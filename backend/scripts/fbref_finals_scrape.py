"""
FBref finals scraper — Champions League / World Cup / Euro finals (all eras).

Major-final lineups + goalscorers come from FBref match-report pages. Competition
"history" pages give every final's match-report URL + the champion, so we:
  1. discover finals (comp, season, champion, match_url) from history pages, then
  2. parse each final's match report for the two lineups (starters/subs) + goals.

Output feeds job:import-finals. Powers "scored in a CL final", "started a World Cup
final", "played in a Champions League final", "won the …" prompts.

Uses SeleniumBase undetected-Chrome (Cloudflare) + the comment-strip trick (FBref hides
most tables in HTML comments). Needs beautifulsoup4 + pandas + lxml.

Usage:
  source .venv/bin/activate
  pip install beautifulsoup4 lxml                      # if not already present
  python3 scripts/fbref_finals_scrape.py probe <match_url>   # dump ONE final's structure
  python3 scripts/fbref_finals_scrape.py list                # list discovered finals
  python3 scripts/fbref_finals_scrape.py                      # scrape all -> fbref_finals.json

If headless returns nothing (Cloudflare), prepend HEADLESS=0.
"""
import json
import math
import os
import re
import sys
import time
from io import StringIO

import pandas as pd
from bs4 import BeautifulSoup
from seleniumbase import Driver

COMPS = [
    {"comp_id": 8, "name": "Champions League", "history": "https://fbref.com/en/comps/8/history/Champions-League-Seasons"},
    {"comp_id": 1, "name": "World Cup", "history": "https://fbref.com/en/comps/1/history/World-Cup-Seasons"},
    {"comp_id": 676, "name": "Euro", "history": "https://fbref.com/en/comps/676/history/UEFA-Euro-Seasons"},
]

OUT_PATH = "fbref_finals.json"
REQUEST_DELAY_S = 5
MIN_SEASON = 1992  # our player data starts ~1995; a little earlier is harmless


def s(v):
    return str(v).strip() if v is not None and not (isinstance(v, float) and math.isnan(v)) else ""


def to_int(v, default=0):
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return default
        return int(float(v))
    except (ValueError, TypeError):
        return default


def season_start(season_text):
    m = re.search(r"\d{4}", season_text)
    return to_int(m.group(0)) if m else 0


def norm(txt):
    return re.sub(r"[^a-z0-9]+", " ", s(txt).lower()).strip()


def strip_flag(txt):
    """National-team champions carry a flag-code prefix ("fr France"). Drop it."""
    t = s(txt)
    parts = t.split(" ", 1)
    if len(parts) == 2 and parts[0].islower() and 2 <= len(parts[0]) <= 3:
        return parts[1].strip()
    return t


def flat(col):
    if isinstance(col, tuple):
        top, sub = str(col[0]), str(col[-1])
        if top.startswith("Unnamed") or top in ("nan", ""):
            return sub
        return f"{top}_{sub}"
    return str(col)


def get_page(driver, url):
    driver.uc_open_with_reconnect(url, 6)
    time.sleep(REQUEST_DELAY_S)
    return driver.page_source.replace("<!--", "").replace("-->", "")


def discover_finals(driver):
    """Return [{comp, season, season_text, champion, url}] from history pages."""
    finals = []
    for comp in COMPS:
        try:
            html = get_page(driver, comp["history"])
        except Exception as exc:  # noqa: BLE001
            print(f"  history skip {comp['name']}: {exc}", file=sys.stderr)
            continue

        # champion-by-season from the parsed table (header-based, robust)
        champ_by_season = {}
        try:
            tables = pd.read_html(StringIO(html))
            for df in tables:
                df2 = df.copy()
                df2.columns = [flat(c) for c in df2.columns]
                cols = {c.lower(): c for c in df2.columns}
                c_season = next((cols[k] for k in cols if "season" in k or k == "year"), None)
                c_champ = next((cols[k] for k in cols if "champion" in k or "winner" in k), None)
                if c_season and c_champ:
                    for _, r in df2.iterrows():
                        champ_by_season[season_start(s(r.get(c_season)))] = s(r.get(c_champ))
                    break
        except Exception as exc:  # noqa: BLE001
            print(f"  history table parse {comp['name']}: {exc}", file=sys.stderr)

        # match-report url-by-season from the row links
        soup = BeautifulSoup(html, "lxml")
        for tr in soup.find_all("tr"):
            link = tr.find("a", href=re.compile(r"/en/matches/[0-9a-f]{6,}/"))
            if not link:
                continue
            row_text = tr.get_text(" ", strip=True)
            yr = season_start(row_text)
            if yr < MIN_SEASON:
                continue
            url = "https://fbref.com" + link["href"]
            finals.append(
                {
                    "comp": comp["name"],
                    "season": yr,
                    "champion": champ_by_season.get(yr, ""),
                    "url": url,
                }
            )
    # de-dupe by (comp, season)
    seen = set()
    out = []
    for f in finals:
        k = (f["comp"], f["season"])
        if k in seen:
            continue
        seen.add(k)
        out.append(f)
    out.sort(key=lambda f: (f["comp"], f["season"]))
    return out


def parse_lineups(html):
    """Return list of (team_name, [(player, started)]) for the 2 lineup tables."""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for div in soup.select("div.lineup")[:2]:
        table = div.find("table")
        if not table:
            continue
        header = table.find("th")
        team = re.sub(r"\(.*?\)", "", header.get_text(" ", strip=True)).strip() if header else ""
        players = []
        for tr in table.find_all("tr"):
            a = tr.find("a", href=re.compile(r"/en/players/"))
            if not a:
                continue
            players.append(a.get_text(strip=True))
        # first 11 player rows = starters
        rows = [(p, i < 11) for i, p in enumerate(players)]
        out.append((team, rows))
    return out


def parse_goals(html):
    """player_name -> (goals, minutes) from per-team summary tables."""
    goals = {}
    try:
        tables = pd.read_html(StringIO(html), attrs=None)
    except ValueError:
        return goals
    soup = BeautifulSoup(html, "lxml")
    summary_ids = [t.get("id", "") for t in soup.find_all("table") if t.get("id", "").endswith("_summary")]
    # pandas tables order matches table order in HTML; re-read by id for safety
    for tid in summary_ids:
        try:
            df = pd.read_html(StringIO(html), attrs={"id": tid})[0]
        except (ValueError, IndexError):
            continue
        df.columns = [flat(c) for c in df.columns]
        cols = {c.lower(): c for c in df.columns}
        c_player = next((cols[k] for k in cols if k == "player"), None)
        c_gls = next((cols[k] for k in cols if k.endswith("_gls") or k == "gls"), None)
        c_min = next((cols[k] for k in cols if k.endswith("_min") or k == "min"), None)
        if not c_player:
            continue
        for _, r in df.iterrows():
            name = s(r.get(c_player))
            if not name or name.lower() == "player":
                continue
            # FBref summary tables end with a totals row like "14 Players" — skip it.
            if re.match(r"^\d+\s+players?$", name.lower()):
                continue
            goals[name] = (to_int(r.get(c_gls)) if c_gls else 0, to_int(r.get(c_min)) if c_min else 0)
    return goals


def page_loaded(html):
    """True if the match page actually rendered (has a scorebox), vs a Cloudflare
    challenge / blocked response. Old finals load fine but simply have no lineups."""
    return 'class="scorebox"' in html or "scorebox" in html[:20000]


def scrape_final(driver, final):
    # Retry ONLY when the page didn't load (blocked). If it loaded but has no lineups,
    # this final just predates FBref's lineup data — accept and move on (no wasted retries).
    lineups = []
    html = ""
    for attempt in range(3):
        html = get_page(driver, final["url"])
        lineups = parse_lineups(html)
        if lineups:
            break
        if page_loaded(html):
            print(f"    no lineup data on FBref for {final['comp']} {final['season']} — skipping", file=sys.stderr)
            break
        print(f"    page blocked, retry {attempt + 1}/3 for {final['comp']} {final['season']}", file=sys.stderr)
        time.sleep(8 * (attempt + 1))
    goals = parse_goals(html)
    champ_norm = norm(strip_flag(final["champion"]))
    have_summary = len(goals) > 0
    rows = []
    for team, players in lineups:
        won = champ_norm != "" and norm(team) == champ_norm
        for player, started in players:
            g, mins = goals.get(player, (0, 0))
            if started:
                minutes = mins if mins else 90
            elif have_summary:
                # bench: only keep players who actually came on (minutes > 0)
                if mins <= 0:
                    continue
                minutes = mins
            else:
                # no summary table (old final) — can't confirm subs; keep starters only
                continue
            rows.append(
                {
                    "competition": final["comp"],
                    "season": final["season"],
                    "team": team,
                    "won": won,
                    "player": player,
                    "started": started,
                    "minutes": minutes,
                    "goals": g,
                }
            )
    return rows


def probe(driver, url):
    html = get_page(driver, url)
    soup = BeautifulSoup(html, "lxml")
    print(f"=== PROBE {url} ===")
    divs = soup.select("div.lineup")
    print(f".lineup divs: {len(divs)}")
    for i, div in enumerate(divs[:2]):
        table = div.find("table")
        header = table.find("th").get_text(" ", strip=True) if table and table.find("th") else "?"
        players = [a.get_text(strip=True) for a in table.find_all("a", href=re.compile(r"/en/players/"))] if table else []
        print(f"  lineup[{i}] header={header!r} players({len(players)})={players}")
    sids = [t.get("id") for t in soup.find_all("table") if (t.get("id") or "").endswith("_summary")]
    print(f"summary tables: {sids}")
    g = parse_goals(html)
    scorers = {k: v for k, v in g.items() if v[0] > 0}
    print(f"scorers parsed: {scorers}")


def make_driver():
    headless = os.environ.get("HEADLESS", "1") != "0"
    return Driver(uc=True, headless=headless)


# Restart the browser session every N finals to dodge Cloudflare session throttling.
RESTART_EVERY = 10


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "full"
    driver = make_driver()
    try:
        if mode == "probe":
            probe(driver, sys.argv[2])
            return
        finals = discover_finals(driver)
        print(f"Discovered {len(finals)} finals", file=sys.stderr)
        for f in finals:
            print(f"  {f['comp']} {f['season']}: champion={f['champion']!r} {f['url']}", file=sys.stderr)
        if mode == "list":
            return
        rows = []
        for i, f in enumerate(finals):
            try:
                r = scrape_final(driver, f)
                rows.extend(r)
                print(f"  {f['comp']} {f['season']}: {len(r)} players", file=sys.stderr)
            except Exception as exc:  # noqa: BLE001
                print(f"  FAIL {f['comp']} {f['season']}: {exc}", file=sys.stderr)
            if (i + 1) % RESTART_EVERY == 0 and i + 1 < len(finals):
                driver.quit()
                driver = make_driver()
        with open(OUT_PATH, "w") as fh:
            json.dump(rows, fh)
        print(f"Wrote {len(rows)} rows to {OUT_PATH}")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
