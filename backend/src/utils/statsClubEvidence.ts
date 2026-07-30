import { sql, type SQL } from 'drizzle-orm';

/**
 * `player_stats` records a team NAME per season, so it has to be resolved to a `teams.id` before it
 * can be compared with `player_career.team_id`. Every job that reads club history out of stats must
 * resolve names the SAME way — if the mappings drift the jobs disagree about which club a stats row
 * refers to and each one undoes the other's work.
 */
export function statsTeamNameKeySql(column: SQL): SQL {
  return sql`CASE lower(${column})
    WHEN 'porto' THEN 'fc porto'
    WHEN 'sporting' THEN 'sporting cp'
    WHEN 'psg' THEN 'paris saint germain'
    WHEN 'inter milan' THEN 'inter'
    WHEN 'man utd' THEN 'manchester united'
    WHEN 'man united' THEN 'manchester united'
    WHEN 'man city' THEN 'manchester city'
    WHEN 'spurs' THEN 'tottenham'
    WHEN 'atletico' THEN 'atletico madrid'
    WHEN 'atlético madrid' THEN 'atletico madrid'
    WHEN 'charlton athletic' THEN 'charlton'
    ELSE lower(${column})
  END`;
}

/**
 * CTEs ending in `stats_club_season` — one row per (player, club, season) the player actually made
 * appearances in, keyed by `teams.id`. National, youth-national and Olympic sides are excluded, so
 * what remains is club appearance evidence.
 *
 * Per-SEASON rather than a min/max range on purpose: a min/max would merge two separate stints at
 * the same club into one continuous spell (Cristiano at United in 2003 and again in 2021), which
 * invents teammates for every year in between.
 */
export function statsClubSeasonCte(): SQL {
  return sql`
    nations AS (
      SELECT DISTINCT nationality AS name FROM players
      WHERE nationality IS NOT NULL AND nationality <> ''
    ),
    team_map AS (
      SELECT DISTINCT ON (lower(name))
        lower(name) AS name_key,
        id AS team_id,
        name AS team_name
      FROM teams
      WHERE id > 0
      ORDER BY lower(name), (league_id IS NOT NULL) DESC, id ASC
    ),
    stats_seasons AS (
      SELECT
        s.player_id,
        s.team_name,
        ${statsTeamNameKeySql(sql`s.team_name`)} AS name_key,
        s.season::int AS season,
        SUM(COALESCE(s.appearances, 0))::int AS apps
      FROM player_stats s
      WHERE s.team_name IS NOT NULL
        AND s.team_name <> ''
        AND COALESCE(s.appearances, 0) > 0
        AND s.season IS NOT NULL
      GROUP BY s.player_id, s.team_name, s.season
    ),
    stats_club_season AS (
      SELECT
        ss.player_id,
        tm.team_id,
        tm.team_name,
        ss.season,
        SUM(ss.apps)::int AS apps
      FROM stats_seasons ss
      JOIN team_map tm ON tm.name_key = ss.name_key
      WHERE NOT EXISTS (SELECT 1 FROM nations n WHERE n.name = ss.team_name)
        AND ss.team_name !~* '\\s+U\\d{1,2}(\\s+W)?$'
        AND ss.team_name !~* '\\s+(Olympics?|Olympic)$'
      GROUP BY ss.player_id, tm.team_id, tm.team_name, ss.season
    )
  `;
}
