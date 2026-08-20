/**
 * Full player dossier for Quiz Ops review: every stored field we have, plus approve/flag.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  finalAppearances,
  playerAwards,
  playerCareer,
  playerDataReviews,
  playerExtraStats,
  playerHonours,
  playerStats,
  playerTransfers,
  players,
  wcMatchEvents,
  wcMemorable,
  wcSquads,
} from '../db/schema.js';
import { resolveHeadshot, teamLogoUrl } from '../constants/footballMedia.js';
import {
  clubCareerOnlySql,
  clubTeamIds,
  isExcludedNationalSpell,
  isExcludedNationalStat,
  isYouthOrReserveSide,
  nationSet,
} from '../utils/nationalTeam.js';
import { getPhotoOverrides } from './photoOverrides.js';
import {
  CAREER_LEAGUE_IDS,
  TROPHY_COMPETITIONS,
  gameCareerGoalsValue,
  trustedIntlCapsValue,
  trustedIntlGoalsValue,
} from './statMetrics.js';

export type PlayerReviewStatus = 'pending' | 'approved' | 'flagged';
export type PlayerReviewPool = 'unreviewed' | 'flagged' | 'approved' | 'any';

export interface PlayerReviewCounts {
  unreviewed: number;
  approved: number;
  flagged: number;
  poolSize: number;
}

export type CareerSpell = {
  teamId: number;
  teamName: string;
  seasonFrom: number;
  seasonTo: number | null;
  badgeUrl: string;
};

export type SeasonStat = {
  season: number;
  leagueId: number;
  leagueName: string;
  teamId: number;
  teamName: string | null;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number | null;
  saves: number | null;
  foulsCommitted: number | null;
  tackles: number | null;
};

export type StatTotals = {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
};

export type LeagueTotal = {
  leagueId: number;
  leagueName: string;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
};

export interface PlayerDossier {
  id: string;
  name: string;
  aliases: string[];
  nationality: string;
  position: string;
  subPosition: string | null;
  subPositions: string[];
  age: number;
  birthDate: string | null;
  currentClub: string;
  currentLeague: string;
  shirtNumber: number | null;
  foot: string | null;
  marketValueTier: number;
  marketValueEur: number | null;
  peakMarketValueEur: number | null;
  recordFeeEur: number | null;
  externalId: string | null;
  tmPlayerId: string | null;
  apiFootballId: number | null;
  photoUrl: string | null;
  headshotUrl: string | null;
  review: {
    status: PlayerReviewStatus;
    note: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  };
  /** Same club-only filter as Club Chain / LMS career path. */
  career: CareerSpell[];
  /** Stored national / youth-national sides — games never treat these as clubs. */
  internationalCareer: CareerSpell[];
  /** Club competitions only (drops WC / Euro / AFCON / Copa América / national sides). */
  stats: SeasonStat[];
  internationalStats: SeasonStat[];
  statTotals: StatTotals;
  leagueTotals: LeagueTotal[];
  gameUsage: {
    clubCount: number;
    careerApps: number;
    careerGoals: number | null;
    intlCaps: number;
    intlGoals: number;
    trophies: number;
  };
  extra: {
    penaltyGoals: number;
    weakFootGoals: number;
    careerHattricks: number;
    uclKnockoutGoals: number;
    uclGoalsVsEnglish: number;
    uclRedCards: number;
    goalsBefore21: number;
    firstGoalAgeDays: number | null;
    debutAgeDays: number | null;
    intlCaps: number;
    intlGoals: number;
    fbrefPenalties: number;
    tmCareerGoals: number | null;
    tmCareerApps: number | null;
    tmIntlCaps: number | null;
    tmIntlGoals: number | null;
    verifiedClubCount: number | null;
    plPenalties: number;
    laligaPenalties: number;
    serieaPenalties: number;
    bundesligaPenalties: number;
    ligue1Penalties: number;
  } | null;
  transfers: Array<{
    transferDate: string | null;
    fromTeamId: number;
    fromTeamName: string | null;
    toTeamId: number;
    toTeamName: string | null;
    feeRaw: string | null;
    feeEurM: string | null;
    transferType: string;
  }>;
  honours: Array<{
    competition: string;
    country: string | null;
    season: string;
    placement: string;
    usedInTrophyRankings: boolean;
  }>;
  awards: Array<{
    award: string;
    year: number;
    placement: string;
  }>;
  finals: Array<{
    competition: string;
    season: number;
    team: string;
    started: boolean;
    minutes: number;
    goals: number;
    won: boolean;
  }>;
  managers: Array<{
    manager: string;
    club: string;
    seasonFrom: number;
    seasonTo: number | null;
  }>;
  wcSquads: Array<{
    year: number;
    country: string;
    position: string;
    shirtNumber: number | null;
    club: string | null;
    caps: number | null;
    isCaptain: boolean;
    coach: string | null;
  }>;
  wcEvents: Array<{
    year: number;
    matchDate: string | null;
    stage: string;
    team: string;
    opponent: string;
    type: string;
    minute: number | null;
    detail: string | null;
    assistPlayerName: string | null;
    role: 'player' | 'assist';
  }>;
  wcMemorable: Array<{
    year: number;
    clue: string;
    status: string;
  }>;
}

/** Same household bar as LMS / Draft — tier 3 is the schema default and is full of unknowns. */
const FAMOUS_TIER = 4;

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function isoStamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export async function getPlayerReviewCounts(): Promise<PlayerReviewCounts> {
  const rows = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE p.market_value_tier >= ${FAMOUS_TIER} AND COALESCE(r.status, 'pending') = 'pending')::int AS unreviewed,
      COUNT(*) FILTER (WHERE r.status = 'approved')::int AS approved,
      COUNT(*) FILTER (WHERE r.status = 'flagged')::int AS flagged,
      COUNT(*) FILTER (WHERE p.market_value_tier >= ${FAMOUS_TIER})::int AS pool_size
    FROM players p
    LEFT JOIN player_data_reviews r ON r.player_id = p.id
  `)) as unknown as Array<{
    unreviewed: number;
    approved: number;
    flagged: number;
    pool_size: number;
  }>;
  const row = rows[0];
  return {
    unreviewed: row?.unreviewed ?? 0,
    approved: row?.approved ?? 0,
    flagged: row?.flagged ?? 0,
    poolSize: row?.pool_size ?? 0,
  };
}

function poolWhere(pool: PlayerReviewPool) {
  if (pool === 'approved') return sql`r.status = 'approved'`;
  if (pool === 'flagged') return sql`r.status = 'flagged'`;
  if (pool === 'any') return sql`p.market_value_tier >= ${FAMOUS_TIER}`;
  return sql`p.market_value_tier >= ${FAMOUS_TIER} AND COALESCE(r.status, 'pending') = 'pending'`;
}

export async function pickRandomPlayerId(
  pool: PlayerReviewPool,
  excludeIds: string[]
): Promise<string | null> {
  const exclude =
    excludeIds.length > 0
      ? sql`AND p.id NOT IN (${sql.join(excludeIds.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql``;
  const rows = (await db.execute(sql`
    SELECT p.id
    FROM players p
    LEFT JOIN player_data_reviews r ON r.player_id = p.id
    WHERE ${poolWhere(pool)}
      ${exclude}
    ORDER BY random()
    LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function loadPlayerDossier(playerId: string): Promise<PlayerDossier | null> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;

  const [
    reviewRows,
    careerRows,
    statRows,
    extraRows,
    transferRows,
    honourRows,
    awardRows,
    finalRows,
    wcSquadRows,
    wcEventRows,
    memorableRows,
    managerRows,
    overrides,
  ] = await Promise.all([
    db.select().from(playerDataReviews).where(eq(playerDataReviews.playerId, playerId)).limit(1),
    db
      .select()
      .from(playerCareer)
      .where(eq(playerCareer.playerId, playerId))
      .orderBy(playerCareer.seasonFrom, playerCareer.teamName),
    db
      .select()
      .from(playerStats)
      .where(eq(playerStats.playerId, playerId))
      .orderBy(desc(playerStats.season), playerStats.leagueName, playerStats.teamName),
    db.select().from(playerExtraStats).where(eq(playerExtraStats.playerId, playerId)).limit(1),
    db
      .select()
      .from(playerTransfers)
      .where(eq(playerTransfers.playerId, playerId))
      .orderBy(playerTransfers.transferDate),
    db
      .select()
      .from(playerHonours)
      .where(eq(playerHonours.playerId, playerId))
      .orderBy(playerHonours.season, playerHonours.competition),
    db
      .select()
      .from(playerAwards)
      .where(eq(playerAwards.playerId, playerId))
      .orderBy(desc(playerAwards.year), playerAwards.award),
    db
      .select()
      .from(finalAppearances)
      .where(eq(finalAppearances.playerId, playerId))
      .orderBy(desc(finalAppearances.season), finalAppearances.competition),
    db
      .select()
      .from(wcSquads)
      .where(eq(wcSquads.playerId, playerId))
      .orderBy(desc(wcSquads.year)),
    db
      .select()
      .from(wcMatchEvents)
      .where(sql`${wcMatchEvents.playerId} = ${playerId}::uuid OR ${wcMatchEvents.assistPlayerId} = ${playerId}::uuid`)
      .orderBy(desc(wcMatchEvents.year), wcMatchEvents.matchDate),
    db
      .select()
      .from(wcMemorable)
      .where(eq(wcMemorable.playerId, playerId))
      .orderBy(desc(wcMemorable.year)),
    db.execute(sql`
      SELECT DISTINCT mt.manager, mt.club, mt.season_from, mt.season_to
      FROM manager_tenures mt
      JOIN player_career pc ON pc.player_id = ${playerId}::uuid
        AND ${clubCareerOnlySql('pc')}
        AND (
          lower(pc.team_name) = mt.club_norm
          OR lower(pc.team_name) = lower(mt.club)
        )
        AND pc.season_from <= COALESCE(mt.season_to, 9999)
        AND mt.season_from <= COALESCE(pc.season_to, 9999)
      ORDER BY mt.season_from, mt.manager
    `),
    getPhotoOverrides(),
  ]);

  const review = reviewRows[0];
  const extra = extraRows[0] ?? null;
  const managers = managerRows as unknown as Array<{
    manager: string;
    club: string;
    season_from: number;
    season_to: number | null;
  }>;

  const [nations, clubs] = await Promise.all([nationSet(), clubTeamIds()]);

  const mapCareer = (row: (typeof careerRows)[number]): CareerSpell => ({
    teamId: row.teamId,
    teamName: row.teamName,
    seasonFrom: row.seasonFrom,
    seasonTo: row.seasonTo,
    badgeUrl: teamLogoUrl(row.teamId),
  });
  const career: CareerSpell[] = [];
  const internationalCareer: CareerSpell[] = [];
  for (const row of careerRows) {
    const spell = mapCareer(row);
    if (isExcludedNationalSpell(row.teamId, row.teamName, nations, clubs)) {
      internationalCareer.push(spell);
    } else {
      career.push(spell);
    }
  }

  const mapStat = (row: (typeof statRows)[number]): SeasonStat => ({
    season: row.season,
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    teamId: row.teamId,
    teamName: row.teamName,
    appearances: row.appearances,
    minutes: row.minutes,
    goals: row.goals,
    assists: row.assists,
    yellowCards: row.yellowCards,
    redCards: row.redCards,
    cleanSheets: row.cleanSheets,
    saves: row.saves,
    foulsCommitted: row.foulsCommitted,
    tackles: row.tackles,
  });
  const stats: SeasonStat[] = [];
  const internationalStats: SeasonStat[] = [];
  for (const row of statRows) {
    const mapped = mapStat(row);
    if (isExcludedNationalStat(row.leagueId, row.teamId, row.teamName, nations, clubs)) {
      internationalStats.push(mapped);
    } else {
      stats.push(mapped);
    }
  }

  const sumStats = (rows: SeasonStat[]): StatTotals =>
    rows.reduce(
      (acc, row) => {
        acc.appearances += row.appearances;
        acc.minutes += row.minutes;
        acc.goals += row.goals;
        acc.assists += row.assists;
        acc.yellowCards += row.yellowCards;
        acc.redCards += row.redCards;
        return acc;
      },
      { appearances: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 }
    );

  const leagueMap = new Map<string, LeagueTotal>();
  for (const row of stats) {
    const key = `${row.leagueId}|${row.leagueName}`;
    const current = leagueMap.get(key) ?? {
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      appearances: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
    };
    current.appearances += row.appearances;
    current.minutes += row.minutes;
    current.goals += row.goals;
    current.assists += row.assists;
    leagueMap.set(key, current);
  }

  const careerLeagueIds = new Set(CAREER_LEAGUE_IDS);
  const careerApps = stats
    .filter((row) => careerLeagueIds.has(row.leagueId))
    .reduce((sum, row) => sum + row.appearances, 0);

  const clubKeys = new Set<string>();
  for (const row of career) {
    if (row.teamId > 0 && !isYouthOrReserveSide(row.teamName)) {
      clubKeys.add(row.teamName.toLowerCase());
    }
  }
  for (const row of stats) {
    if (row.appearances > 0 && row.teamName && !isYouthOrReserveSide(row.teamName)) {
      clubKeys.add(row.teamName.toLowerCase());
    }
  }

  const trophySet = new Set(TROPHY_COMPETITIONS);
  const honours = honourRows.map((row) => ({
    competition: row.competition,
    country: row.country,
    season: row.season,
    placement: row.placement,
    usedInTrophyRankings: row.placement.toLowerCase() === 'winner' && trophySet.has(row.competition),
  }));

  const intlCaps = extra ? trustedIntlCapsValue(extra.tmIntlCaps, extra.intlCaps) : 0;
  const intlGoals = extra ? trustedIntlGoalsValue(extra.tmIntlGoals, extra.intlGoals, extra.intlCaps) : 0;

  return {
    id: player.id,
    name: player.name,
    aliases: player.aliases ?? [],
    nationality: player.nationality,
    position: player.position,
    subPosition: player.subPosition,
    subPositions: player.subPositions ?? [],
    age: player.age,
    birthDate: isoDate(player.birthDate),
    currentClub: player.currentClub,
    currentLeague: player.currentLeague,
    shirtNumber: player.shirtNumber,
    foot: player.foot,
    marketValueTier: player.marketValueTier,
    marketValueEur: player.marketValueEur,
    peakMarketValueEur: player.peakMarketValueEur,
    recordFeeEur: player.recordFeeEur,
    externalId: player.externalId,
    tmPlayerId: player.tmPlayerId,
    apiFootballId: player.apiFootballId,
    photoUrl: player.photoUrl,
    headshotUrl: resolveHeadshot(overrides.get(player.id) ?? player.photoUrl, player.apiFootballId),
    review: {
      status: (review?.status as PlayerReviewStatus | undefined) ?? 'pending',
      note: review?.note ?? null,
      reviewedBy: review?.reviewedBy ?? null,
      reviewedAt: isoStamp(review?.reviewedAt),
    },
    career,
    internationalCareer,
    stats,
    internationalStats,
    statTotals: sumStats(stats),
    leagueTotals: [...leagueMap.values()].sort((a, b) => b.appearances - a.appearances),
    gameUsage: {
      clubCount: extra?.verifiedClubCount ?? clubKeys.size,
      careerApps,
      careerGoals: extra ? gameCareerGoalsValue(extra.tmCareerGoals, intlGoals) : null,
      intlCaps,
      intlGoals,
      trophies: honours.filter((row) => row.usedInTrophyRankings).length,
    },
    extra: extra
      ? {
          penaltyGoals: extra.penaltyGoals,
          weakFootGoals: extra.weakFootGoals,
          careerHattricks: extra.careerHattricks,
          uclKnockoutGoals: extra.uclKnockoutGoals,
          uclGoalsVsEnglish: extra.uclGoalsVsEnglish,
          uclRedCards: extra.uclRedCards,
          goalsBefore21: extra.goalsBefore21,
          firstGoalAgeDays: extra.firstGoalAgeDays,
          debutAgeDays: extra.debutAgeDays,
          intlCaps: extra.intlCaps,
          intlGoals: extra.intlGoals,
          fbrefPenalties: extra.fbrefPenalties,
          tmCareerGoals: extra.tmCareerGoals,
          tmCareerApps: extra.tmCareerApps,
          tmIntlCaps: extra.tmIntlCaps,
          tmIntlGoals: extra.tmIntlGoals,
          verifiedClubCount: extra.verifiedClubCount,
          plPenalties: extra.plPenalties,
          laligaPenalties: extra.laligaPenalties,
          serieaPenalties: extra.serieaPenalties,
          bundesligaPenalties: extra.bundesligaPenalties,
          ligue1Penalties: extra.ligue1Penalties,
        }
      : null,
    transfers: transferRows
      .filter((row) => {
        const fromNational = Boolean(
          row.fromTeamName && isExcludedNationalSpell(row.fromTeamId, row.fromTeamName, nations, clubs)
        );
        const toNational = Boolean(
          row.toTeamName && isExcludedNationalSpell(row.toTeamId, row.toTeamName, nations, clubs)
        );
        return !fromNational && !toNational;
      })
      .map((row) => ({
        transferDate: isoDate(row.transferDate),
        fromTeamId: row.fromTeamId,
        fromTeamName: row.fromTeamName,
        toTeamId: row.toTeamId,
        toTeamName: row.toTeamName,
        feeRaw: row.feeRaw,
        feeEurM: row.feeEurM == null ? null : String(row.feeEurM),
        transferType: row.transferType,
      })),
    honours,
    awards: awardRows.map((row) => ({
      award: row.award,
      year: row.year,
      placement: row.placement,
    })),
    finals: finalRows.map((row) => ({
      competition: row.competition,
      season: row.season,
      team: row.team,
      started: row.started,
      minutes: row.minutes,
      goals: row.goals,
      won: row.won,
    })),
    managers: managers.map((row) => ({
      manager: row.manager,
      club: row.club,
      seasonFrom: row.season_from,
      seasonTo: row.season_to,
    })),
    wcSquads: wcSquadRows.map((row) => ({
      year: row.year,
      country: row.country,
      position: row.position,
      shirtNumber: row.shirtNumber,
      club: row.club,
      caps: row.caps,
      isCaptain: row.isCaptain,
      coach: row.coach,
    })),
    wcEvents: wcEventRows.map((row) => ({
      year: row.year,
      matchDate: isoDate(row.matchDate),
      stage: row.stage,
      team: row.team,
      opponent: row.opponent,
      type: row.type,
      minute: row.minute,
      detail: row.detail,
      assistPlayerName: row.assistPlayerName,
      role: row.playerId === playerId ? 'player' : 'assist',
    })),
    wcMemorable: memorableRows.map((row) => ({
      year: row.year,
      clue: row.clue,
      status: row.status,
    })),
  };
}

export async function setPlayerReview(input: {
  playerId: string;
  status: 'approved' | 'flagged' | 'pending';
  note?: string | null;
  reviewedBy: string;
}): Promise<PlayerDossier> {
  const [existing] = await db.select().from(players).where(eq(players.id, input.playerId)).limit(1);
  if (!existing) throw new Error('Player not found.');

  const now = new Date();
  await db
    .insert(playerDataReviews)
    .values({
      playerId: input.playerId,
      status: input.status,
      note: input.note?.trim() || null,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.status === 'pending' ? null : now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: playerDataReviews.playerId,
      set: {
        status: input.status,
        note: input.note?.trim() || null,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.status === 'pending' ? null : now,
        updatedAt: now,
      },
    });

  const dossier = await loadPlayerDossier(input.playerId);
  if (!dossier) throw new Error('Player not found.');
  return dossier;
}

export async function getRandomPlayerDossier(
  pool: PlayerReviewPool,
  excludeIds: string[]
): Promise<{ dossier: PlayerDossier | null; counts: PlayerReviewCounts }> {
  const counts = await getPlayerReviewCounts();
  const id = await pickRandomPlayerId(pool, excludeIds);
  if (!id) return { dossier: null, counts };
  const dossier = await loadPlayerDossier(id);
  return { dossier, counts };
}
