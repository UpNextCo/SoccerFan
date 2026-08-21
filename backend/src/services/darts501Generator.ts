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
import { intlCapsSub, trustedIntlGoalsSql } from './statMetrics.js';
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

export type Darts501Pool =
  | { kind: 'nationality'; nationality: string; aliases?: string[] }
  | { kind: 'league'; leagueId: number; leagueName: string }
  | { kind: 'club'; club: string; teamId?: number; leagueName?: string }
  | { kind: 'international' };

export interface Darts501Formula {
  id: string;
  label: string;
  left: string;
  op: '+' | '-';
  right: string;
  pool: Darts501Pool;
}

export interface Darts501Presentation {
  nationality: string | null;
  leagueName: string | null;
  club: string | null;
  clubLeague: string | null;
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
  leagueName: string | null;
  club: string | null;
  clubLeague: string | null;
  audience: string;
  formulaDetail: string;
  left?: string;
  op?: '+' | '-';
  right?: string;
  pool?: Darts501Pool;
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
  pl_yellows: 'Premier League yellow cards',
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

function audienceForPool(pool: Darts501Pool): string {
  if (pool.kind === 'nationality') {
    return AUDIENCE_COPY[pool.nationality] ?? `${pool.nationality} Players`;
  }
  if (pool.kind === 'league') return `${pool.leagueName} Players`;
  if (pool.kind === 'club') return `${pool.club} Players`;
  return 'International Players';
}

export function presentDarts501Formula(formula: Darts501Formula): Darts501Presentation {
  const left = METRIC_COPY[formula.left] ?? formula.left.replaceAll('_', ' ');
  const right = METRIC_COPY[formula.right] ?? formula.right.replaceAll('_', ' ');
  const op = formula.op === '+' ? '+' : '−';
  const pool = formula.pool;
  return {
    nationality: pool.kind === 'nationality' ? pool.nationality : null,
    leagueName: pool.kind === 'league' ? pool.leagueName : null,
    club: pool.kind === 'club' ? pool.club : null,
    clubLeague: pool.kind === 'club' ? (pool.leagueName ?? null) : null,
    audience: audienceForPool(pool),
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
    leagueName: presentation.leagueName,
    club: presentation.club,
    clubLeague: presentation.clubLeague,
    audience: presentation.audience,
    formulaDetail: presentation.formulaDetail,
    left: formula.left,
    op: formula.op,
    right: formula.right,
    pool: formula.pool,
    startScore: DARTS501_START,
    checkoutWindow: DARTS501_CHECKOUT_WINDOW,
    checkoutLives: DARTS501_CHECKOUT_LIVES,
  };
}

const plYellowsSub: SQL = sql`(SELECT player_id, SUM(yellow_cards)::int AS value
  FROM player_stats WHERE league_id = 39 GROUP BY player_id)`;

function metricDef(id: string): MetricDef | undefined {
  if (id === 'intl_goals') {
    return { id, label: 'International Goals', sub: intlGoalsSub };
  }
  if (id === 'pl_yellows') {
    return { id, label: 'Premier League Yellow Cards', sub: plYellowsSub };
  }
  const category = targetCategoryById(id);
  if (!category) return undefined;
  return { id, label: category.label, sub: category.sub };
}

const nation = (nationality: string, aliases?: string[]): Darts501Pool =>
  aliases ? { kind: 'nationality', nationality, aliases } : { kind: 'nationality', nationality };
const league = (leagueId: number, leagueName: string): Darts501Pool => ({
  kind: 'league',
  leagueId,
  leagueName,
});

const PL = league(39, 'Premier League');
const LL = league(140, 'La Liga');
const SA = league(135, 'Serie A');
const CL = league(2, 'Champions League');
const WC = league(1, 'World Cup');
const INTL: Darts501Pool = { kind: 'international' };
const chelsea: Darts501Pool = {
  kind: 'club',
  club: 'Chelsea',
  teamId: 49,
  leagueName: 'Premier League',
};

/** Curated formulas. Every one has a pool (nation / league / club) plus a formula under it. */
export const DARTS501_FORMULAS: Darts501Formula[] = [
  {
    id: 'pl_apps_minus_goals_wales',
    label: 'Premier League Appearances − Goals from Wales',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    pool: nation('Wales'),
  },
  {
    id: 'cl_apps_plus_intl_goals',
    label: 'Champions League Appearances + International Goals',
    left: 'cl_apps',
    op: '+',
    right: 'intl_goals',
    pool: CL,
  },
  {
    id: 'pl_goals_plus_england_caps',
    label: 'Premier League Goals + England Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('England'),
  },
  {
    id: 'pl_apps_minus_goals_scotland',
    label: 'Premier League Appearances − Goals from Scotland',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    pool: nation('Scotland'),
  },
  {
    id: 'pl_apps_minus_goals_ireland',
    label: 'Premier League Appearances − Goals from Ireland',
    left: 'pl_apps',
    op: '-',
    right: 'career_goals',
    pool: nation('Ireland', ['Republic of Ireland', 'Ireland']),
  },
  {
    id: 'pl_apps_minus_pl_goals_nireland',
    label: 'Premier League Appearances − Premier League Goals from Northern Ireland',
    left: 'pl_apps',
    op: '-',
    right: 'pl_goals',
    pool: nation('Northern Ireland'),
  },
  {
    id: 'laliga_goals_plus_spain_caps',
    label: 'La Liga Goals + Spain Caps',
    left: 'laliga_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('Spain'),
  },
  {
    id: 'seriea_goals_plus_italy_caps',
    label: 'Serie A Goals + Italy Caps',
    left: 'seriea_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('Italy'),
  },
  {
    id: 'bundesliga_goals_plus_germany_caps',
    label: 'Bundesliga Goals + Germany Caps',
    left: 'bundesliga_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('Germany'),
  },
  {
    id: 'ligue1_goals_plus_france_caps',
    label: 'Ligue 1 Goals + France Caps',
    left: 'ligue1_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('France'),
  },
  {
    id: 'pl_goals_plus_france_caps',
    label: 'Premier League Goals + France Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('France'),
  },
  {
    id: 'pl_goals_plus_brazil_caps',
    label: 'Premier League Goals + Brazil Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('Brazil'),
  },
  {
    id: 'pl_assists_plus_england_caps',
    label: 'Premier League Assists + England Caps',
    left: 'pl_assists',
    op: '+',
    right: 'intl_caps',
    pool: nation('England'),
  },
  {
    id: 'cl_goals_plus_intl_goals',
    label: 'Champions League Goals + International Goals',
    left: 'cl_goals',
    op: '+',
    right: 'intl_goals',
    pool: CL,
  },
  {
    id: 'pl_goals_plus_cl_goals',
    label: 'Premier League Goals + Champions League Goals',
    left: 'pl_goals',
    op: '+',
    right: 'cl_goals',
    pool: PL,
  },
  {
    id: 'cl_apps_minus_cl_goals',
    label: 'Champions League Appearances − Champions League Goals',
    left: 'cl_apps',
    op: '-',
    right: 'cl_goals',
    pool: CL,
  },
  {
    id: 'pl_goals_plus_intl_goals',
    label: 'Premier League Goals + International Goals',
    left: 'pl_goals',
    op: '+',
    right: 'intl_goals',
    pool: PL,
  },
  {
    id: 'laliga_goals_plus_cl_goals',
    label: 'La Liga Goals + Champions League Goals',
    left: 'laliga_goals',
    op: '+',
    right: 'cl_goals',
    pool: LL,
  },
  {
    id: 'career_trophies_plus_intl_goals',
    label: 'Career Trophies + International Goals',
    left: 'career_trophies',
    op: '+',
    right: 'intl_goals',
    pool: INTL,
  },
  {
    id: 'cl_apps_plus_portugal_caps',
    label: 'Champions League Appearances + Portugal Caps',
    left: 'cl_apps',
    op: '+',
    right: 'intl_caps',
    pool: nation('Portugal'),
  },
  {
    id: 'cl_apps_plus_netherlands_caps',
    label: 'Champions League Appearances + Netherlands Caps',
    left: 'cl_apps',
    op: '+',
    right: 'intl_caps',
    pool: nation('Netherlands'),
  },
  {
    id: 'seriea_goals_plus_cl_goals',
    label: 'Serie A Goals + Champions League Goals',
    left: 'seriea_goals',
    op: '+',
    right: 'cl_goals',
    pool: SA,
  },
  {
    id: 'pl_assists_plus_cl_assists',
    label: 'Premier League Assists + Champions League Assists',
    left: 'pl_assists',
    op: '+',
    right: 'cl_assists',
    pool: PL,
  },
  {
    id: 'wc_goals_plus_cl_goals',
    label: 'World Cup Goals + Champions League Goals',
    left: 'wc_goals',
    op: '+',
    right: 'cl_goals',
    pool: WC,
  },
  {
    id: 'intl_caps_minus_intl_goals_brazil',
    label: 'International Caps − International Goals from Brazil',
    left: 'intl_caps',
    op: '-',
    right: 'intl_goals',
    pool: nation('Brazil'),
  },
  {
    id: 'intl_caps_minus_intl_goals_argentina',
    label: 'International Caps − International Goals from Argentina',
    left: 'intl_caps',
    op: '-',
    right: 'intl_goals',
    pool: nation('Argentina'),
  },
  {
    id: 'pl_goals_plus_scotland_caps',
    label: 'Premier League Goals + Scotland Caps',
    left: 'pl_goals',
    op: '+',
    right: 'intl_caps',
    pool: nation('Scotland'),
  },
  {
    id: 'pl_apps_minus_pl_goals_wales',
    label: 'Premier League Appearances − Premier League Goals from Wales',
    left: 'pl_apps',
    op: '-',
    right: 'pl_goals',
    pool: nation('Wales'),
  },
  {
    id: 'pl_apps_minus_yellows_chelsea',
    label: 'Premier League Appearances − Yellow Cards from Chelsea',
    left: 'pl_apps',
    op: '-',
    right: 'pl_yellows',
    pool: chelsea,
  },
];

export function darts501FormulaById(id: string): Darts501Formula | undefined {
  return DARTS501_FORMULAS.find((formula) => formula.id === id);
}

export const DARTS501_METRIC_OPTIONS = Object.entries(METRIC_COPY).map(([id, label]) => ({
  id,
  label,
}));

export const DARTS501_LEAGUE_OPTIONS = [
  { leagueId: 39, leagueName: 'Premier League' },
  { leagueId: 140, leagueName: 'La Liga' },
  { leagueId: 135, leagueName: 'Serie A' },
  { leagueId: 78, leagueName: 'Bundesliga' },
  { leagueId: 61, leagueName: 'Ligue 1' },
  { leagueId: 2, leagueName: 'Champions League' },
  { leagueId: 1, leagueName: 'World Cup' },
] as const;

export const DARTS501_NATION_OPTIONS = Object.keys(AUDIENCE_COPY);

export function parseDarts501Pool(raw: unknown): Darts501Pool | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'nationality' && typeof value.nationality === 'string' && value.nationality.trim()) {
    const aliases = Array.isArray(value.aliases)
      ? value.aliases.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      : undefined;
    return { kind: 'nationality', nationality: value.nationality.trim(), aliases };
  }
  if (value.kind === 'league' && typeof value.leagueId === 'number' && typeof value.leagueName === 'string') {
    return { kind: 'league', leagueId: value.leagueId, leagueName: value.leagueName };
  }
  if (value.kind === 'club' && typeof value.club === 'string' && value.club.trim()) {
    return {
      kind: 'club',
      club: value.club.trim(),
      teamId: typeof value.teamId === 'number' ? value.teamId : undefined,
      leagueName: typeof value.leagueName === 'string' ? value.leagueName : undefined,
    };
  }
  if (value.kind === 'international') return { kind: 'international' };
  return null;
}

function poolsEqual(left: Darts501Pool, right: Darts501Pool): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'nationality' && right.kind === 'nationality') {
    return left.nationality.toLowerCase() === right.nationality.toLowerCase();
  }
  if (left.kind === 'league' && right.kind === 'league') return left.leagueId === right.leagueId;
  if (left.kind === 'club' && right.kind === 'club') {
    if (left.teamId && right.teamId) return left.teamId === right.teamId;
    return left.club.toLowerCase() === right.club.toLowerCase();
  }
  return true;
}

function poolFromPresentation(puzzle: Pick<
  Darts501PuzzlePublic,
  'nationality' | 'leagueName' | 'club' | 'clubLeague' | 'audience'
>): Darts501Pool | null {
  if (puzzle.nationality) return { kind: 'nationality', nationality: puzzle.nationality };
  if (puzzle.club) {
    return { kind: 'club', club: puzzle.club, leagueName: puzzle.clubLeague ?? undefined };
  }
  if (puzzle.leagueName) {
    const league = DARTS501_LEAGUE_OPTIONS.find((row) => row.leagueName === puzzle.leagueName);
    if (league) return { kind: 'league', leagueId: league.leagueId, leagueName: league.leagueName };
  }
  if (puzzle.audience === 'International Players') return { kind: 'international' };
  return null;
}

export function composeDarts501Formula(input: {
  left: string;
  op: '+' | '-';
  right: string;
  pool: Darts501Pool;
}): Darts501Formula | null {
  if (!metricDef(input.left) || !metricDef(input.right)) return null;
  const catalog = DARTS501_FORMULAS.find(
    (formula) =>
      formula.left === input.left &&
      formula.op === input.op &&
      formula.right === input.right &&
      poolsEqual(formula.pool, input.pool)
  );
  const draft: Darts501Formula = {
    id: 'custom',
    label: '',
    left: input.left,
    op: input.op,
    right: input.right,
    pool: input.pool,
  };
  const presented = presentDarts501Formula(draft);
  return {
    id: catalog?.id ?? `custom:${input.left}:${input.op}:${input.right}:${input.pool.kind}`,
    label: catalog?.label ?? `${presented.formulaDetail} from ${presented.audience.replace(/ Players$/i, '')}`,
    left: input.left,
    op: input.op,
    right: input.right,
    pool: input.pool,
  };
}

export function resolveDarts501Formula(puzzle: Darts501PuzzlePublic): Darts501Formula | undefined {
  const pool = parseDarts501Pool(puzzle.pool) ?? poolFromPresentation(puzzle);
  if (puzzle.left && (puzzle.op === '+' || puzzle.op === '-') && puzzle.right && pool) {
    return composeDarts501Formula({ left: puzzle.left, op: puzzle.op, right: puzzle.right, pool }) ?? undefined;
  }
  return darts501FormulaById(puzzle.formulaId);
}

export function darts501AuthoringOptions() {
  return {
    metrics: DARTS501_METRIC_OPTIONS,
    leagues: DARTS501_LEAGUE_OPTIONS,
    nations: DARTS501_NATION_OPTIONS.map((nationality) => ({
      nationality,
      audience: AUDIENCE_COPY[nationality] ?? `${nationality} Players`,
    })),
  };
}

export type Darts501PoolPlayer = {
  id: string;
  name: string;
  club: string;
  nationality: string;
  position: string;
  score: number;
  leftValue: number;
  rightValue: number;
  valid: boolean;
  fame: number;
  headshotUrl?: string;
};

export async function previewDarts501Pool(formula: Darts501Formula): Promise<{
  formulaId: string;
  label: string;
  audience: string;
  formulaDetail: string;
  left: string;
  op: '+' | '-';
  right: string;
  pool: Darts501Pool;
  quality: { eligible: number; valid: number; high: number; checkout: number };
  players: Darts501PoolPlayer[];
}> {
  if (!metricDef(formula.left) || !metricDef(formula.right)) {
    throw new Error('Unknown Football 501 metric');
  }
  const rows = await loadFormulaRows(formula);
  const presented = presentDarts501Formula(formula);
  const quality = qualityForRows(formula, rows);
  const players = rows
    .map((row) => {
      const leftValue = Number(row.left_val);
      const rightValue = Number(row.right_val);
      const score = computeFormulaScore(leftValue, rightValue, formula.op);
      return {
        id: row.id,
        name: row.name,
        club: row.club,
        nationality: row.nationality,
        position: row.position,
        score,
        leftValue,
        rightValue,
        valid: isValidDartsScore(score) && score !== 0,
        fame: row.mvt ?? 0,
        photo_url: row.photo_url,
        api_football_id: row.api_football_id,
      };
    })
    .sort((a, b) => b.fame - a.fame || b.score - a.score || a.name.localeCompare(b.name))
    .map((row, index) => ({
      id: row.id,
      name: row.name,
      club: row.club,
      nationality: row.nationality,
      position: row.position,
      score: row.score,
      leftValue: row.leftValue,
      rightValue: row.rightValue,
      valid: row.valid,
      fame: row.fame,
      headshotUrl: index < 80 ? resolveHeadshot(row.photo_url, row.api_football_id) ?? undefined : undefined,
    }));

  return {
    formulaId: formula.id,
    label: formula.label,
    audience: presented.audience,
    formulaDetail: presented.formulaDetail,
    left: formula.left,
    op: formula.op,
    right: formula.right,
    pool: formula.pool,
    quality: {
      eligible: quality.eligible,
      valid: quality.valid,
      high: quality.high,
      checkout: quality.checkout,
    },
    players,
  };
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

function poolPredicate(formula: Darts501Formula): SQL {
  const pool = formula.pool;
  if (pool.kind === 'nationality') {
    const names = [pool.nationality, ...(pool.aliases ?? [])].map((name) => name.toLowerCase());
    return sql`lower(p.nationality) IN (${sql.join(
      names.map((name) => sql`${name}`),
      sql`, `
    )})`;
  }
  if (pool.kind === 'league') {
    return sql`EXISTS (
      SELECT 1 FROM player_stats s
      WHERE s.player_id = p.id AND s.league_id = ${pool.leagueId} AND s.appearances > 0
    )`;
  }
  if (pool.kind === 'club') {
    const teamId = pool.teamId;
    const clubMatch =
      typeof teamId === 'number'
        ? sql`(s.team_name = ${pool.club} OR s.team_id = ${teamId})`
        : sql`s.team_name = ${pool.club}`;
    const careerMatch =
      typeof teamId === 'number'
        ? sql`(c.team_name = ${pool.club} OR c.team_id = ${teamId})`
        : sql`c.team_name = ${pool.club}`;
    return sql`(
      EXISTS (
        SELECT 1 FROM player_stats s
        WHERE s.player_id = p.id AND s.appearances > 0 AND ${clubMatch}
      )
      OR EXISTS (
        SELECT 1 FROM player_career c
        WHERE c.player_id = p.id AND c.team_id > 0 AND ${careerMatch}
      )
    )`;
  }
  return sql`EXISTS (
    SELECT 1 FROM ${intlCapsSub} caps WHERE caps.player_id = p.id AND caps.value > 0
  )`;
}

function poolFilter(formula: Darts501Formula): SQL {
  return sql`AND ${poolPredicate(formula)}`;
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
  mvt?: number;
}

async function loadFormulaRows(formula: Darts501Formula): Promise<FormulaRow[]> {
  const left = metricDef(formula.left);
  const right = metricDef(formula.right);
  if (!left || !right) return [];

  const rows = (await db.execute(sql`
    SELECT p.id::text AS id, p.name, COALESCE(p.current_club, '') AS club,
           COALESCE(p.nationality, '') AS nationality, COALESCE(p.position, '') AS position,
           p.photo_url, p.api_football_id, COALESCE(p.market_value_tier, 0)::int AS mvt,
           COALESCE(l.value, 0)::int AS left_val,
           COALESCE(r.value, 0)::int AS right_val
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.external_id IS NOT NULL
      ${poolFilter(formula)}
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
  const pool =
    parseDarts501Pool(puzzle.pool) ?? poolFromPresentation(puzzle as Darts501PuzzlePublic);
  const composed =
    puzzle.left && (puzzle.op === '+' || puzzle.op === '-') && puzzle.right && pool
      ? composeDarts501Formula({
          left: puzzle.left,
          op: puzzle.op,
          right: puzzle.right,
          pool,
        })
      : null;
  const formula = composed ?? darts501FormulaById(puzzle.formulaId);
  const presentation = formula ? presentDarts501Formula(formula) : null;
  return {
    modeId: DARTS501_MODE_ID,
    puzzleId: typeof puzzle.puzzleId === 'string' ? puzzle.puzzleId : `${DARTS501_MODE_ID}`,
    date: typeof puzzle.date === 'string' ? puzzle.date : '',
    formulaId: formula?.id ?? puzzle.formulaId,
    formulaLabel: formula?.label ?? puzzle.formulaLabel,
    nationality:
      typeof puzzle.nationality === 'string'
        ? puzzle.nationality
        : (presentation?.nationality ?? null),
    leagueName:
      typeof puzzle.leagueName === 'string'
        ? puzzle.leagueName
        : (presentation?.leagueName ?? null),
    club: typeof puzzle.club === 'string' ? puzzle.club : (presentation?.club ?? null),
    clubLeague:
      typeof puzzle.clubLeague === 'string'
        ? puzzle.clubLeague
        : (presentation?.clubLeague ?? null),
    audience:
      typeof puzzle.audience === 'string' && puzzle.audience && puzzle.audience !== 'Any player'
        ? puzzle.audience
        : (presentation?.audience ?? 'Players'),
    formulaDetail:
      typeof puzzle.formulaDetail === 'string' && puzzle.formulaDetail
        ? puzzle.formulaDetail
        : (presentation?.formulaDetail ?? puzzle.formulaLabel),
    left: formula?.left ?? puzzle.left,
    op: formula?.op ?? puzzle.op,
    right: formula?.right ?? puzzle.right,
    pool: formula?.pool ?? parseDarts501Pool(puzzle.pool) ?? undefined,
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
  const formula = puzzle ? resolveDarts501Formula(puzzle) : undefined;
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
           COALESCE(r.value, 0)::int AS right_val,
           (${poolPredicate(formula)}) AS in_pool
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.id = ${input.playerId}::uuid
    LIMIT 1
  `)) as unknown as Array<FormulaRow & { in_pool: boolean }>;

  const row = found[0];
  if (!row) {
    return { valid: false, duplicate: false, reason: 'Unknown player' };
  }

  const leftValue = Number(row.left_val ?? 0);
  const rightValue = Number(row.right_val ?? 0);
  const inDataset = leftValue > 0 || rightValue > 0;
  if (!inDataset || !row.in_pool) {
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
    SELECT p.id::text AS id,
           COALESCE(l.value, 0)::int AS left_val,
           COALESCE(r.value, 0)::int AS right_val,
           (${poolPredicate(formula)}) AS in_pool
    FROM players p
    LEFT JOIN ${left.sub} l ON l.player_id = p.id
    LEFT JOIN ${right.sub} r ON r.player_id = p.id
    WHERE p.id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{
    id: string;
    left_val: number;
    right_val: number;
    in_pool: boolean;
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
    const eligible = (leftValue > 0 || rightValue > 0) && Boolean(row.in_pool);
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
  const formula = puzzle ? resolveDarts501Formula(puzzle) : undefined;
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
  const formula = resolveDarts501Formula(puzzle);
  if (!formula) return 0;
  const { rows, window } = await checkoutScoresForFormula(formula, puzzle.checkoutWindow);
  return countCheckoutOptions(rows, remaining, alreadyUsedIds, window);
}
