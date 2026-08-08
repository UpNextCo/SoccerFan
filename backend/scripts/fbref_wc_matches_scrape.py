"""
FBref World Cup game-by-game scraper (2006 onwards).

Walks each tournament's "Scores & Fixtures" page to discover every match (round/stage,
home, away, date, match-report URL), then parses each match report's event feed
(#events_wrap) for goals, penalty goals, own goals and cards — with the minute and the
scoring/booked player. This is the COMPLETE, internally-consistent game-by-game data the
World Cup XI clue validator needs (our old wc_match_events from Wikipedia was patchy and
missed real goals, e.g. semi-final headers).

Output -> fbref_wc_events.json, consumed by job:ingest-wc-events-fbref (which matches each
player to our DB via the wc_squads roster and rebuilds wc_match_events for these years).

Mirrors fbref_finals_scrape.py: SeleniumBase undetected-Chrome (Cloudflare) + the
comment-strip trick + periodic browser restarts.

Usage:
  source .venv/bin/activate
  pip install beautifulsoup4 lxml                       # if not already present
  python3 scripts/fbref_wc_matches_scrape.py probe-sched 2018   # dump one schedule
  python3 scripts/fbref_wc_matches_scrape.py probe <match_url>   # dump one match's events
  python3 scripts/fbref_wc_matches_scrape.py                     # scrape all -> fbref_wc_events.json
  python3 scripts/fbref_wc_matches_scrape.py 2018 2022           # only these years

If headless returns nothing (Cloudflare), prepend HEADLESS=0.
"""
import json
import os
import re
import sys
import time

from bs4 import BeautifulSoup
from seleniumbase import Driver

COMP_ID = 1  # FBref World Cup competition id
YEARS = [2006, 2010, 2014, 2018, 2022, 2026]
OUT_PATH = "fbref_wc_events.json"
REQUEST_DELAY_S = 5
RESTART_EVERY = 12  # restart the browser every N matches to dodge Cloudflare throttling


def stage_of(round_text: str) -> str:
    """Map an FBref 'Round' label to our wc_match_events stage labels."""
    t = (round_text or "").lower()
    if "group" in t:
        return "Group Stage"
    # 48-team 2026 format introduces Round of 32 before Round of 16.
    if "round of 32" in t or "round-of-32" in t or t.strip() in ("r32", "32"):
        return "Round of 32"
    if "round of 16" in t or "round-of-16" in t or t.strip() in ("r16", "16"):
        return "Round of 16"
    if "quarter" in t:
        return "Quarter-finals"
    if "semi" in t:
        return "Semi-finals"
    if "third" in t or "3rd" in t:
        return "3rd Place Final"
    if "final" in t:
        return "Final"
    return round_text or ""


def make_driver():
    headless = os.environ.get("HEADLESS", "1") != "0"
    return Driver(uc=True, headless=headless)


def get_page(driver, url: str) -> str:
    driver.uc_open_with_reconnect(url, 6)
    time.sleep(REQUEST_DELAY_S)
    # FBref hides many tables inside HTML comments; strip them so BeautifulSoup sees everything.
    return driver.page_source.replace("<!--", "").replace("-->", "")


def page_loaded(html: str) -> bool:
    return 'class="scorebox"' in html or "scorebox" in html[:20000] or 'id="events_wrap"' in html


def team_name(cell):
    """Clean national-team name from a schedule cell — the <a> link text (no flag code)."""
    a = cell.find("a")
    return (a.get_text(strip=True) if a else cell.get_text(strip=True)).strip()


def parse_schedule(html: str):
    """Return [{stage, home, away, date, url}] for matches that have a report link."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id=re.compile(r"^sched"))
    if not table:
        return []
    body = table.find("tbody") or table
    out = []
    for tr in body.find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue

        def cell(stat):
            return tr.find(["td", "th"], attrs={"data-stat": stat})

        home_el, away_el = cell("home_team"), cell("away_team")
        if not home_el or not away_el:
            continue
        # The cell text glues on FBref's flag code ("IR Iranir", "ptPortugal"); the team LINK
        # holds the clean name, so prefer the anchor text.
        home = team_name(home_el)
        away = team_name(away_el)
        if not home or not away:
            continue
        report = cell("match_report")
        link = report.find("a", href=re.compile(r"/en/matches/[0-9a-f]{6,}")) if report else None
        if not link:
            continue
        date_el = cell("date")
        round_el = cell("round")
        out.append(
            {
                "stage": stage_of(round_el.get_text(strip=True) if round_el else ""),
                "home": home,
                "away": away,
                "date": date_el.get_text(strip=True) if date_el else "",
                "url": "https://fbref.com" + link["href"],
            }
        )
    return out


# Event-icon class -> (type, detail). Order matters in classify() because "own_goal"/
# "penalty_goal" both contain the substring "goal".
def classify(icon_classes: str):
    c = icon_classes.lower()
    if "own_goal" in c:
        return ("own_goal", "")
    if "penalty_goal" in c:
        return ("goal", "penalty")
    if "goal" in c:
        return ("goal", "")
    if "red_card" in c or "yellow_red_card" in c:
        return ("card", "Red Card")
    if "yellow_card" in c:
        return ("card", "Yellow Card")
    return (None, None)


def parse_minute(text: str):
    m = re.search(r"(\d{1,3})(?:\+\d+)?\s*[\u2019']", text)
    return int(m.group(1)) if m else None


def parse_events(html: str, home: str, away: str):
    """Return event dicts from #events_wrap. side 'a' = home, 'b' = away (team is resolved
    later by squad-matching, so this is only a hint)."""
    soup = BeautifulSoup(html, "lxml")
    wrap = soup.find(id="events_wrap")
    if not wrap:
        return []
    out = []
    for ev in wrap.select("div.event"):
        classes = ev.get("class") or []
        side = "a" if "a" in classes else ("b" if "b" in classes else "")
        icon = ev.find("div", class_="event_icon")
        etype, detail = classify(" ".join(icon.get("class") or []) if icon else "")
        if not etype:
            continue
        a = ev.find("a", href=re.compile(r"/en/players/"))
        if not a:
            continue
        out.append(
            {
                "side": side,
                "player": a.get_text(strip=True),
                "minute": parse_minute(ev.get_text(" ", strip=True)),
                "type": etype,
                "detail": detail,
            }
        )
    return out


def scrape_match(driver, m):
    """Return event rows (with match context) for one fixture, retrying only on a blocked page."""
    html = ""
    for attempt in range(3):
        html = get_page(driver, m["url"])
        if page_loaded(html):
            break
        print(f"    blocked, retry {attempt + 1}/3: {m['url']}", file=sys.stderr)
        time.sleep(8 * (attempt + 1))
    rows = []
    for e in parse_events(html, m["home"], m["away"]):
        rows.append(
            {
                "year": m["year"],
                "stage": m["stage"],
                "date": m["date"],
                "home": m["home"],
                "away": m["away"],
                "side": e["side"],
                "player": e["player"],
                "minute": e["minute"],
                "type": e["type"],
                "detail": e["detail"],
            }
        )
    return rows


def scrape_year(driver, year: int):
    url = f"https://fbref.com/en/comps/{COMP_ID}/{year}/schedule/{year}-World-Cup-Scores-and-Fixtures"
    html = get_page(driver, url)
    matches = parse_schedule(html)
    for m in matches:
        m["year"] = year
    print(f"  {year}: {len(matches)} matches discovered", file=sys.stderr)
    return matches


def main():
    args = [a for a in sys.argv[1:]]
    if args and args[0] == "probe-sched":
        driver = make_driver()
        try:
            year = int(args[1])
            html = get_page(driver, f"https://fbref.com/en/comps/{COMP_ID}/{year}/schedule/{year}-World-Cup-Scores-and-Fixtures")
            for m in parse_schedule(html):
                print(m)
        finally:
            driver.quit()
        return
    if args and args[0] == "probe":
        driver = make_driver()
        try:
            html = get_page(driver, args[1])
            for e in parse_events(html, "HOME", "AWAY"):
                print(e)
        finally:
            driver.quit()
        return

    years = [int(a) for a in args] if args else YEARS
    driver = make_driver()
    rows = []
    done = 0
    try:
        for year in years:
            try:
                matches = scrape_year(driver, year)
            except Exception as exc:  # noqa: BLE001
                print(f"  schedule FAIL {year}: {exc}", file=sys.stderr)
                continue
            for m in matches:
                try:
                    r = scrape_match(driver, m)
                    rows.extend(r)
                    print(f"    {year} {m['stage']}: {m['home']} v {m['away']} -> {len(r)} events", file=sys.stderr)
                except Exception as exc:  # noqa: BLE001
                    print(f"    match FAIL {m['url']}: {exc}", file=sys.stderr)
                done += 1
                if done % RESTART_EVERY == 0:
                    driver.quit()
                    driver = make_driver()
    finally:
        driver.quit()

    # Merge with any previously scraped years so a `2026`-only run doesn't wipe 2006–2022.
    year_set = set(years)
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH) as f:
                prior = json.load(f)
            kept = [r for r in prior if r.get("year") not in year_set]
            rows = kept + rows
            print(f"Merged with existing {OUT_PATH}: kept {len(kept)} prior-year events", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"Could not merge existing {OUT_PATH}: {exc}", file=sys.stderr)

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {len(rows)} events to {OUT_PATH}")


if __name__ == "__main__":
    main()
