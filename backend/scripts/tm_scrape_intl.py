"""
Scrape senior international caps + goals from Transfermarkt into transferdata/tm_intl.jsonl.

Why: player_extra_stats.intl_caps came from Transfermarkt's players.csv, which sometimes stored CLUB
appearances in that field (Iker Muniain 270 caps, really 2; Massimo Maccarone 250, really 2), and
intl_goals came from Wikipedia lists that miss plenty of real scorers (Bale 0, really 40; Son 0,
really 56). Both numbers sit in the header of a player's national-team page, so one cheap fetch gives
a consistent pair from a single source.

No browser needed — this page is plain server-rendered HTML, unlike the Svelte performance grid that
tm_scrape_seasons.py has to drive Chrome for. Resumable: players already in the jsonl are skipped.

Usage:
  ./.venv/bin/python scripts/tm_scrape_intl.py [--limit N] [--delay SECONDS] [--workers N]
"""
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TARGETS = "transferdata/tm_targets.json"
OUT = "transferdata/tm_intl.jsonl"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# "Current international: Portugal" / "Former International: England". A youth-only player shows a
# U-team here (e.g. "Germany U21"), which must not be stored as senior caps — the importer decides.
TEAM_RE = re.compile(r'(Current international|Former International|Former international)\s*:.*?<a title="([^"]+)"', re.S)
CAPS_RE = re.compile(r'Caps/Goals:.*?highlight"[^>]*>\s*([\d.,]+)\s*</a>\s*/\s*<a[^>]*>\s*([\d.,]+)', re.S)

# Every national team the player is on record for, e.g. {"19753":"French Guiana","3377":"France",...}.
# The header above describes only ONE of them — the latest — so for anyone who represented two senior
# sides it can be the wrong one entirely (Malouda's 4 French Guiana caps in place of his 80 for
# France; Šuker's 2 Yugoslavia caps in place of 69 for Croatia). Per-team numbers are only rendered by
# JavaScript, so the importer treats a multi-team player as ambiguous and leaves their stored value be.
TEAM_LIST_RE = re.compile(r"window\.nationalTeamsListData\s*=\s*JSON\.parse\('(.*?)'\)", re.S)


def num(x):
    x = x.replace(".", "").replace(",", "").strip()
    return int(x) if x.isdigit() else None


def fetch(url, attempts=3):
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            print(f"  HTTP {e.code} — retry {i + 1}", flush=True)
        except Exception as e:
            print(f"  {type(e).__name__} — retry {i + 1}", flush=True)
        time.sleep(3 * (i + 1))
    return None


def team_list(html):
    """All national teams on the player's record, from the inline JSON the filter dropdown uses."""
    m = TEAM_LIST_RE.search(html)
    if not m:
        return []
    try:
        # The value is a JS string literal holding JSON, so quotes arrive backslash-escaped.
        return sorted(json.loads(m.group(1).replace("\\\"", "\"").replace("\\\\", "\\")).values())
    except Exception:
        return []


def scrape_one(t):
    code = t.get("code") or "x"
    html = fetch(f"https://www.transfermarkt.com/{code}/nationalmannschaft/spieler/{t['tmId']}")
    rec = {"ourId": t["ourId"], "tmId": t["tmId"], "team": None, "caps": None, "goals": None, "teams": []}
    if html:
        rec["teams"] = team_list(html)
        html = re.sub(r"<script.*?</script>", "", html, flags=re.S)
        team = TEAM_RE.search(html)
        cg = CAPS_RE.search(html)
        if team:
            rec["team"] = team.group(2).strip()
        if cg:
            rec["caps"] = num(cg.group(1))
            rec["goals"] = num(cg.group(2))
    return rec


def main():
    args = sys.argv[1:]
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    delay = float(args[args.index("--delay") + 1]) if "--delay" in args else 2.0
    workers = int(args[args.index("--workers") + 1]) if "--workers" in args else 1

    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                done.add(json.loads(line)["ourId"])
            except Exception:
                pass

    targets = [t for t in json.load(open(TARGETS)) if t["ourId"] not in done]
    if limit:
        targets = targets[:limit]
    print(f"{len(targets)} players to fetch ({len(done)} already done), {workers} worker(s)", flush=True)

    out = open(OUT, "a")
    lock = threading.Lock()
    state = {"found": 0, "blank": 0, "n": 0}

    def work(t):
        rec = scrape_one(t)
        with lock:
            state["n"] += 1
            if rec["caps"] is None:
                state["blank"] += 1
            else:
                state["found"] += 1
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            if state["n"] % 100 == 0:
                print(f"  {state['n']}/{len(targets)} — {state['found']} with caps, {state['blank']} without", flush=True)
        time.sleep(delay)  # per worker, so total rate is workers/delay

    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(work, targets))
    else:
        for t in targets:
            work(t)
    print(f"done: {state['found']} with caps, {state['blank']} without", flush=True)


if __name__ == "__main__":
    main()
