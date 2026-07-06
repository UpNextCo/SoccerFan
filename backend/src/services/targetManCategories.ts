import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { FactPackPlayer } from './dailyPuzzleTypes.js';
import { careerGoalsSub, peakValueSub, careerTrophiesSub } from './statMetrics.js';

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
  { id: 'intl_caps', label: 'International Caps', valueNoun: 'caps', offNoun: 'caps off', unit: null, round: 5, min: 30, sub: extraStat('intl_caps') },
  { id: 'pl_penalties', label: 'Premier League Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('pl_penalties') },
  { id: 'laliga_penalties', label: 'La Liga Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('laliga_penalties') },
  { id: 'seriea_penalties', label: 'Serie A Penalties', valueNoun: 'pens', offNoun: 'pens off', unit: null, round: 1, min: 5, sub: extraStat('seriea_penalties') },
  { id: 'hattricks', label: 'Career Hat-tricks', valueNoun: 'hat-tricks', offNoun: 'hat-tricks off', unit: null, round: 1, min: 2, sub: extraStat('career_hattricks') },
  { id: 'career_trophies', label: 'Career Trophies', valueNoun: 'trophies', offNoun: 'trophies off', unit: null, round: 1, min: 5, sub: careerTrophiesSub },
];

export function targetCategoryById(id: string): TargetCategoryDef | undefined {
  return TARGET_CATEGORIES.find((c) => c.id === id);
}

/** Top players for a category, ranked by value desc — used to seed the daily target. */
export async function topPlayersForCategory(
  def: TargetCategoryDef,
  limit = 25
): Promise<FactPackPlayer[]> {
  const rows = (await db.execute(sql`
    SELECT v.player_id AS id, v.value::int AS value,
           p.name, p.current_club AS club, p.current_league AS league, p.nationality, p.position
    FROM ${def.sub} v
    JOIN players p ON p.id = v.player_id
    WHERE v.value >= ${def.min} AND p.external_id IS NOT NULL
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

/** Value each of `playerIds` for a category (0 if no record) — used to score guesses. */
export async function playerValuesForCategory(
  categoryId: string,
  playerIds: string[]
): Promise<Array<{ id: string; value: number }>> {
  const def = targetCategoryById(categoryId);
  if (!def || playerIds.length === 0) return playerIds.map((id) => ({ id, value: 0 }));

  const rows = (await db.execute(sql`
    SELECT v.player_id AS id, v.value::int AS value
    FROM ${def.sub} v
    WHERE v.player_id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ id: string; value: number }>;

  const byId = new Map(rows.map((r) => [r.id, Number(r.value ?? 0)]));
  return playerIds.map((id) => ({ id, value: byId.get(id) ?? 0 }));
}
