import { and, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerHonours, playerStats, playerTransfers, players } from '../db/schema.js';
import { LEAGUE_ID_BY_NAME } from '../jobs/ingest-config.js';

export type StatMetric =
  | 'goals'
  | 'assists'
  | 'appearances'
  | 'yellowCards'
  | 'redCards'
  | 'minutes'
  | 'cleanSheets'
  | 'saves'
  | 'foulsCommitted'
  | 'tackles';

const METRIC_COLUMN: Record<StatMetric, keyof typeof playerStats.$inferSelect> = {
  goals: 'goals',
  assists: 'assists',
  appearances: 'appearances',
  yellowCards: 'yellowCards',
  redCards: 'redCards',
  minutes: 'minutes',
  cleanSheets: 'cleanSheets',
  saves: 'saves',
  foulsCommitted: 'foulsCommitted',
  tackles: 'tackles',
};

export function resolveLeagueId(leagueId?: number, leagueName?: string): number | null {
  if (leagueId && leagueId > 0) return leagueId;
  if (leagueName && LEAGUE_ID_BY_NAME[leagueName]) return LEAGUE_ID_BY_NAME[leagueName];
  return null;
}

export async function getPlayerCareerStats(
  playerId: string,
  leagueId: number
): Promise<Record<StatMetric, number>> {
  const rows = await db
    .select({
      goals: sum(playerStats.goals),
      assists: sum(playerStats.assists),
      appearances: sum(playerStats.appearances),
      yellowCards: sum(playerStats.yellowCards),
      redCards: sum(playerStats.redCards),
      minutes: sum(playerStats.minutes),
      cleanSheets: sum(playerStats.cleanSheets),
      saves: sum(playerStats.saves),
      foulsCommitted: sum(playerStats.foulsCommitted),
      tackles: sum(playerStats.tackles),
    })
    .from(playerStats)
    .where(and(eq(playerStats.playerId, playerId), eq(playerStats.leagueId, leagueId)));

  const row = rows[0];
  return {
    goals: Number(row?.goals ?? 0),
    assists: Number(row?.assists ?? 0),
    appearances: Number(row?.appearances ?? 0),
    yellowCards: Number(row?.yellowCards ?? 0),
    redCards: Number(row?.redCards ?? 0),
    minutes: Number(row?.minutes ?? 0),
    cleanSheets: Number(row?.cleanSheets ?? 0),
    saves: Number(row?.saves ?? 0),
    foulsCommitted: Number(row?.foulsCommitted ?? 0),
    tackles: Number(row?.tackles ?? 0),
  };
}

export async function getPlayerCareerStatValue(
  playerId: string,
  leagueId: number,
  metric: StatMetric
): Promise<number> {
  const totals = await getPlayerCareerStats(playerId, leagueId);
  return totals[metric] ?? 0;
}

export async function getTopPlayersByCareerStat(input: {
  leagueId: number;
  metric: StatMetric;
  min: number;
  limit?: number;
}) {
  const limit = Math.min(input.limit ?? 50, 100);
  const metricColumn = METRIC_COLUMN[input.metric];

  const rows = await db
    .select({
      playerId: playerStats.playerId,
      total: sum(playerStats[metricColumn]),
      name: players.name,
      club: players.currentClub,
      league: players.currentLeague,
      nationality: players.nationality,
      position: players.position,
    })
    .from(playerStats)
    .innerJoin(players, eq(players.id, playerStats.playerId))
    .where(eq(playerStats.leagueId, input.leagueId))
    .groupBy(
      playerStats.playerId,
      players.name,
      players.currentClub,
      players.currentLeague,
      players.nationality,
      players.position
    )
    .having(gte(sum(playerStats[metricColumn]), input.min))
    .orderBy(sql`${sum(playerStats[metricColumn])} DESC`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.playerId,
    name: row.name,
    club: row.club,
    league: row.league,
    nationality: row.nationality,
    position: row.position,
    statValue: Number(row.total ?? 0),
  }));
}

export async function getPlayerTransfers(playerId: string) {
  return db
    .select()
    .from(playerTransfers)
    .where(eq(playerTransfers.playerId, playerId))
    .orderBy(sql`${playerTransfers.transferDate} DESC NULLS LAST`);
}

export async function getPlayerHonours(playerId: string) {
  return db
    .select()
    .from(playerHonours)
    .where(eq(playerHonours.playerId, playerId));
}

export async function getPlayerTrophyCount(playerId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(playerHonours)
    .where(
      and(eq(playerHonours.playerId, playerId), sql`lower(${playerHonours.placement}) = 'winner'`)
    );
  return rows[0]?.count ?? 0;
}

export async function getLatestTransferFeeEurM(playerId: string): Promise<number | null> {
  const rows = await db
    .select({ feeEurM: playerTransfers.feeEurM })
    .from(playerTransfers)
    .where(eq(playerTransfers.playerId, playerId))
    .orderBy(sql`${playerTransfers.transferDate} DESC NULLS LAST`)
    .limit(1);

  const fee = rows[0]?.feeEurM;
  return fee != null ? Number(fee) : null;
}
