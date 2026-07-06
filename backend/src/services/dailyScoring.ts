/**
 * Server-authoritative scoring. The client still scores locally for instant / offline feedback, but
 * when it submits its actual ANSWER inputs we recompute the score + won flag here from the stored
 * puzzle (and server-only answer_json) so a modified client can't fabricate leaderboard XP.
 *
 * Recompute is best-effort: any shape mismatch returns null and the caller falls back to the (clamped)
 * client-reported score, so older clients that don't send answers keep working.
 */
import { maxXpForMode } from './dailyService.js';

export interface ServerScore {
  score: number;
  won: boolean;
}

type PuzzleRow = { puzzleJson: unknown; answerJson: unknown };

// ---- Blind Rank -----------------------------------------------------------------------------
// answer: { order: string[] } — the 10 player ids as the user arranged them (top → bottom).
function scoreBlindRank(row: PuzzleRow, answer: unknown): ServerScore | null {
  const order = (answer as { order?: unknown })?.order;
  if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) return null;

  // Ground-truth ranking: prefer the server-only answer_json, else derive from the presentation stats.
  let correct = (row.answerJson as { answer?: { correctRanking?: unknown } })?.answer?.correctRanking;
  if (!Array.isArray(correct)) {
    const po = (row.puzzleJson as { presentationOrder?: Array<{ id?: string; statValue?: number }> })?.presentationOrder;
    if (!Array.isArray(po)) return null;
    correct = [...po].sort((a, b) => (b.statValue ?? 0) - (a.statValue ?? 0)).map((p) => p.id);
  }
  const idx = new Map((correct as string[]).map((id, i) => [id, i]));

  // Per-slot XP by distance from the true spot (exact 100 / off-1 60 / off-2 30 / else 0).
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
// answer: { picks: [{ slotId, name }] } — the player NAME the user placed in each slot.
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
// answer: { picks: string[]; cashedOut: boolean } — the option id chosen each round, in order.
function scoreOneMore(row: PuzzleRow, answer: unknown): ServerScore | null {
  const picks = (answer as { picks?: unknown })?.picks;
  const cashedOut = (answer as { cashedOut?: unknown })?.cashedOut === true;
  const puzzle = row.puzzleJson as { minimum?: number; rounds?: Array<{ options?: Array<{ id: string; value: number }> }> };
  if (!Array.isArray(picks) || !Array.isArray(puzzle?.rounds) || typeof puzzle.minimum !== 'number') return null;

  const minimum = puzzle.minimum;
  const rounds = puzzle.rounds.length;
  let streak = 0;
  let busted = false;
  for (let i = 0; i < picks.length; i += 1) {
    const opt = puzzle.rounds[i]?.options?.find((o) => o.id === picks[i]);
    if (!opt || opt.value < minimum) { busted = true; break; }
    streak += 1;
  }
  if (busted) return { score: 0, won: false };
  // Escalating share of the 900 max, summing to 900 when all rounds are cleared (pick k of N).
  const pickXp = (k: number): number => (rounds > 0 && k > 0 ? Math.round((900 * 2 * k) / (rounds * (rounds + 1))) : 0);
  let score = 0;
  for (let k = 1; k <= streak; k += 1) score += pickXp(k);
  return { score, won: cashedOut || streak >= rounds };
}

// ---- Draft XI (async — needs the DB) --------------------------------------------------------
// answer: { picks: [{ slotId, constraintId, playerId }] }
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
      case 'draft_master': return await scoreDraft(row, answer);
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
