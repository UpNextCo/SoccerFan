"""
Direct FBref scraper for EFL leagues + English cups.

soccerdata only ships the big-5, so this fetches each competition's Standard Stats
page via SeleniumBase (Cloudflare bypass) and writes JSON for job:import-fbref.

Usage:
  source .venv/bin/activate
  python3 scripts/fbref_efl_scrape.py                 # 1992 through last completed season
  python3 scripts/fbref_efl_scrape.py 2004 2017       # custom start/end (season start years)
  COMPS=10,15 python3 scripts/fbref_efl_scrape.py     # Championship + League One only

Then:
  npx tsx src/jobs/import-fbref.ts fbref_efl_backfill.json

If every season returns 0 rows (Cloudflare), re-run with a visible browser:
  HEADLESS=0 python3 scripts/fbref_efl_scrape.py
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from io import StringIO

import pandas as pd
from seleniumbase import Driver

# (FBref comp id, our api-football league id, league name, URL slug)
COMPS = [
    (10, 40, "Championship", "Championship"),
    (15, 41, "League One", "League-One"),
    (16, 42, "League Two", "League-Two"),
    (514, 45, "FA Cup", "FA-Cup"),
    (690, 48, "EFL Cup", "EFL-Cup"),
]

OUT_PATH = os.environ.get("FBREF_EFL_OUT", "fbref_efl_backfill.json")
REQUEST_DELAY_S = 4


def s(v):
    return str(v).strip() if v is not None and not (isinstance(v, float) and math.isnan(v)) else ""


def to_int(v, default=0):
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return default
        return int(float(v))
    except (ValueError, TypeError):
        return default


def parse_age(v):
    txt = s(v)
    return to_int(txt.split("-")[0]) if txt else 0


def clean_nation(v):
    parts = s(v).split()
    return parts[-1].upper() if parts else None


def flat(col):
    if isinstance(col, tuple):
        top, sub = str(col[0]), str(col[-1])
        if top.startswith("Unnamed") or top in ("nan", ""):
            return sub
        return f"{top}_{sub}"
    return str(col)


def find_col(cols, *cands):
    lower = {c.lower(): c for c in cols}
    for cand in cands:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def parse_table(html, lid, lname, start_year):
    cleaned = html.replace("<!--", "").replace("-->", "")
    try:
        tables = pd.read_html(StringIO(cleaned), attrs={"id": "stats_standard"})
    except ValueError:
        try:
            tables = pd.read_html(StringIO(cleaned), attrs={"id": "stats_standard_dom_lg"})
        except ValueError:
            return []
    if not tables:
        return []

    df = tables[0]
    df.columns = [flat(c) for c in df.columns]
    cols = list(df.columns)

    c_player = find_col(cols, "Player")
    if not c_player:
        return []
    c_squad = find_col(cols, "Squad", "Team")
    c_nation = find_col(cols, "Nation", "Nationality")
    c_pos = find_col(cols, "Pos", "Position")
    c_age = find_col(cols, "Age")
    c_mp = find_col(cols, "Playing Time_MP", "MP")
    c_min = find_col(cols, "Playing Time_Min", "Min")
    c_gls = find_col(cols, "Performance_Gls", "Gls")
    c_ast = find_col(cols, "Performance_Ast", "Ast")
    c_cy = find_col(cols, "Performance_CrdY", "CrdY")
    c_cr = find_col(cols, "Performance_CrdR", "CrdR")

    out = []
    for _, r in df.iterrows():
        name = s(r.get(c_player))
        if not name or name.lower() == "player":
            continue
        out.append(
            {
                "player": name,
                "team": s(r.get(c_squad)) if c_squad else "",
                "nation": clean_nation(r.get(c_nation)) if c_nation else None,
                "pos": s(r.get(c_pos)) if c_pos else "",
                "age": parse_age(r.get(c_age)) if c_age else 0,
                "leagueId": lid,
                "leagueName": lname,
                "season": start_year,
                "games": to_int(r.get(c_mp)) if c_mp else 0,
                "minutes": to_int(r.get(c_min)) if c_min else 0,
                "goals": to_int(r.get(c_gls)) if c_gls else 0,
                "assists": to_int(r.get(c_ast)) if c_ast else 0,
                "yellow": to_int(r.get(c_cy)) if c_cy else 0,
                "red": to_int(r.get(c_cr)) if c_cr else 0,
            }
        )
    return out


def selected_comps():
    raw = os.environ.get("COMPS", "").strip()
    if not raw:
        return COMPS
    wanted = {int(tok) for tok in raw.split(",") if tok.strip().isdigit()}
    return [c for c in COMPS if c[0] in wanted]


def last_completed_start_year(now=None):
    now = now or datetime.now(timezone.utc)
    year = now.year
    month = now.month
    if month >= 8:
        return year - 1
    return year - 1 if month >= 6 else year - 2


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1992
    end = int(sys.argv[2]) if len(sys.argv) > 2 else last_completed_start_year()
    headless = os.environ.get("HEADLESS", "1") != "0"
    comps = selected_comps()
    if not comps:
        print("COMPS matched no competitions.", file=sys.stderr)
        sys.exit(1)

    driver = Driver(uc=True, headless=headless)
    rows = []
    try:
        for comp_id, lid, lname, slug in comps:
            for year in range(start, end + 1):
                season = f"{year}-{year + 1}"
                url = f"https://fbref.com/en/comps/{comp_id}/{season}/stats/{season}-{slug}-Stats"
                try:
                    driver.uc_open_with_reconnect(url, 6)
                    time.sleep(REQUEST_DELAY_S)
                    extracted = parse_table(driver.page_source, lid, lname, year)
                except Exception as exc:  # noqa: BLE001
                    print(f"  skip {lname} {season}: {exc}", file=sys.stderr)
                    continue
                rows.extend(extracted)
                print(f"  {lname} {season}: {len(extracted)} players", file=sys.stderr)
    finally:
        driver.quit()

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
