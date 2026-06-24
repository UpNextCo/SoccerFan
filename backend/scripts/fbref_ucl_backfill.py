"""
Pre-2010 European-cup backfill (Champions League / Europa League) from FBref.

soccerdata doesn't ship these competitions in its default league dict, so we
register them in ~/soccerdata/config/league_dict.json *before* importing soccerdata,
then reuse the extraction logic from fbref_backfill.py. Output feeds job:import-fbref.

Usage:
  source .venv/bin/activate
  python3 scripts/fbref_ucl_backfill.py            # 1991-2009 by default
  python3 scripts/fbref_ucl_backfill.py 2000 2009

Then:
  npx tsx src/jobs/import-fbref.ts fbref_ucl_backfill.json
"""
import json
import sys
from pathlib import Path

# Register the cups BEFORE soccerdata is imported (LEAGUE_DICT is built at import).
_config_dir = Path.home() / "soccerdata" / "config"
_config_dir.mkdir(parents=True, exist_ok=True)
_dict_path = _config_dir / "league_dict.json"
_existing = json.loads(_dict_path.read_text()) if _dict_path.is_file() else {}
_existing.update(
    {
        "INT-Champions League": {"FBref": "Champions League", "season_start": "Aug", "season_end": "May"},
        "INT-Europa League": {"FBref": "Europa League", "season_start": "Aug", "season_end": "May"},
    }
)
_dict_path.write_text(json.dumps(_existing, indent=2))

import soccerdata as sd  # noqa: E402

from fbref_backfill import extract_rows, to_int  # noqa: E402

# (soccerdata league key, our leagueId matching api-football, our league name)
COMPS = [
    ("INT-Champions League", 2, "UEFA Champions League"),
    ("INT-Europa League", 3, "UEFA Europa League"),
]

OUT_PATH = "fbref_ucl_backfill.json"


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 1991
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 2009
    seasons = [f"{y}-{y + 1}" for y in range(start, end + 1)]

    rows = []
    for lkey, lid, lname in COMPS:
        for season in seasons:
            try:
                fb = sd.FBref(leagues=lkey, seasons=season)
                df = fb.read_player_season_stats(stat_type="standard")
            except Exception as exc:  # noqa: BLE001
                print(f"  skip {lkey} {season}: {exc}", file=sys.stderr)
                continue
            if df is None or df.empty:
                continue
            extracted = extract_rows(df, lid, lname, to_int(season[:4]))
            rows.extend(extracted)
            print(f"  {lkey} {season}: {len(extracted)} players", file=sys.stderr)

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
