/**
 * Darts 501 daily generator.
 *
 * Each day picks a football-stat formula (metric ± metric, optional nationality filter).
 * Eligible players produce a numeric value that is thrown as a darts score.
 * Scores stay hidden until the player commits — search never includes the value.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { trustedIntlGoalsSql } from './statMetrics.js';
import { targetCategoryById } from './targetManCategories.js';
import { recentDarts501Formulas } from './puzzleHistory.js';
import {
  clampPlayerValue,
  countCheckoutOptions,
  DARTS501_CHECKOUT_LIVES,
  DARTS501_CHECKOUT_WINDOW,
  DARTS501_START,
  isValidDartsScore,
} from './darts501Scoring.js';

export const DARTS501_MODE_ID = 'darts_501';
const REPEAT_WINDOW_DAYS = 21;
const MIN_ELIGIBLE = 28;
const MIN_VALID = 12;
const MIN_HIGH = 2;
const MIN_CHECKOUT = 4;

export interface Darts501Formula {
  id: string;
  label: string;
  left: string;
  op: '+' | '-';
  right: string;
  nationality?: string;
  nationalityAliases?: string[];
}

export interface Darts501Presentation {
  nationality: string | null;
  audience: string;
  formulaDetail: string;
}

export interface Darts501PuzzlePublic {
  modeId: typeof DARTS501_MODE_ID;
  puzzleId: string;
  date: string;
  formulaId: string;
  formulaLabel: string;
  nationality: string | null;
  audience: string;
  formulaDetail: string;
  startScore: number;
  checkoutWindow: number;
  checkoutLives: number;
}

export interface Darts501ThrowResult {
  valid: boolean;
  duplicate: boolean;
  reason?: string;
  player?: {
    id: string;
    name: string;
    club: string;
    nationality: string;
    position: string;
    headshotUrl?: string;
  };
  score?: number;
  leftValue?: number;
  rightValue?: number;
}

type MetricDef = { id: string; label: string; sub: SQL };

const intlGoalsSub: SQL = sql`(SELECT player_id, ${trustedIntlGoalsSql('e')}::int AS value
  FROM player_extra_stats e)`;

const METRIC_COPY: Record<string, string> = {
  pl_apps: 'Premier League appearances',
  pl_goals: 'Premier League goals',
  pl_assists: 'Premier League assists',
  laliga_goals: 'La Liga goals',
  seriea_goals: 'Serie A goals',
  bundesliga_goals: 'Bundesliga goals',
  ligue1_goals: 'Ligue 1 goals',
  cl_apps: 'Champions League appearances',
  cl_goals: 'Champions League goals',
  cl_assists: 'Champions League assists',
  wc_goals: 'World Cup goals',
  career_goals: 'career goals',
  career_trophies: 'career trophies',
  intl_caps: 'international caps',
  intl_goals: 'international goals',
};

const AUDIENCE_COPY: Record<string, string> = {
  Wales: 'Welsh Players',
  England: 'English Players',
  Scotland: 'Scottish Players',
  Ireland: 'Irish Players',
  'Northern Ireland': 'Northern Irish Players',
  Spain: 'Spanish Players',
  Italy: 'Italian Players',
  Germany: 'German Players',
  France: 'French Players',
  Brazil: 'Brazilian Players',
  Portugal: 'Portuguese Players',
  Netherlands: 'Dutch Players',
  Argentina: 'Argentine Players',
};

export function presentDarts501Formula(formula: Darts501Formula): Darts501Presentation {
  const left = METRIC_COPY[formula.left] ?? formula.left.replaceAll('_', ' ');
  const right = METRIC_COPY[formula.right] ?? formula.right.replaceAll('_', ' ');
  const op = formula.op === '+' ? '+' : '−';
  return {
    nationality: formula.nationality ?? null,
    audience: formula.nationality
      ? (AUDIENCE_COPY[formula.nationality] ?? `${formula.nationality} Players`)
      : 'Any player',
    formulaDetail: `${left} ${op} ${right}`,
  };
}

export function allDarts501PublicPuzzles(date: string): Array<{
  puzzle: Darts501PuzzlePublic;
  answer: { formulaId: string };
}> {
  return DARTS501_FORMULAS.map((formula) => ({
    puzzle: publicPuzzle(date, formula),
    answer: { formulaId: formula.id },
  }));
}

function publicPuzzle(date: string, formula: Darts501Formula): Darts501PuzzlePublic {
  const presentation = presentDarts501Formula(formula);
  return {
    modeId: DARTS501_MODE_ID,
    puzzleId: `${DARTS501_MODE_ID}_${date}`,
    date,
    formulaId: formula.id,
    formulaLabel: formula.label,
    nationality: presentation.nationality,
    audience: presentation.audience,
    formulaDetail: presentation.formulaDetail,
    startScore: DARTS501_START,
    checkoutWindow: DARTS501_CHECKOUT_WINDOW,
    checkoutLives: DARTS501_CHECKOUT_LIVES,
  };
}

function metricDef(id: string): MetricDef | undefined {
  if (id === 'intl_goals') {
    return { id, label: 'International Goals', sub: intlGoalsSub };
  }
  const category = targetCategoryById(id);
  if (!category) return undefined;
  return { id, label: category.label, sub: category.sub };
}

/** Curated formulas. Labels are the only thing the player sees. */
export const DARTS501_FORMULAS: Darts501Formula[] = [
  {
    id: 'pl_apps_minus_goals_wales',
    label: 'Premier League Appearances − Goals from Wales',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    nationality: 'Wales',
  },
  {
    id: 'cl_apps_plus_intl_goals',
    label: 'Champions League Appearances + International Goals',
    left: 'cl_apps',
    op: '+',
    right: 'intl_goals',
  },
  {
    id: 'pl_goals_plus_england_caps',
    label: 'Premier League Goals + England Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'England',
  },
  {
    id: 'pl_apps_minus_goals_scotland',
    label: 'Premier League Appearances − Goals from Scotland',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    nationality: 'Scotland',
  },
  {
    id: 'pl_apps_minus_goals_ireland',
    label: 'Premier League Appearances − Goals from Ireland',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    nationality: 'Ireland',
    nationalityAliases: ['Republic of Ireland', 'Ireland'],
  },
  {
    id: 'pl_apps_minus_pl_goals_nireland',
    label: 'Premier League Appearances − Premier League Goals from Northern Ireland',
    left: 'pl_apps',
    op: '-',
    right: 'pl_goals',
    nationality: 'Northern Ireland',
  },
  {
    id: 'laliga_goals_plus_spain_caps',
    label: 'La Liga Goals + Spain Caps',
    left: 'laliga_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'Spain',
  },
  {
    id: 'seriea_goals_plus_italy_caps',
    label: 'Serie A Goals + Italy Caps',
    left: 'seriea_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'Italy',
  },
  {
    id: 'bundesliga_goals_plus_germany_caps',
    label: 'Bundesliga Goals + Germany Caps',
    left: 'bundesliga_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'Germany',
  },
  {
    id: 'ligue1_goals_plus_france_caps',
    label: 'Ligue 1 Goals + France Caps',
    left: 'ligue1_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'France',
  },
  {
    id: 'pl_goals_plus_france_caps',
    label: 'Premier League Goals + France Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'France',
  },
  {
    id: 'pl_goals_plus_brazil_caps',
    label: 'Premier League Goals + Brazil Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'Brazil',
  },
  {
    id: 'pl_assists_plus_england_caps',
    label: 'Premier League Assists + England Caps',
    left: 'pl_assists',
    op: '+',
    right: 'intl_caps',
    nationality: 'England',
  },
  {
    id: 'cl_goals_plus_intl_goals',
    label: 'Champions League Goals + International Goals',
    left: 'cl_goals',
    op: '+',
    right: 'intl_goals',
  },
  {
    id: 'pl_goals_plus_cl_goals',
    label: 'Premier League Goals + Champions League Goals',
    left: 'pl_goals',
    op: '+',
    right: 'cl_goals',
  },
  {
    id: 'cl_apps_minus_cl_goals',
    label: 'Champions League Appearances − Champions League Goals',
    left: 'cl_apps',
    op: '-',
    right: 'cl_goals',
  },
  {
    id: 'pl_goals_plus_intl_goals',
    label: 'Premier League Goals + International Goals',
    left: 'pl_goals',
    op: '+',
    right: 'intl_goals',
  },
  {
    id: 'laliga_goals_plus_cl_goals',
    label: 'La Liga Goals + Champions League Goals',
    left: 'laliga_goals',
    op: '+',
    right: 'cl_goals',
  },
  {
    id: 'career_trophies_plus_intl_goals',
    label: 'Career Trophies + International Goals',
    left: 'career_trophies',
    op: '+',
    right: 'intl_goals',
  },
  {
    id: 'cl_apps_plus_portugal_caps',
    label: 'Champions League Appearances + Portugal Caps',
    left: 'cl_apps',
    op: '+',
    right: 'intl_caps',
    nationality: 'Portugal',
  },
  {
    id: 'cl_apps_plus_netherlands_caps',
    label: 'Champions League Appearances + Netherlands Caps',
    left: 'cl_apps',
    op: '+',
    right: 'intl_caps',
    nationality: 'Netherlands',
  },
  {
    id: 'seriea_goals_plus_cl_goals',
    label: 'Serie A Goals + Champions League Goals',
    left: 'seriea_goals',
    op: '+',
    right: 'cl_goals',
  },
  {
    id: 'pl_assists_plus_cl_assists',
    label: 'Premier League Assists + Champions League Assists',
    left: 'pl_assists',
    op: '+',
    right: 'cl_assists',
  },
  {
    id: 'wc_goals_plus_cl_goals',
    label: 'World Cup Goals + Champions League Goals',
    left: 'wc_goals',
    op: '+',
    right: 'cl_goals',
  },
  {
    id: 'intl_caps_minus_intl_goals_brazil',
    label: 'International Caps − International Goals from Brazil',
    left: 'intl_caps',
    op: '-',
    right: 'intl_goals',
    nationality: 'Brazil',
  },
  {
    id: 'intl_caps_minus_intl_goals_argentina',
    label: 'International Caps − International Goals from Argentina',
    left: 'intl_caps',
    op: '-',
    right: 'intl_goals',
    nationality: 'Argentina',
  },
  {
    id: 'pl_goals_plus_scotland_caps',
    label: 'Premier League Goals + Scotland Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    nationality: 'Scotland',
  },
  {
    id: 'pl_apps_minus_pl_goals_wales',
    label: 'Premier League Appearances − Premier League Goals from Wales',
    left: 'pl_apps',
    op: '-',
    right: 'pl_goals',
    nationality: 'Wales',
  },
];

export function darts501FormulaById(id: string): Darts501Formula | undefined {
  return DARTS501_FORMULAS.find((formula) => formula.id === id);
}

export function computeFormulaScore(left: number, right: number, op: '+' | '-'): number {
  const raw = op === '+' ? left + right : left - right;
  return clampPlayerValue(raw);
}

function hashStr(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function nationalityFilter(formula: Darts501Formula): SQL {
  if (!formula.nationality) return sql``;
  const names = [formula.nationality, ...(formula.nationalityAliases ?? [])].map((name) =>
    name.toLowerCase()
  );
  return sql`AND lower(p.nationality) IN (${sql.join(
    names.map((name) => sql`${name}`),
    sql`, `
  )})`;
}

function playerMatchesNationality(
  nationality: string | null | undefined,
  formula: Darts501Formula
): boolean {
  if (!formula.nationality) return true;
  const value = (nationality ?? '').trim().toLowerCase();
  if (!value) return false;
  const names = [formula.nationality, ...(formula.nationalityAliases ?? [])].map((name) =>
    name.toLowerCase()
  );
  return names.includes(value);
}

interface FormulaRow {
  id: string;
  name: string;
  club: string;
  nationality: string;
  position: string;
  photo_url: string | null;
  api_football_id: number | null;
  left_val: number;
  right_val: number;
}

async function loadFormulaRows(formula: Darts501Formula): Promise<FormulaRow[]> {
  const left = metricDef(formula.left);
  const right = metricDef(formula.right);
  if (!left || !right) return [];

  const rows = (await db.execute(sql`
    SELECT p.id::text AS id, p.name, COALESCE(p.current_club, '') AS club,
           COALESCE(p.nationality, '') AS nationality, COALESCE(p.position, '') AS position,
           p.photo_url, p.api_football_id,
           COALESCE(l.value, 0)::int AS left_val,
           COALESCE(r.value, 0)::int AS right_val
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.external_id IS NOT NULL
      ${nationalityFilter(formula)}
      AND (COALESCE(l.value, 0) > 0 OR COALESCE(r.value, 0) > 0)
  `)) as unknown as FormulaRow[];

  return rows;
}

interface FormulaQuality {
  formula: Darts501Formula;
  eligible: number;
  valid: number;
  high: number;
  checkout: number;
}

function qualityForRows(formula: Darts501Formula, rows: FormulaRow[]): FormulaQuality {
  let valid = 0;
  let high = 0;
  let checkout = 0;
  for (const row of rows) {
    const score = computeFormulaScore(Number(row.left_val), Number(row.right_val), formula.op);
    if (!isValidDartsScore(score) || score === 0) continue;
    valid += 1;
    if (score >= 100) high += 1;
    if (score >= 1 && score <= 80) checkout += 1;
  }
  return { formula, eligible: rows.length, valid, high, checkout };
}

function isHealthy(quality: FormulaQuality): boolean {
  return (
    quality.eligible >= MIN_ELIGIBLE &&
    quality.valid >= MIN_VALID &&
    quality.high >= MIN_HIGH &&
    quality.checkout >= MIN_CHECKOUT
  );
}

async function recentFormulaIds(date: string): Promise<Set<string>> {
  return recentDarts501Formulas(date, REPEAT_WINDOW_DAYS);
}

export async function generateDarts501Puzzle(
  date: string,
  opts?: { seedKey?: string }
): Promise<{
  puzzle: Darts501PuzzlePublic;
  answer: { formulaId: string };
} | null> {
  const recent = opts?.seedKey ? new Set<string>() : await recentFormulaIds(date);
  const start = hashStr(opts?.seedKey ?? date) % DARTS501_FORMULAS.length;
  const ordered = [
    ...DARTS501_FORMULAS.slice(start),
    ...DARTS501_FORMULAS.slice(0, start),
  ];

  let fallback: FormulaQuality | null = null;

  for (const skipRecent of [true, false]) {
    for (const formula of ordered) {
      if (skipRecent && recent.has(formula.id)) continue;
      if (!metricDef(formula.left) || !metricDef(formula.right)) continue;
      const rows = await loadFormulaRows(formula);
      const quality = qualityForRows(formula, rows);
      if (!fallback || quality.valid > fallback.valid) fallback = quality;
      if (!isHealthy(quality)) continue;
      return {
        puzzle: publicPuzzle(date, formula),
        answer: { formulaId: formula.id },
      };
    }
  }

  if (fallback && fallback.valid >= 8) {
    return {
      puzzle: publicPuzzle(date, fallback.formula),
      answer: { formulaId: fallback.formula.id },
    };
  }

  return null;
}

export function parseDarts501Puzzle(puzzleJson: unknown): Darts501PuzzlePublic | null {
  if (!puzzleJson || typeof puzzleJson !== 'object') return null;
  const puzzle = puzzleJson as Partial<Darts501PuzzlePublic>;
  if (typeof puzzle.formulaId !== 'string' || !puzzle.formulaId) return null;
  if (typeof puzzle.formulaLabel !== 'string' || !puzzle.formulaLabel) return null;
  const formula = darts501FormulaById(puzzle.formulaId);
  const presentation = formula ? presentDarts501Formula(formula) : null;
  return {
    modeId: DARTS501_MODE_ID,
    puzzleId: typeof puzzle.puzzleId === 'string' ? puzzle.puzzleId : `${DARTS501_MODE_ID}`,
    date: typeof puzzle.date === 'string' ? puzzle.date : '',
    formulaId: puzzle.formulaId,
    formulaLabel: puzzle.formulaLabel,
    nationality:
      typeof puzzle.nationality === 'string'
        ? puzzle.nationality
        : (presentation?.nationality ?? null),
    audience:
      typeof puzzle.audience === 'string' && puzzle.audience
        ? puzzle.audience
        : (presentation?.audience ?? 'Any player'),
    formulaDetail:
      typeof puzzle.formulaDetail === 'string' && puzzle.formulaDetail
        ? puzzle.formulaDetail
        : (presentation?.formulaDetail ?? puzzle.formulaLabel),
    startScore: typeof puzzle.startScore === 'number' ? puzzle.startScore : DARTS501_START,
    checkoutWindow:
      typeof puzzle.checkoutWindow === 'number' ? puzzle.checkoutWindow : DARTS501_CHECKOUT_WINDOW,
    checkoutLives:
      typeof puzzle.checkoutLives === 'number' ? puzzle.checkoutLives : DARTS501_CHECKOUT_LIVES,
  };
}

export async function evaluateDarts501Throw(input: {
  date: string;
  playerId: string;
  alreadyUsedIds?: string[];
}): Promise<Darts501ThrowResult> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, input.date), eq(dailyPuzzles.modeId, DARTS501_MODE_ID)))
    .limit(1);

  const puzzle = parseDarts501Puzzle(rows[0]?.puzzleJson);
  const formula = puzzle ? darts501FormulaById(puzzle.formulaId) : undefined;
  if (!puzzle || !formula) {
    throw new Error('No Football 501 puzzle for date');
  }

  if ((input.alreadyUsedIds ?? []).includes(input.playerId)) {
    return { valid: false, duplicate: true, reason: 'Already used' };
  }

  const left = metricDef(formula.left);
  const right = metricDef(formula.right);
  if (!left || !right) {
    throw new Error('Football 501 formula is missing a metric');
  }

  const found = (await db.execute(sql`
    SELECT p.id::text AS id, p.name, COALESCE(p.current_club, '') AS club,
           COALESCE(p.nationality, '') AS nationality, COALESCE(p.position, '') AS position,
           p.photo_url, p.api_football_id,
           COALESCE(l.value, 0)::int AS left_val,
           COALESCE(r.value, 0)::int AS right_val
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.id = ${input.playerId}::uuid
    LIMIT 1
  `)) as unknown as FormulaRow[];

  const row = found[0];
  if (!row) {
    return { valid: false, duplicate: false, reason: 'Unknown player' };
  }

  const leftValue = Number(row.left_val ?? 0);
  const rightValue = Number(row.right_val ?? 0);
  const inDataset = leftValue > 0 || rightValue > 0;
  if (!inDataset || !playerMatchesNationality(row.nationality, formula)) {
    return { valid: false, duplicate: false, reason: "Not in today's category" };
  }

  const score = computeFormulaScore(leftValue, rightValue, formula.op);
  const headshotUrl = resolveHeadshot(row.photo_url, row.api_football_id) ?? undefined;

  return {
    valid: true,
    duplicate: false,
    player: {
      id: row.id,
      name: row.name,
      club: row.club,
      nationality: row.nationality,
      position: row.position,
      headshotUrl,
    },
    score,
    leftValue,
    rightValue,
  };
}

export async function playerValuesForDarts501(
  formula: Darts501Formula,
  playerIds: string[]
): Promise<Map<string, { score: number; eligible: boolean }>> {
  const result = new Map<string, { score: number; eligible: boolean }>();
  if (playerIds.length === 0) return result;

  const left = metricDef(formula.left);
  const right = metricDef(formula.right);
  if (!left || !right) return result;

  const rows = (await db.execute(sql`
    SELECT p.id::text AS id, COALESCE(p.nationality, '') AS nationality,
           COALESCE(l.value, 0)::int AS left_val,
           COALESCE(r.value, 0)::int AS right_val
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{
    id: string;
    nationality: string;
    left_val: number;
    right_val: number;
  }>;

  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of playerIds) {
    const row = byId.get(id);
    if (!row) {
      result.set(id, { score: 0, eligible: false });
      continue;
    }
    const leftValue = Number(row.left_val ?? 0);
    const rightValue = Number(row.right_val ?? 0);
    const eligible =
      (leftValue > 0 || rightValue > 0) && playerMatchesNationality(row.nationality, formula);
    result.set(id, {
      score: computeFormulaScore(leftValue, rightValue, formula.op),
      eligible,
    });
  }
  return result;
}

type CheckoutScoreRow = { id: string; score: number };
let checkoutScoreCache: { key: string; rows: CheckoutScoreRow[] } | null = null;

async function checkoutScoresForFormula(
  formula: Darts501Formula,
  window: number
): Promise<{ rows: CheckoutScoreRow[]; window: number }> {
  if (checkoutScoreCache?.key === formula.id) {
    return { rows: checkoutScoreCache.rows, window };
  }
  const loaded = await loadFormulaRows(formula);
  const rows: CheckoutScoreRow[] = [];
  for (const row of loaded) {
    const score = computeFormulaScore(Number(row.left_val), Number(row.right_val), formula.op);
    if (!isValidDartsScore(score) || score === 0) continue;
    rows.push({ id: row.id, score });
  }
  checkoutScoreCache = { key: formula.id, rows };
  return { rows, window };
}

async function checkoutScoresForDate(date: string): Promise<{
  rows: CheckoutScoreRow[];
  window: number;
}> {
  const found = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, DARTS501_MODE_ID)))
    .limit(1);
  const puzzle = parseDarts501Puzzle(found[0]?.puzzleJson);
  const formula = puzzle ? darts501FormulaById(puzzle.formulaId) : undefined;
  if (!puzzle || !formula) {
    throw new Error('No Football 501 puzzle for date');
  }
  return checkoutScoresForFormula(formula, puzzle.checkoutWindow);
}

export async function countDarts501Checkouts(input: {
  date: string;
  remaining: number;
  alreadyUsedIds?: string[];
}): Promise<{ count: number }> {
  const { rows, window } = await checkoutScoresForDate(input.date);
  return {
    count: countCheckoutOptions(rows, input.remaining, input.alreadyUsedIds ?? [], window),
  };
}

export async function countDarts501CheckoutsForPuzzle(
  puzzle: Darts501PuzzlePublic,
  remaining: number,
  alreadyUsedIds: string[] = []
): Promise<number> {
  const formula = darts501FormulaById(puzzle.formulaId);
  if (!formula) return 0;
  const { rows, window } = await checkoutScoresForFormula(formula, puzzle.checkoutWindow);
  return countCheckoutOptions(rows, remaining, alreadyUsedIds, window);
}
