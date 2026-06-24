/**
 * Football Tower generator. Builds a 40-floor "name a player/club/country matching
 * the rule" climb from real data. Each floor ships a machine-readable rule; answers
 * are validated server-side (towerRules) against the same data, so the client can
 * never disagree with the server.
 *
 * Solvability: every template is checked with countValidPlayers at generation; any
 * the data can't support is dropped (and logged), so a floor always has answers.
 *
 * Dry run: DATABASE_URL=... npm run job:gen-tower [date]
 */
import 'dotenv/config';
import { countFamousPlayers, countValidPlayers, towerVocab, type TowerRule } from './towerRules.js';
import { proposeTowerPrompts } from './llmCuration.js';

type AnswerType = 'player' | 'club' | 'country';
type Difficulty = 'easy' | 'medium' | 'hard' | 'elite';

interface Template {
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
  minFloor: number;
}

export interface TowerFloor {
  floor: number;
  difficulty: Difficulty;
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
}

export interface FootballTowerPuzzle {
  modeId: 'football_tower';
  puzzleId: string;
  date: string;
  title: string;
  floors: TowerFloor[];
}

const TEMPLATES: Template[] = [
  // Easy
  { prompt: 'Name a Premier League club.', answerType: 'club', rule: {}, minFloor: 1 },
  { prompt: 'Name a football nation.', answerType: 'country', rule: {}, minFloor: 1 },
  { prompt: 'Name a player who has played in the Premier League.', answerType: 'player', rule: { leaguePlayed: 'Premier League' }, minFloor: 1 },
  { prompt: 'Name a player from England.', answerType: 'player', rule: { nationality: 'England' }, minFloor: 1 },
  { prompt: 'Name a Champions League winner.', answerType: 'player', rule: { uclWinner: true }, minFloor: 1 },
  { prompt: 'Name a Premier League goalkeeper.', answerType: 'player', rule: { position: 'Goalkeeper', leaguePlayed: 'Premier League' }, minFloor: 1 },
  // Medium
  { prompt: 'Name a Brazilian who has played in the Premier League.', answerType: 'player', rule: { nationality: 'Brazil', leaguePlayed: 'Premier League' }, minFloor: 6 },
  { prompt: 'Name a player with 100+ Premier League appearances.', answerType: 'player', rule: { minPlApps: 100 }, minFloor: 6 },
  { prompt: 'Name a player who has played for Chelsea.', answerType: 'player', rule: { playedFor: ['Chelsea'] }, minFloor: 6 },
  { prompt: 'Name a player who has scored in the Champions League.', answerType: 'player', rule: { minUclGoals: 1 }, minFloor: 6 },
  { prompt: 'Name a Spanish player who has played in La Liga.', answerType: 'player', rule: { nationality: 'Spain', leaguePlayed: 'La Liga' }, minFloor: 6 },
  { prompt: 'Name a player who has played for Liverpool.', answerType: 'player', rule: { playedFor: ['Liverpool'] }, minFloor: 6 },
  // Hard
  { prompt: 'Name a French player with 5+ Champions League goals.', answerType: 'player', rule: { nationality: 'France', minUclGoals: 5 }, minFloor: 16 },
  { prompt: 'Name a player with 40+ Premier League assists.', answerType: 'player', rule: { minPlAssists: 40 }, minFloor: 16 },
  { prompt: 'Name a goalkeeper with 100+ Premier League appearances.', answerType: 'player', rule: { position: 'Goalkeeper', minPlApps: 100 }, minFloor: 16 },
  { prompt: 'Name a player who has played for both Arsenal and Chelsea.', answerType: 'player', rule: { playedFor: ['Arsenal', 'Chelsea'] }, minFloor: 16 },
  { prompt: 'Name an Italian who has played in the Premier League.', answerType: 'player', rule: { nationality: 'Italy', leaguePlayed: 'Premier League' }, minFloor: 16 },
  { prompt: 'Name a player with 200+ Premier League appearances.', answerType: 'player', rule: { minPlApps: 200 }, minFloor: 16 },
  // Elite
  { prompt: 'Name a Dutch player with 100+ Premier League appearances.', answerType: 'player', rule: { nationality: 'Netherlands', minPlApps: 100 }, minFloor: 31 },
  { prompt: 'Name a player with 10+ Champions League goals who played for Bayern Munich.', answerType: 'player', rule: { playedFor: ['Bayern München'], minUclGoals: 10 }, minFloor: 31 },
  { prompt: 'Name a defender with 200+ Premier League appearances.', answerType: 'player', rule: { position: 'Defender', minPlApps: 200 }, minFloor: 31 },
  { prompt: 'Name a player who has played for both Manchester United and Chelsea.', answerType: 'player', rule: { playedFor: ['Manchester United', 'Chelsea'] }, minFloor: 31 },
  { prompt: 'Name a non-European player with 20+ Champions League appearances.', answerType: 'player', rule: { nonEuropean: true, minUclApps: 20 }, minFloor: 31 },
  { prompt: 'Name a French player with 10+ Champions League goals.', answerType: 'player', rule: { nationality: 'France', minUclGoals: 10 }, minFloor: 31 },
];

function difficultyForFloor(floor: number): Difficulty {
  if (floor <= 5) return 'easy';
  if (floor <= 15) return 'medium';
  if (floor <= 30) return 'hard';
  return 'elite';
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Minimum valid answers a template must have to be usable. */
const MIN_VALID = 3;

interface Candidate {
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
  difficulty: number; // 0 (easy) → 100 (hard)
}

/** Always-easy anchors so floor 1-2 are gentle, regardless of the proposed set. */
const CLOSED_ANCHORS: Candidate[] = [
  { prompt: 'Name a football nation.', answerType: 'country', rule: {}, difficulty: 2 },
  { prompt: 'Name a Premier League club.', answerType: 'club', rule: {}, difficulty: 5 },
];

export async function generateFootballTowerPuzzle(
  date: string,
  opts: { llm?: boolean } = {}
): Promise<{ puzzle: FootballTowerPuzzle; report: Array<{ prompt: string; valid: number; difficulty: number }>; curated: string }> {
  const useLlm = opts.llm ?? true;
  const report: Array<{ prompt: string; valid: number; difficulty: number }> = [];
  let candidates: Candidate[] = [];
  let curated = 'data';

  // 1) Preferred path: Claude proposes a varied, difficulty-spread set; we DB-verify each.
  // Gated by `llm` so the on-demand bundle path stays fast (the slow LLM call runs in the
  // offline pre-generation job instead).
  const vocab = useLlm ? await towerVocab() : { clubs: [], nationalities: [] };
  const proposals = useLlm ? await proposeTowerPrompts(vocab) : null;
  if (proposals) {
    const verified: Candidate[] = [];
    const seenPrompts = new Set<string>();
    for (const p of proposals) {
      if (seenPrompts.has(p.prompt.toLowerCase())) continue;
      // Our rules are AND-only; reject any "or" prompt whose wording can't match the rule.
      if (/\bor\b/i.test(p.prompt)) continue;
      let n = 0;
      try {
        n = await countValidPlayers(p.rule);
      } catch {
        n = 0; // malformed rule from the model — skip
      }
      report.push({ prompt: p.prompt, valid: n, difficulty: p.difficulty });
      if (n >= MIN_VALID) {
        seenPrompts.add(p.prompt.toLowerCase());
        verified.push({ prompt: p.prompt, answerType: 'player', rule: p.rule, difficulty: p.difficulty });
      }
    }
    if (verified.length >= 20) {
      candidates = [...CLOSED_ANCHORS, ...verified];
      curated = 'llm';
    }
  }

  // 2) Fallback: static templates ordered by fame-weighted difficulty.
  if (candidates.length === 0) {
    const scored: Array<{ t: Template; fame: number }> = [];
    for (const t of TEMPLATES) {
      if (t.answerType === 'player') {
        const n = await countValidPlayers(t.rule);
        if (n < MIN_VALID) {
          report.push({ prompt: t.prompt, valid: n, difficulty: 0 });
          continue;
        }
        const fame = await countFamousPlayers(t.rule);
        scored.push({ t, fame });
      } else {
        scored.push({ t, fame: Number.MAX_SAFE_INTEGER });
      }
    }
    scored.sort((a, b) => b.fame - a.fame); // easiest (most famous answers) first
    const n = scored.length;
    candidates = scored.map((s, i) => ({
      prompt: s.t.prompt,
      answerType: s.t.answerType,
      rule: s.t.rule,
      difficulty: n <= 1 ? 50 : (i / (n - 1)) * 100,
    }));
    for (const c of candidates) report.push({ prompt: c.prompt, valid: -1, difficulty: c.difficulty });
  }

  // Order easy → hard, then walk floors 1→40 along the curve, picking from a small window
  // for variety while avoiding any prompt used in the last few floors.
  candidates.sort((a, b) => a.difficulty - b.difficulty);
  const M = candidates.length;
  const floors: TowerFloor[] = [];
  const recent: string[] = [];
  const usedAll = new Set<string>();
  const WIN = 5;
  for (let floor = 1; floor <= 40; floor += 1) {
    const center = M <= 1 ? 0 : Math.round(((floor - 1) / 39) * (M - 1));
    // Keep a constant-width window even at the edges (so the top floors still have a
    // choice and don't repeat), shifting it inward rather than shrinking it.
    let lo = center - Math.floor(WIN / 2);
    let hi = lo + WIN - 1;
    if (lo < 0) { hi -= lo; lo = 0; }
    if (hi > M - 1) { lo -= hi - (M - 1); hi = M - 1; }
    lo = Math.max(0, lo);
    const window: number[] = [];
    for (let i = lo; i <= hi; i += 1) window.push(i);
    // Prefer a prompt never used yet (we have more candidates than floors), then one not
    // used recently, then anything in the window — so repeats are essentially eliminated.
    let pickPool = window.filter((i) => !usedAll.has(candidates[i]!.prompt));
    if (pickPool.length === 0) pickPool = window.filter((i) => !recent.includes(candidates[i]!.prompt));
    if (pickPool.length === 0) pickPool = window;
    const pickIdx = pickPool[hashStr(`${date}:tower:${floor}`) % pickPool.length]!;
    const c = candidates[pickIdx]!;
    usedAll.add(c.prompt);
    recent.push(c.prompt);
    if (recent.length > 5) recent.shift();
    floors.push({ floor, difficulty: difficultyForFloor(floor), prompt: c.prompt, answerType: c.answerType, rule: c.rule });
  }

  return {
    puzzle: { modeId: 'football_tower', puzzleId: `${date}-football_tower`, date, title: 'Daily Football Tower', floors },
    report,
    curated,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const store = args.includes('store');
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
  generateFootballTowerPuzzle(date)
    .then(async ({ puzzle, report, curated }) => {
      if (store) {
        const { db } = await import('../db/index.js');
        const { dailyPuzzles } = await import('../db/schema.js');
        const { and, eq } = await import('drizzle-orm');
        await db.delete(dailyPuzzles).where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_tower')));
        await db.insert(dailyPuzzles).values({ date, modeId: 'football_tower', puzzleJson: puzzle, answerPlayerId: null, answerJson: null });
        console.log(`\n💾 Stored ${curated.toUpperCase()} tower for ${date}.`);
      }
      console.log(`\n=== FOOTBALL TOWER ${date} — ${puzzle.floors.length} floors · ordering: ${curated.toUpperCase()} ===\n`);
      console.log('Proposed prompts (Claude difficulty · verified answers):');
      for (const r of report.sort((a, b) => a.difficulty - b.difficulty)) {
        const flag = r.valid >= 0 && r.valid < MIN_VALID ? '❌ unsolvable' : r.difficulty >= 70 ? '🔴 hard' : r.difficulty >= 40 ? '🟠 med' : '🟢 easy';
        const validStr = r.valid < 0 ? '   —' : String(r.valid).padStart(4);
        console.log(`  ${flag.padEnd(13)} diff ${String(Math.round(r.difficulty)).padStart(3)} · answers ${validStr}  ${r.prompt}`);
      }
      console.log('\nFull floor ramp:');
      for (const fl of puzzle.floors) {
        console.log(`  ${String(fl.floor).padStart(2)} [${fl.difficulty.padEnd(6)}] ${fl.prompt}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
