"""
Scrape per-season/per-competition stats for our fame-floored players from Transfermarkt's detailed
performance page (JS/Svelte grid) into transferdata/tm_seasons.jsonl.

Robust against TM's hangs via OS-level isolation: an ORCHESTRATOR runs each batch in a child
process it can hard-kill on a wall-clock timeout (so a poisoned browser can never wedge the crawl),
and every player is marked "attempted" BEFORE scraping so a killed player is skipped on resume
(never retried into another hang). Resumable; done = scraped (jsonl) ∪ attempted.

Usage:
  ./.venv/bin/python scripts/tm_scrape_seasons.py            # orchestrator (full crawl)
  ./.venv/bin/python scripts/tm_scrape_seasons.py --worker N # one batch of N (used internally)
  TM_TARGETS=transferdata/tm_efl_targets.json ./.venv/bin/python scripts/tm_scrape_seasons.py
"""
import json, os, re, signal, subprocess, sys, time

TARGETS = os.environ.get("TM_TARGETS", "transferdata/tm_targets.json")
OUT = os.environ.get("TM_SEASONS_OUT", "transferdata/tm_seasons.jsonl")
ATTEMPTED = os.environ.get("TM_ATTEMPTED", "transferdata/tm_attempted.txt")
BATCH = 40
BATCH_TIMEOUT = 700   # seconds; a healthy 40-player batch is ~6 min, so this only fires on a hang


def load_done():
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                done.add(json.loads(line)["ourId"])
            except Exception:
                pass
    if os.path.exists(ATTEMPTED):
        for line in open(ATTEMPTED):
            done.add(line.strip())
    return done


def remaining():
    targets = json.load(open(TARGETS))
    done = load_done()
    return [t for t in targets if t["ourId"] not in done]


# ---------------- worker: scrape one batch in its own process ----------------
def season_year(s):
    """Start year of a TM season label.

    Split-season leagues label rows "23/24", but calendar-year leagues (MLS, Brasileirao, Liga MX,
    J1, pre-2011 Russia, Scandinavia) label them "2023". Only accepting the first form silently
    dropped every one of those competitions -- Henry's Red Bulls and Zlatan's Galaxy goals vanished.
    """
    s = s.strip()
    m = re.match(r"^(\d{2})/(\d{2})$", s)
    if m:
        yy = int(m.group(1))
        return (1900 + yy) if yy > 30 else (2000 + yy)
    m = re.match(r"^(\d{4})$", s)
    if m:
        yr = int(m.group(1))
        return yr if 1880 <= yr <= 2100 else None
    return None


def num(x):
    x = x.replace(",", "").replace("'", "").strip()
    if x in ("", "-"):
        return 0
    try:
        return int(x)
    except ValueError:
        return 0


def run_worker(limit):
    from seleniumbase import SB
    from bs4 import BeautifulSoup

    class PT(Exception):
        pass

    def alarm(_s, _f):
        raise PT()
    signal.signal(signal.SIGALRM, alarm)

    batch = remaining()[:limit]
    if not batch:
        return
    att = open(ATTEMPTED, "a")
    out = open(OUT, "a")
    with SB(uc=True, headless=True) as sb:
        try:
            sb.set_page_load_timeout(30)
        except Exception:
            pass
        for t in batch:
            att.write(t["ourId"] + "\n"); att.flush()  # mark BEFORE, so a hang isn't retried
            code = t.get("code") or "x"
            url = (f"https://www.transfermarkt.com/{code}/leistungsdatendetails/spieler/"
                   f"{t['tmId']}/saison/ges/verein/0/liga/0/wettbewerb//pos/0/trainer_id/0/plus/1")
            rows = []
            signal.alarm(40)
            try:
                sb.open(url)
                sb.sleep(1.5)
                try:
                    sb.click('input[type="submit"], button[type="submit"]')
                    sb.sleep(1.5)
                except Exception:
                    pass
                soup = BeautifulSoup(sb.get_page_source(), "html.parser")
                for r in soup.select('[class*="grid-row"]'):
                    cs = [c.get_text(" ", strip=True) for c in r.select('[class*="tm-grid__cell"]')]
                    if len(cs) < 16:
                        continue
                    yr = season_year(cs[0])
                    if yr is None:
                        continue
                    rows.append({"season": yr, "comp": cs[1], "apps": num(cs[3]),
                                 "goals": num(cs[5]), "assists": num(cs[6]), "minutes": num(cs[15])})
            except PT:
                print("  TIMEOUT", t["name"], flush=True)
                signal.alarm(0)
                out.write(json.dumps({"ourId": t["ourId"], "tmId": t["tmId"], "rows": []}) + "\n"); out.flush()
                break  # poisoned driver — let the orchestrator start a fresh child
            except Exception as e:
                print("  ERR", t["name"], repr(e)[:80], flush=True)
            finally:
                signal.alarm(0)
            out.write(json.dumps({"ourId": t["ourId"], "tmId": t["tmId"], "rows": rows}) + "\n"); out.flush()
            time.sleep(0.4)


# ---------------- orchestrator: loop, kill hung children ----------------
def main():
    if "--worker" in sys.argv:
        run_worker(int(sys.argv[sys.argv.index("--worker") + 1]))
        return

    while True:
        rem = remaining()
        if not rem:
            break
        print(f"[orchestrator] {len(rem)} left", flush=True)
        p = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--worker", str(BATCH)],
                             start_new_session=True)
        try:
            p.wait(timeout=BATCH_TIMEOUT)
        except subprocess.TimeoutExpired:
            print("[orchestrator] batch hung — killing child + chrome", flush=True)
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except Exception:
                pass
            subprocess.run(["pkill", "-9", "-f", "Google Chrome for Testing|chromedriver|uc_driver|undetected"],
                          stderr=subprocess.DEVNULL)
            time.sleep(2)
    print("done", flush=True)


if __name__ == "__main__":
    main()
