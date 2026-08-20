/**
 * Repeat suppression: what content has already shipped recently?
 *
 * Every daily puzzle is retained in daily_puzzles, so generators read back a rolling window of
 * their own history and exclude recently-used content (answers, questions, pairs, tiles…).
 * Selection *within* the eligible set stays seeded-random, so nothing settles into a fixed
 * repeat schedule — content only comes back by chance once it leaves the window.
 *
 * Each helper returns a Set of mode-specific keys used in the `days` before `date` (exclusive).
 * Generators accept these as an optional override so audit dry-runs can emulate history
 * without writing to the DB.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { golfRuleSignature } from './golfRuleSignature.js';
import { towerRuleSchema } from './towerRuleSchema.js';
import { clubKey } from '../utils/clubCanonical.js';

async function recentRows(
  modeId: string,
  date: string,
  days: number
): Promise<Array<{ date: string; pj: Record<string, unknown>; apid: string | null }>> {
  const window = Math.max(1, Math.floor(days));
  return (await db.execute(sql`
    SELECT date::text AS date, puzzle_json AS pj, answer_player_id AS apid
    FROM daily_puzzles
    WHERE mode_id = ${modeId}
      AND date < ${date}
      AND date >= (${date}::date - ${window}::int)
  `)) as unknown as Array<{ date: string; pj: Record<string, unknown>; apid: string | null }>;
}

/** Guess Who: answer player ids used in the window. */
export async function recentGuessWhoAnswerIds(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('guess_who', date, days);
  return new Set(rows.map((r) => r.apid).filter((id): id is string => !!id));
}

export function targetManQuestionKey(categoryId: string, target: number): string {
  return `${categoryId}:${target}`;
}

/** Target Man: exact questions (category + target) used in the window. */
export async function recentTargetManQuestions(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('target_man', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const categoryId = pj['categoryId'];
    const target = pj['target'];
    if (typeof categoryId === 'string' && typeof target === 'number') {
      out.add(targetManQuestionKey(categoryId, target));
    }
  }
  return out;
}

export function blindRankTenKey(playerIds: string[]): string {
  return [...playerIds].sort().join('|');
}

/** Blind Rank: exact sets of ten used in the window. */
export async function recentBlindRankTens(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('blind_rank', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const order = pj['presentationOrder'];
    if (Array.isArray(order)) {
      const ids = order.map((p) => (p as { id?: string }).id).filter((id): id is string => !!id);
      if (ids.length > 0) out.add(blindRankTenKey(ids));
    }
  }
  return out;
}

export function oneMorePairKey(metricId: string, idA: string, idB: string): string {
  return `${metricId}:${[idA, idB].sort().join('|')}`;
}

/** One More: exact (metric, player-pair) rounds used in the window. */
export async function recentOneMorePairs(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('one_more', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    // puzzleId is `${date}-one_more`; the metric id isn't stored, so key on the title (stable per metric).
    const title = typeof pj['title'] === 'string' ? (pj['title'] as string) : '';
    const rounds = pj['rounds'];
    if (!Array.isArray(rounds)) continue;
    for (const r of rounds) {
      const options = (r as { options?: Array<{ id?: string }> }).options;
      if (Array.isArray(options) && options.length === 2 && options[0]?.id && options[1]?.id) {
        out.add(oneMorePairKey(title, options[0].id, options[1].id));
      }
    }
  }
  return out;
}

export function wcxiPlayerYearKey(name: string, year: number | null | undefined): string {
  return `${name}|${year ?? '?'}`;
}

/** World Cup XI: player+tournament-year slots used in the window. */
export async function recentWcxiPlayerYears(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('world_cup_xi', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const slots = pj['slots'];
    if (!Array.isArray(slots)) continue;
    for (const s of slots) {
      const slot = s as { expectedName?: string; year?: number };
      if (slot.expectedName) out.add(wcxiPlayerYearKey(slot.expectedName, slot.year));
    }
  }
  return out;
}

export interface BingoTileUsage {
  frequency: number;
  lastUsedDate: string;
  daysSinceLastUse: number;
  usedDates: string[];
}

export type BingoResourceUsage = BingoTileUsage;

function utcDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Football Bingo: frequency and recency for every tile used in the weighting window. */
export async function recentBingoTileUsage(
  date: string,
  days: number
): Promise<Map<string, BingoTileUsage>> {
  const rows = await recentRows('football_bingo', date, days);
  const datesByTile = new Map<string, Set<string>>();
  for (const { date: usedDate, pj } of rows) {
    const categories = pj['categories'];
    if (!Array.isArray(categories)) continue;
    for (const c of categories) {
      const id = (c as { id?: string }).id;
      if (!id) continue;
      const dates = datesByTile.get(id) ?? new Set<string>();
      dates.add(usedDate);
      datesByTile.set(id, dates);
    }
  }
  const targetDay = utcDay(date);
  const out = new Map<string, BingoTileUsage>();
  for (const [id, dateSet] of datesByTile) {
    const usedDates = [...dateSet].sort();
    const lastUsedDate = usedDates[usedDates.length - 1]!;
    out.set(id, {
      frequency: usedDates.length,
      lastUsedDate,
      daysSinceLastUse: targetDay - utcDay(lastUsedDate),
      usedDates,
    });
  }
  return out;
}

/** Football Bingo compatibility helper: tile ids used in the window. */
export async function recentBingoTileIds(date: string, days: number): Promise<Set<string>> {
  return new Set((await recentBingoTileUsage(date, days)).keys());
}

function usageFromDates(
  datesByResource: Map<string, Set<string>>,
  date: string
): Map<string, BingoResourceUsage> {
  const targetDay = utcDay(date);
  const usage = new Map<string, BingoResourceUsage>();
  for (const [resource, dateSet] of datesByResource) {
    const usedDates = [...dateSet].sort();
    const lastUsedDate = usedDates.at(-1)!;
    usage.set(resource, {
      frequency: usedDates.length,
      lastUsedDate,
      daysSinceLastUse: targetDay - utcDay(lastUsedDate),
      usedDates,
    });
  }
  return usage;
}

function clubsFromStoredBingoCategory(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const category = value as { type?: string; matchingRule?: string };
  const rule = category.matchingRule ?? '';
  if (category.type === 'playedForClub') return [rule];
  if (category.type === 'nationClub') return [rule.split('|')[1] ?? ''];
  if (category.type === 'clubCombo') return rule.split('|').slice(0, 2);
  if (category.type === 'clubLeague') return [rule.split('|')[0] ?? ''];
  return [];
}

/** Underlying clubs used across direct, nation+club and club-combo tiles. */
export async function recentBingoClubUsage(
  date: string,
  days: number
): Promise<Map<string, BingoResourceUsage>> {
  const rows = await recentRows('football_bingo', date, days);
  const datesByClub = new Map<string, Set<string>>();
  for (const { date: usedDate, pj } of rows) {
    const categories = pj['categories'];
    if (!Array.isArray(categories)) continue;
    for (const category of categories) {
      for (const club of clubsFromStoredBingoCategory(category)) {
        const key = clubKey(club);
        if (!key) continue;
        const dates = datesByClub.get(key) ?? new Set<string>();
        dates.add(usedDate);
        datesByClub.set(key, dates);
      }
    }
  }
  return usageFromDates(datesByClub, date);
}

/** Player frequency in shipped Bingo queues, used to stop adjacent-day pool repetition. */
export async function recentBingoPlayerUsage(
  date: string,
  days: number
): Promise<Map<string, BingoResourceUsage>> {
  const rows = await recentRows('football_bingo', date, days);
  const datesByPlayer = new Map<string, Set<string>>();
  for (const { date: usedDate, pj } of rows) {
    const players = pj['players'];
    if (!Array.isArray(players)) continue;
    for (const player of players) {
      const id = (player as { id?: string }).id;
      if (!id) continue;
      const dates = datesByPlayer.get(id) ?? new Set<string>();
      dates.add(usedDate);
      datesByPlayer.set(id, dates);
    }
  }
  return usageFromDates(datesByPlayer, date);
}

/** Football Golf: prompts (lowercased) used in the window. */
export async function recentGolfPrompts(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('football_golf', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const holes = pj['holes'];
    if (!Array.isArray(holes)) continue;
    for (const h of holes) {
      const prompt = (h as { prompt?: string }).prompt;
      if (prompt) out.add(prompt.toLowerCase());
    }
  }
  return out;
}

/** Darts 501: formula ids used in the window. */
export async function recentDarts501Formulas(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('darts_501', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const formulaId = pj['formulaId'];
    if (typeof formulaId === 'string' && formulaId) out.add(formulaId);
  }
  return out;
}

/** Football Golf: semantic structured rules used in the window. Legacy holes are ignored. */
export async function recentGolfRuleSignatures(date: string, days: number): Promise<Set<string>> {
  const rows = await recentRows('football_golf', date, days);
  const out = new Set<string>();
  for (const { pj } of rows) {
    const holes = pj['holes'];
    if (!Array.isArray(holes)) continue;
    for (const hole of holes) {
      const parsed = towerRuleSchema.safeParse((hole as { rule?: unknown }).rule);
      if (parsed.success) out.add(golfRuleSignature(parsed.data));
    }
  }
  return out;
}
