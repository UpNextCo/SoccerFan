/**
 * Repeat/looping audit: dry-runs the daily generators over a long future window (no DB writes)
 * and measures how often the SAME content (answer player, category+target, ranked ten, round
 * pair, clue, prompt, tile) comes back — and how many days apart.
 *
 * The run EMULATES the production repeat-suppression history: each generator receives the same
 * rolling window of recently-used keys it would read from daily_puzzles in production.
 *
 *   DATABASE_URL=... npx tsx src/jobs/audit-repeats.ts [days]
 */
import 'dotenv/config';
import { generateGuessWhoPuzzle, generateTargetManPuzzle } from '../services/dailyPuzzleGenerator.js';
import { generateBlindRankPuzzle } from '../services/blindRankGenerator.js';
import { generateFootballBingoPuzzle } from '../services/footballBingoGenerator.js';
import { generateOneMorePuzzle } from '../services/oneMoreGenerator.js';
import { generateBattlePuzzle } from '../services/battleGenerator.js';
import { generateWorldCupXiPuzzle } from '../services/worldCupXiGenerator.js';
import { generateFootballGolfCourse } from '../services/footballGolfGenerator.js';
import { buildDailyFactPack } from '../services/dailyFactPack.js';
import { getPlayerById } from '../services/playerService.js';
import {
  blindRankTenKey,
  oneMorePairKey,
  targetManQuestionKey,
  wcxiPlayerYearKey,
} from '../services/puzzleHistory.js';

const DAYS = Number(process.argv[2] ?? 120);

// Must mirror the windows inside each generator.
const WINDOWS = {
  guessWho: 180,
  targetMan: 240,
  blindRank: 240,
  oneMore: 180,
  wcxi: 30,
  bingo: 10,
  golf: 28,
};

function futureDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Rolling per-day key store emulating what daily_puzzles history would return. */
class RollingWindow {
  private byDay: Array<{ day: number; keys: string[] }> = [];
  constructor(private days: number) {}
  visible(day: number): Set<string> {
    const s = new Set<string>();
    for (const e of this.byDay) {
      if (e.day < day && e.day >= day - this.days) for (const k of e.keys) s.add(k);
    }
    return s;
  }
  add(day: number, keys: string[]) {
    this.byDay.push({ day, keys });
  }
}

type Occurrences = Map<string, number[]>;

function record(map: Occurrences, key: string, day: number) {
  const arr = map.get(key);
  if (arr) arr.push(day);
  else map.set(key, [day]);
}

interface RepeatStats {
  total: number;
  unique: number;
  repeatedKeys: number;
  minGap: number | null;
  medianGap: number | null;
  gaps: Array<{ key: string; gap: number }>;
}

function analyze(map: Occurrences): RepeatStats {
  let total = 0;
  const gaps: Array<{ key: string; gap: number }> = [];
  for (const [key, days] of map) {
    total += days.length;
    for (let i = 1; i < days.length; i++) gaps.push({ key, gap: days[i]! - days[i - 1]! });
  }
  const sorted = gaps.map((g) => g.gap).sort((a, b) => a - b);
  return {
    total,
    unique: map.size,
    repeatedKeys: [...map.values()].filter((d) => d.length > 1).length,
    minGap: sorted[0] ?? null,
    medianGap: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
    gaps: gaps.sort((a, b) => a.gap - b.gap),
  };
}

function report(name: string, stats: RepeatStats, worst = 8) {
  console.log(`\n--- ${name} ---`);
  console.log(
    `items ${stats.total} · unique ${stats.unique} · keys repeated ${stats.repeatedKeys}` +
      (stats.minGap !== null ? ` · min gap ${stats.minGap}d · median gap ${stats.medianGap}d` : ' · NO REPEATS in window')
  );
  for (const g of stats.gaps.slice(0, worst)) console.log(`  ${String(g.gap).padStart(3)}d  ${g.key}`);
}

async function main() {
  const dates = futureDates(DAYS);
  console.log(`=== Repeat audit (history-emulated): ${DAYS} days (${dates[0]} … ${dates[dates.length - 1]}) ===`);

  const guessWho: Occurrences = new Map();
  const tmCategory: Occurrences = new Map();
  const tmQuestion: Occurrences = new Map();
  const brPair: Occurrences = new Map();
  const brTen: Occurrences = new Map();
  const omMetric: Occurrences = new Map();
  const omPair: Occurrences = new Map();
  const battleCat: Occurrences = new Map();
  const battleSetup: Occurrences = new Map();
  const wcxiPlayer: Occurrences = new Map();
  const golfPrompt: Occurrences = new Map();
  const bingoTile: Occurrences = new Map();

  const hGuessWho = new RollingWindow(WINDOWS.guessWho);
  const hTargetMan = new RollingWindow(WINDOWS.targetMan);
  const hBlindRank = new RollingWindow(WINDOWS.blindRank);
  const hOneMore = new RollingWindow(WINDOWS.oneMore);
  const hWcxi = new RollingWindow(WINDOWS.wcxi);
  const hBingo = new RollingWindow(WINDOWS.bingo);
  const hGolf = new RollingWindow(WINDOWS.golf);

  const failures: string[] = [];

  for (let day = 0; day < dates.length; day++) {
    const date = dates[day]!;
    const factPack = await buildDailyFactPack(date);

    try {
      const p = await generateGuessWhoPuzzle(date, factPack, { recentAnswerIds: hGuessWho.visible(day) });
      const id = p.answerPlayerId ?? '?';
      hGuessWho.add(day, [id]);
      const player = p.answerPlayerId ? await getPlayerById(p.answerPlayerId) : null;
      record(guessWho, player?.name ?? id, day);
    } catch (err) {
      failures.push(`${date} guess_who: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateTargetManPuzzle(date, factPack, { recentQuestions: hTargetMan.visible(day) });
      const pub = p.puzzleJson as { categoryId: string; target: number };
      hTargetMan.add(day, [targetManQuestionKey(pub.categoryId, pub.target)]);
      record(tmCategory, pub.categoryId, day);
      record(tmQuestion, `${pub.categoryId} target=${pub.target}`, day);
    } catch (err) {
      failures.push(`${date} target_man: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateBlindRankPuzzle(date, { recentTens: hBlindRank.visible(day) });
      const pub = p.puzzleJson as { themeTitle: string; categoryTitle: string; presentationOrder: Array<{ id: string; name: string }> };
      hBlindRank.add(day, [blindRankTenKey(pub.presentationOrder.map((x) => x.id))]);
      const pair = `${pub.themeTitle} × ${pub.categoryTitle}`;
      record(brPair, pair, day);
      record(brTen, `${pair} :: ${pub.presentationOrder.map((x) => x.name).sort().join(', ')}`, day);
    } catch (err) {
      failures.push(`${date} blind_rank: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const { puzzle } = await generateOneMorePuzzle(date, { recentPairs: hOneMore.visible(day) });
      const pz = puzzle as unknown as { title: string; rounds: Array<{ options: Array<{ id: string; name: string }> }> };
      const keys: string[] = [];
      record(omMetric, pz.title, day);
      for (const r of pz.rounds) {
        keys.push(oneMorePairKey(pz.title, r.options[0]!.id, r.options[1]!.id));
        record(omPair, `${pz.title}: ${r.options.map((o) => o.name).sort().join(' v ')}`, day);
      }
      hOneMore.add(day, keys);
      if (pz.rounds.length < 10) failures.push(`${date} one_more THIN: ${pz.rounds.length} rounds`);
    } catch (err) {
      failures.push(`${date} one_more: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateBattlePuzzle(date);
      if (!p) failures.push(`${date} draft_master: null`);
      else {
        record(battleCat, p.category.title, day);
        record(battleSetup, `${p.category.title} :: ${p.clubs.map((c) => c.name).sort().join(', ')}`, day);
      }
    } catch (err) {
      failures.push(`${date} draft_master: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateWorldCupXiPuzzle(date, { recentPlayerYears: hWcxi.visible(day) });
      if (!p) failures.push(`${date} world_cup_xi: null`);
      else {
        hWcxi.add(day, p.slots.map((s) => wcxiPlayerYearKey(s.expectedName, s.year)));
        for (const s of p.slots) record(wcxiPlayer, `${s.expectedName} (${s.year ?? '?'})`, day);
        if (p.slots.length !== 11) failures.push(`${date} world_cup_xi: ${p.slots.length} slots`);
      }
    } catch (err) {
      failures.push(`${date} world_cup_xi: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateFootballGolfCourse(date, { recentPromptsOverride: hGolf.visible(day) });
      hGolf.add(day, p.holes.map((h) => h.prompt.toLowerCase()));
      for (const h of p.holes) record(golfPrompt, h.prompt, day);
    } catch (err) {
      failures.push(`${date} football_golf: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const p = await generateFootballBingoPuzzle(date, { recentTileIds: hBingo.visible(day) });
      hBingo.add(day, p.categories.map((c) => c.id));
      for (const c of p.categories) record(bingoTile, c.title, day);
    } catch (err) {
      failures.push(`${date} football_bingo: ${err instanceof Error ? err.message : err}`);
    }

    process.stderr.write(`\rday ${day + 1}/${DAYS} (${date})   `);
  }
  process.stderr.write('\n');

  report('GUESS WHO — answer player', analyze(guessWho), 10);
  report('TARGET MAN — category (similar is OK)', analyze(tmCategory), 2);
  report('TARGET MAN — exact question (category+target)', analyze(tmQuestion), 8);
  report('BLIND RANK — theme × category pair (similar is OK)', analyze(brPair), 2);
  report('BLIND RANK — exact ten', analyze(brTen), 8);
  report('ONE MORE — metric (similar is OK)', analyze(omMetric), 2);
  report('ONE MORE — exact round pair', analyze(omPair), 8);
  report('BATTLE — category (similar is OK)', analyze(battleCat), 2);
  report('BATTLE — exact setup (category+clubs)', analyze(battleSetup), 8);
  report('WORLD CUP XI — player+year in XI', analyze(wcxiPlayer), 10);
  report('GOLF — prompt', analyze(golfPrompt), 8);
  report('BINGO — tile title', analyze(bingoTile), 10);

  console.log(`\n=== FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log(f);
  if (failures.length === 0) console.log('none');
  // No process.exit(0): let stdout flush naturally, then force-exit only if a stray DB handle
  // keeps the loop alive.
  setTimeout(() => process.exit(0), 3000).unref();
}

main().catch((err) => {
  console.error('repeat audit failed:', err);
  process.exit(1);
});
