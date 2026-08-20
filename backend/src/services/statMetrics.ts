/**
 * Canonical stat definitions shared across the daily games (Draft XI, Target Man, Blind Rank) so a
 * category with the same label always ranks the SAME number everywhere. Previously each generator
 * had its own SQL — e.g. "Career Goals" meant big-5+CL+EL in Draft/Target but "everything except
 * the World Cup" in Blind Rank, and the transfer-fee category read a different column in each — so
 * the identical-looking tile disagreed between modes.
 */
import { sql, type SQL } from 'drizzle-orm';
import { clubCareerOnlySql, youthOrReserveSideSql } from '../utils/nationalTeam.js';

/** Club competitions counted as "career" everywhere: big-5 leagues + Champions League + Europa League. */
export const CAREER_LEAGUE_IDS = [39, 140, 135, 78, 61, 2, 3];
const CAREER_IN: SQL = sql`(39, 140, 135, 78, 61, 2, 3)`;

/** SQL comparison snippet `s.league_id IN (...career...)` for use inside an existing aggregate. */
export const careerLeagueFilter = (col: string): SQL =>
  sql`${sql.raw(col)} IN (39, 140, 135, 78, 61, 2, 3)`;

const careerMetric = (col: 'goals' | 'assists' | 'appearances' | 'yellow_cards'): SQL =>
  sql`(SELECT player_id, SUM(${sql.raw(col)})::int AS value FROM player_stats
       WHERE league_id IN ${CAREER_IN} GROUP BY player_id)`;

export const careerAssistsSub: SQL = careerMetric('assists');
export const careerYellowsSub: SQL = careerMetric('yellow_cards');

/** TM's players.csv international_caps is sometimes club appearances or a merged-id artefact.
 *  Values in 1–29 from TM are often World Cup / tournament scraps (Lampard=10, Beckham=9) —
 *  TM ingest still refuses those. Wikipedia nation-list / infobox jobs write real senior totals
 *  at any size ≥1, so scoring trusts the full 1–280 range once stored. */
export const INTL_CAPS_SANITY_MAX = 280;
/** Floor used by Transfermarkt ingest only (refuse TM scraps below this). */
export const INTL_CAPS_TRUST_MIN = 30;
/** Minimum senior caps we'll display / score once written (Wikipedia-verified values). */
export const INTL_CAPS_DISPLAY_MIN = 1;
/**
 * Ceiling for the FALLBACK sources only. The men's record is around 200 caps, so a stored 220–260 is
 * always the club-appearance bug rather than a career (Fernando Navarro on 240, Emiliano Moretti on
 * 240). Transfermarkt values skip this check — Ronaldo really is past 200.
 */
export const INTL_CAPS_FALLBACK_MAX = 200;

/**
 * Senior caps for a `player_extra_stats` row. Transfermarkt's national-team page wins when we have it:
 * the older players.csv value sometimes held CLUB appearances instead of caps (Iker Muniain 270 -> 2,
 * Massimo Maccarone 250 -> 2), which put nonsense in front of players. Otherwise fall back to the
 * stored Wikipedia/players.csv figure with out-of-range values zeroed.
 *
 * Several generators read these columns straight out of their own joins, so this is exported as a
 * snippet rather than a subquery — one definition, whatever the table is aliased as.
 */
export const trustedIntlCapsSql = (alias = 'e'): SQL => sql`CASE
    WHEN ${sql.raw(alias)}.tm_intl_caps IS NOT NULL THEN ${sql.raw(alias)}.tm_intl_caps
    WHEN ${sql.raw(alias)}.intl_caps BETWEEN ${INTL_CAPS_DISPLAY_MIN} AND ${INTL_CAPS_FALLBACK_MAX}
      THEN ${sql.raw(alias)}.intl_caps
    ELSE 0
  END`;

/**
 * Senior international goals, Transfermarkt first for the same reason as caps. The Wikipedia ingest
 * read the caps column as goals for a whole nation's worth of players — it has Courtois on 108
 * international goals and Vertonghen on 142 — so taking the larger of the two would enshrine that.
 *
 * Where Transfermarkt is missing we still fall back, since the list is right far more often than not,
 * but only when the goals don't exceed the caps: 239 rows fail that (Chadli on 83 goals in 66 caps,
 * Batshuayi 76 in 55) and they are the same swapped-column bug. No modern career scores more often
 * than once a game, so the check costs nothing real.
 */
export const trustedIntlGoalsSql = (alias = 'e'): SQL => sql`COALESCE(
    ${sql.raw(alias)}.tm_intl_goals,
    CASE WHEN COALESCE(${sql.raw(alias)}.intl_goals, 0) <= COALESCE(${sql.raw(alias)}.intl_caps, 0)
      THEN ${sql.raw(alias)}.intl_goals END,
    0)`;

/** Same rules as `trustedIntlCapsSql`, for in-memory review / scoring. */
export function trustedIntlCapsValue(tmIntlCaps: number | null | undefined, intlCaps: number): number {
  if (tmIntlCaps != null) return tmIntlCaps;
  if (intlCaps >= INTL_CAPS_DISPLAY_MIN && intlCaps <= INTL_CAPS_FALLBACK_MAX) return intlCaps;
  return 0;
}

/** Same rules as `trustedIntlGoalsSql`. */
export function trustedIntlGoalsValue(
  tmIntlGoals: number | null | undefined,
  intlGoals: number,
  intlCaps: number
): number {
  if (tmIntlGoals != null) return tmIntlGoals;
  if (intlGoals <= intlCaps) return intlGoals;
  return 0;
}

/** Draft / Target Man "career goals": TM club total + trusted intl. Null if TM never scraped. */
export function gameCareerGoalsValue(
  tmCareerGoals: number | null | undefined,
  trustedIntlGoals: number
): number | null {
  if (tmCareerGoals == null) return null;
  return tmCareerGoals + trustedIntlGoals;
}

export const intlCapsSub: SQL = sql`(SELECT player_id, ${trustedIntlCapsSql('e')}::int AS value
  FROM player_extra_stats e)`;

export const intlGoalsSub: SQL = sql`(SELECT player_id, ${trustedIntlGoalsSql('e')}::int AS value
  FROM player_extra_stats e)`;

/**
 * Career appearances stay on the tracked-league definition. tm_career_apps holds the true
 * all-competition figure, but Transfermarkt renders goalkeepers on a different performance grid that
 * our season scrape can't read, so switching would silently drop every keeper — exactly the players an
 * appearance ranking wants. Goals don't have that problem (keepers score none).
 */
export const careerAppsSub: SQL = careerMetric('appearances');

/**
 * Career goals: EVERY senior club competition (from the Transfermarkt season scrape) plus senior
 * international goals — i.e. the number a fan would quote. Summing player_stats instead only covered
 * the big-5 leagues and CL/EL, so Ronaldo showed ~640 of his 970: his Sporting and Al-Nassr years and
 * every domestic-cup goal were missing.
 *
 * Only players with a scraped club total are ranked. NULL means "we never scraped them", and a partial
 * total would rank a legend below someone we happen to know completely — better to leave them out.
 */
export const careerGoalsSub: SQL = sql`(SELECT player_id,
  (e.tm_career_goals + ${trustedIntlGoalsSql('e')})::int AS value
  FROM player_extra_stats e WHERE e.tm_career_goals IS NOT NULL)`;

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

/**
 * Distinct senior clubs played for.
 * Unions `player_career` with club names seen in `player_stats` so legends with thin API career
 * rows (Anelka / Verón) still get a real count. National / U21 / Olympic / youth-B sides dropped.
 * Count by lower(team_name) — stats often reuse the same club under several team_id hashes.
 *
 * When `player_extra_stats.verified_club_count` is set (merge-smell players only — see
 * job:compute-verified-club-counts), that value wins. Raw career/stats rows are left untouched;
 * only the Draft XI / ranking number is corrected.
 */
export const mostClubsSub: SQL = sql`(
  SELECT player_id, value FROM (
    SELECT p.id AS player_id,
           COALESCE(e.verified_club_count, live.value)::int AS value
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    LEFT JOIN (
      SELECT player_id, COUNT(DISTINCT club_key)::int AS value
      FROM (
        SELECT pc.player_id, lower(pc.team_name) AS club_key
        FROM player_career pc
        WHERE pc.team_id > 0
          AND ${clubCareerOnlySql('pc')}
          AND NOT ${youthOrReserveSideSql(sql`pc.team_name`)}
        UNION
        SELECT s.player_id, lower(s.team_name) AS club_key
        FROM player_stats s
        WHERE COALESCE(s.appearances, 0) > 0
          AND s.team_name IS NOT NULL
          AND s.team_name <> ''
          AND NOT ${youthOrReserveSideSql(sql`s.team_name`)}
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
    ) live ON live.player_id = p.id
  ) x
  WHERE value IS NOT NULL AND value > 0
)`;
