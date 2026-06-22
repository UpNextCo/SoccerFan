import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { INGEST_LEAGUES } from '../jobs/ingest-config.js';
import type { DailyFactPack, FactPackPlayer, TargetManStatCategory } from './dailyPuzzleTypes.js';
import { getTopPlayersByCareerStat, type StatMetric } from './statsService.js';

const PL_LEAGUE_ID = 39;

const METRIC_BY_TARGET_CATEGORY: Record<TargetManStatCategory, StatMetric> = {
  goals: 'goals',
  assists: 'assists',
  appearances: 'appearances',
  yellowCards: 'yellowCards',
  redCards: 'redCards',
  cleanSheets: 'cleanSheets',
  minutesPlayed: 'minutes',
  saves: 'saves',
  foulsCommitted: 'foulsCommitted',
  tacklesWon: 'tackles',
};

export function leagueIdByName(name: string): number | undefined {
  return INGEST_LEAGUES.find((league) => league.name === name)?.id;
}

export function targetCategoryLabel(category: TargetManStatCategory): string {
  const labels: Record<TargetManStatCategory, string> = {
    goals: 'Goals',
    assists: 'Assists',
    appearances: 'Appearances',
    yellowCards: 'Yellow Cards',
    redCards: 'Red Cards',
    cleanSheets: 'Clean Sheets',
    minutesPlayed: 'Minutes Played',
    saves: 'Saves',
    foulsCommitted: 'Fouls Committed',
    tacklesWon: 'Tackles Won',
  };
  return labels[category];
}

export function metricForTargetCategory(category: TargetManStatCategory): StatMetric {
  return METRIC_BY_TARGET_CATEGORY[category];
}

export async function topPlayersByLeagueMetric(
  leagueId: number,
  metric: StatMetric,
  min = 1,
  limit = 40
): Promise<FactPackPlayer[]> {
  const rows = await getTopPlayersByCareerStat({ leagueId, metric, min, limit });

  return rows.map((row) => ({
    playerId: row.id,
    name: row.name,
    club: row.club,
    league: row.league,
    nationality: row.nationality,
    position: row.position,
    statValue: row.statValue,
  }));
}

export async function buildDailyFactPack(date: string): Promise<DailyFactPack> {
  const [playerCountRow, plTopScorers, plTopAssists, plTopAppearances] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(players)
      .where(sql`${players.externalId} IS NOT NULL`),
    topPlayersByLeagueMetric(PL_LEAGUE_ID, 'goals', 5, 40),
    topPlayersByLeagueMetric(PL_LEAGUE_ID, 'assists', 3, 40),
    topPlayersByLeagueMetric(PL_LEAGUE_ID, 'appearances', 20, 40),
  ]);

  return {
    date,
    playerCount: playerCountRow[0]?.count ?? 0,
    plTopScorers,
    plTopAssists,
    plTopAppearances,
  };
}

export function blindRankPoolForCategory(
  factPack: DailyFactPack,
  category: 'premier_league_goals' | 'premier_league_assists' | 'premier_league_appearances'
): FactPackPlayer[] {
  switch (category) {
    case 'premier_league_goals':
      return factPack.plTopScorers;
    case 'premier_league_assists':
      return factPack.plTopAssists;
    case 'premier_league_appearances':
      return factPack.plTopAppearances;
  }
}

export function blindRankCategoryTitle(
  category: 'premier_league_goals' | 'premier_league_assists' | 'premier_league_appearances'
): string {
  switch (category) {
    case 'premier_league_goals':
      return 'Premier League Goals';
    case 'premier_league_assists':
      return 'Premier League Assists';
    case 'premier_league_appearances':
      return 'Premier League Appearances';
  }
}

export { PL_LEAGUE_ID };
