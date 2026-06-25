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
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { towerPrompts } from '../db/schema.js';
import { countFamousPlayers, countRecallablePlayers, countValidPlayers, sampleFamousPlayers, towerVocab, type TowerRule } from './towerRules.js';
import { proposeTowerPrompts, rateTowerDifficulty, type CurationItem } from './llmCuration.js';

/** A prompt with many recallable answers can't be elite, no matter how niche it sounds —
 *  a fan will stumble onto one. Caps Claude's score by answer abundance. */
function abundanceCap(recallable: number): number {
  if (recallable >= 20) return 25;
  if (recallable >= 12) return 40;
  if (recallable >= 6) return 60;
  if (recallable >= 3) return 80;
  return 100;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
}

function normPrompt(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Prompts used in recently-stored tower puzzles, to keep each day fresh. */
async function recentPrompts(days: number): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT puzzle_json AS pj FROM daily_puzzles
    WHERE mode_id = 'football_tower' AND date >= (CURRENT_DATE - ${`${days} days`}::interval)
  `)) as unknown as Array<{ pj: { floors?: Array<{ prompt: string }> } }>;
  const out: string[] = [];
  for (const r of rows) for (const f of r.pj?.floors ?? []) if (f.prompt) out.push(f.prompt);
  return out;
}

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

const FLOORS = 15;

/** Honest label from the actual difficulty score (not the floor's position). */
function labelForScore(score: number): Difficulty {
  if (score >= 70) return 'elite';
  if (score >= 50) return 'hard';
  return 'medium';
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Minimum valid answers to be usable. 1-2 answers isn't "unsolvable" — it's a great
 *  ELITE prompt (you only need to name ONE). Only 0 answers is truly unusable. */
const MIN_VALID = 1;

interface Candidate {
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
  difficulty: number; // 0 (easy) → 100 (hard)
  answers: number; // verified total answers (-1 for closed sets)
}

/** Always-easy anchors so floor 1-2 are gentle, regardless of the proposed set. */
const CLOSED_ANCHORS: Candidate[] = [
  { prompt: 'Name a football nation.', answerType: 'country', rule: {}, difficulty: 2, answers: -1 },
  { prompt: 'Name a Premier League club.', answerType: 'club', rule: {}, difficulty: 5, answers: -1 },
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
  const avoid = useLlm ? await recentPrompts(21) : [];
  const avoidSet = new Set(avoid.map(normPrompt));
  const proposals = useLlm ? await proposeTowerPrompts(vocab, avoid) : null;
  if (proposals) {
    const verified: Candidate[] = [];
    const seenPrompts = new Set<string>();
    for (const p of proposals) {
      if (seenPrompts.has(p.prompt.toLowerCase())) continue;
      // Hard guarantee of freshness even if the model ignores the avoid list.
      if (avoidSet.has(normPrompt(p.prompt))) continue;
      // Our rules are AND-only; reject any "or" prompt whose wording can't match the rule.
      if (/\bor\b/i.test(p.prompt)) continue;
      // Reject malformed prompts: model leaked reasoning, ran on, or is too long.
      if (p.prompt.length > 110) continue;
      if (/\b(wait|let me|allowed|actually|hmm|i should|note:|i.?ll use)\b/i.test(p.prompt)) continue;
      if (p.prompt.includes('—') || (p.prompt.match(/\./g)?.length ?? 0) > 1) continue;
      let n = 0;
      try {
        n = await countValidPlayers(p.rule);
      } catch {
        n = 0; // malformed rule from the model — skip
      }
      report.push({ prompt: p.prompt, valid: n, difficulty: p.difficulty });
      if (n >= MIN_VALID) {
        seenPrompts.add(p.prompt.toLowerCase());
        verified.push({ prompt: p.prompt, answerType: 'player', rule: p.rule, difficulty: p.difficulty, answers: n });
      }
    }
    if (verified.length >= 20) {
      candidates = [...CLOSED_ANCHORS.map((a) => ({ ...a })), ...verified];
      curated = 'llm';

      // SECOND PASS: Claude proposed difficulty BLIND. Re-rate each verified prompt using
      // the REAL famous answers from the DB, so "Uruguayan in the PL" (Suárez, Cavani,
      // Núñez, Forlán…) is correctly rated easy rather than guessed as elite.
      const rateItems: CurationItem[] = [];
      const recallableByPrompt = new Map<string, number>();
      for (const c of candidates) {
        const isClosed = c.answerType !== 'player';
        recallableByPrompt.set(c.prompt, isClosed ? 999 : await countRecallablePlayers(c.rule));
        const samples = isClosed ? [] : await sampleFamousPlayers(c.rule, 8);
        rateItems.push({ id: slug(c.prompt), prompt: c.prompt, samples });
      }
      const ratings = await rateTowerDifficulty(rateItems);
      if (ratings) {
        for (const c of candidates) {
          const claudeDiff = ratings.get(slug(c.prompt)) ?? c.difficulty;
          // Claude judges from the famous answers; the cap stops an abundant-answer prompt
          // (e.g. 40 Argentines in the Bundesliga) being mislabelled elite.
          c.difficulty = Math.min(claudeDiff, abundanceCap(recallableByPrompt.get(c.prompt) ?? 0));
        }
        curated = 'llm-2pass';
      }
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
      answers: -1,
    }));
    for (const c of candidates) report.push({ prompt: c.prompt, valid: -1, difficulty: c.difficulty });
  }

  // Order easy → hard, then walk floors 1→40 along the curve, picking from a small window
  // for variety while avoiding any prompt used in the last few floors.
  // Banded selection: fill medium / hard / elite floors from their REAL score bands so the
  // tower always has a genuine ramp and every label is honest. Borrow across bands only if
  // a band is short. Floors end up sorted by ascending difficulty (a true climb).
  candidates.sort((a, b) => a.difficulty - b.difficulty);
  // Start accessible (>=25, gettable but not the trivial "name a nation" stuff) and climb.
  const med = candidates.filter((c) => c.difficulty >= 25 && c.difficulty < 50);
  const hard = candidates.filter((c) => c.difficulty >= 50 && c.difficulty < 70);
  const elite = candidates.filter((c) => c.difficulty >= 70);

  /** Take up to n from a band, spread evenly across it for variety. */
  const pickEven = (band: Candidate[], n: number, used: Set<string>): Candidate[] => {
    const avail = band.filter((c) => !used.has(c.prompt));
    if (avail.length <= n) return avail;
    const out: Candidate[] = [];
    for (let i = 0; i < n; i += 1) out.push(avail[Math.round((i / (n - 1)) * (avail.length - 1))]!);
    return out;
  };

  const used = new Set<string>();
  const chosen: Candidate[] = [];
  for (const [band, n] of [[med, 5], [hard, 6], [elite, 4]] as const) {
    for (const c of pickEven(band, n, used)) {
      chosen.push(c);
      used.add(c.prompt);
    }
  }
  // Backfill if any band was short — prefer the hardest remaining so the top stays tough.
  if (chosen.length < FLOORS) {
    const rest = candidates.filter((c) => c.difficulty >= 25 && !used.has(c.prompt)).sort((a, b) => b.difficulty - a.difficulty);
    for (const c of rest) {
      if (chosen.length >= FLOORS) break;
      chosen.push(c);
      used.add(c.prompt);
    }
  }

  chosen.sort((a, b) => a.difficulty - b.difficulty);
  const floors: TowerFloor[] = chosen.slice(0, FLOORS).map((c, i) => ({
    floor: i + 1,
    difficulty: labelForScore(c.difficulty),
    prompt: c.prompt,
    answerType: c.answerType,
    rule: c.rule,
  }));

  return {
    puzzle: { modeId: 'football_tower', puzzleId: `${date}-football_tower`, date, title: 'Daily Football Tower', floors },
    report,
    curated,
  };
}

/**
 * Draw today's tower from the reviewed bank WITHOUT replacement (least-recently-used per
 * tier), so days don't repeat until the bank cycles. Returns null if the bank is too small,
 * letting the caller fall back to live generation. Marks the chosen prompts as used.
 */
export async function drawTowerFromBank(date: string): Promise<FootballTowerPuzzle | null> {
  // [tier, floors, min relationship floors]. Relationship prompts (closed-set teammate /
  // manager / finals / World Cup) are the "fun" core, so we reserve a few slots per tier
  // for them, then fill the rest with the wider bank — all least-recently-used.
  const want: Array<[string, number, number]> = [['medium', 5, 2], ['hard', 6, 2], ['elite', 4, 1]];
  type Row = { id: string; prompt: string; rule: TowerRule; answer_type: AnswerType; tier: Difficulty; difficulty: number };
  const chosen: Row[] = [];
  const usedIds: string[] = [];
  // Track clubs already featured so two prompts in the same tower don't share a club
  // (e.g. "Atalanta + City" next to "Toulouse + City").
  const usedClubs = new Set<string>();
  const clubsOf = (r: Row): string[] => (Array.isArray(r.rule?.playedFor) ? r.rule.playedFor!.map((c) => c.toLowerCase()) : []);
  const sharesClub = (r: Row): boolean => clubsOf(r).some((c) => usedClubs.has(c));
  const take = (r: Row) => {
    chosen.push(r);
    usedIds.push(r.id);
    for (const c of clubsOf(r)) usedClubs.add(c);
  };

  const exclude = () =>
    usedIds.length ? sql`AND id NOT IN (${sql.join(usedIds.map((id) => sql`${id}`), sql`, `)})` : sql``;

  for (const [tier, n, relMin] of want) {
    // reserve relationship slots first (over-fetch, then greedily pick avoiding repeats)
    if (relMin > 0) {
      const pool = (await db.execute(sql`
        SELECT id, prompt, rule, answer_type, tier, difficulty FROM tower_prompts
        WHERE status = 'active' AND tier = ${tier} AND rule ? 'validIds' ${exclude()}
        ORDER BY used_count ASC, last_used_date ASC NULLS FIRST, random()
        LIMIT ${relMin * 5}
      `)) as unknown as Row[];
      let added = 0;
      for (const r of pool) {
        if (added >= relMin) break;
        if (sharesClub(r)) continue;
        take(r);
        added += 1;
      }
    }
    // fill the remainder of the tier from the wider bank, avoiding shared clubs
    const need = () => n - chosen.filter((c) => c.tier === tier).length;
    if (need() > 0) {
      const pool = (await db.execute(sql`
        SELECT id, prompt, rule, answer_type, tier, difficulty FROM tower_prompts
        WHERE status = 'active' AND tier = ${tier} ${exclude()}
        ORDER BY used_count ASC, last_used_date ASC NULLS FIRST, random()
        LIMIT ${n * 6}
      `)) as unknown as Row[];
      // first pass: skip prompts sharing a club with one already chosen
      for (const r of pool) {
        if (need() <= 0) break;
        if (usedIds.includes(r.id) || sharesClub(r)) continue;
        take(r);
      }
      // second pass: if still short (small bank), relax the club constraint
      for (const r of pool) {
        if (need() <= 0) break;
        if (usedIds.includes(r.id)) continue;
        take(r);
      }
    }
  }

  // Backfill from any active prompt (hardest first) if a tier was short.
  if (chosen.length < FLOORS) {
    const excl = usedIds.length ? sql`AND id NOT IN (${sql.join(usedIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
    const more = (await db.execute(sql`
      SELECT id, prompt, rule, answer_type, tier, difficulty FROM tower_prompts
      WHERE status = 'active' ${excl}
      ORDER BY difficulty DESC, used_count ASC, random()
      LIMIT ${FLOORS - chosen.length}
    `)) as unknown as Row[];
    chosen.push(...more);
    usedIds.push(...more.map((r) => r.id));
  }

  if (chosen.length < FLOORS) return null; // bank too small — caller falls back

  chosen.sort((a, b) => a.difficulty - b.difficulty);
  const floors: TowerFloor[] = chosen.slice(0, FLOORS).map((c, i) => ({
    floor: i + 1,
    difficulty: c.tier,
    prompt: c.prompt,
    answerType: c.answer_type,
    rule: c.rule,
  }));

  await db.execute(sql`
    UPDATE tower_prompts SET used_count = used_count + 1, last_used_date = ${date}
    WHERE id IN (${sql.join(usedIds.slice(0, FLOORS).map((id) => sql`${id}`), sql`, `)})
  `);

  return { modeId: 'football_tower', puzzleId: `${date}-football_tower`, date, title: 'Daily Football Tower', floors };
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
        const flag =
          r.valid === 0 ? '❌ unsolvable'
          : r.difficulty >= 75 ? '🟣 elite'
          : r.difficulty >= 55 ? '🔴 hard'
          : r.difficulty >= 35 ? '🟠 medium'
          : '🟢 easy(skip)';
        const validStr = r.valid < 0 ? '   —' : String(r.valid).padStart(4);
        console.log(`  ${flag.padEnd(14)} diff ${String(Math.round(r.difficulty)).padStart(3)} · answers ${validStr}  ${r.prompt}`);
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
