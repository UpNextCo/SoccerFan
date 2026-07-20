/**
 * Server-authoritative scoring. The client still scores locally for instant / offline feedback, but
 * when it submits its actual ANSWER inputs we recompute the score + won flag here from the stored
 * puzzle (and server-only answer_json) so a modified client can't fabricate leaderboard XP.
 *
 * Recompute is best-effort for legacy clients that omit answers. Football Golf is stricter: once an
 * answer payload is supplied, malformed input is rejected rather than falling back to client XP.
 */
import { maxXpForMode } from './dailyService.js';
import { matches as bingoMatches, type BingoCategory, type BingoPlayer } from './footballBingoGenerator.js';
import { playerValuesForCategory } from './targetManCategories.js';
import { clubChainLink } from './clubChainGenerator.js';
import {
  FOOTBALL_GOLF_HOLE_COUNT,
  FOOTBALL_GOLF_MAX_XP,
} from './footballGolfConstants.js';

export interface ServerScore {
  score: number;
  won: boolean;
}

export class InvalidCompletionAnswerError extends Error {}

export type PuzzleRow = { puzzleJson: unknown; answerJson: unknown };

// ---- XP helpers (mirror ios DailyXP) ---------------------------------------------------------

export function golfHoleXp(relativeToPar: number): number {
  if (relativeToPar <= -2) return 160;
  if (relativeToPar === -1) return 130;
  if (relativeToPar === 0) return 60;
  if (relativeToPar === 1) return 25;
  return 0;
}

function golfRarityPoints(rarity: string | undefined): number {
  switch (rarity) {
    case 'ultraRare':
    case 'ultra_rare':
      return 4;
    case 'rare':
      return 3;
    case 'uncommon':
      return 2;
    default:
      return 1;
  }
}

function targetManXp(pctOff: number): number {
  if (pctOff < 0.0001) return 1100;
  if (pctOff < 0.02) return 1000;
  if (pctOff < 0.05) return 875;
  if (pctOff < 0.10) return 700;
  if (pctOff < 0.15) return 500;
  if (pctOff < 0.25) return 275;
  return 0;
}

/** Clear the grid → 400–1000 by efficiency. Near-miss: 1/2/3 tiles left → 250/150/75. Else 0. */
function bingoXp(filled: number, tiles: number, remaining: number, queueSize: number): number {
  const filledClamped = Math.max(0, Math.min(filled, tiles));
  if (filledClamped >= tiles) {
    if (queueSize <= tiles) return 1000;
    const maxRemaining = queueSize - tiles;
    const efficiency = Math.min(1, Math.max(0, remaining / maxRemaining));
    return 400 + Math.round(600 * efficiency);
  }
  switch (tiles - filledClamped) {
    case 1:
      return 250;
    case 2:
      return 150;
    case 3:
      return 75;
    default:
      return 0;
  }
}

/** Mirrors ios DailyXP.clubChainMistakeCost — deducted from medal XP per wrong guess. */
export const CLUB_CHAIN_MISTAKE_COST = 150;

export function clubChainXp(
  reached: boolean,
  moves: number,
  par: number,
  mistakes = 0
): number {
  if (!reached) return 0;
  let base = 500;
  if (moves <= par) base = 1000;
  else if (moves <= par + 2) base = 750;
  return Math.max(0, base - Math.max(0, mistakes) * CLUB_CHAIN_MISTAKE_COST);
}

// ---- Blind Rank -----------------------------------------------------------------------------
// answer: { order: string[] } — the 10 player ids as the user arranged them (top → bottom).
function scoreBlindRank(row: PuzzleRow, answer: unknown): ServerScore | null {
  const order = (answer as { order?: unknown })?.order;
  if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) return null;

  let correct = (row.answerJson as { answer?: { correctRanking?: unknown } })?.answer?.correctRanking;
  if (!Array.isArray(correct)) {
    const po = (row.puzzleJson as { presentationOrder?: Array<{ id?: string; statValue?: number }> })?.presentationOrder;
    if (!Array.isArray(po)) return null;
    correct = [...po].sort((a, b) => (b.statValue ?? 0) - (a.statValue ?? 0)).map((p) => p.id);
  }
  const idx = new Map((correct as string[]).map((id, i) => [id, i]));

  const slotXp = (d: number): number => (d === 0 ? 100 : d === 1 ? 60 : d === 2 ? 30 : 0);
  let score = 0;
  (order as string[]).forEach((id, i) => {
    const c = idx.get(id);
    if (c === undefined) return;
    score += slotXp(Math.abs(i - c));
  });
  return { score, won: score >= 600 };
}

// ---- World Cup XI ---------------------------------------------------------------------------
function normName(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
function wcNamesMatch(guess: string, expected: string): boolean {
  const g = normName(guess);
  const e = normName(expected);
  if (g === e) return true;
  const gw = g.split(' ').filter(Boolean);
  const ew = e.split(' ').filter(Boolean);
  if (gw.length >= 2 && e.includes(g)) return true;
  if (ew.length >= 2 && g.includes(e)) return true;
  const gLast = gw[gw.length - 1] ?? '';
  const eLast = ew[ew.length - 1] ?? '';
  if (gLast && gLast === eLast) {
    const gFirst = gw[0] ?? '';
    const eFirst = ew[0] ?? '';
    if (gFirst[0] === eFirst[0] && (gFirst.length === 1 || eFirst.length === 1)) return true;
  }
  return false;
}
function scoreWorldCupXi(row: PuzzleRow, answer: unknown): ServerScore | null {
  const picks = (answer as { picks?: unknown })?.picks;
  const slots = (row.puzzleJson as { slots?: Array<{ id: string; expectedName: string }> })?.slots;
  if (!Array.isArray(picks) || !Array.isArray(slots)) return null;
  const expectedBySlot = new Map(slots.map((s) => [s.id, s.expectedName]));

  let correct = 0;
  for (const p of picks as Array<{ slotId?: string; name?: string }>) {
    const expected = p.slotId ? expectedBySlot.get(p.slotId) : undefined;
    if (expected && typeof p.name === 'string' && wcNamesMatch(p.name, expected)) correct += 1;
  }
  return { score: correct * 100, won: correct >= 6 };
}

// ---- One More -------------------------------------------------------------------------------
// answer: { picks: string[]; cashedOut: boolean }
// Values may live in puzzleJson (legacy) or answerJson.valuesByRound (stripped bundles).
function scoreOneMore(row: PuzzleRow, answer: unknown): ServerScore | null {
  const picks = (answer as { picks?: unknown })?.picks;
  const cashedOut = (answer as { cashedOut?: unknown })?.cashedOut === true;
  const puzzle = row.puzzleJson as {
    minimum?: number;
    rounds?: Array<{ options?: Array<{ id: string; value?: number }> }>;
  };
  if (!Array.isArray(picks) || !Array.isArray(puzzle?.rounds) || typeof puzzle.minimum !== 'number') return null;

  const answerValues = (row.answerJson as { valuesByRound?: Array<Record<string, number>> } | null)?.valuesByRound;
  const minimum = puzzle.minimum;
  const rounds = puzzle.rounds.length;
  let streak = 0;
  let busted = false;
  for (let i = 0; i < picks.length; i += 1) {
    const pickId = picks[i] as string;
    const opt = puzzle.rounds[i]?.options?.find((o) => o.id === pickId);
    if (!opt) { busted = true; break; }
    const value =
      typeof opt.value === 'number'
        ? opt.value
        : answerValues?.[i]?.[pickId];
    if (typeof value !== 'number' || value < minimum) { busted = true; break; }
    streak += 1;
  }
  if (busted) return { score: 0, won: false };
  const perPick = rounds > 0 ? Math.round(900 / rounds) : 0;
  const score = Math.min(900, streak * perPick);
  return { score, won: cashedOut || streak >= rounds };
}

// ---- Last Man Standing -----------------------------------------------------------------------
function scoreLastManStanding(row: PuzzleRow, answer: unknown): ServerScore | null {
  const picks = (answer as { picks?: unknown })?.picks;
  if (!Array.isArray(picks) || picks.some((x) => typeof x !== 'string')) return null;

  const stored = row.answerJson as {
    questions?: Array<{ questionId: string; correctOptionId: string }>;
    correctOptionIds?: string[];
  };

  let expected: string[] = [];
  if (Array.isArray(stored?.questions) && stored.questions.length > 0) {
    expected = stored.questions.map((q) => q.correctOptionId);
  } else if (Array.isArray(stored?.correctOptionIds)) {
    expected = stored.correctOptionIds as string[];
  }
  if (expected.length === 0) return null;

  let streak = 0;
  for (let i = 0; i < picks.length; i += 1) {
    if (picks[i] !== expected[i]) break;
    streak += 1;
  }
  const perQuestion = expected.length > 0 ? Math.round(900 / expected.length) : 0;
  const score = Math.min(900, streak * perQuestion);
  return { score, won: streak >= expected.length };
}

// ---- Draft XI --------------------------------------------------------------------------------
async function scoreDraft(row: PuzzleRow, answer: unknown): Promise<ServerScore | null> {
  const picks = (answer as { picks?: unknown })?.picks;
  if (!Array.isArray(picks)) return null;
  const clean = (picks as Array<{ slotId?: string; constraintId?: string; playerId?: string }>).filter(
    (p): p is { slotId: string; constraintId: string; playerId: string } =>
      typeof p.slotId === 'string' && typeof p.constraintId === 'string' && typeof p.playerId === 'string'
  );
  const { recomputeBattleScore } = await import('./battleGenerator.js');
  return recomputeBattleScore(row.puzzleJson as Parameters<typeof recomputeBattleScore>[0], clean);
}

// ---- Football Bingo --------------------------------------------------------------------------
// answer: { placements: [{ playerId, categoryId }], remainingPlayers, queueSize, won }
function scoreFootballBingo(row: PuzzleRow, answer: unknown): ServerScore | null {
  const placements = (answer as { placements?: unknown })?.placements;
  const remainingPlayers = (answer as { remainingPlayers?: unknown })?.remainingPlayers;
  const queueSize = (answer as { queueSize?: unknown })?.queueSize;
  const won = (answer as { won?: unknown })?.won === true;

  if (!Array.isArray(placements)) return null;
  if (typeof remainingPlayers !== 'number' || typeof queueSize !== 'number') return null;

  const puzzle = row.puzzleJson as { categories?: BingoCategory[]; players?: BingoPlayer[] };
  if (!Array.isArray(puzzle.categories) || !Array.isArray(puzzle.players)) return null;

  const playersById = new Map(puzzle.players.map((p) => [p.id, p]));
  const categoriesById = new Map(puzzle.categories.map((c) => [c.id, c]));
  const completed = new Set<string>();

  for (const raw of placements as Array<{ playerId?: string; categoryId?: string }>) {
    if (typeof raw.playerId !== 'string' || typeof raw.categoryId !== 'string') return null;
    const player = playersById.get(raw.playerId);
    const category = categoriesById.get(raw.categoryId);
    if (!player || !category) return null;
    if (completed.has(raw.categoryId)) return null;
    if (!bingoMatches(player, category)) return null;
    completed.add(raw.categoryId);
  }

  const tiles = puzzle.categories.length;
  const filled = completed.size;
  const completedAll = won && filled === tiles;
  // Prefer verified placement count; if client claims a win with a full set, treat as filled.
  const score = bingoXp(completedAll ? tiles : filled, tiles, remainingPlayers, queueSize);
  return { score, won: completedAll };
}

// ---- Football Golf ---------------------------------------------------------------------------
// answer: { holes: [{ holeId, matchedIds: string[], shots: number, skipped: boolean }] }
export function scoreFootballGolf(row: PuzzleRow, answer: unknown): ServerScore | null {
  const holes = (answer as { holes?: unknown })?.holes;
  if (!Array.isArray(holes)) return null;

  const puzzle = row.puzzleJson as {
    holes?: Array<{
      id: string;
      par: number;
      target?: number;
      answers?: Array<{ id: string; rarity?: string }>;
    }>;
  };
  if (
    !Array.isArray(puzzle.holes)
    || puzzle.holes.length !== FOOTBALL_GOLF_HOLE_COUNT
    || holes.length !== puzzle.holes.length
  ) return null;

  const byId = new Map(puzzle.holes.map((h) => [h.id, h]));
  if (byId.size !== puzzle.holes.length) return null;
  const submittedHoleIds = new Set<string>();
  let totalXp = 0;
  let totalRelativeToPar = 0;

  for (const raw of holes as Array<{
    holeId?: string;
    matchedIds?: unknown;
    shots?: unknown;
    skipped?: unknown;
  }>) {
    if (
      typeof raw.holeId !== 'string'
      || typeof raw.shots !== 'number'
      || !Number.isInteger(raw.shots)
      || raw.shots < 1
      || typeof raw.skipped !== 'boolean'
      || submittedHoleIds.has(raw.holeId)
    ) return null;
    const hole = byId.get(raw.holeId);
    if (!hole) return null;
    submittedHoleIds.add(raw.holeId);
    const answersById = new Map((hole.answers ?? []).map((a) => [a.id, a]));
    if (answersById.size !== (hole.answers ?? []).length) return null;
    const matchedIds = Array.isArray(raw.matchedIds) ? raw.matchedIds : [];
    if (
      matchedIds.some((id) => typeof id !== 'string' || !answersById.has(id as string))
      || new Set(matchedIds).size !== matchedIds.length
      || raw.shots < matchedIds.length
    ) return null;
    const target = hole.target ?? hole.par;
    const points = (matchedIds as string[]).reduce(
      (sum, id) => sum + golfRarityPoints(answersById.get(id)?.rarity),
      0
    );
    if (!raw.skipped && points < target) return null;
    if (raw.skipped) {
      const remaining = Math.max(0, target - points);
      if (remaining === 0 || raw.shots < matchedIds.length + 2 * remaining) return null;
    }

    const relative = raw.shots - hole.par;
    totalRelativeToPar += relative;
    totalXp += golfHoleXp(relative);
  }

  return {
    score: Math.min(FOOTBALL_GOLF_MAX_XP, totalXp),
    won: totalRelativeToPar <= 0,
  };
}

// ---- Target Man ------------------------------------------------------------------------------
// answer: { playerIds: string[] }
async function scoreTargetMan(row: PuzzleRow, answer: unknown): Promise<ServerScore | null> {
  const playerIds = (answer as { playerIds?: unknown })?.playerIds;
  if (!Array.isArray(playerIds) || playerIds.length !== 5 || playerIds.some((x) => typeof x !== 'string')) {
    return null;
  }

  const puzzle = row.puzzleJson as { categoryId?: string; target?: number };
  const answerMeta = row.answerJson as { answer?: { categoryId?: string; target?: number } } | null;
  const categoryId = puzzle.categoryId ?? answerMeta?.answer?.categoryId;
  const target = puzzle.target ?? answerMeta?.answer?.target;
  if (typeof categoryId !== 'string' || typeof target !== 'number' || target <= 0) return null;

  const values = await playerValuesForCategory(categoryId, playerIds as string[]);
  const combined = values.reduce((sum, v) => sum + v.value, 0);
  const difference = combined - target;
  const pctOff = Math.abs(difference) / Math.max(target, 1);
  const score = targetManXp(pctOff);
  return { score, won: score >= 500 };
}

// ---- Club Chain ------------------------------------------------------------------------------
// answer: { steps: string[], won: boolean, mistakes?: number }
async function scoreClubChain(row: PuzzleRow, answer: unknown): Promise<ServerScore | null> {
  const steps = (answer as { steps?: unknown })?.steps;
  const won = (answer as { won?: unknown })?.won === true;
  const mistakesRaw = (answer as { mistakes?: unknown })?.mistakes;
  if (!Array.isArray(steps) || steps.some((x) => typeof x !== 'string')) return null;

  const puzzle = row.puzzleJson as {
    start?: { id?: string };
    target?: { id?: string };
    shortestPathLength?: number;
    maxMoves?: number;
    mistakesAllowed?: number;
  };
  const answerMeta = row.answerJson as { shortestPathLength?: number } | null;
  const startId = puzzle.start?.id;
  const targetId = puzzle.target?.id;
  if (typeof startId !== 'string' || typeof targetId !== 'string') return null;

  const parEdges = answerMeta?.shortestPathLength ?? puzzle.shortestPathLength;
  if (typeof parEdges !== 'number' || parEdges < 1) return null;
  const parMoves = Math.max(1, parEdges - 1);
  const maxMoves = typeof puzzle.maxMoves === 'number' ? puzzle.maxMoves : parMoves + 4;
  const mistakesAllowed = typeof puzzle.mistakesAllowed === 'number' ? puzzle.mistakesAllowed : 3;

  let mistakes = 0;
  if (mistakesRaw !== undefined) {
    if (typeof mistakesRaw !== 'number' || !Number.isInteger(mistakesRaw) || mistakesRaw < 0) {
      return null;
    }
    mistakes = Math.min(mistakesRaw, mistakesAllowed);
  }

  if (!won) {
    return { score: 0, won: false };
  }

  // A win requires at least one life left, so mistakes must be below the cap.
  if (mistakes >= mistakesAllowed) return { score: 0, won: false };

  const path = [startId, ...(steps as string[]), targetId];
  if (steps.length > maxMoves) return { score: 0, won: false };

  for (let i = 0; i < path.length - 1; i += 1) {
    const link = await clubChainLink(path[i]!, path[i + 1]!);
    if (!link) return { score: 0, won: false };
  }

  return {
    score: clubChainXp(true, steps.length, parMoves, mistakes),
    won: true,
  };
}

/**
 * Recompute {score, won} for a completion from the submitted answer. Returns null for modes we don't
 * (yet) recompute or when the answer shape doesn't parse — the caller then clamps the client score.
 */
export async function computeServerScore(
  modeId: string,
  row: PuzzleRow,
  answer: unknown
): Promise<ServerScore | null> {
  if (answer == null) return null;
  try {
    switch (modeId) {
      case 'blind_rank': return scoreBlindRank(row, answer);
      case 'world_cup_xi': return scoreWorldCupXi(row, answer);
      case 'one_more': return scoreOneMore(row, answer);
      case 'last_man_standing': return scoreLastManStanding(row, answer);
      case 'draft_master': return await scoreDraft(row, answer);
      case 'football_bingo': return scoreFootballBingo(row, answer);
      case 'football_golf': return scoreFootballGolf(row, answer);
      case 'target_man': return await scoreTargetMan(row, answer);
      case 'club_chain': return await scoreClubChain(row, answer);
      default: return null;
    }
  } catch {
    return null;
  }
}

/**
 * Clamp a client-reported score (which is now the XP itself) to the mode's XP ceiling, never below 0.
 * Used when we can't fully recompute server-side from the answer.
 */
export function clampClientScore(modeId: string, score: number): number {
  return Math.max(0, Math.min(maxXpForMode(modeId), Math.round(score)));
}

/**
 * Resolve the score persisted for a completion. Only a genuinely absent answer keeps the legacy
 * Football Golf fallback; a supplied payload that cannot be verified must never earn client XP.
 */
export async function resolveCompletionScore(
  modeId: string,
  row: PuzzleRow,
  input: { score: number; won: boolean; answer?: unknown }
): Promise<ServerScore> {
  const server = await computeServerScore(modeId, row, input.answer);
  if (server) return server;
  if (modeId === 'football_golf' && Object.prototype.hasOwnProperty.call(input, 'answer')) {
    throw new InvalidCompletionAnswerError('Invalid Football Golf answer payload');
  }
  return {
    score: clampClientScore(modeId, input.score),
    won: input.won,
  };
}
