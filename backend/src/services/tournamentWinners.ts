/**
 * Tournament “winner” eligibility — full squad / campaign, not just final XI.
 *
 * - World Cup: `wc_squads` for winning countries (unused bench included)
 * - Euro: players with Euro apps (`league_id = 4`) for the winning nation that edition
 * - Champions League: UCL apps for the winning club that season (plus honours / final rows)
 *
 * Final-appearance wins remain as a fallback so linked players aren’t dropped if squad
 * rows are missing.
 */
import { sql, type SQL } from 'drizzle-orm';

/** FIFA World Cup winners by tournament year → `wc_squads.country`. */
export const WORLD_CUP_WINNERS: Record<number, string> = {
  1994: 'Brazil',
  1998: 'France',
  2002: 'Brazil',
  2006: 'Italy',
  2010: 'Spain',
  2014: 'Germany',
  2018: 'France',
  2022: 'Argentina',
  2026: 'Spain',
};

/** UEFA Euro winners by edition year → `player_stats.team_name` (league_id 4). */
export const EURO_WINNERS: Record<number, string> = {
  1996: 'Germany',
  2000: 'France',
  2004: 'Greece',
  2008: 'Spain',
  2012: 'Spain',
  2016: 'Portugal',
  2020: 'Italy', // Euro 2020; our stats season is 2020
  2024: 'Spain',
};

function yearCountryOrs(
  map: Record<number, string>,
  yearExpr: SQL,
  countryExpr: SQL
): SQL {
  const parts = Object.entries(map).map(
    ([year, country]) => sql`(${yearExpr} = ${Number(year)} AND ${countryExpr} = ${country})`
  );
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** Dominant winning club per UCL season (canonical team_name from winners’ own UCL stats). */
const UCL_WINNING_CLUB_SEASONS = sql`
  SELECT season, team_name FROM (
    SELECT ws.season, ws.team_name,
           COUNT(DISTINCT fa.player_id) AS n,
           ROW_NUMBER() OVER (
             PARTITION BY ws.season
             ORDER BY COUNT(DISTINCT fa.player_id) DESC
           ) AS rk
    FROM final_appearances fa
    JOIN player_stats ws
      ON ws.player_id = fa.player_id
     AND ws.season = fa.season
     AND ws.league_id = 2
     AND ws.appearances > 0
    WHERE fa.competition = 'Champions League' AND fa.won = true
    GROUP BY ws.season, ws.team_name
  ) t
  WHERE rk = 1 AND n >= 5
`;

/**
 * EXISTS predicate: player is a tournament winner for the given competition.
 * `playerIdRef` must be a safe column ref like `a.id` or `p.id`.
 */
export function wonTournamentExistsSql(
  competition: 'World Cup' | 'Euro' | 'Champions League',
  playerIdRef: 'a.id' | 'p.id'
): SQL {
  const pid = sql.raw(playerIdRef);

  if (competition === 'World Cup') {
    return sql`(
      EXISTS (
        SELECT 1 FROM wc_squads s
        WHERE s.player_id = ${pid}
          AND ${yearCountryOrs(WORLD_CUP_WINNERS, sql`s.year`, sql`s.country`)}
      )
      OR EXISTS (
        SELECT 1 FROM final_appearances f
        WHERE f.player_id = ${pid}
          AND f.competition = 'World Cup'
          AND f.won = true
      )
    )`;
  }

  if (competition === 'Euro') {
    return sql`(
      EXISTS (
        SELECT 1 FROM player_stats s
        WHERE s.player_id = ${pid}
          AND s.league_id = 4
          AND s.appearances > 0
          AND ${yearCountryOrs(EURO_WINNERS, sql`s.season`, sql`s.team_name`)}
      )
      OR EXISTS (
        SELECT 1 FROM final_appearances f
        WHERE f.player_id = ${pid}
          AND f.competition = 'Euro'
          AND f.won = true
      )
      OR EXISTS (
        SELECT 1 FROM player_honours h
        WHERE h.player_id = ${pid}
          AND (
            h.competition ILIKE '%european championship%'
            OR h.competition ILIKE '%uefa euro%'
          )
          AND h.placement ILIKE '%winner%'
      )
    )`;
  }

  // Champions League — season squad via UCL apps for winning club, plus trophies / final.
  return sql`(
    EXISTS (
      SELECT 1 FROM player_honours h
      WHERE h.player_id = ${pid}
        AND h.competition ILIKE '%champions league%'
        AND h.placement ILIKE '%winner%'
    )
    OR EXISTS (
      SELECT 1 FROM final_appearances f
      WHERE f.player_id = ${pid}
        AND f.competition = 'Champions League'
        AND f.won = true
    )
    OR EXISTS (
      SELECT 1
      FROM player_stats ps
      JOIN (${UCL_WINNING_CLUB_SEASONS}) win
        ON ps.team_name = win.team_name AND ps.season = win.season
      WHERE ps.player_id = ${pid}
        AND ps.league_id = 2
        AND ps.appearances > 0
    )
  )`;
}

/** Distinct player ids who count as winners for relationship-prompt banks etc. */
export function wonTournamentPlayersSql(
  competition: 'World Cup' | 'Euro' | 'Champions League'
): SQL {
  if (competition === 'World Cup') {
    return sql`
      SELECT DISTINCT player_id AS id FROM (
        SELECT s.player_id
        FROM wc_squads s
        WHERE s.player_id IS NOT NULL
          AND ${yearCountryOrs(WORLD_CUP_WINNERS, sql`s.year`, sql`s.country`)}
        UNION
        SELECT f.player_id
        FROM final_appearances f
        WHERE f.player_id IS NOT NULL
          AND f.competition = 'World Cup'
          AND f.won = true
      ) w
    `;
  }

  if (competition === 'Euro') {
    return sql`
      SELECT DISTINCT player_id AS id FROM (
        SELECT s.player_id
        FROM player_stats s
        WHERE s.league_id = 4
          AND s.appearances > 0
          AND ${yearCountryOrs(EURO_WINNERS, sql`s.season`, sql`s.team_name`)}
        UNION
        SELECT f.player_id
        FROM final_appearances f
        WHERE f.player_id IS NOT NULL
          AND f.competition = 'Euro'
          AND f.won = true
        UNION
        SELECT h.player_id
        FROM player_honours h
        WHERE h.player_id IS NOT NULL
          AND (
            h.competition ILIKE '%european championship%'
            OR h.competition ILIKE '%uefa euro%'
          )
          AND h.placement ILIKE '%winner%'
      ) w
    `;
  }

  return sql`
    SELECT DISTINCT player_id AS id FROM (
      SELECT h.player_id
      FROM player_honours h
      WHERE h.player_id IS NOT NULL
        AND h.competition ILIKE '%champions league%'
        AND h.placement ILIKE '%winner%'
      UNION
      SELECT f.player_id
      FROM final_appearances f
      WHERE f.player_id IS NOT NULL
        AND f.competition = 'Champions League'
        AND f.won = true
      UNION
      SELECT ps.player_id
      FROM player_stats ps
      JOIN (${UCL_WINNING_CLUB_SEASONS}) win
        ON ps.team_name = win.team_name AND ps.season = win.season
      WHERE ps.league_id = 2 AND ps.appearances > 0
    ) w
  `;
}
