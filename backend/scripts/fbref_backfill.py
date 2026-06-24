"""
One-time FBref historical backfill of big-5 standard stats (pre-2010 era).

FBref carries goals / assists / appearances / minutes / cards back to the 90s for
the big-5 leagues — exactly what powers "Chelsea top scorers" / "20+ goals for
Fulham" puzzles and makes legends (Lampard, Gerrard, Terry…) valid answers.

Outputs a JSON file consumed by `npm run job:import-fbref`.

Usage:
  pip install -r scripts/requirements.txt
  python scripts/fbref_backfill.py            # default 1995-2009
  python scripts/fbref_backfill.py 1992 2009  # custom start/end (season start years)

soccerdata caches pages under ~/.cache, so re-runs are fast and polite to FBref.
"""
import json
import math
import sys

import soccerdata as sd

# soccerdata league id -> (api-football league id, our league name)
LEAGUES = {
    "ENG-Premier League": (39, "Premier League"),
    "ESP-La Liga": (140, "La Liga"),
    "ITA-Serie A": (135, "Serie A"),
    "GER-Bundesliga": (78, "Bundesliga"),
    "FRA-Ligue 1": (61, "Ligue 1"),
}

OUT_PATH = "fbref_backfill.json"


def flatten_columns(df):
    df = df.copy()
    df.columns = [
        "_".join(str(p) for p in col if p not in (None, "")).strip()
        if isinstance(col, tuple)
        else str(col)
        for col in df.columns
    ]
    return df


def find_col(cols, *cands):
    lower = {c.lower(): c for c in cols}
    for cand in cands:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def to_int(v, default=0):
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return default
        return int(float(v))
    except (ValueError, TypeError):
        return default


def s(v):
    return v.strip() if isinstance(v, str) else ""


def clean_nation(v):
    parts = s(v).split()
    return parts[-1].upper() if parts else None


def extract_rows(df, lid, lname, start_year, league_filter=None):
    """Turn an FBref standard-stats DataFrame into our flat row dicts.

    league_filter (e.g. "ITA-Serie A") keeps only rows for one league — used when
    reading the Big-5 combined table.
    """
    df = flatten_columns(df.reset_index())
    cols = list(df.columns)
    c_player = find_col(cols, "player")
    if not c_player:
        return []
    c_league = find_col(cols, "league", "comp")
    c_team = find_col(cols, "team", "squad")
    c_nation = find_col(cols, "nation", "nationality")
    c_pos = find_col(cols, "pos", "position")
    c_age = find_col(cols, "age")
    c_mp = find_col(cols, "Playing Time_MP", "MP")
    c_min = find_col(cols, "Playing Time_Min", "Min")
    c_gls = find_col(cols, "Performance_Gls", "Gls")
    c_ast = find_col(cols, "Performance_Ast", "Ast")
    c_cy = find_col(cols, "Performance_CrdY", "CrdY")
    c_cr = find_col(cols, "Performance_CrdR", "CrdR")

    out = []
    for _, r in df.iterrows():
        if league_filter and c_league and s(r.get(c_league)) != league_filter:
            continue
        name = s(r.get(c_player))
        if not name:
            continue
        out.append(
            {
                "player": name,
                "team": s(r.get(c_team)) if c_team else "",
                "nation": clean_nation(r.get(c_nation)) if c_nation else None,
                "pos": s(r.get(c_pos)) if c_pos else "",
                "age": to_int(r.get(c_age)) if c_age else 0,
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


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1995
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 2009
    seasons = [f"{y}-{y + 1}" for y in range(start, end + 1)]

    rows = []
    league_counts = {lid: 0 for _, (lid, _) in LEAGUES.items()}

    for league_id, (lid, lname) in LEAGUES.items():
        for season in seasons:
            try:
                fb = sd.FBref(leagues=league_id, seasons=season)
                df = fb.read_player_season_stats(stat_type="standard")
            except Exception as exc:  # noqa: BLE001 - one bad season shouldn't abort all
                print(f"  skip {league_id} {season}: {exc}", file=sys.stderr)
                continue
            if df is None or df.empty:
                continue
            extracted = extract_rows(df, lid, lname, to_int(season[:4]))
            rows.extend(extracted)
            league_counts[lid] += len(extracted)
            print(f"  {league_id} {season}: {len(extracted)} players", file=sys.stderr)

    # Fallback: soccerdata's individual ITA-Serie A read can fail ("No objects to
    # concatenate"); the Big-5 combined table includes Serie A and parses fine.
    serie_a_id, serie_a_name = 135, "Serie A"
    if league_counts.get(serie_a_id, 0) == 0:
        print("Serie A empty via direct read — falling back to Big 5 Combined", file=sys.stderr)
        for season in seasons:
            if to_int(season[:4]) < 1996:  # combined dataset starts 1996-97
                continue
            try:
                fb = sd.FBref(leagues="Big 5 European Leagues Combined", seasons=season)
                df = fb.read_player_season_stats(stat_type="standard")
            except Exception as exc:  # noqa: BLE001
                print(f"  skip combined {season}: {exc}", file=sys.stderr)
                continue
            if df is None or df.empty:
                continue
            extracted = extract_rows(
                df, serie_a_id, serie_a_name, to_int(season[:4]), league_filter="ITA-Serie A"
            )
            rows.extend(extracted)
            print(f"  Combined Serie A {season}: {len(extracted)} players", file=sys.stderr)

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
