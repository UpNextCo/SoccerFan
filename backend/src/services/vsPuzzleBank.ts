import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { vsPuzzleBank } from '../db/schema.js';
import {
  VS_MODE_IDS,
  vsPuzzleMeta,
  type VsGeneratedPuzzle,
  type VsModeId,
} from './vsPuzzle.js';

const TARGET_PER_MODE = 80;
const FILL_BATCH = 10;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1_000;

const filling = new Set<VsModeId>();
let ensured = false;

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vs_puzzle_bank (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      mode_id text NOT NULL,
      title text NOT NULL,
      puzzle_json jsonb NOT NULL,
      answer_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vs_puzzle_bank_mode_title_unique
    ON vs_puzzle_bank (mode_id, title)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vs_puzzle_bank_mode_idx
    ON vs_puzzle_bank (mode_id)
  `);
  ensured = true;
}

export async function takeVsBankPuzzle(
  modeId: VsModeId,
  seedKey: string,
  excludeTitle?: string
): Promise<VsGeneratedPuzzle | null> {
  await ensureTable();
  const rows = await db
    .select({
      puzzleJson: vsPuzzleBank.puzzleJson,
      answerJson: vsPuzzleBank.answerJson,
      title: vsPuzzleBank.title,
    })
    .from(vsPuzzleBank)
    .where(
      excludeTitle
        ? and(eq(vsPuzzleBank.modeId, modeId), ne(vsPuzzleBank.title, excludeTitle))
        : eq(vsPuzzleBank.modeId, modeId)
    );

  if (rows.length === 0) return null;
  const chosen = rows[hashSeed(seedKey) % rows.length]!;
  return { puzzle: chosen.puzzleJson, answer: chosen.answerJson };
}

async function fillMode(modeId: VsModeId): Promise<void> {
  await ensureTable();
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  await db.delete(vsPuzzleBank).where(and(eq(vsPuzzleBank.modeId, modeId), lt(vsPuzzleBank.createdAt, cutoff)));

  const existing = await db
    .select({ title: vsPuzzleBank.title })
    .from(vsPuzzleBank)
    .where(eq(vsPuzzleBank.modeId, modeId));
  if (existing.length >= TARGET_PER_MODE) return;

  const titles = new Set(existing.map((row) => row.title));

  if (modeId === 'back_yourself') {
    const { generateAllBackYourselfPuzzles } = await import('./backYourselfGenerator.js');
    const today = new Date().toISOString().slice(0, 10);
    const all = await generateAllBackYourselfPuzzles(today, { minPool: 40 });
    for (const generated of all) {
      const title = vsPuzzleMeta(modeId, generated.puzzle).title;
      if (titles.has(title)) continue;
      await db
        .insert(vsPuzzleBank)
        .values({
          modeId,
          title,
          puzzleJson: generated.puzzle,
          answerJson: generated.answer,
        })
        .onConflictDoNothing({ target: [vsPuzzleBank.modeId, vsPuzzleBank.title] });
      titles.add(title);
    }
    return;
  }

  if (modeId === 'darts_501') {
    const { allDarts501PublicPuzzles } = await import('./darts501Generator.js');
    const today = new Date().toISOString().slice(0, 10);
    for (const generated of allDarts501PublicPuzzles(today)) {
      const title = vsPuzzleMeta(modeId, generated.puzzle).title;
      if (titles.has(title)) continue;
      await db
        .insert(vsPuzzleBank)
        .values({
          modeId,
          title,
          puzzleJson: generated.puzzle,
          answerJson: generated.answer,
        })
        .onConflictDoNothing({ target: [vsPuzzleBank.modeId, vsPuzzleBank.title] });
      titles.add(title);
    }
    return;
  }

  const { generateFreshVsPuzzle } = await import('./vsPuzzle.js');

  for (let i = 0; i < FILL_BATCH && titles.size < TARGET_PER_MODE; i += 1) {
    try {
      const generated = await generateFreshVsPuzzle(modeId, `vs-bank:${modeId}:${Date.now()}:${i}`);
      const title = vsPuzzleMeta(modeId, generated.puzzle).title;
      if (titles.has(title)) continue;
      await db
        .insert(vsPuzzleBank)
        .values({
          modeId,
          title,
          puzzleJson: generated.puzzle,
          answerJson: generated.answer ?? null,
        })
        .onConflictDoNothing({ target: [vsPuzzleBank.modeId, vsPuzzleBank.title] });
      titles.add(title);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      console.warn(`VS puzzle bank fill failed for ${modeId}: ${detail}`);
      break;
    }
  }
}

export function scheduleVsBankFill(modeId: VsModeId): void {
  if (filling.has(modeId)) return;
  filling.add(modeId);
  void fillMode(modeId)
    .catch((reason) => {
      const detail = reason instanceof Error ? reason.message : String(reason);
      console.warn(`VS puzzle bank fill failed for ${modeId}: ${detail}`);
    })
    .finally(() => {
      filling.delete(modeId);
    });
}

async function fillAllModes(): Promise<void> {
  for (const modeId of VS_MODE_IDS) {
    scheduleVsBankFill(modeId);
    // Let each mode start, but don't pile every generator onto the first tick.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Prebuild full VS category sets in the background so create/reshuffle stay instant. */
export function startVsPuzzleBank(): void {
  void ensureTable()
    .then(() => fillAllModes())
    .catch((reason) => {
      const detail = reason instanceof Error ? reason.message : String(reason);
      console.warn(`VS puzzle bank start failed: ${detail}`);
    });
  const timer = setInterval(() => {
    void fillAllModes();
  }, TICK_MS);
  timer.unref();
}
