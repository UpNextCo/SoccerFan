/**
 * Football Tower rule engine. A rule is a small machine-readable object; the SAME
 * SQL drives both generation-solvability (how many players satisfy it) and answer
 * validation (does THIS player satisfy it), so the two can never disagree.
 *
 * All club / nationality / league strings are the CANONICAL values produced by the
 * data-consolidation jobs (e.g. "Bayern München", "Manchester United").
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export interface TowerRule {
  /** Closed-set relationship prompts (teammates / managers / finals / World Cup):
   *  the valid player ids are precomputed at build time (reusing verified helpers),
   *  so validation is a membership test and counting is the set size. `label` is a
   *  short human tag for debugging/curation. */
  validIds?: string[];
  label?: string;
  nationality?: string;
  nonEuropean?: boolean;
  position?: 'Goalkeeper' | 'Defender';
  leaguePlayed?: string;
  playedFor?: string[];
  minPlApps?: number;
  minPlAssists?: number;
  minPlGoals?: number;
  minPlYellowCards?: number;
  minPlCleanSheets?: number;
  uclWinner?: boolean;
  minUclGoals?: number;
  minUclApps?: number;
  minPeakValueEur?: number; // career-peak market value in euros
  minRecordFeeEur?: number; // biggest transfer fee in euros
}

/** Canonical European nationalities (for the "non-European" elite rule). */
const EUROPE = new Set(
  [
    'England', 'Scotland', 'Wales', 'Northern Ireland', 'Republic of Ireland', 'Ireland',
    'France', 'Germany', 'Spain', 'Italy', 'Netherlands', 'Portugal', 'Belgium', 'Switzerland',
    'Austria', 'Poland', 'Czech Republic', 'Czechia', 'Denmark', 'Sweden', 'Norway', 'Finland',
    'Iceland', 'Greece', 'Turkey', 'Russia', 'Ukraine', 'Romania', 'Hungary', 'Bulgaria',
    'Croatia', 'Serbia', 'Slovakia', 'Slovenia', 'Bosnia and Herzegovina', 'Montenegro',
    'North Macedonia', 'Macedonia', 'Albania', 'Kosovo', 'Belarus', 'Lithuania', 'Latvia',
    'Estonia', 'Luxembourg', 'Malta', 'Cyprus', 'Georgia', 'Armenia', 'Moldova', 'Andorra',
    'Faroe Islands', 'Gibraltar', 'San Marino', 'Liechtenstein',
  ].map((n) => n.toLowerCase())
);

const PL = 39;
const UCL = 2;

/** SQL WHERE fragments for a rule, operating on CTE alias `a` (id, nationality, position, pl_*, ucl_*). */
function ruleConditions(rule: TowerRule) {
  const c = [] as ReturnType<typeof sql>[];
  if (rule.nationality) c.push(sql`lower(a.nationality) = ${rule.nationality.toLowerCase()}`);
  if (rule.nonEuropean) {
    const list = sql.join([...EUROPE].map((n) => sql`${n}`), sql`, `);
    c.push(sql`lower(a.nationality) NOT IN (${list})`);
  }
  if (rule.position) c.push(sql`a.position = ${rule.position}`);
  if (typeof rule.minPlApps === 'number') c.push(sql`a.pl_apps >= ${rule.minPlApps}`);
  if (typeof rule.minPlGoals === 'number') c.push(sql`a.pl_goals >= ${rule.minPlGoals}`);
  if (typeof rule.minPlAssists === 'number') c.push(sql`a.pl_assists >= ${rule.minPlAssists}`);
  if (typeof rule.minPlYellowCards === 'number') c.push(sql`a.pl_yellows >= ${rule.minPlYellowCards}`);
  if (typeof rule.minPlCleanSheets === 'number') c.push(sql`a.pl_clean_sheets >= ${rule.minPlCleanSheets}`);
  if (typeof rule.minUclGoals === 'number') c.push(sql`a.ucl_goals >= ${rule.minUclGoals}`);
  if (typeof rule.minUclApps === 'number') c.push(sql`a.ucl_apps >= ${rule.minUclApps}`);
  if (typeof rule.minPeakValueEur === 'number') c.push(sql`a.peak_value >= ${rule.minPeakValueEur}`);
  if (typeof rule.minRecordFeeEur === 'number') c.push(sql`a.record_fee >= ${rule.minRecordFeeEur}`);
  if (rule.leaguePlayed) {
    c.push(sql`EXISTS (SELECT 1 FROM player_stats s2 WHERE s2.player_id = a.id AND s2.league_name = ${rule.leaguePlayed} AND s2.appearances > 0)`);
  }
  for (const club of rule.playedFor ?? []) {
    // Club affiliation = an appearance row OR a transfer in/out of the club. Transfers
    // (Transfermarkt) catch academy/reserve/loan spells that top-5-league appearance data
    // misses — e.g. Pablo Sarabia at Real Madrid (Castilla + a UCL sub, no La Liga apps).
    c.push(sql`(
      EXISTS (SELECT 1 FROM player_stats s2 WHERE s2.player_id = a.id AND s2.team_name = ${club})
      OR EXISTS (SELECT 1 FROM player_transfers t2 WHERE t2.player_id = a.id AND (t2.from_team_name = ${club} OR t2.to_team_name = ${club}))
    )`);
  }
  if (rule.uclWinner) {
    c.push(sql`EXISTS (SELECT 1 FROM player_honours h WHERE h.player_id = a.id AND h.competition ILIKE '%champions league%' AND h.placement ILIKE '%winner%')`);
  }
  return c.length ? c : [sql`TRUE`];
}

const AGG = sql`
  WITH agg AS (
    SELECT p.id, p.nationality, p.position, p.market_value_tier AS mvt,
      COALESCE(p.peak_market_value_eur, 0)::bigint AS peak_value,
      COALESCE(p.record_fee_eur, 0)::bigint AS record_fee,
      COALESCE(SUM(s.appearances)   FILTER (WHERE s.league_id = ${PL}), 0)::int AS pl_apps,
      COALESCE(SUM(s.goals)         FILTER (WHERE s.league_id = ${PL}), 0)::int AS pl_goals,
      COALESCE(SUM(s.assists)       FILTER (WHERE s.league_id = ${PL}), 0)::int AS pl_assists,
      COALESCE(SUM(s.yellow_cards)  FILTER (WHERE s.league_id = ${PL}), 0)::int AS pl_yellows,
      COALESCE(SUM(s.clean_sheets)  FILTER (WHERE s.league_id = ${PL}), 0)::int AS pl_clean_sheets,
      COALESCE(SUM(s.appearances)   FILTER (WHERE s.league_id = ${UCL}), 0)::int AS ucl_apps,
      COALESCE(SUM(s.goals)         FILTER (WHERE s.league_id = ${UCL}), 0)::int AS ucl_goals,
      COALESCE(SUM(s.appearances)   FILTER (WHERE s.league_id IN (39,140,135,78,61)), 0)::int AS big5_apps,
      COALESCE(SUM(s.appearances), 0)::int AS total_apps
    FROM players p
    LEFT JOIN player_stats s ON s.player_id = p.id
    GROUP BY p.id, p.nationality, p.position, p.market_value_tier, p.peak_market_value_eur, p.record_fee_eur
  )`;
// NB: previously filtered `WHERE p.external_id IS NOT NULL`, which hid pre-2010 legends
// (Cannavaro, Emerson…) from counting AND validation — so they were wrongly rejected as
// answers. Now ALL players are eligible; fame is judged by market_value_tier, not apps.

/** How many players satisfy this rule (for generation solvability). */
export async function countValidPlayers(rule: TowerRule): Promise<number> {
  if (rule.validIds) return rule.validIds.length;
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`${AGG} SELECT COUNT(*)::int AS n FROM agg a WHERE ${conds}`)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * How many RECOGNISABLE players satisfy the rule — a far better difficulty signal than
 * raw count. Recognisable = top market-value tier OR a big career (lots of apps), so a
 * prompt with 500 obscure answers but few famous ones is correctly rated hard.
 */
export async function countFamousPlayers(rule: TowerRule): Promise<number> {
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`
    ${AGG} SELECT COUNT(*)::int AS n FROM agg a
    WHERE ${conds} AND (a.mvt >= 4 OR a.total_apps >= 250)
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * How many answers a knowledgeable fan could plausibly NAME — the true difficulty signal.
 * "Recallable" = a player with real top-flight exposure (big-5 apps / UCL apps) OR an
 * elite market value. A journeyman with 150 Premier League games (e.g. Schlupp) counts;
 * a one-cap obscurity does not. Fewer recallable answers ⇒ genuinely harder prompt.
 */
export async function countRecallablePlayers(rule: TowerRule): Promise<number> {
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`
    ${AGG} SELECT COUNT(*)::int AS n FROM agg a
    WHERE ${conds} AND (a.mvt >= 4 OR a.big5_apps >= 60 OR a.ucl_apps >= 35)
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Highest market_value_tier (1–5) among a prompt's answers — the "is there a STAR answer?"
 * signal. Tier is fully populated (unlike peak market value, ~64% covered) and correctly
 * rates legends (Cannavaro/Danilo/Emerson = 5), so it's the reliable fame gate. A prompt
 * whose best answer is only tier ≤3 (e.g. Udinese+Man City journeymen) is "database-hard",
 * not fun-hard, and should be pruned.
 */
export async function bestAnswerTier(rule: TowerRule): Promise<number> {
  if (rule.validIds) {
    if (rule.validIds.length === 0) return 0;
    const ids = sql.join(rule.validIds.map((i) => sql`${i}::uuid`), sql`, `);
    const rows = (await db.execute(sql`SELECT COALESCE(MAX(market_value_tier),0)::int AS t FROM players WHERE id IN (${ids})`)) as unknown as Array<{ t: number }>;
    return rows[0]?.t ?? 0;
  }
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`${AGG} SELECT COALESCE(MAX(a.mvt),0)::int AS t FROM agg a WHERE ${conds}`)) as unknown as Array<{ t: number }>;
  return rows[0]?.t ?? 0;
}

/** Does this specific player satisfy the rule? Same SQL, filtered to one id. */
export async function playerSatisfiesRule(playerId: string, rule: TowerRule): Promise<boolean> {
  if (rule.validIds) return rule.validIds.includes(playerId);
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`${AGG} SELECT 1 FROM agg a WHERE a.id = ${playerId} AND ${conds} LIMIT 1`)) as unknown as unknown[];
  return rows.length > 0;
}

export interface AnswerPlayer {
  id: string;
  name: string;
  mvt: number;
  pl: number; // Premier League appearances (strongest "this audience knows them" signal)
  big5: number;
  ucl: number;
  total: number;
}

/** EVERY player satisfying the rule, with fame fields — the full answer set for a
 *  Football Golf hole (and rarity derivation). Works for closed-set (validIds) and
 *  rule-based prompts alike. */
export async function enumeratePlayers(rule: TowerRule): Promise<AnswerPlayer[]> {
  if (rule.validIds) {
    if (rule.validIds.length === 0) return [];
    const ids = sql.join(rule.validIds.map((i) => sql`${i}::uuid`), sql`, `);
    const rows = (await db.execute(sql`
      SELECT p.id, p.name, p.market_value_tier AS mvt,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39),0)::int AS pl,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39,140,135,78,61)),0)::int AS big5,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2),0)::int AS ucl,
        COALESCE(SUM(s.appearances),0)::int AS total
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      WHERE p.id IN (${ids}) GROUP BY p.id, p.name, p.market_value_tier
    `)) as unknown as AnswerPlayer[];
    return rows;
  }
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`
    ${AGG}
    SELECT a.id, (SELECT name FROM players WHERE id = a.id) AS name, a.mvt,
           a.pl_apps AS pl, a.big5_apps AS big5, a.ucl_apps AS ucl, a.total_apps AS total
    FROM agg a WHERE ${conds}
  `)) as unknown as AnswerPlayer[];
  return rows;
}

/** Up to `limit` of the most recognisable players satisfying the rule (real names,
 *  most famous first) — used to let the LLM judge difficulty from concrete answers. */
export async function sampleFamousPlayers(rule: TowerRule, limit = 6): Promise<string[]> {
  if (rule.validIds) {
    if (rule.validIds.length === 0) return [];
    const ids = sql.join(rule.validIds.map((i) => sql`${i}::uuid`), sql`, `);
    const rows = (await db.execute(sql`
      SELECT p.name FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      WHERE p.id IN (${ids})
      GROUP BY p.id, p.name, p.market_value_tier
      ORDER BY p.market_value_tier DESC, COALESCE(SUM(s.appearances),0) DESC
      LIMIT ${limit}
    `)) as unknown as Array<{ name: string }>;
    return rows.map((r) => r.name).filter(Boolean);
  }
  const conds = sql.join(ruleConditions(rule), sql` AND `);
  const rows = (await db.execute(sql`
    ${AGG}
    SELECT (SELECT name FROM players WHERE id = a.id) AS name
    FROM agg a WHERE ${conds}
    ORDER BY a.mvt DESC, a.total_apps DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ name: string }>;
  return rows.map((r) => r.name).filter(Boolean);
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

let plClubCache: Set<string> | null = null;
/** Any club that has appeared in the Premier League (ever). */
export async function isPremierLeagueClub(name: string): Promise<boolean> {
  if (!plClubCache) {
    const rows = (await db.execute(sql`SELECT DISTINCT team_name FROM player_stats WHERE league_id = ${PL} AND team_name IS NOT NULL`)) as unknown as Array<{ team_name: string }>;
    plClubCache = new Set(rows.map((r) => norm(r.team_name)));
  }
  return plClubCache.has(norm(name));
}

/** Allowed building blocks for LLM-proposed prompts: real clubs + nationalities that
 *  have enough players to make a solvable prompt. */
export async function towerVocab(): Promise<{ clubs: string[]; nationalities: string[] }> {
  const clubRows = (await db.execute(sql`
    SELECT team_name, COUNT(DISTINCT player_id)::int AS n
    FROM player_stats
    WHERE league_id IN (39, 140, 135, 78, 61) AND team_name IS NOT NULL
    GROUP BY team_name HAVING COUNT(DISTINCT player_id) >= 18
    ORDER BY n DESC LIMIT 60
  `)) as unknown as Array<{ team_name: string; n: number }>;
  const natRows = (await db.execute(sql`
    SELECT nationality, COUNT(*)::int AS n
    FROM players WHERE external_id IS NOT NULL AND nationality <> 'Unknown'
    GROUP BY nationality HAVING COUNT(*) >= 25
    ORDER BY n DESC LIMIT 45
  `)) as unknown as Array<{ nationality: string; n: number }>;
  return { clubs: clubRows.map((r) => r.team_name), nationalities: natRows.map((r) => r.nationality) };
}

let nationCache: Set<string> | null = null;
/** A recognised football nation (any canonical nationality we hold). */
export async function isFootballNation(name: string): Promise<boolean> {
  if (!nationCache) {
    const rows = (await db.execute(sql`SELECT DISTINCT nationality FROM players WHERE nationality IS NOT NULL AND nationality <> 'Unknown'`)) as unknown as Array<{ nationality: string }>;
    nationCache = new Set(rows.map((r) => norm(r.nationality)));
  }
  return nationCache.has(norm(name));
}
