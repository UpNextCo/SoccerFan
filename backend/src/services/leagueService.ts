import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { leagueCohorts, leagueMemberships, xpLedger } from '../db/schema.js';
import { avatarPublicUrl } from '../utils/avatarUrl.js';

const COHORT_SIZE = 30;
/** Min fans a club needs before it appears on the team league. */
const TEAM_MIN_MEMBERS = 3;
/** Bayesian pseudo-count: how strongly small clubs are pulled toward the global average. */
const TEAM_SHRINKAGE = 8;

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
  score: number;
  rank: number;
}

/** Monday (UTC) of the week containing the given YYYY-MM-DD date. */
export function weekStartFor(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const shift = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

function weekEndFor(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Append earned XP to the ledger. Idempotent per (user, date, mode). */
export async function recordXp(
  userId: string,
  modeId: string,
  xpEarned: number,
  date: string
): Promise<void> {
  if (xpEarned <= 0) return;
  await db
    .insert(xpLedger)
    .values({ userId, modeId, xpEarned, date })
    .onConflictDoNothing({
      target: [xpLedger.userId, xpLedger.date, xpLedger.modeId],
    });
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

export async function dailyLeaderboard(date: string, limit = 50): Promise<PlayerStanding[]> {
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

export async function weeklyLeaderboard(weekStart: string, limit = 50): Promise<PlayerStanding[]> {
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

export async function overallLeaderboard(limit = 50): Promise<PlayerStanding[]> {
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
 * Team league ranked by Bayesian-shrunk XP-per-fan, so big fanbases don't win on
 * volume and tiny ones don't spike from a single superfan.
 */
export async function teamLeaderboard(weekStart: string, limit = 50): Promise<TeamStanding[]> {
  const weekEnd = weekEndFor(weekStart);
  const rows = (await db.execute(sql`
    WITH team_week AS (
      SELECT u.favorite_team_id AS team_id,
             COUNT(DISTINCT x.user_id)::int AS members,
             SUM(x.xp_earned)::int AS total_xp
      FROM users u
      JOIN xp_ledger x ON x.user_id = u.id AND x.date BETWEEN ${weekStart} AND ${weekEnd}
      WHERE u.favorite_team_id IS NOT NULL
      GROUP BY u.favorite_team_id
    ),
    global AS (
      SELECT COALESCE(AVG(total_xp::numeric / NULLIF(members, 0)), 0) AS global_avg FROM team_week
    )
    SELECT tw.team_id, t.name, t.logo_url, tw.members, tw.total_xp,
           ROUND((tw.total_xp + ${TEAM_SHRINKAGE} * g.global_avg) / (tw.members + ${TEAM_SHRINKAGE}), 1)::float AS score
    FROM team_week tw
    CROSS JOIN global g
    JOIN teams t ON t.id = tw.team_id
    WHERE tw.members >= ${TEAM_MIN_MEMBERS}
    ORDER BY score DESC, tw.members DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    team_id: number;
    name: string;
    logo_url: string | null;
    members: number;
    total_xp: number;
    score: number;
  }>;

  return rows.map((row, index) => ({
    teamId: row.team_id,
    name: row.name,
    logoUrl: row.logo_url,
    members: Number(row.members),
    totalXp: Number(row.total_xp),
    score: Number(row.score),
    rank: index + 1,
  }));
}

/** Assign a user to a weekly cohort with room (creating one if needed). Idempotent. */
export async function ensureWeeklyMembership(userId: string, weekStart: string): Promise<string> {
  const existing = await db
    .select({ cohortId: leagueMemberships.cohortId })
    .from(leagueMemberships)
    .where(and(eq(leagueMemberships.userId, userId), eq(leagueMemberships.weekStart, weekStart)))
    .limit(1);

  if (existing[0]) return existing[0].cohortId;

  const openCohort = (await db.execute(sql`
    SELECT c.id, COUNT(m.id)::int AS members
    FROM league_cohorts c
    LEFT JOIN league_memberships m ON m.cohort_id = c.id
    WHERE c.week_start = ${weekStart}
    GROUP BY c.id
    HAVING COUNT(m.id) < ${COHORT_SIZE}
    ORDER BY members DESC
    LIMIT 1
  `)) as unknown as Array<{ id: string; members: number }>;

  let cohortId = openCohort[0]?.id;
  if (!cohortId) {
    const created = await db
      .insert(leagueCohorts)
      .values({ tier: 'bronze', weekStart })
      .returning({ id: leagueCohorts.id });
    cohortId = created[0]!.id;
  }

  await db
    .insert(leagueMemberships)
    .values({ userId, cohortId, weekStart })
    .onConflictDoNothing({ target: [leagueMemberships.userId, leagueMemberships.weekStart] });

  return cohortId;
}

/** The standings of the cohort the user belongs to this week (their personal league). */
export async function myCohortStandings(
  userId: string,
  weekStart: string
): Promise<{ cohortId: string | null; standings: PlayerStanding[] }> {
  const cohortId = await ensureWeeklyMembership(userId, weekStart);
  const weekEnd = weekEndFor(weekStart);

  const rows = (await db.execute(sql`
    SELECT u.id AS user_id, u.display_name, u.favorite_team_id,
           (u.avatar_jpeg IS NOT NULL) AS has_avatar,
           COALESCE(SUM(x.xp_earned) FILTER (WHERE x.date BETWEEN ${weekStart} AND ${weekEnd}), 0)::int AS xp
    FROM league_memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN xp_ledger x ON x.user_id = u.id
    WHERE m.cohort_id = ${cohortId}
    GROUP BY u.id, u.display_name, u.favorite_team_id, u.avatar_jpeg
    ORDER BY xp DESC, u.display_name ASC
  `)) as unknown as Array<{
    user_id: string;
    display_name: string;
    favorite_team_id: number | null;
    has_avatar: boolean;
    xp: number;
  }>;

  return { cohortId, standings: rankRows(rows) };
}
