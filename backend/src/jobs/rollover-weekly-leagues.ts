/**
 * Finalize the previous London league week and open the next one.
 *
 * Idempotent: if the previous week is already finalized, exits cleanly.
 *
 *   DATABASE_URL=... npm run job:rollover-weekly-leagues
 *   DATABASE_URL=... npm run job:rollover-weekly-leagues -- --dry
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { leagueCohorts, leagueMemberships, leagueWeeks, users } from '../db/schema.js';
import {
  ensureActiveLeagueWeek,
  londonWeekStart,
  resolveMembershipDestination,
  selectChampionsLeagueQualifiers,
  weekEndFor,
  type WeeklyDivision,
} from '../services/leagueService.js';
import { isWeeklyDivision } from '../services/weeklyLeagueDivisions.js';

const DRY = process.argv.includes('--dry');

function previousWeekStart(fromWeekStart: string): string {
  const d = new Date(`${fromWeekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const currentStart = londonWeekStart();
  const prevStart = previousWeekStart(currentStart);
  const prevEnd = weekEndFor(prevStart);

  console.log(`Rollover weekly leagues — current=${currentStart} previous=${prevStart}${DRY ? ' (DRY)' : ''}`);

  // Ensure the new week exists (active).
  await ensureActiveLeagueWeek(currentStart);

  let prevWeek = await db
    .select()
    .from(leagueWeeks)
    .where(eq(leagueWeeks.weekStart, prevStart))
    .limit(1);

  if (!prevWeek[0]) {
    // No activity last week — create a finalized empty week for continuity.
    if (!DRY) {
      await db.insert(leagueWeeks).values({
        weekStart: prevStart,
        weekEnd: prevEnd,
        status: 'finalized',
        finalizedAt: new Date(),
      }).onConflictDoNothing();
    }
    console.log('No previous week activity — nothing to finalize.');
    process.exit(0);
  }

  if (prevWeek[0].status === 'finalized') {
    console.log(`Week ${prevStart} already finalized — no-op.`);
    process.exit(0);
  }

  const cohorts = await db
    .select()
    .from(leagueCohorts)
    .where(eq(leagueCohorts.weekStart, prevStart));

  console.log(`Finalizing ${cohorts.length} table(s) for week ${prevStart}`);

  type MemberRow = {
    id: string;
    user_id: string;
    weekly_xp: number;
    weekly_xp_reached_at: string | null;
  };

  const membersByCohort = new Map<string, MemberRow[]>();
  const topTierPool: Array<{
    weeklyXp: number;
    weeklyXpReachedAt: Date | null;
    userId: string;
  }> = [];

  for (const cohort of cohorts) {
    const members = (await db.execute(sql`
      SELECT m.id, m.user_id, m.weekly_xp, m.weekly_xp_reached_at
      FROM league_memberships m
      WHERE m.cohort_id = ${cohort.id}::uuid
      ORDER BY m.weekly_xp DESC NULLS LAST,
               m.weekly_xp_reached_at ASC NULLS LAST,
               m.user_id ASC
    `)) as unknown as MemberRow[];
    membersByCohort.set(cohort.id, members);
    if (cohort.division === 'premier_league' || cohort.division === 'champions_league') {
      for (const member of members) {
        topTierPool.push({
          weeklyXp: Number(member.weekly_xp) || 0,
          weeklyXpReachedAt: member.weekly_xp_reached_at
            ? new Date(member.weekly_xp_reached_at)
            : null,
          userId: member.user_id,
        });
      }
    }
  }

  const clQualifiers = selectChampionsLeagueQualifiers(topTierPool);
  console.log(
    `Champions League next week: ${clQualifiers.size} qualifier(s) from ${topTierPool.length} CL + Premier League player(s)`
  );

  let updatedMembers = 0;
  for (const cohort of cohorts) {
    const division = isWeeklyDivision(cohort.division) ? cohort.division : 'sunday_league';
    const members = membersByCohort.get(cohort.id) ?? [];
    const n = members.length;
    for (let i = 0; i < n; i += 1) {
      const rank = i + 1;
      const member = members[i]!;
      const { outcome, nextDivision } = resolveMembershipDestination(
        division as WeeklyDivision,
        rank,
        n,
        member.user_id,
        clQualifiers
      );
      console.log(
        `  ${cohort.division} g${cohort.groupIndex} #${rank} ${member.user_id.slice(0, 8)} xp=${member.weekly_xp} → ${outcome} (${nextDivision})`
      );
      if (DRY) continue;

      await db
        .update(leagueMemberships)
        .set({ finalRank: rank, outcome })
        .where(eq(leagueMemberships.id, member.id));

      await db
        .update(users)
        .set({ currentDivision: nextDivision })
        .where(eq(users.id, member.user_id));

      updatedMembers += 1;
    }
  }

  if (!DRY) {
    await db
      .update(leagueWeeks)
      .set({ status: 'finalized', finalizedAt: new Date() })
      .where(and(eq(leagueWeeks.weekStart, prevStart), eq(leagueWeeks.status, 'active')));
  }

  console.log(
    DRY
      ? `Dry run complete — would update ${cohorts.length} tables`
      : `Finalized week ${prevStart}; updated ${updatedMembers} memberships. Next week ${currentStart} is active (tables fill on XP).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
