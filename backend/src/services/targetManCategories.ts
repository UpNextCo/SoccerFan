import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { FactPackPlayer } from './dailyPuzzleTypes.js';
import { careerGoalsSub, peakValueSub, careerTrophiesSub, intlCapsSub } from './statMetrics.js';

/**
 * Target Man categories. Each one is a self-describing, fan-friendly stat with a SQL
 * "value subquery" returning (player_id, value). The same subquery powers both ranking
 * (build the daily target from 5 mid-table players) and valuation (score a player's guess).
 *
 * We deliberately avoid the old obscure per-league grind (minutes / tackles / fouls / saves)
 * in favour of stats fans actually have a feel for: marquee goals, value, caps, penalties, trophies.
 */
export interface TargetCategoryDef {
  id: string;
  label: string;
  valueNoun: string; // short noun: "goals", "caps", "pens", "value"
  offNoun: string; // result-screen suffix: "goals off", "€m off"
  unit: 'eur_m' | null; // value formatting hint for the client
  round: number; // target rounding step
  min: number; // minimum value for a player to be "ranked" (eligible to seed a target)
  sub: SQL; // subquery yielding (player_id, value)
}

const leagueMetric = (col: 'goals' | 'assists' | 'appearances', leagueId: number): SQL =>
  sql`(SELECT player_id, SUM(${sql.raw(col)})::int AS value FROM player_stats WHERE league_id = ${leagueId} GROUP BY player_id)`;

const extraStat = (col: string): SQL =>
  sql`(SELECT player_id, ${sql.raw(col)}::int AS value FROM player_extra_stats)`;

// peakValueSub, careerGoalsSub, careerTrophiesSub are the shared canonical definitions (statMetrics.ts)
// so "Career Goals" / "Peak Value" mean the same thing here as in Draft XI and Blind Rank.

const wcGoalsSub: SQL = sql`(SELECT player_id, SUM(goals)::int AS value FROM player_stats WHERE league_id = 1 GROUP BY player_id)`;

export const TARGET_CATEGORIES: TargetCategoryDef[] = [
  { id: 'peak_value', label: 'Peak Market Value', valueNoun: 'value', offNoun: '€m off', unit: 'eur_m', round: 5, min: 20, sub: peakValueSub },
  { id: 'pl_goals', label: 'Premier League Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 20, sub: leagueMetric('goals', 39) },
  { id: 'laliga_goals', label: 'La Liga Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 20, sub: leagueMetric('goals', 140) },
  { id: 'seriea_goals', label: 'Serie A Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 20, sub: leagueMetric('goals', 135) },
  { id: 'bundesliga_goals', label: 'Bundesliga Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 20, sub: leagueMetric('goals', 78) },
  { id: 'ligue1_goals', label: 'Ligue 1 Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 20, sub: leagueMetric('goals', 61) },
  { id: 'cl_goals', label: 'Champions League Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 5, min: 10, sub: leagueMetric('goals', 2) },
  { id: 'wc_goals', label: 'World Cup Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 1, min: 3, sub: wcGoalsSub },
  { id: 'career_goals', label: 'Career Goals', valueNoun: 'goals', offNoun: 'goals off', unit: null, round: 10, min: 50, sub: careerGoalsSub },
  { id: 'pl_assists', label: 'Premier League Assists', valueNoun: 'assists', offNoun: 'assists off', unit: null, round: 5, min: 15, sub: leagueMetric('assists', 39) },
  { id: 'cl_assists', label: 'Champions League Assists', valueNoun: 'assists', offNoun: 'assists off', unit: null, round: 5, min: 8, sub: leagueMetric('assists', 2) },
  { id: 'pl_apps', label: 'Premier League Appearances', valueNoun: 'apps', offNoun: 'apps off', unit: null, round: 5, min: 100, sub: leagueMetric('appearances', 39) },
  { id: 'cl_apps', label: 'Champions League Appearances', valueNoun: 'apps', offNoun: 'apps off', unit: null, round: 5, min: 30, sub: leagueMetric('appearances', 2) },
  { id: 'intl_caps', label: 'International Caps', valueNoun: 'caps', offNoun: 'caps off', unit: null, round: 5, min: 30, sub: intlCapsSub },
  { id: 'pl_penalties', label: 'Premier League Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('pl_penalties') },
  { id: 'laliga_penalties', label: 'La Liga Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('laliga_penalties') },
  { id: 'seriea_penalties', label: 'Serie A Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('seriea_penalties') },
  { id: 'hattricks', label: 'Career Hat-tricks', valueNoun: 'hat-tricks', offNoun: 'hat-tricks off', unit: null, round: 1, min: 2, sub: extraStat('career_hattricks') },
  { id: 'career_trophies', label: 'Career Trophies', valueNoun: 'trophies', offNoun: 'trophies off', unit: null, round: 1, min: 5, sub: careerTrophiesSub },
];

export function targetCategoryById(id: string): TargetCategoryDef | undefined {
  return TARGET_CATEGORIES.find((c) => c.id === id);
}

/** Optional Quiz Ops pool filter — the stat stays the same; only eligible players change. */
export type TargetManPool = {
  type: 'nationality' | 'club';
  nationality?: string | null;
  club?: string | null;
  teamId?: number | null;
};

export function normalizeTargetManPool(raw: unknown): TargetManPool | null {
  if (!raw || typeof raw !== 'object') return null;
  const pool = raw as TargetManPool;
  if (pool.type === 'nationality') {
    const nationality = typeof pool.nationality === 'string' ? pool.nationality.trim() : '';
    return nationality ? { type: 'nationality', nationality } : null;
  }
  if (pool.type === 'club') {
    const club = typeof pool.club === 'string' ? pool.club.trim() : '';
    const teamId = typeof pool.teamId === 'number' && Number.isInteger(pool.teamId) && pool.teamId > 0
      ? pool.teamId
      : null;
    return club ? { type: 'club', club, teamId } : null;
  }
  return null;
}

export function composeTargetManLabel(baseLabel: string, pool?: TargetManPool | null): string {
  if (pool?.type === 'nationality' && pool.nationality) {
    return `${baseLabel} from ${pool.nationality} players`;
  }
  if (pool?.type === 'club' && pool.club) {
    return `${baseLabel} from ${pool.club} players`;
  }
  return baseLabel;
}

function poolFilterSql(pool?: TargetManPool | null): SQL {
  if (pool?.type === 'nationality' && pool.nationality) {
    return sql`p.nationality = ${pool.nationality}`;
  }
  if (pool?.type === 'club' && pool.club) {
    const teamId = pool.teamId;
    const clubMatch = typeof teamId === 'number'
      ? sql`(s.team_name = ${pool.club} OR s.team_id = ${teamId})`
      : sql`s.team_name = ${pool.club}`;
    const careerMatch = typeof teamId === 'number'
      ? sql`(c.team_name = ${pool.club} OR c.team_id = ${teamId})`
      : sql`c.team_name = ${pool.club}`;
    return sql`(
      EXISTS (
        SELECT 1 FROM player_stats s
        WHERE s.player_id = p.id AND s.appearances > 0 AND ${clubMatch}
      )
      OR EXISTS (
        SELECT 1 FROM player_career c
        WHERE c.player_id = p.id AND c.team_id > 0 AND ${careerMatch}
      )
    )`;
  }
  return sql`TRUE`;
}

export function targetManSearchFilterSql(opts?: {
  nationality?: string;
  club?: string;
  teamId?: number;
}): SQL {
  return poolFilterSql(normalizeTargetManPool(
    opts?.nationality
      ? { type: 'nationality', nationality: opts.nationality }
      : opts?.club
        ? { type: 'club', club: opts.club, teamId: opts.teamId ?? null }
        : null
  ));
}

export interface AdminTargetCategoryOption {
  id: string;
  label: string;
  valueNoun: string;
  offNoun: string;
  unit: 'eur_m' | null;
  round: number;
  minimumPlayerValue: number;
  suggestedTarget: number;
}

/** Canonical, currently viable category options for Quiz Ops authoring. */
export async function adminTargetCategoryOptions(): Promise<AdminTargetCategoryOption[]> {
  const options = await Promise.all(TARGET_CATEGORIES.map(async (def) => {
    const ranked = await topPlayersForCategory(def, 30);
    if (ranked.length < 5) return null;
    const targetPlayers = (ranked.length >= 9 ? ranked.slice(4) : ranked).slice(0, 5);
    const combined = targetPlayers.reduce((sum, player) => sum + player.statValue, 0);
    const suggestedTarget = Math.max(def.round, Math.round(combined / def.round) * def.round);
    return {
      id: def.id,
      label: def.label,
      valueNoun: def.valueNoun,
      offNoun: def.offNoun,
      unit: def.unit,
      round: def.round,
      minimumPlayerValue: def.min,
      suggestedTarget,
    };
  }));
  return options.filter((option): option is AdminTargetCategoryOption => option !== null);
}

/** Top players for a category, ranked by value desc — used to seed the daily target. */
export async function topPlayersForCategory(
  def: TargetCategoryDef,
  limit = 25,
  pool?: TargetManPool | null
): Promise<FactPackPlayer[]> {
  const rows = (await db.execute(sql`
    SELECT v.player_id AS id, v.value::int AS value,
           p.name, p.current_club AS club, p.current_league AS league, p.nationality, p.position
    FROM ${def.sub} v
    JOIN players p ON p.id = v.player_id
    WHERE v.value >= ${def.min} AND p.external_id IS NOT NULL
      AND ${poolFilterSql(pool)}
    ORDER BY v.value DESC, p.id
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string; value: number; name: string; club: string; league: string; nationality: string; position: string;
  }>;

  return rows.map((r) => ({
    playerId: r.id,
    name: r.name,
    club: r.club,
    league: r.league,
    nationality: r.nationality,
    position: r.position,
    statValue: Number(r.value ?? 0),
  }));
}

export type TargetManPreview = {
  label: string;
  suggestedTarget: number;
  eligibleCount: number;
  samplePlayers: Array<{ name: string; value: number }>;
};

export async function previewTargetManCategory(
  categoryId: string,
  pool?: TargetManPool | null
): Promise<TargetManPreview | null> {
  const def = targetCategoryById(categoryId);
  if (!def) return null;
  const normalized = normalizeTargetManPool(pool);
  const ranked = await topPlayersForCategory(def, 30, normalized);
  const sample = ranked.length >= 9 ? ranked.slice(4) : ranked;
  const seedPlayers = sample.slice(0, 5);
  const combined = seedPlayers.reduce((sum, player) => sum + player.statValue, 0);
  const suggestedTarget = seedPlayers.length > 0
    ? Math.max(def.round, Math.round(combined / def.round) * def.round)
    : def.round;
  return {
    label: composeTargetManLabel(def.label, normalized),
    suggestedTarget,
    eligibleCount: ranked.length,
    samplePlayers: ranked.slice(0, 8).map((player) => ({
      name: player.name,
      value: player.statValue,
    })),
  };
}

export async function playersMatchTargetManPool(
  playerIds: string[],
  pool?: TargetManPool | null
): Promise<Array<{ id: string; inPool: boolean }>> {
  const normalized = normalizeTargetManPool(pool);
  if (!normalized || playerIds.length === 0) {
    return playerIds.map((id) => ({ id, inPool: true }));
  }
  const rows = (await db.execute(sql`
    SELECT p.id
    FROM players p
    WHERE p.id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND ${poolFilterSql(normalized)}
  `)) as unknown as Array<{ id: string }>;
  const matched = new Set(rows.map((row) => row.id));
  return playerIds.map((id) => ({ id, inPool: matched.has(id) }));
}

/** Value each of `playerIds` for a category (0 if no record or outside the pool). */
export async function playerValuesForCategory(
  categoryId: string,
  playerIds: string[],
  pool?: TargetManPool | null
): Promise<Array<{ id: string; value: number; inPool: boolean }>> {
  const def = targetCategoryById(categoryId);
  if (!def || playerIds.length === 0) {
    return playerIds.map((id) => ({ id, value: 0, inPool: true }));
  }
  const normalized = normalizeTargetManPool(pool);
  const membership = await playersMatchTargetManPool(playerIds, normalized);
  const inPoolById = new Map(membership.map((row) => [row.id, row.inPool]));

  const rows = (await db.execute(sql`
    SELECT v.player_id AS id, v.value::int AS value
    FROM ${def.sub} v
    WHERE v.player_id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ id: string; value: number }>;

  const byId = new Map(rows.map((r) => [r.id, Number(r.value ?? 0)]));
  return playerIds.map((id) => {
    const inPool = inPoolById.get(id) ?? true;
    return { id, value: inPool ? (byId.get(id) ?? 0) : 0, inPool };
  });
}
