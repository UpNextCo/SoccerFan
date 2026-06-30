"""
Scrape per-season, per-competition stats for our fame-floored players from Transfermarkt's
detailed performance page (JS/Svelte grid), into transferdata/tm_seasons.jsonl.

Hardened: a hard per-page timeout (SIGALRM) so a slow page can never wedge the crawl, and EVERY
player gets an output line (even on failure) so it's marked done and never retried/re-hung. The
browser is restarted after a timeout or every BATCH players. Resumable (skips done ourIds).

Usage:  ./.venv/bin/python scripts/tm_scrape_seasons.py [limit]
"""
import json, os, re, signal, sys, time
from seleniumbase import SB
from bs4 import BeautifulSoup

TARGETS = "transferdata/tm_targets.json"
OUT = "transferdata/tm_seasons.jsonl"
PAGE_TIMEOUT = 45   # hard cap per player (seconds)
BATCH = 120         # restart the browser every N players


class PageTimeout(Exception):
    pass


def _alarm(_s, _f):
    raise PageTimeout()


signal.signal(signal.SIGALRM, _alarm)


def season_year(s):
    m = re.match(r"(\d{2})/(\d{2})", s.strip())
    if not m:
        return None
    yy = int(m.group(1))
    return (1900 + yy) if yy > 30 else (2000 + yy)


def num(x):
    x = x.replace(",", "").replace("'", "").strip()
    if x in ("", "-"):
        return 0
    try:
        return int(x)
    except ValueError:
        return 0


def parse(html):
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for r in soup.select('[class*="grid-row"]'):
        cs = [c.get_text(" ", strip=True) for c in r.select('[class*="tm-grid__cell"]')]
        if len(cs) < 16:
            continue
        yr = season_year(cs[0])
        if yr is None:
            continue
        rows.append({"season": yr, "comp": cs[1], "apps": num(cs[3]),
                     "goals": num(cs[5]), "assists": num(cs[6]), "minutes": num(cs[15])})
    return rows


def load_done():
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                done.add(json.loads(line)["ourId"])
            except Exception:
                pass
    return done


def main():
    targets = json.load(open(TARGETS))
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(targets)

    processed = 0
    while True:
        done = load_done()
        todo = [t for t in targets if t["ourId"] not in done]
        if not todo or processed >= limit:
            break
        batch = todo[: min(BATCH, limit - processed)]
        print(f"[batch] {len(batch)} players (done {len(done)})", flush=True)
        try:
            with SB(uc=True, headless=True) as sb:
                try:
                    sb.set_page_load_timeout(30)
                except Exception:
                    pass
                with open(OUT, "a") as out:
                    for t in batch:
                        code = t.get("code") or "x"
                        url = (f"https://www.transfermarkt.com/{code}/leistungsdatendetails/spieler/"
                               f"{t['tmId']}/saison/ges/verein/0/liga/0/wettbewerb//pos/0/trainer_id/0/plus/1")
                        rows, timed_out = [], False
                        signal.alarm(PAGE_TIMEOUT)
                        try:
                            sb.open(url)
                            sb.sleep(1.5)
                            try:
                                sb.click('input[type="submit"], button[type="submit"]')
                                sb.sleep(1.5)
                            except Exception:
                                pass
                            rows = parse(sb.get_page_source())
                        except PageTimeout:
                            timed_out = True
                            print("  TIMEOUT", t["name"], flush=True)
                        except Exception as e:
                            print("  ERR", t["name"], repr(e)[:80], flush=True)
                        finally:
                            signal.alarm(0)
                        out.write(json.dumps({"ourId": t["ourId"], "tmId": t["tmId"], "rows": rows}) + "\n")
                        out.flush()
                        processed += 1
                        if processed % 25 == 0:
                            print(processed, t["name"], len(rows), "rows", flush=True)
                        if timed_out:
                            print("  -> restarting browser", flush=True)
                            break  # leave SB context, fresh browser next batch
                        time.sleep(0.5)
        except Exception as e:
            print("[batch crashed, restarting]", repr(e)[:120], flush=True)
            time.sleep(2)
    print("done", flush=True)


if __name__ == "__main__":
    main()
