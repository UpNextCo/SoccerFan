"""
Requeue players for the Transfermarkt season scrape.

tm_scrape_seasons.py treats "done" as (scraped in tm_seasons.jsonl) UNION (listed in tm_attempted.txt),
marking a player attempted BEFORE fetching so a browser hang is never retried into another hang. Two
situations need that memory cleared:

  --orphans        the crawl was killed mid-batch, leaving players marked attempted but never scraped
  --ids FILE       a stored scrape is known-bad (e.g. scraped before a parser fix) and must be redone

Usage:
  ./.venv/bin/python scripts/tm_forget.py --orphans
  ./.venv/bin/python scripts/tm_forget.py --ids transferdata/tm_rescrape.txt
  ./.venv/bin/python scripts/tm_forget.py --orphans --empty   # also redo scrapes that returned no rows
"""
import json
import os
import sys

OUT = "transferdata/tm_seasons.jsonl"
ATTEMPTED = "transferdata/tm_attempted.txt"


def read_scraped():
    """ourId -> number of rows stored, for every line in the jsonl."""
    rows = {}
    if os.path.exists(OUT):
        for line in open(OUT):
            try:
                d = json.loads(line)
            except Exception:
                continue
            rows[d["ourId"]] = len(d.get("rows") or [])
    return rows


def main():
    args = sys.argv[1:]
    scraped = read_scraped()
    forget = set()

    if "--ids" in args:
        path = args[args.index("--ids") + 1]
        for line in open(path):
            pid = line.strip()
            if pid:
                forget.add(pid)
        print(f"ids requested       : {len(forget)}")

    if "--empty" in args:
        empty = {pid for pid, n in scraped.items() if n == 0}
        forget |= empty
        print(f"empty scrapes       : {len(empty)}")

    attempted = []
    if os.path.exists(ATTEMPTED):
        attempted = [l.strip() for l in open(ATTEMPTED) if l.strip()]

    if "--orphans" in args:
        orphans = {pid for pid in attempted if pid not in scraped}
        forget |= orphans
        print(f"attempted, no result: {len(orphans)}")

    if not forget:
        print("nothing to requeue")
        return

    kept = [pid for pid in attempted if pid not in forget]
    with open(ATTEMPTED, "w") as f:
        for pid in kept:
            f.write(pid + "\n")

    dropped = 0
    if os.path.exists(OUT):
        lines = []
        for line in open(OUT):
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d["ourId"] in forget:
                dropped += 1
                continue
            lines.append(line if line.endswith("\n") else line + "\n")
        with open(OUT, "w") as f:
            f.writelines(lines)

    print(f"requeued            : {len(forget)}")
    print(f"jsonl lines dropped : {dropped}")
    print(f"attempted rows kept : {len(kept)}")


if __name__ == "__main__":
    main()
