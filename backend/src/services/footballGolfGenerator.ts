/**
 * Football Golf generator. Each hole has:
 *   - PAR = expected number of shots (guesses) to clear the hole (2–5)
 *   - TARGET = points needed to finish (= par × 2; average solid answer ≈ 2 pts)
 * Rarity on each answer sets point value (common 1 … ultraRare 4). Prompts are broad
 * ("Played for both Arsenal and Chelsea", "Brazilian players in the Premier League"),
 * drawn from the same prompt bank that fed Tower (tower_prompts) — closed-set and
 * rule-based alike — with EVERY valid answer enumerated and tagged by rarity so the
 * client can validate locally and reward "I know a rarer one" depth.
 *
 * The full answer set ships in the daily bundle, so validation + scoring run on-device.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { enumeratePlayers, type AnswerPlayer, type TowerRule } from './towerRules.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

/** Prompts used within this window are excluded (shrunk adaptively if the bank runs thin). */
const GOLF_PROMPT_REPEAT_WINDOW_DAYS = 28;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'ultraRare';

export interface GolfAnswer {
  id: string;
  name: string;
  aliases: string[];
  rarity: Rarity;
}
export interface GolfHole {
  id: string;
  holeNumber: number;
  par: 2 | 3 | 4 | 5;
  /** Points to clear the hole — always par × 2 so a decent run averages ~2 pts per shot. */
  target: number;
  prompt: string;
  category: string;
  answers: GolfAnswer[];
  hints: string[];
}
export interface FootballGolfPuzzle {
  modeId: 'football_golf';
  puzzleId: string;
  date: string;
  title: string;
  totalPar: number;
  holes: GolfHole[];
}

const HOLES = 9;
// Stroke par per hole (expected shots). A varied spread; broader prompts get higher pars.
const PAR_SEQUENCE: Array<2 | 3 | 4 | 5> = [2, 3, 3, 3, 4, 4, 4, 5, 5];

/** Inverse of fame: a household name is "common", a deep cut is "ultraRare". This is
 *  what powers the satisfying "I found a rarer answer" moment. */
function rarityFor(p: AnswerPlayer): Rarity {
  // Fame = market_value_tier (the validated signal). Career apps are NOT used for the
  // famous tiers, because long-serving journeymen rack up apps without being nameable —
  // that's exactly what made niche prompts (e.g. Ivorian-in-Bundesliga) look fair when
  // they weren't.
  if (p.mvt >= 5) return 'common';
  if (p.mvt >= 4) return 'uncommon';
  if (p.mvt >= 3 || p.big5 >= 120) return 'rare';
  return 'ultraRare';
}

/** Whether THIS audience could name the player: a global megastar (mvt 5), a Premier
 *  League regular, or a Champions League regular. Crucially NOT "high market value in a
 *  foreign league" — that's how niche prompts (Ivorian-in-Bundesliga) snuck through. */
function isNameable(p: AnswerPlayer): boolean {
  return p.mvt >= 5 || p.pl >= 25 || p.ucl >= 30;
}

/** Count of answers the audience can actually name. Par is clamped below this. */
function nameableCount(players: AnswerPlayer[]): number {
  return players.filter(isNameable).length;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function categoryFor(rule: TowerRule, prompt: string): string {
  if (rule.validIds) {
    if (/\bplayed under\b/i.test(prompt)) return 'Managers';
    if (/\bplayed with\b/i.test(prompt)) return 'Teammates';
    if (/final/i.test(prompt)) return 'Finals';
    if (/World Cup|European Championship|Copa|Africa Cup/i.test(prompt)) return 'Internationals';
    if (/Ballon|Golden|Boot/i.test(prompt)) return 'Awards';
    return 'Connections';
  }
  if (rule.playedFor && rule.playedFor.length >= 2) return 'Clubs';
  if (rule.nationality) return 'Nationality';
  if (rule.leaguePlayed) return 'Leagues';
  return 'Career';
}

interface Candidate {
  prompt: string;
  rule: TowerRule;
  answers: GolfAnswer[];
  famous: number;
}

async function aliasesByIds(ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`SELECT id, aliases FROM players WHERE id IN (${list})`)) as unknown as Array<{ id: string; aliases: string[] }>;
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.id, Array.isArray(r.aliases) ? r.aliases : []);
  return m;
}

function hintsFor(answers: GolfAnswer[]): string[] {
  const surnameInitial = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return (parts[parts.length - 1] ?? name)[0]?.toUpperCase() ?? '?';
  };
  const out: string[] = [];
  const uncommon = answers.find((a) => a.rarity === 'uncommon');
  const rare = answers.find((a) => a.rarity === 'rare' || a.rarity === 'ultraRare');
  if (uncommon) out.push(`A valid answer's surname starts with "${surnameInitial(uncommon.name)}".`);
  if (rare) out.push(`A rarer answer's surname starts with "${surnameInitial(rare.name)}".`);
  return out;
}

/** Recent golf prompts to avoid repeats within a window. */
async function recentPrompts(days: number): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT puzzle_json AS pj FROM daily_puzzles
    WHERE mode_id = 'football_golf' AND date >= (CURRENT_DATE - ${`${days} days`}::interval)
  `)) as unknown as Array<{ pj: { holes?: Array<{ prompt: string }> } }>;
  const out = new Set<string>();
  for (const r of rows) for (const h of r.pj?.holes ?? []) if (h.prompt) out.add(h.prompt.toLowerCase());
  return out;
}

export async function generateFootballGolfCourse(
  date: string,
  opts?: { recentPromptsOverride?: Set<string> }
): Promise<FootballGolfPuzzle> {
  // Source prompts: active player prompts from the bank (closed-set + rule-based).
  const prompts = (await db.execute(sql`
    SELECT prompt, rule FROM tower_prompts WHERE status = 'active' AND answer_type = 'player'
  `)) as unknown as Array<{ prompt: string; rule: TowerRule }>;

  // Repeat suppression: prompts used in the last 28 days are excluded; if the bank can't fill a
  // course under that window (too many prompts also fail the quality thresholds), shrink it
  // rather than fail the day.
  const fullAvoid = opts?.recentPromptsOverride ?? (await recentPrompts(GOLF_PROMPT_REPEAT_WINDOW_DAYS));
  const shorterAvoid = opts?.recentPromptsOverride ?? null;

  // Deterministic daily shuffle.
  const seed = hashStr(`${date}:golf`);
  const ordered = prompts
    .map((p, i) => ({ p, k: hashStr(`${seed}:${i}:${p.prompt}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);

  let candidates = await scanCandidates(ordered, fullAvoid);
  if (candidates.length < HOLES) {
    for (const window of [14, 7, 0]) {
      const avoid = shorterAvoid ?? (window > 0 ? await recentPrompts(window) : new Set<string>());
      candidates = await scanCandidates(ordered, window > 0 ? avoid : new Set<string>());
      if (candidates.length >= HOLES) break;
    }
  }

  if (candidates.length < HOLES) {
    throw new Error(`Only ${candidates.length} golf candidates for ${date} (need ${HOLES})`);
  }

  // Assign pars: broadest prompts get the highest pars, and every par is CLAMPED to
  // (famous − 2) so the hole is always completable from common knowledge.
  const chosen = candidates.slice(0, HOLES).sort((a, b) => b.famous - a.famous);
  const parsDesc = [...PAR_SEQUENCE].sort((a, b) => b - a); // [5,5,4,4,4,3,3,3,2]
  const withPar = chosen.map((c, i) => ({
    ...c,
    par: Math.max(2, Math.min(parsDesc[i]!, c.famous - 2)) as 2 | 3 | 4 | 5,
  }));

  // Re-order holes for the round (deterministic), so pars aren't monotonic.
  withPar.sort((a, b) => hashStr(`${seed}:order:${a.prompt}`) - hashStr(`${seed}:order:${b.prompt}`));

  const holes: GolfHole[] = withPar.map((c, i) => ({
    id: `${date}-h${i + 1}`,
    holeNumber: i + 1,
    par: c.par,
    target: c.par * 2,
    prompt: c.prompt,
    category: categoryFor(c.rule, c.prompt),
    answers: c.answers,
    hints: hintsFor(c.answers),
  }));

  const totalPar = holes.reduce((s, h) => s + h.par, 0);
  return { modeId: 'football_golf', puzzleId: `${date}-football_golf`, date, title: 'Daily Football Golf', totalPar, holes };
}

/** Scan the day's shuffled prompt order, enumerating answers until 9 quality holes are found. */
async function scanCandidates(
  ordered: Array<{ prompt: string; rule: TowerRule }>,
  avoid: Set<string>
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const usedClubs = new Set<string>();
  const catCount = new Map<string, number>();
  const MAX_PER_CATEGORY = 2; // keep a course varied (clubs / nationality / managers / …)
  for (const { prompt, rule } of ordered) {
    if (candidates.length >= HOLES) break;
    if (avoid.has(prompt.toLowerCase())) continue;
    // club diversity: no two holes sharing a club
    const clubs = Array.isArray(rule.playedFor) ? rule.playedFor.map((c) => c.toLowerCase()) : [];
    if (clubs.some((c) => usedClubs.has(c))) continue;
    // A "[foreign nationality] in [a non-PL league]" prompt is niche for this audience
    // (you might not name one Ivorian in the Bundesliga), even if the DB has many. Allow
    // nationality prompts only when the league is the Premier League.
    if (rule.nationality && rule.leaguePlayed && rule.leaguePlayed !== 'Premier League') continue;

    // category diversity
    const cat = categoryFor(rule, prompt);
    if ((catCount.get(cat) ?? 0) >= MAX_PER_CATEGORY) continue;

    let players: AnswerPlayer[] = [];
    try {
      players = await enumeratePlayers(rule);
    } catch {
      continue;
    }
    // Dedupe same-display-name answers (keep the most prominent) so a hole never lists
    // "José Reyes" twice.
    const byName = new Map<string, AnswerPlayer>();
    for (const p of players) {
      const k = normalizeSearchText(p.name);
      const prev = byName.get(k);
      if (!prev || p.total > prev.total) byName.set(k, p);
    }
    players = [...byName.values()];
    const famous = nameableCount(players);
    // A fair golf hole must be genuinely BROAD for THIS audience — ≥8 answers they could
    // name (megastars / PL / UCL), so any par (2–5) is reachable and there's depth for
    // birdies. Excludes niche foreign-league prompts. Bounded total so it ships.
    // Manager pair links need a higher bar — knowing who played under both X and Y is harder.
    const minFamous = cat === 'Managers' && /\bboth\b/i.test(prompt) ? 12 : 8;
    if (famous < minFamous || players.length > 200) continue;

    const aliasMap = await aliasesByIds(players.map((p) => p.id));
    const answers: GolfAnswer[] = players.map((p) => ({
      id: p.id,
      name: p.name,
      aliases: aliasMap.get(p.id) ?? [],
      rarity: rarityFor(p),
    }));
    candidates.push({ prompt, rule, answers, famous });
    for (const c of clubs) usedClubs.add(c);
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
  }

  return candidates;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
  generateFootballGolfCourse(date)
    .then((puz) => {
      console.log(`\n=== FOOTBALL GOLF ${date} · Par ${puz.totalPar} ===\n`);
      for (const h of puz.holes) {
        const byR = (r: Rarity) => h.answers.filter((a) => a.rarity === r).length;
        const famous = byR('common') + byR('uncommon');
        console.log(`Hole ${h.holeNumber} · Par ${h.par} · [${h.category}]  ${h.prompt}`);
        console.log(`   ${h.answers.length} answers · ${famous} nameable (C${byR('common')}/U${byR('uncommon')}/R${byR('rare')}/UR${byR('ultraRare')})  hint: ${h.hints[0] ?? '—'}`);
        const common = h.answers.filter((a) => a.rarity === 'common').slice(0, 4).map((a) => a.name);
        const rare = h.answers.filter((a) => a.rarity === 'rare' || a.rarity === 'ultraRare').slice(0, 3).map((a) => a.name);
        console.log(`   e.g. common: ${common.join(', ')}${rare.length ? `  ·  rare: ${rare.join(', ')}` : ''}`);
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
