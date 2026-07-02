/**
 * Content audit: dry-runs every daily-puzzle generator for the next N days (no DB writes)
 * and reports category rotation, pool sizes, solvability failures and difficulty signals.
 *
 *   DATABASE_URL=... npx tsx src/jobs/audit-content.ts [days]
 */
import 'dotenv/config';
import { generateGuessWhoPuzzle, generateTargetManPuzzle } from '../services/dailyPuzzleGenerator.js';
import { generateBlindRankPuzzle } from '../services/blindRankGenerator.js';
import { generateFootballBingoPuzzle, isBingoSolvable } from '../services/footballBingoGenerator.js';
import { generateOneMorePuzzle } from '../services/oneMoreGenerator.js';
import { generateBattlePuzzle } from '../services/battleGenerator.js';
import { generateWorldCupXiPuzzle } from '../services/worldCupXiGenerator.js';
import { generateFootballGolfCourse } from '../services/footballGolfGenerator.js';
import { TARGET_CATEGORIES, topPlayersForCategory } from '../services/targetManCategories.js';
import { buildDailyFactPack } from '../services/dailyFactPack.js';
import { getPlayerById } from '../services/playerService.js';

const DAYS = Number(process.argv[2] ?? 30);

function futureDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

async function main() {
  const dates = futureDates(DAYS);
  console.log(`=== Content audit: ${DAYS} days (${dates[0]} … ${dates[dates.length - 1]}) ===\n`);

  // ---- Target Man: static pool check for all 19 categories -------------------------------------
  console.log('--- TARGET MAN: per-category qualifying pool (need >= 5) ---');
  for (const def of TARGET_CATEGORIES) {
    try {
      const ranked = await topPlayersForCategory(def);
      const flag = ranked.length < 5 ? '  <<< UNUSABLE' : ranked.length < 15 ? '  <<< THIN' : '';
      const top = ranked[0] ? `${ranked[0].name}=${ranked[0].statValue}` : '-';
      const bottom = ranked[ranked.length - 1] ? `${ranked[ranked.length - 1].name}=${ranked[ranked.length - 1].statValue}` : '-';
      console.log(`${def.id.padEnd(20)} pool=${String(ranked.length).padStart(2)}  top:[${top}]  25th:[${bottom}]${flag}`);
    } catch (err) {
      console.log(`${def.id.padEnd(20)} ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- Per-day dry runs -------------------------------------------------------------------------
  const guessWhoAnswers: string[] = [];
  const targetManCats: string[] = [];
  const blindPairs: string[] = [];
  const oneMoreMetrics: string[] = [];
  const battleCats: string[] = [];
  const failures: string[] = [];
  const bingoTightTiles: string[] = [];
  const golfRarity = { common: 0, uncommon: 0, rare: 0, ultraRare: 0 };
  let golfHoleCats: string[] = [];
  let wcxiYears: string[] = [];
  let battleZeroCells = 0;
  let battleSlots = 0;

  for (const date of dates) {
    const factPack = await buildDailyFactPack(date);

    // Guess Who
    try {
      const p = await generateGuessWhoPuzzle(date, factPack);
      const ans = p.answerPlayerId ?? '';
      const player = ans ? await getPlayerById(ans) : null;
      guessWhoAnswers.push(player ? `${player.name} (${player.currentClub ?? '?'} · mvt ${player.marketValueTier ?? '?'})` : ans);
    } catch (err) {
      failures.push(`${date} guess_who: ${err instanceof Error ? err.message : err}`);
    }

    // Target Man
    try {
      const p = await generateTargetManPuzzle(date, factPack);
      const pub = p.puzzleJson as { categoryId: string; target: number };
      targetManCats.push(`${pub.categoryId} (target ${pub.target})`);
    } catch (err) {
      failures.push(`${date} target_man: ${err instanceof Error ? err.message : err}`);
    }

    // Blind Rank
    try {
      const p = await generateBlindRankPuzzle(date);
      const pub = p.puzzleJson as { themeTitle?: string; categoryTitle?: string };
      blindPairs.push(`${pub.themeTitle} × ${pub.categoryTitle}`);
    } catch (err) {
      failures.push(`${date} blind_rank: ${err instanceof Error ? err.message : err}`);
    }

    // Football Bingo
    try {
      const p = await generateFootballBingoPuzzle(date);
      const solvable = isBingoSolvable(p);
      if (!solvable.ok) {
        const dead = solvable.perCategory.filter((c) => c.matchers === 0).map((c) => c.title);
        failures.push(`${date} football_bingo UNSOLVABLE: [${dead.join(', ')}]`);
      }
      for (const c of solvable.perCategory) {
        if (c.matchers > 0 && c.matchers <= 2) bingoTightTiles.push(`${c.title} (${c.matchers})`);
      }
    } catch (err) {
      failures.push(`${date} football_bingo: ${err instanceof Error ? err.message : err}`);
    }

    // One More
    try {
      const { puzzle, pool } = await generateOneMorePuzzle(date);
      const pz = puzzle as unknown as { title: string; rounds: unknown[] };
      oneMoreMetrics.push(`${pz.title} (rounds ${pz.rounds.length}, pool ${pool})`);
      if (pz.rounds.length < 10) failures.push(`${date} one_more THIN: ${pz.rounds.length} rounds (server min is 10)`);
    } catch (err) {
      failures.push(`${date} one_more: ${err instanceof Error ? err.message : err}`);
    }

    // Battle Mode
    try {
      const p = await generateBattlePuzzle(date);
      if (!p) {
        failures.push(`${date} draft_master: generator returned null`);
      } else {
        battleCats.push(`${p.category.title} (optimal ${p.optimalScore})`);
        battleSlots += p.slots.length;
        battleZeroCells += (p.optimalLineup ?? []).filter((o) => o.statValue <= 0).length;
      }
    } catch (err) {
      failures.push(`${date} draft_master: ${err instanceof Error ? err.message : err}`);
    }

    // World Cup XI
    try {
      const p = await generateWorldCupXiPuzzle(date);
      if (!p) {
        failures.push(`${date} world_cup_xi: generator returned null`);
      } else {
        wcxiYears.push(...p.slots.map((s) => String(s.year ?? '?')));
        if (p.slots.length !== 11) failures.push(`${date} world_cup_xi: only ${p.slots.length} slots`);
      }
    } catch (err) {
      failures.push(`${date} world_cup_xi: ${err instanceof Error ? err.message : err}`);
    }

    // Football Golf
    try {
      const p = await generateFootballGolfCourse(date);
      for (const h of p.holes) {
        golfHoleCats.push(h.category ?? '?');
        for (const a of h.answers) golfRarity[a.rarity as keyof typeof golfRarity]++;
      }
    } catch (err) {
      failures.push(`${date} football_golf: ${err instanceof Error ? err.message : err}`);
    }
    process.stderr.write(`.${date.slice(8)}`);
  }
  process.stderr.write('\n');

  console.log('\n--- GUESS WHO answers (repeat = same player twice in window) ---');
  for (const [name, n] of count(guessWhoAnswers)) console.log(`${n > 1 ? `x${n} <<<` : '  '} ${name}`);

  console.log('\n--- TARGET MAN category rotation ---');
  for (const [c, n] of count(targetManCats)) console.log(`x${n}  ${c}`);

  console.log('\n--- BLIND RANK pairs used ---');
  for (const [c, n] of count(blindPairs)) console.log(`x${n}  ${c}`);

  console.log('\n--- ONE MORE metrics used ---');
  for (const [c, n] of count(oneMoreMetrics)) console.log(`x${n}  ${c}`);

  console.log('\n--- BATTLE categories ---');
  for (const [c, n] of count(battleCats)) console.log(`x${n}  ${c}`);
  console.log(`zero-stat optimal picks: ${battleZeroCells} of ${battleSlots} slots`);

  console.log('\n--- WORLD CUP XI year distribution (all slots) ---');
  for (const [c, n] of count(wcxiYears)) console.log(`x${n}  ${c}`);

  console.log('\n--- GOLF hole categories ---');
  for (const [c, n] of count(golfHoleCats)) console.log(`x${n}  ${c}`);
  console.log(`answer rarity mix: ${JSON.stringify(golfRarity)}`);

  console.log('\n--- BINGO tiles shipping with <=2 matchers in queue (tight but solvable) ---');
  for (const [c, n] of count(bingoTightTiles)) console.log(`x${n}  ${c}`);

  console.log(`\n=== FAILURES (${failures.length}) ===`);
  for (const f of failures) console.log(f);
  if (failures.length === 0) console.log('none');
  process.exit(0);
}

main().catch((err) => {
  console.error('audit failed:', err);
  process.exit(1);
});
