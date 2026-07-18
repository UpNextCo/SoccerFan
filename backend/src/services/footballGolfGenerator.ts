/**
 * Football Golf generator. Each hole has:
 *   - PAR = expected shots to clear at a typical mix (2–4, capped)
 *   - TARGET = points to clear — equals par (all-common path), max 4
 * Rarity on each answer sets point value (common 1 … ultraRare 4). Prompts are broad
 * ("scored in 2023/24 Premier League", "appeared for Leicester in 2015/16"),
 * drawn from the tower_prompts bank — closed-set and rule-based alike — with EVERY
 * valid answer enumerated and tagged by rarity so the client can validate locally
 * and reward "I know a rarer one" depth. Geography filter stacks are a last resort.
 *
 * The full answer set ships in the daily bundle, so validation + scoring run on-device.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { enumeratePlayers, type AnswerPlayer, type TowerRule } from './towerRules.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { golfRuleSignature } from './golfRuleSignature.js';
import { recentGolfPrompts, recentGolfRuleSignatures } from './puzzleHistory.js';
import {
  FOOTBALL_GOLF_HOLE_COUNT,
  FOOTBALL_GOLF_PAR_SEQUENCE,
  FOOTBALL_GOLF_RULE_COOLDOWN_DAYS,
} from './footballGolfConstants.js';

export { FOOTBALL_GOLF_HOLE_COUNT } from './footballGolfConstants.js';

/** Prompts used within this window are excluded (shrunk adaptively if the bank runs thin). */
const GOLF_PROMPT_REPEAT_WINDOW_DAYS = 28;
/** Structured rule meaning is never reused inside this fixed window. */
const GOLF_RULE_REPEAT_WINDOW_DAYS = FOOTBALL_GOLF_RULE_COOLDOWN_DAYS;

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
  par: 2 | 3 | 4;
  /** Points to clear — equals stroke par (all-common path). */
  target: number;
  prompt: string;
  category: string;
  answers: GolfAnswer[];
  hints: string[];
  /** Declarative source used to regenerate and verify the complete answer set. */
  rule?: TowerRule;
  /** tower_prompts row used to author this hole, when applicable. */
  templateId?: string;
}
export interface FootballGolfPuzzle {
  modeId: 'football_golf';
  puzzleId: string;
  date: string;
  title: string;
  totalPar: number;
  holes: GolfHole[];
}

const MAX_PAR = 4;
const MAX_TARGET = 4;
/** Trivia-shaped categories players enjoy naming into. */
export const FUN_GOLF_CATEGORIES = new Set([
  'Seasons',
  'Achievements',
  'Club Eras',
  'Finals',
  'Managers',
  'Transfers',
  'Tournaments',
]);
/** Broad season / moment prompts — aim for two per course. */
const MOMENT_GOLF_CATEGORIES = new Set([
  'Seasons',
  'Tournaments',
  'Achievements',
  'Finals',
]);
const ERA_GOLF_CATEGORIES = new Set(['Club Eras']);
const JOURNEY_GOLF_CATEGORIES = new Set(['Clubs', 'Transfers', 'Managers']);
// Stroke par per hole — capped at 4 so no hole asks for 5+ names on an all-common run.
export const PAR_SEQUENCE: ReadonlyArray<2 | 3 | 4> = FOOTBALL_GOLF_PAR_SEQUENCE;

/** Points needed to clear — always equals par (birdies come from picking rarer names). */
export function targetForPar(par: 2 | 3 | 4): number {
  return Math.min(MAX_TARGET, par);
}

/** Achievement prestige — same weights as compute-fame.ts (finals×3 + awards×4). */
function achievementPrestige(p: AnswerPlayer): number {
  return p.finals * 3 + p.awards * 4;
}

/** Composite name-recognition score. Peak € tier alone mis-ranks legends (e.g. Sergio Ramos
 *  can sit at tier 4 while being a household name) — CL/PL exposure + major honours lift icons. */
function recognitionScore(p: AnswerPlayer): number {
  let s = p.mvt * 10;
  if (p.ucl >= 80) s += 14;
  else if (p.ucl >= 40) s += 9;
  else if (p.ucl >= 20) s += 5;
  if (p.pl >= 80) s += 12;
  else if (p.pl >= 40) s += 8;
  else if (p.pl >= 20) s += 4;
  if (p.big5 >= 350) s += 6;
  else if (p.big5 >= 200) s += 3;
  const ach = achievementPrestige(p);
  if (ach >= 12) s += 18;
  else if (ach >= 6) s += 10;
  else if (ach >= 2.5) s += 5;
  else if (ach >= 0.8) s += 2;
  return s;
}

/** Household names for the "common" bucket — casual MOTD viewer knows them instantly. */
function isHouseholdCommon(p: AnswerPlayer, rec: number, ach: number): boolean {
  if (p.mvt >= 5 || ach >= 12) return true;
  // CL regulars with a tier-4+ peak — not just high appearance counts.
  if (p.mvt >= 4 && p.ucl >= 50) return true;
  // Strong all-round recognition only when peak tier backs it up (avoids PL volume traps).
  if (p.mvt >= 4 && rec >= 64) return true;
  return false;
}

/** Inverse of fame for scoring: household → common, deep cut → ultraRare. Uses recognition
 *  (tier + CL/PL/BIG5 + finals/awards), not market tier or raw apps alone. */
export function rarityFor(p: AnswerPlayer): Rarity {
  const rec = recognitionScore(p);
  const ach = achievementPrestige(p);
  if (isHouseholdCommon(p, rec, ach)) return 'common';
  // Regular fan knows them — solid PL/UCL regulars, tier-4 peaks, WC/Euro finalists.
  if (p.mvt >= 4 || ach >= 6 || rec >= 44 || p.pl >= 25 || p.ucl >= 30 || p.big5 >= 200) return 'uncommon';
  // Footy-nerd picks — some fame signal but not casual-audience names.
  if (p.mvt >= 3 || ach >= 2.5 || rec >= 34 || p.big5 >= 100 || p.pl >= 12 || p.ucl >= 15) return 'rare';
  return 'ultraRare';
}

/** Whether THIS audience could name the player: megastar, PL/UCL regular, or major honours. */
function isNameable(p: AnswerPlayer): boolean {
  return p.mvt >= 5 || p.pl >= 25 || p.ucl >= 30 || achievementPrestige(p) >= 6;
}

/** Count of answers the audience can actually name. Par is clamped below this. */
export function nameableCount(players: AnswerPlayer[]): number {
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

const GOLF_DEMONYMS: Record<string, string> = {
  Argentina: 'Argentine',
  Austria: 'Austrian',
  Belgium: 'Belgian',
  Brazil: 'Brazilian',
  Cameroon: 'Cameroonian',
  Chile: 'Chilean',
  Colombia: 'Colombian',
  Croatia: 'Croatian',
  Denmark: 'Danish',
  England: 'English',
  France: 'French',
  Germany: 'German',
  Ghana: 'Ghanaian',
  Italy: 'Italian',
  Japan: 'Japanese',
  Mexico: 'Mexican',
  Morocco: 'Moroccan',
  Netherlands: 'Dutch',
  Nigeria: 'Nigerian',
  Norway: 'Norwegian',
  Poland: 'Polish',
  Portugal: 'Portuguese',
  Scotland: 'Scottish',
  Senegal: 'Senegalese',
  Serbia: 'Serbian',
  Spain: 'Spanish',
  Sweden: 'Swedish',
  Switzerland: 'Swiss',
  Uruguay: 'Uruguayan',
  Wales: 'Welsh',
  "Côte d'Ivoire": 'Ivorian',
  'Ivory Coast': 'Ivorian',
  'United States': 'American',
};

/** Golf always expects multiple answers, so player-facing prompts use plural wording. */
export function golfPromptCopy(prompt: string): string {
  let copy = prompt.trim()
    .replace(/^Name a footballer who\b/i, 'Name players who')
    .replace(/^Name a footballer whose\b/i, 'Name players whose')
    .replace(/^Name a player who\b/i, 'Name players who')
    .replace(/^Name a player whose\b/i, 'Name players whose')
    .replace(/^Name a player with\b/i, 'Name players with')
    .replace(/^Name a player from\b/i, 'Name players from')
    .replace(/^Name an? (.+?) player who\b/i, 'Name $1 players who')
    .replace(/^Name an? (.+?) who has\b/i, 'Name $1 players who have')
    .replace(
      /^Name an? (.+?) who (played|scored|won|started|finished)\b/i,
      'Name $1 players who $2'
    )
    .replace(/^Name players who has\b/i, 'Name players who have');

  copy = copy
    .replace(/\bfootballer players\b/gi, 'players')
    .replace(/\bgoalkeeper players\b/gi, 'goalkeepers')
    .replace(/\bdefender players\b/gi, 'defenders')
    .replace(
      /^Name (.+?) who (.+?) and has\b/i,
      'Name $1 who $2 and have'
    )
    .replace(
      /^Name (.+?) whose (.+?) and has\b/i,
      'Name $1 whose $2 and have'
    );

  for (const [nation, demonym] of Object.entries(GOLF_DEMONYMS)) {
    const prefix = `Name ${nation} players`;
    if (copy.toLowerCase().startsWith(prefix.toLowerCase())) {
      copy = `Name ${demonym} players${copy.slice(prefix.length)}`;
      break;
    }
  }

  if (/^Name a Champions League winner\.?$/i.test(copy)) {
    copy = 'Name Champions League winners.';
  } else if (/^Name a Premier League goalkeeper\.?$/i.test(copy)) {
    copy = 'Name Premier League goalkeepers.';
  }
  return copy;
}

export function categoryFor(rule: TowerRule, prompt: string): string {
  if (rule.validIds) {
    if (/\bplayed under\b/i.test(prompt)) return 'Managers';
    if (/\bplayed with\b/i.test(prompt)) return 'Teammates';
    if (/final/i.test(prompt)) return 'Finals';
    if (/World Cup|European Championship|Copa|Africa Cup/i.test(prompt)) return 'Internationals';
    if (/Ballon|Golden|Boot/i.test(prompt)) return 'Awards';
    return 'Connections';
  }
  if (rule.seasonStat) return 'Seasons';
  if (rule.clubSeason) return 'Club Eras';
  if (rule.managedBy) return 'Managers';
  if (rule.directTransfer) return 'Transfers';
  if (rule.finalAppearance) return 'Finals';
  if (rule.worldCupScorerYear) return 'Tournaments';
  if (
    typeof rule.minCareerHattricks === 'number' ||
    typeof rule.minUclKnockoutGoals === 'number'
  ) return 'Achievements';
  if (rule.playedFor && rule.playedFor.length >= 2) return 'Clubs';
  // Geography / filter stacks read like SQL, not trivia — keep them in one bucket.
  if (rule.nationality || rule.nonEuropean) return 'Nationality';
  if (rule.leaguePlayed) return 'Leagues';
  return 'Career';
}

/** Nationality / continent / league-filter prompts — allowed only as a last resort. */
export function isGeographyHeavyGolfRule(rule: TowerRule, category?: string): boolean {
  const cat = category ?? categoryFor(rule, '');
  return Boolean(rule.nationality || rule.nonEuropean)
    || cat === 'Nationality'
    || cat === 'Leagues';
}

/**
 * Legacy Tower filter stacks (yellow cards, appearance thresholds, lone positions)
 * and niche manager-pair links that read like SQL rather than football trivia.
 */
export function isDullFilterGolfRule(
  rule: TowerRule,
  category?: string,
  prompt = ''
): boolean {
  const cat = category ?? categoryFor(rule, prompt);
  if (isGeographyHeavyGolfRule(rule, cat)) return true;
  if (cat === 'Career') return true;
  if (typeof rule.minPlYellowCards === 'number') return true;
  if (typeof rule.minPlCleanSheets === 'number') return true;
  if (rule.position && !rule.clubSeason && !(rule.playedFor && rule.playedFor.length >= 2)) {
    return true;
  }
  // "Played under both X and Y" closed sets are often obscure manager pairings.
  if (rule.validIds && /\bplayed under both\b/i.test(prompt)) return true;
  return false;
}

/** Preferred daily mix: 2 moments, 1 club era, 1 career journey, 1 fun wildcard. */
export type GolfCourseSlot =
  | 'moment'
  | 'clubEra'
  | 'journey'
  | 'wildcard';

export function golfCourseSlotFor(category: string): GolfCourseSlot | null {
  if (MOMENT_GOLF_CATEGORIES.has(category)) return 'moment';
  if (ERA_GOLF_CATEGORIES.has(category)) return 'clubEra';
  if (JOURNEY_GOLF_CATEGORIES.has(category)) return 'journey';
  if (FUN_GOLF_CATEGORIES.has(category) || category === 'Clubs') return 'wildcard';
  return null;
}

export function golfPromptPriority(category: string, rule: TowerRule, prompt = ''): number {
  if (isDullFilterGolfRule(rule, category, prompt)) return 5;
  if (isGeographyHeavyGolfRule(rule, category)) return 4;
  if (MOMENT_GOLF_CATEGORIES.has(category) || ERA_GOLF_CATEGORIES.has(category)) return 0;
  if (JOURNEY_GOLF_CATEGORIES.has(category)) return 1;
  if (FUN_GOLF_CATEGORIES.has(category) || category === 'Clubs') return 2;
  return 3;
}

export function minNameableForGolfCategory(category: string, prompt: string): number {
  if (category === 'Managers' && /\bboth\b/i.test(prompt)) return 12;
  if (category === 'Transfers') return 8;
  if (MOMENT_GOLF_CATEGORIES.has(category) || category === 'Club Eras') return 12;
  return 10;
}

export function maxAnswersForGolfCategory(category: string): number {
  return category === 'Seasons' || category === 'Tournaments' ? 220 : 120;
}

interface Candidate {
  templateId: string;
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

export function hintsFor(answers: GolfAnswer[]): string[] {
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

export interface GolfRuleCounts {
  total: number;
  nameable: number;
  duplicateNamesRemoved: number;
  rarity: Record<Rarity, number>;
}

export interface GolfRuleEvaluation {
  prompt: string;
  rule: TowerRule;
  category: string;
  answers: GolfAnswer[];
  hints: string[];
  counts: GolfRuleCounts;
  qualityWarnings: string[];
  suggestedPar: 2 | 3 | 4;
  suggestedTarget: number;
}

/** Dedupe display names exactly as daily generation does, retaining the strongest record. */
export function dedupeGolfPlayers(players: AnswerPlayer[]): {
  players: AnswerPlayer[];
  removed: number;
} {
  const byName = new Map<string, AnswerPlayer>();
  for (const player of players) {
    const key = normalizeSearchText(player.name);
    const previous = byName.get(key);
    if (!previous || player.total > previous.total) byName.set(key, player);
  }
  return { players: [...byName.values()], removed: players.length - byName.size };
}

export function suggestGolfPar(nameable: number): 2 | 3 | 4 {
  if (nameable >= 12) return 4;
  if (nameable >= 9) return 3;
  return 2;
}

export function golfQualityWarnings(
  prompt: string,
  category: string,
  counts: Pick<GolfRuleCounts, 'total' | 'nameable' | 'duplicateNamesRemoved'>
): string[] {
  const warnings: string[] = [];
  const minimumNameable = minNameableForGolfCategory(category, prompt);
  if (counts.total === 0) warnings.push('Rule currently matches no players.');
  if (counts.nameable < minimumNameable) {
    warnings.push(`Only ${counts.nameable} nameable answers; this prompt should have at least ${minimumNameable}.`);
  }
  const maximumAnswers = maxAnswersForGolfCategory(category);
  if (counts.total > maximumAnswers) {
    warnings.push(
      `Rule matches ${counts.total} players; keep this category at ${maximumAnswers} answers or fewer.`
    );
  }
  if (category === 'Nationality' || category === 'Leagues') {
    warnings.push('Geography / league-filter prompts are a last resort for Golf — prefer season, club-era or career questions.');
  }
  return warnings;
}

/** Enumerate and enrich the complete DB-backed answer set for a structured rule. */
export async function evaluateGolfRule(prompt: string, rule: TowerRule): Promise<GolfRuleEvaluation> {
  const enumerated = await enumeratePlayers(rule);
  const deduped = dedupeGolfPlayers(enumerated);
  const aliasMap = await aliasesByIds(deduped.players.map((player) => player.id));
  const answers = deduped.players.map((player) => ({
    id: player.id,
    name: player.name,
    aliases: aliasMap.get(player.id) ?? [],
    rarity: rarityFor(player),
  }));
  const category = categoryFor(rule, prompt);
  const nameable = nameableCount(deduped.players);
  const counts: GolfRuleCounts = {
    total: answers.length,
    nameable,
    duplicateNamesRemoved: deduped.removed,
    rarity: {
      common: answers.filter((answer) => answer.rarity === 'common').length,
      uncommon: answers.filter((answer) => answer.rarity === 'uncommon').length,
      rare: answers.filter((answer) => answer.rarity === 'rare').length,
      ultraRare: answers.filter((answer) => answer.rarity === 'ultraRare').length,
    },
  };
  const suggestedPar = suggestGolfPar(nameable);
  return {
    prompt,
    rule,
    category,
    answers,
    hints: hintsFor(answers),
    counts,
    qualityWarnings: golfQualityWarnings(prompt, category, counts),
    suggestedPar,
    suggestedTarget: targetForPar(suggestedPar),
  };
}

export function buildGolfHoleFromEvaluation(
  evaluation: GolfRuleEvaluation,
  input: {
    holeNumber: number;
    holeId?: string;
    templateId?: string;
    par?: 2 | 3 | 4;
  }
): GolfHole {
  const par = input.par ?? evaluation.suggestedPar;
  return {
    id: input.holeId ?? `hole-${input.holeNumber}`,
    holeNumber: input.holeNumber,
    par,
    target: targetForPar(par),
    prompt: evaluation.prompt,
    category: evaluation.category,
    answers: evaluation.answers,
    hints: evaluation.hints,
    rule: evaluation.rule,
    ...(input.templateId ? { templateId: input.templateId } : {}),
  };
}

export async function buildGolfHole(input: {
  prompt: string;
  rule: TowerRule;
  holeNumber: number;
  holeId?: string;
  templateId?: string;
  par?: 2 | 3 | 4;
}): Promise<{ hole: GolfHole; evaluation: GolfRuleEvaluation }> {
  const evaluation = await evaluateGolfRule(input.prompt, input.rule);
  return { hole: buildGolfHoleFromEvaluation(evaluation, input), evaluation };
}

/** Pure rule-cooldown gate shared by generation and tests. */
export function golfRuleCandidateAllowed(
  rule: TowerRule,
  recentRuleSignatures: ReadonlySet<string>,
  courseRuleSignatures: ReadonlySet<string>
): boolean {
  const signature = golfRuleSignature(rule);
  return !recentRuleSignatures.has(signature) && !courseRuleSignatures.has(signature);
}

export async function generateFootballGolfCourse(
  date: string,
  opts?: {
    recentPromptsOverride?: Set<string>;
    recentRuleSignaturesOverride?: Set<string>;
  }
): Promise<FootballGolfPuzzle> {
  // Source prompts: active player prompts from the bank (closed-set + rule-based).
  const prompts = (await db.execute(sql`
    SELECT id, prompt, rule FROM tower_prompts WHERE status = 'active' AND answer_type = 'player'
  `)) as unknown as Array<{ id: string; prompt: string; rule: TowerRule }>;

  // Repeat suppression: prompts used in the last 28 days are excluded; if the bank can't fill a
  // course under that window (too many prompts also fail the quality thresholds), shrink it
  // rather than fail the day.
  const fullAvoid = opts?.recentPromptsOverride
    ?? (await recentGolfPrompts(date, GOLF_PROMPT_REPEAT_WINDOW_DAYS));
  const shorterAvoid = opts?.recentPromptsOverride ?? null;
  const ruleAvoid = opts?.recentRuleSignaturesOverride
    ?? (await recentGolfRuleSignatures(date, GOLF_RULE_REPEAT_WINDOW_DAYS));

  // Deterministic daily shuffle, with fun trivia categories ahead of filter stacks.
  const seed = hashStr(`${date}:golf`);
  const ordered = prompts
    .map((p, i) => {
      const normalized = { ...p, prompt: golfPromptCopy(p.prompt) };
      const category = categoryFor(normalized.rule, normalized.prompt);
      const priority = golfPromptPriority(category, normalized.rule, normalized.prompt);
      return {
        p: normalized,
        priority,
        k: hashStr(`${seed}:${i}:${normalized.prompt}`),
      };
    })
    .sort((a, b) => a.priority - b.priority || a.k - b.k)
    .map((x) => x.p);

  let candidates = await scanCandidates(ordered, fullAvoid, ruleAvoid, {
    allowGeography: false,
    allowDullFilters: false,
  });
  if (candidates.length < FOOTBALL_GOLF_HOLE_COUNT) {
    for (const window of [14, 7, 0]) {
      const avoid = shorterAvoid
        ?? (window > 0 ? await recentGolfPrompts(date, window) : new Set<string>());
      candidates = await scanCandidates(
        ordered,
        window > 0 ? avoid : new Set<string>(),
        ruleAvoid,
        { allowGeography: false, allowDullFilters: false }
      );
      if (candidates.length >= FOOTBALL_GOLF_HOLE_COUNT) break;
    }
  }
  // Last resorts only if the fun bank is thin for this date window.
  if (candidates.length < FOOTBALL_GOLF_HOLE_COUNT) {
    candidates = await scanCandidates(ordered, new Set<string>(), ruleAvoid, {
      allowGeography: false,
      allowDullFilters: true,
    });
  }
  if (candidates.length < FOOTBALL_GOLF_HOLE_COUNT) {
    candidates = await scanCandidates(ordered, new Set<string>(), ruleAvoid, {
      allowGeography: true,
      allowDullFilters: true,
    });
  }

  if (candidates.length < FOOTBALL_GOLF_HOLE_COUNT) {
    throw new Error(
      `Only ${candidates.length} golf candidates for ${date} (need exactly ${FOOTBALL_GOLF_HOLE_COUNT})`
    );
  }

  // Assign pars: broadest prompts get the highest pars, and every par is CLAMPED to
  // (famous − 2) so the hole is always completable from common knowledge.
  const chosen = candidates
    .slice(0, FOOTBALL_GOLF_HOLE_COUNT)
    .sort((a, b) => b.famous - a.famous);
  const parsDesc = [...PAR_SEQUENCE].sort((a, b) => b - a); // [4,4,3,3,2]
  const withPar = chosen.map((c, i) => {
    const par = Math.max(2, Math.min(MAX_PAR, Math.min(parsDesc[i]!, c.famous - 2))) as 2 | 3 | 4;
    return { ...c, par, target: targetForPar(par) };
  });

  // Re-order holes for the round (deterministic), so pars aren't monotonic.
  withPar.sort((a, b) => hashStr(`${seed}:order:${a.prompt}`) - hashStr(`${seed}:order:${b.prompt}`));

  const holes: GolfHole[] = withPar.map((candidate, index) => ({
    id: `${date}-h${index + 1}`,
    holeNumber: index + 1,
    par: candidate.par,
    target: candidate.target,
    prompt: candidate.prompt,
    category: categoryFor(candidate.rule, candidate.prompt),
    answers: candidate.answers,
    hints: hintsFor(candidate.answers),
    rule: candidate.rule,
    templateId: candidate.templateId,
  }));

  const totalPar = holes.reduce((s, h) => s + h.par, 0);
  return { modeId: 'football_golf', puzzleId: `${date}-football_golf`, date, title: 'Daily Football Golf', totalPar, holes };
}

interface ScanOptions {
  allowGeography: boolean;
  allowDullFilters: boolean;
}

const SLOT_TARGETS: Record<GolfCourseSlot, number> = {
  moment: 2,
  clubEra: 1,
  journey: 1,
  wildcard: 1,
};

function clubsTouchedByRule(rule: TowerRule): string[] {
  const clubs: string[] = [];
  if (Array.isArray(rule.playedFor)) {
    for (const club of rule.playedFor) clubs.push(club.toLowerCase());
  }
  if (rule.clubSeason?.club) clubs.push(rule.clubSeason.club.toLowerCase());
  if (rule.directTransfer) {
    clubs.push(rule.directTransfer.fromClub.toLowerCase());
    clubs.push(rule.directTransfer.toClub.toLowerCase());
  }
  return clubs;
}

function slotHasCapacity(
  slot: GolfCourseSlot | null,
  slotCount: Map<GolfCourseSlot, number>
): boolean {
  if (!slot) return false;
  return (slotCount.get(slot) ?? 0) < SLOT_TARGETS[slot];
}

/** Scan the day's shuffled prompt order, enumerating answers until five quality holes are found. */
async function scanCandidates(
  ordered: Array<{ id: string; prompt: string; rule: TowerRule }>,
  avoid: Set<string>,
  recentRuleSignatures: ReadonlySet<string>,
  opts: ScanOptions
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const usedRuleSignatures = new Set<string>();
  const usedClubs = new Set<string>();
  const catCount = new Map<string, number>();
  const slotCount = new Map<GolfCourseSlot, number>();
  const MAX_PER_CATEGORY = 1;
  let geographyCount = 0;

  // Pass 1 fills the preferred mix; pass 2 tops up with any remaining fun/career prompts.
  for (const pass of ['slots', 'fill'] as const) {
    for (const { id, prompt, rule } of ordered) {
      if (candidates.length >= FOOTBALL_GOLF_HOLE_COUNT) break;
      if (avoid.has(prompt.toLowerCase())) continue;
      if (!golfRuleCandidateAllowed(rule, recentRuleSignatures, usedRuleSignatures)) continue;
      const ruleSignature = golfRuleSignature(rule);
      const clubs = clubsTouchedByRule(rule);
      if (clubs.some((club) => usedClubs.has(club))) continue;

      const cat = categoryFor(rule, prompt);
      if ((catCount.get(cat) ?? 0) >= MAX_PER_CATEGORY) continue;

      const geographyHeavy = isGeographyHeavyGolfRule(rule, cat);
      const dullFilter = isDullFilterGolfRule(rule, cat, prompt);
      if (geographyHeavy && (!opts.allowGeography || geographyCount >= 1)) continue;
      if (dullFilter && !opts.allowDullFilters) continue;

      const slot = golfCourseSlotFor(cat);
      if (pass === 'slots') {
        if (!slotHasCapacity(slot, slotCount)) continue;
      } else if (!slot || geographyHeavy || (dullFilter && !opts.allowDullFilters)) {
        continue;
      }

      let evaluation: GolfRuleEvaluation;
      try {
        evaluation = await evaluateGolfRule(prompt, rule);
      } catch {
        continue;
      }
      const famous = evaluation.counts.nameable;
      // Broad pools make rarity scoring fun — players know many names, then chase deep cuts.
      if (
        famous < minNameableForGolfCategory(cat, prompt)
        || evaluation.answers.length > maxAnswersForGolfCategory(cat)
      ) {
        continue;
      }

      const assignedSlot: GolfCourseSlot =
        pass === 'slots' && slot && slotHasCapacity(slot, slotCount)
          ? slot
          : 'wildcard';

      candidates.push({
        templateId: id,
        prompt,
        rule,
        answers: evaluation.answers,
        famous,
      });
      usedRuleSignatures.add(ruleSignature);
      for (const club of clubs) usedClubs.add(club);
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
      slotCount.set(assignedSlot, (slotCount.get(assignedSlot) ?? 0) + 1);
      if (geographyHeavy) geographyCount += 1;
    }
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
