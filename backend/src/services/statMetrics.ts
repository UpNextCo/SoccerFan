/**
 * Canonical stat definitions shared across the daily games (Draft XI, Target Man, Blind Rank) so a
 * category with the same label always ranks the SAME number everywhere. Previously each generator
 * had its own SQL — e.g. "Career Goals" meant big-5+CL+EL in Draft/Target but "everything except
 * the World Cup" in Blind Rank, and the transfer-fee category read a different column in each — so
 * the identical-looking tile disagreed between modes.
 */
import { sql, type SQL } from 'drizzle-orm';
import { clubCareerOnlySql } from '../utils/nationalTeam.js';

/** Club competitions counted as "career" everywhere: big-5 leagues + Champions League + Europa League. */
export const CAREER_LEAGUE_IDS = [39, 140, 135, 78, 61, 2, 3];
const CAREER_IN: SQL = sql`(39, 140, 135, 78, 61, 2, 3)`;

/** SQL comparison snippet `s.league_id IN (...career...)` for use inside an existing aggregate. */
export const careerLeagueFilter = (col: string): SQL =>
  sql`${sql.raw(col)} IN (39, 140, 135, 78, 61, 2, 3)`;

const careerMetric = (col: 'goals' | 'assists' | 'appearances' | 'yellow_cards'): SQL =>
  sql`(SELECT player_id, SUM(${sql.raw(col)})::int AS value FROM player_stats
       WHERE league_id IN ${CAREER_IN} GROUP BY player_id)`;

export const careerGoalsSub: SQL = careerMetric('goals');
export const careerAssistsSub: SQL = careerMetric('assists');
export const careerAppsSub: SQL = careerMetric('appearances');
export const careerYellowsSub: SQL = careerMetric('yellow_cards');

/** Peak market value in EUR millions (players with a known peak value). */
export const peakValueSub: SQL = sql`(SELECT id AS player_id, ROUND(peak_market_value_eur / 1000000.0)::int AS value
  FROM players WHERE peak_market_value_eur IS NOT NULL)`;

/** Highest transfer fee in EUR millions — from the transfers table (best coverage; K/M-safe after
 *  the parse-fee fix). This is the single canonical fee source for all modes. */
export const recordFeeSub: SQL = sql`(SELECT player_id, ROUND(MAX(fee_eur_m))::int AS value
  FROM player_transfers WHERE fee_eur_m IS NOT NULL GROUP BY player_id)`;

/** Real, fan-countable club trophies only — excludes Super Cups / Community Shield / friendlies. */
export const TROPHY_COMPETITIONS = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'UEFA Champions League', 'UEFA Europa League',
  'FA Cup', 'League Cup', 'Copa del Rey', 'DFB Pokal', 'Coppa Italia', 'Coupe de France',
];
export const careerTrophiesSub: SQL = sql`(SELECT player_id, COUNT(*)::int AS value FROM player_honours
  WHERE lower(placement) = 'winner' AND competition IN (${sql.join(TROPHY_COMPETITIONS.map((c) => sql`${c}`), sql`, `)})
  GROUP BY player_id)`;

/** TM's players.csv international_caps is sometimes club appearances or a merged-id artefact.
 *  Values in 1–29 from TM are often World Cup / tournament scraps (Lampard=10, Beckham=9) —
 *  TM ingest still refuses those. Wikipedia nation-list / infobox jobs write real senior totals
 *  at any size ≥1, so scoring trusts the full 1–280 range once stored. */
export const INTL_CAPS_SANITY_MAX = 280;
/** Floor used by Transfermarkt ingest only (refuse TM scraps below this). */
export const INTL_CAPS_TRUST_MIN = 30;
/** Minimum senior caps we'll display / score once written (Wikipedia-verified values). */
export const INTL_CAPS_DISPLAY_MIN = 1;

/** International caps from player_extra_stats (Wikipedia + TM), with out-of-range values zeroed. */
export const intlCapsSub: SQL = sql`(SELECT player_id,
  CASE WHEN intl_caps BETWEEN ${INTL_CAPS_DISPLAY_MIN} AND ${INTL_CAPS_SANITY_MAX} THEN intl_caps ELSE 0 END::int AS value
  FROM player_extra_stats)`;

/**
 * Distinct senior clubs played for.
 * Unions `player_career` with club names seen in `player_stats` so legends with thin API career
 * rows (Anelka / Verón) still get a real count. National / U21 / Olympic sides are dropped.
 * Count by lower(team_name) — stats often reuse the same club under several team_id hashes.
 */
export const mostClubsSub: SQL = sql`(
  SELECT player_id, COUNT(DISTINCT club_key)::int AS value
  FROM (
    SELECT pc.player_id, lower(pc.team_name) AS club_key
    FROM player_career pc
    WHERE pc.team_id > 0 AND ${clubCareerOnlySql('pc')}
    UNION
    SELECT s.player_id, lower(s.team_name) AS club_key
    FROM player_stats s
    WHERE COALESCE(s.appearances, 0) > 0
      AND s.team_name IS NOT NULL
      AND s.team_name <> ''
      AND NOT (
        EXISTS (
          SELECT 1 FROM players _nat
          WHERE _nat.nationality <> '' AND _nat.nationality = s.team_name
        )
        OR EXISTS (
          SELECT 1 FROM players _nat
          WHERE _nat.nationality <> ''
            AND _nat.nationality = regexp_replace(s.team_name, '\\s+U\\d{1,2}(\\s+W)?$', '', 'i')
        )
        OR s.team_name ~* '\\s+(Olympics?|Olympic)$'
        OR s.team_name ~* '\\s+U\\d{1,2}(\\s+W)?$'
      )
  ) clubs
  GROUP BY player_id
)`;
