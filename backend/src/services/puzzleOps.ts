import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { validatePuzzlePayload } from './adminPuzzleValidation.js';
import { enrichAdminPuzzleForSave } from './adminPuzzleEnrich.js';
import { generateFootballBingoPuzzle, isBingoSolvable } from './footballBingoGenerator.js';
import { generateFootballGolfCourse } from './footballGolfGenerator.js';
import { generateOneMorePuzzle } from './oneMoreGenerator.js';
import { generateClubChainPuzzle } from './clubChainGenerator.js';
import { generateLastManStandingPuzzle } from './lastManStandingGenerator.js';
import { generateBattlePuzzle } from './battleGenerator.js';
import { generateDailyPuzzleForMode } from './dailyPuzzleGenerator.js';
import { validateAdminPuzzleDraft } from './adminDraftValidation.js';
import { monthLockStatusError, workflowTransitionError } from './adminWorkflow.js';

export type PuzzleOpsStatus = 'generated' | 'approved' | 'locked';
type DraftValidationIssues = Awaited<ReturnType<typeof validateAdminPuzzleDraft>>['issues'];
export interface MonthStatusIssue {
  date: string;
  modeId: string;
  kind: 'missing' | 'status' | 'validation' | 'conflict';
  message: string;
  validationIssues?: DraftValidationIssues;
}

/** Keep in sync with DAILY_PLAYABLE_MODES in dailyService.ts */
export const OPS_PLAYABLE_MODES = [
  'football_bingo',
  'one_more',
  'draft_master',
  'football_golf',
  'club_chain',
  'target_man',
  'last_man_standing',
] as const;

export const OPS_MODE_TITLES: Record<string, string> = {
  football_bingo: 'FOOTBALL BINGO',
  one_more: 'ONE MORE',
  draft_master: 'DRAFT XI',
  football_golf: 'FOOTBALL GOLF',
  club_chain: 'CLUB CHAIN',
  target_man: 'TARGET MAN',
  last_man_standing: 'LAST MAN STANDING',
};

export function contentHash(puzzleJson: unknown, answerJson: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ puzzleJson, answerJson }))
    .digest('hex')
    .slice(0, 32);
}

export function daysInMonth(yearMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) throw new Error('yearMonth must be YYYY-MM');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return `${yearMonth}-${d}`;
  });
}

export async function getPuzzleStatus(
  date: string,
  modeId: string
): Promise<{ status: PuzzleOpsStatus } | null> {
  const rows = await db
    .select({ status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);
  if (!rows[0]) return null;
  return { status: (rows[0].status as PuzzleOpsStatus) || 'generated' };
}

/** True when the row must not be deleted/overwritten by ensure/regen. */
export async function isPuzzleProtected(
  date: string,
  modeId: string,
  opts?: { protectApproved?: boolean }
): Promise<boolean> {
  const row = await getPuzzleStatus(date, modeId);
  if (!row) return false;
  if (row.status === 'locked') return true;
  if (opts?.protectApproved && row.status === 'approved') return true;
  return false;
}

export async function getMonthMatrix(yearMonth: string) {
  const dates = daysInMonth(yearMonth);
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const rows = await db
    .select({
      date: dailyPuzzles.date,
      modeId: dailyPuzzles.modeId,
      status: dailyPuzzles.status,
      puzzleJson: dailyPuzzles.puzzleJson,
      contentHash: dailyPuzzles.contentHash,
      reviewedAt: dailyPuzzles.reviewedAt,
    })
    .from(dailyPuzzles)
    .where(and(gte(dailyPuzzles.date, start), lte(dailyPuzzles.date, end)));

  const byKey = new Map(rows.map((r) => [`${r.date}|${r.modeId}`, r]));
  const modes = [...OPS_PLAYABLE_MODES];
  const cells = modes.flatMap((modeId) =>
    dates.map((date) => {
      const hit = byKey.get(`${date}|${modeId}`);
      const puzzle = hit?.puzzleJson as { title?: string; version?: number; questions?: unknown[] } | undefined;
      let snippet: string | null = puzzle?.title ?? null;
      if (!snippet && modeId === 'last_man_standing' && Array.isArray(puzzle?.questions)) {
        const q0 = puzzle.questions[0] as { prompt?: string } | undefined;
        snippet = q0?.prompt?.slice(0, 48) ?? null;
      }
      return {
        date,
        modeId,
        title: OPS_MODE_TITLES[modeId] ?? modeId,
        status: hit ? ((hit.status as PuzzleOpsStatus) || 'generated') : ('missing' as const),
        snippet,
        version: puzzle?.version ?? null,
        contentHash: hit?.contentHash ?? null,
        reviewedAt: hit?.reviewedAt?.toISOString?.() ?? (hit?.reviewedAt as string | null) ?? null,
      };
    })
  );

  const locked = cells.filter((c) => c.status === 'locked').length;
  const present = cells.filter((c) => c.status !== 'missing').length;
  return {
    yearMonth,
    dates,
    modes,
    cells,
    summary: {
      total: cells.length,
      present,
      missing: cells.length - present,
      locked,
      approved: cells.filter((c) => c.status === 'approved').length,
      generated: cells.filter((c) => c.status === 'generated').length,
    },
  };
}

async function insertGenerated(
  date: string,
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown
): Promise<void> {
  const hash = contentHash(puzzleJson, answerJson);
  await db
    .insert(dailyPuzzles)
    .values({
      date,
      modeId,
      puzzleJson,
      answerPlayerId: null,
      answerJson,
      status: 'generated',
      contentHash: hash,
    })
    .onConflictDoNothing();
}

/** Generate one mode/date if missing. Skips locked/approved unless force. */
export async function generateOnePuzzle(
  date: string,
  modeId: string,
  opts?: { force?: boolean }
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const existing = await db
    .select({
      status: dailyPuzzles.status,
      id: dailyPuzzles.id,
    })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);

  if (existing[0]) {
    const st = (existing[0].status as PuzzleOpsStatus) || 'generated';
    if (st === 'locked') return { ok: false, skipped: 'locked' };
    if (st === 'approved' && !opts?.force) return { ok: false, skipped: 'approved' };
    if (!opts?.force) return { ok: false, skipped: 'exists' };
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)));
  }

  try {
    switch (modeId) {
      case 'football_bingo': {
        const puzzle = await generateFootballBingoPuzzle(date);
        const check = isBingoSolvable(puzzle);
        if (!check.ok) return { ok: false, error: 'bingo not solvable' };
        await insertGenerated(date, modeId, puzzle, null);
        break;
      }
      case 'football_golf': {
        const puzzle = await generateFootballGolfCourse(date);
        if (puzzle.holes.length < 9) return { ok: false, error: 'golf holes < 9' };
        await insertGenerated(date, modeId, puzzle, null);
        break;
      }
      case 'one_more': {
        const { puzzle, pool } = await generateOneMorePuzzle(date);
        if (pool < 10) return { ok: false, error: `one_more pool ${pool}` };
        await insertGenerated(date, modeId, puzzle, {
          valuesByRound: puzzle.rounds.map((r) =>
            Object.fromEntries(r.options.map((o) => [o.id, o.value]))
          ),
        });
        break;
      }
      case 'draft_master': {
        const puzzle = await generateBattlePuzzle(date);
        if (!puzzle || puzzle.constraints.length < 10) return { ok: false, error: 'draft not viable' };
        await insertGenerated(date, modeId, puzzle, null);
        break;
      }
      case 'club_chain': {
        const generated = await generateClubChainPuzzle(date);
        if (!generated) return { ok: false, error: 'club_chain not viable' };
        await insertGenerated(date, modeId, generated.puzzle, generated.answer);
        break;
      }
      case 'target_man': {
        // generateDailyPuzzleForMode returns existing if present; we already deleted when force.
        const existingTm = await db
          .select({ id: dailyPuzzles.id })
          .from(dailyPuzzles)
          .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
          .limit(1);
        if (existingTm[0] && !opts?.force) {
          return { ok: false, skipped: 'exists' };
        }
        const puzzle = await generateDailyPuzzleForMode(date, 'target_man');
        if (!puzzle) return { ok: false, error: 'target_man failed' };
        await db
          .update(dailyPuzzles)
          .set({
            status: 'generated',
            contentHash: contentHash(puzzle.puzzleJson, puzzle.answerJson ?? null),
            reviewedAt: null,
            reviewNote: null,
          })
          .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)));
        break;
      }
      case 'last_man_standing': {
        const { puzzle, answer } = await generateLastManStandingPuzzle(date);
        if (puzzle.questions.length < 10) return { ok: false, error: 'lms questions < 10' };
        await insertGenerated(date, modeId, puzzle, answer);
        break;
      }
      default:
        return { ok: false, error: `unknown mode ${modeId}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateMonthMissing(
  yearMonth: string,
  opts?: { modes?: string[]; force?: boolean }
): Promise<{ results: Array<{ date: string; modeId: string; ok: boolean; skipped?: string; error?: string }> }> {
  const dates = daysInMonth(yearMonth);
  const modes = opts?.modes?.length ? opts.modes : [...OPS_PLAYABLE_MODES];
  const results: Array<{ date: string; modeId: string; ok: boolean; skipped?: string; error?: string }> = [];

  for (const date of dates) {
    for (const modeId of modes) {
      const r = await generateOnePuzzle(date, modeId, { force: opts?.force });
      results.push({ date, modeId, ...r });
    }
  }
  return { results };
}

export async function setMonthStatus(
  yearMonth: string,
  status: PuzzleOpsStatus,
  note?: string
): Promise<{
  updated: number;
  error?: string;
  invalid?: Array<{ date: string; modeId: string; issues: DraftValidationIssues }>;
  issues?: MonthStatusIssue[];
}> {
  const dates = daysInMonth(yearMonth);
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const modes = [...OPS_PLAYABLE_MODES];

  const candidates = await db
      .select({
        id: dailyPuzzles.id,
        date: dailyPuzzles.date,
        modeId: dailyPuzzles.modeId,
        status: dailyPuzzles.status,
        puzzleJson: dailyPuzzles.puzzleJson,
        answerJson: dailyPuzzles.answerJson,
        contentHash: dailyPuzzles.contentHash,
      })
      .from(dailyPuzzles)
      .where(and(
        gte(dailyPuzzles.date, start),
        lte(dailyPuzzles.date, end),
        inArray(dailyPuzzles.modeId, modes)
      ));

  if (status === 'locked' || status === 'approved') {
    const issues: MonthStatusIssue[] = [];
    const byKey = new Map(candidates.map((row) => [`${row.date}|${row.modeId}`, row]));
    if (status === 'locked') {
      for (const date of dates) {
        for (const modeId of modes) {
          const row = byKey.get(`${date}|${modeId}`);
          if (!row) {
            issues.push({ date, modeId, kind: 'missing', message: 'Expected puzzle row is missing.' });
            continue;
          }
          const statusError = monthLockStatusError(row.status as PuzzleOpsStatus);
          if (statusError) issues.push({ date, modeId, kind: 'status', message: statusError });
        }
      }
    }
    const reports = await Promise.all(candidates.map(async (row) => ({
      date: row.date,
      modeId: row.modeId,
      report: await validateAdminPuzzleDraft(row.modeId, row.puzzleJson, row.answerJson),
    })));
    const invalid = reports
      .filter((entry) => !entry.report.ok)
      .map((entry) => ({ date: entry.date, modeId: entry.modeId, issues: entry.report.issues }));
    issues.push(...invalid.map((entry) => ({
      date: entry.date,
      modeId: entry.modeId,
      kind: 'validation' as const,
      message: 'Puzzle failed semantic validation.',
      validationIssues: entry.issues,
    })));
    if (issues.length > 0) {
      const missing = issues.filter((entry) => entry.kind === 'missing').length;
      const unapproved = issues.filter((entry) => entry.kind === 'status').length;
      const invalidCount = issues.filter((entry) => entry.kind === 'validation').length;
      return {
        updated: 0,
        error: `Month lock blocked: ${missing} missing, ${unapproved} unapproved, ${invalidCount} invalid puzzle(s).`,
        invalid,
        issues,
      };
    }
  }

  try {
    const updated = await db.transaction(async (tx) => {
      let count = 0;
      for (const row of candidates) {
        const currentStatus = row.status as PuzzleOpsStatus;
        const transitionError = workflowTransitionError(currentStatus, status);
        if (transitionError) {
          if (status === 'approved' && currentStatus === 'locked') continue;
          throw new Error(`${row.date}/${row.modeId}: ${transitionError}`);
        }
        const sameHash = row.contentHash == null
          ? isNull(dailyPuzzles.contentHash)
          : eq(dailyPuzzles.contentHash, row.contentHash);
        const changed = await tx
          .update(dailyPuzzles)
          .set({
            status,
            reviewedAt: new Date(),
            ...(note != null ? { reviewNote: note } : {}),
          })
          .where(and(
            eq(dailyPuzzles.id, row.id),
            eq(dailyPuzzles.status, currentStatus),
            sameHash
          ))
          .returning({ id: dailyPuzzles.id });
        if (changed.length !== 1) {
          throw new Error(`${row.date}/${row.modeId}: puzzle changed during validation`);
        }
        count += 1;
      }
      return count;
    });
    return { updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      updated: 0,
      error: `Month status update aborted: ${message}`,
      issues: [{
        date: yearMonth,
        modeId: '*',
        kind: 'conflict',
        message,
      }],
    };
  }
}

export async function getPuzzleForAdmin(date: string, modeId: string) {
  const rows = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function savePuzzleForAdmin(args: {
  date: string;
  modeId: string;
  puzzleJson: unknown;
  answerJson: unknown;
  reviewNote?: string;
  keepApproved?: boolean;
}): Promise<{ ok: boolean; error?: string; puzzleJson?: unknown; answerJson?: unknown }> {
  const existing = await getPuzzleForAdmin(args.date, args.modeId);
  if (!existing) return { ok: false, error: 'not found' };
  if (existing.status === 'locked') return { ok: false, error: 'locked' };

  const enriched = await enrichAdminPuzzleForSave(args.modeId, args.puzzleJson, args.answerJson);
  const validation = validatePuzzlePayload(
    args.modeId,
    enriched.puzzleJson,
    enriched.answerJson ?? null
  );
  if (!validation.ok) {
    return { ok: false, error: validation.error || 'validation failed after enrich' };
  }

  const hash = contentHash(enriched.puzzleJson, enriched.answerJson);
  // Editing always invalidates prior review. Approval must be earned again against the saved hash.
  const nextStatus: PuzzleOpsStatus = 'generated';

  const sameHash = existing.contentHash == null
    ? isNull(dailyPuzzles.contentHash)
    : eq(dailyPuzzles.contentHash, existing.contentHash);
  const changed = await db
    .update(dailyPuzzles)
    .set({
      puzzleJson: enriched.puzzleJson,
      answerJson: enriched.answerJson,
      contentHash: hash,
      status: nextStatus,
      reviewNote: args.reviewNote ?? existing.reviewNote,
      reviewedAt: null,
    })
    .where(and(
      eq(dailyPuzzles.id, existing.id),
      eq(dailyPuzzles.status, existing.status),
      sameHash
    ))
    .returning({ id: dailyPuzzles.id });
  if (changed.length !== 1) return { ok: false, error: 'conflict: puzzle changed while saving' };

  return { ok: true, puzzleJson: enriched.puzzleJson, answerJson: enriched.answerJson };
}

export async function setPuzzleStatus(
  date: string,
  modeId: string,
  status: PuzzleOpsStatus,
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  const existing = await getPuzzleForAdmin(date, modeId);
  if (!existing) return { ok: false, error: 'not found' };
  const currentStatus = existing.status as PuzzleOpsStatus;
  const transitionError = workflowTransitionError(currentStatus, status);
  if (transitionError) return { ok: false, error: transitionError };
  if (status === 'approved' || status === 'locked') {
    const validation = await validateAdminPuzzleDraft(
      existing.modeId,
      existing.puzzleJson,
      existing.answerJson
    );
    if (!validation.ok) {
      const errors = validation.issues
        .filter((entry) => entry.severity === 'error')
        .map((entry) => `${entry.path}: ${entry.message}`)
        .join('; ');
      return { ok: false, error: errors || 'validation failed' };
    }
  }
  const sameHash = existing.contentHash == null
    ? isNull(dailyPuzzles.contentHash)
    : eq(dailyPuzzles.contentHash, existing.contentHash);
  const changed = await db
    .update(dailyPuzzles)
    .set({
      status,
      reviewedAt: new Date(),
      reviewNote: note ?? existing.reviewNote,
    })
    .where(and(
      eq(dailyPuzzles.id, existing.id),
      eq(dailyPuzzles.status, currentStatus),
      sameHash
    ))
    .returning({ id: dailyPuzzles.id });
  if (changed.length !== 1) return { ok: false, error: 'conflict: puzzle changed during validation' };
  return { ok: true };
}
