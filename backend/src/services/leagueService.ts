import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  appMeta,
  leagueCohorts,
  leagueMemberships,
  leagueWeeks,
  users,
  xpLedger,
} from '../db/schema.js';
import { avatarPublicUrl } from '../utils/avatarUrl.js';
import {
  COHORT_SIZE,
  DIVISION_LABELS,
  divisionLabel,
  formatStatusLine,
  isWeeklyDivision,
  londonDateString,
  londonWeekEnd,
  londonWeekStart,
  type LeagueZones,
  type WeeklyDivision,
  zonesForTable,
} from './weeklyLeagueDivisions.js';

export { COHORT_SIZE } from './weeklyLeagueDivisions.js';
export {
  londonWeekStart,
  londonWeekEnd,
  londonDateString,
  zonesForTable,
  packGroupSizes,
  outcomeForRank,
  divisionForLifetimePercentile,
  DIVISION_LABELS,
  WEEKLY_DIVISIONS,
  type WeeklyDivision,
} from './weeklyLeagueDivisions.js';

/**
 * How deep the global boards go. Rank is the row's position in this list, so anyone past the cut
 * doesn't appear at all rather than showing a real rank — keep it well clear of the player count.
 */
const LEADERBOARD_LIMIT = 500;
const OVERALL_LEADERBOARD_LIMIT = 1000;

export interface PlayerStanding {
  userId: string;
  displayName: string;
  favoriteTeamId: number | null;
  avatarUrl?: string;
  xp: number;
  rank: number;
}

export interface TeamStanding {
  teamId: number;
  name: string;
  logoUrl: string | null;
  members: number;
  totalXp: number;
  /** Same as totalXp — kept for older clients that read `score`. */
  score: number;
  rank: number;
}

export interface WeeklyLeagueStanding extends PlayerStanding {
  isYou: boolean;
}

export interface WeeklyLeagueMeResponse {
  weekStart: string;
  weekEnd: string;
  endsLabel: string;
  division: WeeklyDivision;
  divisionLabel: string;
  participated: boolean;
  cohortId: string | null;
  standings: WeeklyLeagueStanding[];
  zones: LeagueZones;
  statusLine: string | null;
  viewerRank: number | null;
}

/** Monday (Europe/London) of the week containing the given YYYY-MM-DD date (interpreted as London). */
export function weekStartFor(dateStr: string): string {
  // Treat dateStr as a London calendar date at noon UTC for stable weekday math.
  return londonWeekStart(new Date(`${dateStr}T12:00:00Z`));
}

export function weekEndFor(weekStart: string): string {
  return londonWeekEnd(weekStart);
}

/** Append earned XP to the ledger. Idempotent per (user, date, mode). Returns whether a row was inserted. */
export async function recordXp(
  userId: string,
  modeId: string,
  xpEarned: number,
  date: string
): Promise<boolean> {
  if (xpEarned <= 0) return false;
  const inserted = await db
    .insert(xpLedger)
    .values({ userId, modeId, xpEarned, date })
    .onConflictDoNothing({
      target: [xpLedger.userId, xpLedger.date, xpLedger.modeId],
    })
    .returning({ id: xpLedger.id });
  return inserted.length > 0;
}

/**
 * After XP is awarded: ensure London week + table membership, refresh denormalized weekly XP.
 * Does not reshuffle an existing cohort mid-week.
 */
export async function syncWeeklyLeagueAfterXp(userId: string, date: string): Promise<void> {
  const weekStart = weekStartFor(date);
  await ensureActiveLeagueWeek(weekStart);
  await ensureWeeklyMembership(userId, weekStart);
  await refreshMembershipWeeklyXp(userId, weekStart);
}

export async function ensureActiveLeagueWeek(weekStart: string): Promise<string> {
  const weekEnd = weekEndFor(weekStart);
  const existing = await db
    .select({ id: leagueWeeks.id })
    .from(leagueWeeks)
    .where(eq(leagueWeeks.weekStart, weekStart))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const created = await db
    .insert(leagueWeeks)
    .values({ weekStart, weekEnd, status: 'active' })
    .onConflictDoNothing()
    .returning({ id: leagueWeeks.id });
  if (created[0]) return created[0].id;

  const again = await db
    .select({ id: leagueWeeks.id })
    .from(leagueWeeks)
    .where(eq(leagueWeeks.weekStart, weekStart))
    .limit(1);
  return again[0]!.id;
}

async function userDivision(userId: string): Promise<WeeklyDivision> {
  const rows = await db
    .select({ currentDivision: users.currentDivision })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const raw = rows[0]?.currentDivision ?? 'sunday_league';
  return isWeeklyDivision(raw) ? raw : 'sunday_league';
}

async function refreshMembershipWeeklyXp(userId: string, weekStart: string): Promise<void> {
  const weekEnd = weekEndFor(weekStart);
  const sumRows = (await db.execute(sql`
    SELECT COALESCE(SUM(xp_earned), 0)::int AS xp
    FROM xp_ledger
    WHERE user_id = ${userId}::uuid
      AND date BETWEEN ${weekStart} AND ${weekEnd}
  `)) as unknown as Array<{ xp: number }>;
  const xp = Number(sumRows[0]?.xp) || 0;

  const current = await db
    .select({
      weeklyXp: leagueMemberships.weeklyXp,
    })
    .from(leagueMemberships)
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)))
    .limit(1);

  if (!current[0]) return;
  if (xp <= current[0].weeklyXp) {
    // Still sync in case of repair / first write at 0.
    if (xp !== current[0].weeklyXp) {
      await db
        .update(leagueMemberships)
        .set({ weeklyXp: xp })
        .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)));
    }
    return;
  }

  await db
    .update(leagueMemberships)
    .set({ weeklyXp: xp, weeklyXpReachedAt: new Date() })
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)));
}

export type XpByModeRow = {
  modeId: string;
  totalXp: number;
  todayXp: number;
};

/** Per-mode XP for the profile breakdown (all-time + a specific day). */
export async function xpByModeForUser(userId: string, date: string): Promise<XpByModeRow[]> {
  const rows = (await db.execute(sql`
    SELECT
      mode_id AS "modeId",
      COALESCE(SUM(xp_earned), 0)::int AS "totalXp",
      COALESCE(SUM(CASE WHEN date = ${date} THEN xp_earned ELSE 0 END), 0)::int AS "todayXp"
    FROM xp_ledger
    WHERE user_id = ${userId}
    GROUP BY mode_id
    ORDER BY "totalXp" DESC, mode_id ASC
  `)) as unknown as Array<{ modeId: string; totalXp: number; todayXp: number }>;

  return rows.map((row) => ({
    modeId: row.modeId,
    totalXp: Number(row.totalXp) || 0,
    todayXp: Number(row.todayXp) || 0,
  }));
}

const PLAYABLE_MODE_IDS = [
  'football_bingo',
  'one_more',
  'draft_master',
  'football_golf',
  'club_chain',
  'target_man',
  'last_man_standing',
  'back_yourself',
] as const;

/** Playable modes first (zeros filled), then any legacy modes with XP. */
export async function xpByModeBreakdownForUser(
  userId: string,
  date: string
): Promise<{ date: string; modes: XpByModeRow[] }> {
  const earned = await xpByModeForUser(userId, date);
  const byMode = new Map(earned.map((row) => [row.modeId, row]));
  const playable = new Set<string>(PLAYABLE_MODE_IDS);
  const modes: XpByModeRow[] = PLAYABLE_MODE_IDS.map((modeId) => {
    const row = byMode.get(modeId);
    return {
      modeId,
      totalXp: row?.totalXp ?? 0,
      todayXp: row?.todayXp ?? 0,
    };
  });
  for (const row of earned) {
    if (!playable.has(row.modeId)) modes.push(row);
  }
  return { date, modes };
}

function rankRows(
  rows: Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean | number | null;
    xp: number;
  }>
): PlayerStanding[] {
  return rows.map((row, index) => ({
    userId: row.user_id,
    displayName: row.display_name,
    favoriteTeamId: row.favorite_team_id,
    avatarUrl: avatarPublicUrl(row.user_id, Boolean(row.has_avatar)),
    xp: Number(row.xp),
    rank: index + 1,
  }));
}

export async function dailyLeaderboard(date: string, limit = LEADERBOARD_LIMIT): Promise<PlayerStanding[]> {
  const rows = (await db.execute(sql`
    SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
           (u.avatar_jpeg IS NOT NULL) AS has_avatar,
           COALESCE(SUM(x.xp_earned), 0)::int AS xp
    FROM xp_ledger x
    JOIN users u ON u.id = x.user_id
    WHERE x.date = ${date}
    GROUP BY u.id, u.display_name, u.favorite_team_id, u.avatar_jpeg
    ORDER BY xp DESC, u.display_name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean;
    xp: number;
  }>;
  return rankRows(rows);
}

export async function weeklyLeaderboard(weekStart: string, limit = LEADERBOARD_LIMIT): Promise<PlayerStanding[]> {
  const weekEnd = weekEndFor(weekStart);
  const rows = (await db.execute(sql`
    SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
           (u.avatar_jpeg IS NOT NULL) AS has_avatar,
           COALESCE(SUM(x.xp_earned), 0)::int AS xp
    FROM xp_ledger x
    JOIN users u ON u.id = x.user_id
    WHERE x.date BETWEEN ${weekStart} AND ${weekEnd}
    GROUP BY u.id, u.display_name, u.favorite_team_id, u.avatar_jpeg
    ORDER BY xp DESC, u.display_name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean;
    xp: number;
  }>;
  return rankRows(rows);
}

export async function overallLeaderboard(limit = OVERALL_LEADERBOARD_LIMIT): Promise<PlayerStanding[]> {
  const rows = (await db.execute(sql`
    SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
           (u.avatar_jpeg IS NOT NULL) AS has_avatar,
           COALESCE(p.xp, 0)::int AS xp
    FROM user_progress p
    JOIN users u ON u.id = p.user_id
    ORDER BY xp DESC, u.display_name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean;
    xp: number;
  }>;
  return rankRows(rows);
}

/**
 * Team league: every club with ≥1 fan, ranked by combined all-time XP of supporters.
 */
export async function teamLeaderboard(_weekStart?: string, limit = LEADERBOARD_LIMIT): Promise<TeamStanding[]> {
  const rows = (await db.execute(sql`
    SELECT u.favorite_team_id AS team_id,
           t.name,
           t.logo_url,
           COUNT(u.id)::int AS members,
           COALESCE(SUM(p.xp), 0)::int AS total_xp
    FROM users u
    JOIN teams t ON t.id = u.favorite_team_id
    LEFT JOIN user_progress p ON p.user_id = u.id
    WHERE u.favorite_team_id IS NOT NULL
    GROUP BY u.favorite_team_id, t.name, t.logo_url
    HAVING COUNT(u.id) >= 1
    ORDER BY total_xp DESC, members DESC, t.name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    team_id: number;
    name: string;
    logo_url: string | null;
    members: number;
    total_xp: number;
  }>;

  return rows.map((row, index) => {
    const totalXp = Number(row.total_xp);
    return {
      teamId: row.team_id,
      name: row.name,
      logoUrl: row.logo_url,
      members: Number(row.members),
      totalXp,
      score: totalXp,
      rank: index + 1,
    };
  });
}

/** Fans of a club, ranked by all-time XP. */
export async function teamFans(teamId: number, limit = LEADERBOARD_LIMIT): Promise<PlayerStanding[]> {
  const rows = (await db.execute(sql`
    SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
           (u.avatar_jpeg IS NOT NULL) AS has_avatar,
           COALESCE(p.xp, 0)::int AS xp
    FROM users u
    LEFT JOIN user_progress p ON p.user_id = u.id
    WHERE u.favorite_team_id = ${teamId}
    ORDER BY xp DESC, u.display_name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean;
    xp: number;
  }>;
  return rankRows(rows);
}

/** Assign a user to an open table in their division (creating one if needed). Idempotent; never reshuffles. */
export async function ensureWeeklyMembership(userId: string, weekStart: string): Promise<string> {
  const existing = await db
    .select({ cohortId: leagueMemberships.cohortId })
    .from(leagueMemberships)
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)))
    .limit(1);

  if (existing[0]) return existing[0].cohortId;

  const weekId = await ensureActiveLeagueWeek(weekStart);
  const division = await userDivision(userId);

  const openCohort = (await db.execute(sql`
    SELECT c.id, COUNT(m.id)::int AS members
    FROM league_cohorts c
    LEFT JOIN league_memberships m ON m.cohort_id = c.id
    WHERE c.league_week_id = ${weekId}::uuid
      AND c.division = ${division}
    GROUP BY c.id
    HAVING COUNT(m.id) < ${COHORT_SIZE}
    ORDER BY members DESC, c.group_index ASC
    LIMIT 1
  `)) as unknown as Array<{ id: string; members: number }>;

  let cohortId = openCohort[0]?.id;
  if (!cohortId) {
    const nextIndexRows = (await db.execute(sql`
      SELECT COALESCE(MAX(group_index), -1)::int + 1 AS next_index
      FROM league_cohorts
      WHERE league_week_id = ${weekId}::uuid AND division = ${division}
    `)) as unknown as Array<{ next_index: number }>;
    const groupIndex = Number(nextIndexRows[0]?.next_index) || 0;
    const created = await db
      .insert(leagueCohorts)
      .values({
        tier: 'bronze',
        weekStart,
        division,
        groupIndex,
        leagueWeekId: weekId,
      })
      .returning({ id: leagueCohorts.id });
    cohortId = created[0]!.id;
  }

  await db
    .insert(leagueMemberships)
    .values({
      userId,
      cohortId,
      weekStart,
      weeklyXp: 0,
      joinedAt: new Date(),
    })
    .onConflictDoNothing({ target: [leagueMemberships.userId, leagueMemberships.weekStart] });

  return cohortId;
}

/** Weekly pyramid payload for the Leagues tab. Does not auto-join until XP is earned. */
export async function weeklyLeagueForUser(userId: string): Promise<WeeklyLeagueMeResponse> {
  const weekStart = londonWeekStart();
  const weekEnd = weekEndFor(weekStart);
  await ensureActiveLeagueWeek(weekStart);

  const division = await userDivision(userId);
  const membership = await db
    .select({
      cohortId: leagueMemberships.cohortId,
      weeklyXp: leagueMemberships.weeklyXp,
    })
    .from(leagueMemberships)
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)))
    .limit(1);

  const participated = Boolean(membership[0]);
  const cohortId = membership[0]?.cohortId ?? null;

  let standings: WeeklyLeagueStanding[] = [];
  if (cohortId) {
    const rows = (await db.execute(sql`
      SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
             (u.avatar_jpeg IS NOT NULL) AS has_avatar,
             m.weekly_xp::int AS xp
      FROM league_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.cohort_id = ${cohortId}::uuid
      ORDER BY m.weekly_xp DESC NULLS LAST,
               m.weekly_xp_reached_at ASC NULLS LAST,
               u.id ASC
    `)) as unknown as Array<{
      user_id: string;
      display_name: string;
      favorite_team_id: number | null;
      has_avatar: boolean;
      xp: number;
    }>;

    standings = rows.map((row, index) => ({
      userId: row.user_id,
      displayName: row.display_name,
      favoriteTeamId: row.favorite_team_id,
      avatarUrl: avatarPublicUrl(row.user_id, Boolean(row.has_avatar)),
      xp: Number(row.xp),
      rank: index + 1,
      isYou: row.user_id === userId,
    }));
  }

  const zones = zonesForTable(division, standings.length);
  const viewer = standings.find((s) => s.isYou) ?? null;
  const statusLine = viewer
    ? formatStatusLine({
        division,
        rank: viewer.rank,
        xp: viewer.xp,
        standings: standings.map((s) => ({ rank: s.rank, xp: s.xp, userId: s.userId })),
        viewerUserId: userId,
      })
    : null;

  return {
    weekStart,
    weekEnd,
    endsLabel: 'Weekly league · Ends Sunday',
    division,
    divisionLabel: DIVISION_LABELS[division],
    participated,
    cohortId,
    standings,
    zones,
    statusLine,
    viewerRank: viewer?.rank ?? null,
  };
}

/** @deprecated Prefer weeklyLeagueForUser — kept for older callers that auto-joined. */
export async function myCohortStandings(
  userId: string,
  weekStart: string
): Promise<{ cohortId: string | null; standings: PlayerStanding[] }> {
  const existing = await db
    .select({ cohortId: leagueMemberships.cohortId })
    .from(leagueMemberships)
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)))
    .limit(1);
  if (!existing[0]) return { cohortId: null, standings: [] };

  const me = await weeklyLeagueForUser(userId);
  return {
    cohortId: me.cohortId,
    standings: me.standings.map(({ isYou: _i, ...rest }) => rest),
  };
}

export async function getAppMeta(key: string): Promise<string | null> {
  const rows = await db.select().from(appMeta).where(eq(appMeta.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setAppMeta(key: string, value: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value, updatedAt: new Date() },
    });
}
