"""
Direct FBref international-tournament scraper (World Cup + European Championship).

Mirrors fbref_cl_scrape.py: fetches each tournament's "Standard Stats" page via
SeleniumBase's undetected-Chrome driver (Cloudflare bypass) and parses the player
table with pandas. International tournaments are single-year seasons (e.g. 2006),
and the "Squad" column is the national TEAM (Brazil, France, ...) — exactly what
powers World Cup XI and "played at the 2006 World Cup" prompts.

Output feeds job:import-fbref (same row shape as the league/CL backfills), so the
World Cup lands as player_stats rows with leagueId=1 / Euro leagueId=4.

Usage:
  source .venv/bin/activate
  python3 scripts/fbref_intl_scrape.py             # all WCs + Euros 1994-2022
  python3 scripts/fbref_intl_scrape.py wc           # World Cups only
  python3 scripts/fbref_intl_scrape.py euro          # Euros only

If every season returns 0 rows (Cloudflare), re-run with a visible browser:
  HEADLESS=0 python3 scripts/fbref_intl_scrape.py
"""
import json
import math
import os
import sys
import time
from io import StringIO

import pandas as pd
from seleniumbase import Driver

# FBref comp id, our leagueId (matching api-football), league name, url slug, years.
# World Cup = comp 1, European Championship = comp 676. Tournaments are quadrennial.
TOURNAMENTS = {
    "wc": {
        "comp_id": 1,
        "league_id": 1,
        "league_name": "World Cup",
        "slug": "World-Cup-Stats",
        "years": [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022],
    },
    "euro": {
        "comp_id": 676,
        "league_id": 4,
        "league_name": "Euro",
        "slug": "UEFA-Euro-Stats",
        "years": [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024],
    },
    "copa": {
        "comp_id": 685,
        "league_id": 9,  # api-football Copa América id
        "league_name": "Copa America",
        "slug": "Copa-America-Stats",
        "years": [2007, 2011, 2015, 2016, 2019, 2021, 2024],
    },
    "afcon": {
        "comp_id": 656,
        "league_id": 6,  # api-football Africa Cup of Nations id
        "league_name": "Africa Cup of Nations",
        "slug": "Africa-Cup-of-Nations-Stats",
        "years": [2008, 2010, 2012, 2013, 2015, 2017, 2019, 2021, 2023],
    },
}

OUT_PATH = "fbref_intl_backfill.json"
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


def clean_team(v):
    """International "Squad" cells are prefixed with a lowercase flag code, e.g.
    "it Italy", "eng England", "kr South Korea". Strip the leading code token."""
    txt = s(v)
    parts = txt.split(" ", 1)
    if len(parts) == 2 and parts[0].islower() and 2 <= len(parts[0]) <= 3:
        return parts[1].strip()
    return txt


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


def parse_table(html, lid, lname, year):
    cleaned = html.replace("<!--", "").replace("-->", "")
    try:
        tables = pd.read_html(StringIO(cleaned), attrs={"id": "stats_standard"})
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
        # For national-team comps the player's NATION is the team. FBref's "Squad"
        # column already holds the country; "Nation" duplicates it. Use Squad as team.
        team = clean_team(r.get(c_squad)) if c_squad else ""
        out.append(
            {
                "player": name,
                "team": team,
                "nation": clean_nation(r.get(c_nation)) if c_nation else None,
                "pos": s(r.get(c_pos)) if c_pos else "",
                "age": parse_age(r.get(c_age)) if c_age else 0,
                "leagueId": lid,
                "leagueName": lname,
                "season": year,
                "games": to_int(r.get(c_mp)) if c_mp else 0,
                "minutes": to_int(r.get(c_min)) if c_min else 0,
                "goals": to_int(r.get(c_gls)) if c_gls else 0,
                "assists": to_int(r.get(c_ast)) if c_ast else 0,
                "yellow": to_int(r.get(c_cy)) if c_cy else 0,
                "red": to_int(r.get(c_cr)) if c_cr else 0,
            }
        )
    return out


def main():
    which = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    keys = ["wc", "euro", "copa", "afcon"] if which == "all" else [which]
    headless = os.environ.get("HEADLESS", "1") != "0"

    driver = Driver(uc=True, headless=headless)
    rows = []
    try:
        for k in keys:
            t = TOURNAMENTS[k]
            for year in t["years"]:
                url = f"https://fbref.com/en/comps/{t['comp_id']}/{year}/stats/{year}-{t['slug']}"
                try:
                    driver.uc_open_with_reconnect(url, 6)
                    time.sleep(REQUEST_DELAY_S)
                    extracted = parse_table(driver.page_source, t["league_id"], t["league_name"], year)
                except Exception as exc:  # noqa: BLE001 - one bad season shouldn't abort all
                    print(f"  skip {t['league_name']} {year}: {exc}", file=sys.stderr)
                    continue
                rows.extend(extracted)
                print(f"  {t['league_name']} {year}: {len(extracted)} players", file=sys.stderr)
    finally:
        driver.quit()

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
