/**
 * Rebuild LMS answer `reveal` text (and higher/lower correct option) from the current
 * question options — used by Quiz Ops when editors swap players/clubs.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { trustedIntlCapsSql, trustedIntlGoalsSql } from '../statMetrics.js';
import {
  formatHigherLowerValue,
  HIGHER_LOWER_METRICS,
  higherLowerMetricFromPrompt,
  type HigherLowerMetric,
} from './higherLowerCatalog.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LmsRevealQuestion = {
  id: string;
  type: string;
  prompt?: string | null;
  subPrompt?: string | null;
  options: Array<{ id: string; label: string }>;
  presentation?: {
    careerClubs?: Array<{ name: string; note?: 'loan' | string | null }>;
    cluePlayers?: Array<{ name: string }>;
    [k: string]: unknown;
  } | null;
};

export type LmsRevealAnswer = {
  questionId: string;
  correctOptionId: string;
  reveal?: string | null;
};

function playerIdFromOption(questionId: string, optionId: string): string | null {
  const suffix = optionId.startsWith(`${questionId}-`)
    ? optionId.slice(questionId.length + 1)
    : optionId;
  return UUID_RE.test(suffix) ? suffix : null;
}

function careerPathLabel(clubs: Array<{ name: string; note?: 'loan' | string | null }>): string {
  return clubs
    .filter((club) => club.name.trim())
    .map((club) => `${club.name}${club.note === 'loan' ? ' (loan)' : ''}`)
    .join(' → ');
}

async function metricValuesForPlayers(
  metric: HigherLowerMetric,
  playerIds: string[]
): Promise<Map<string, { name: string; val: number }>> {
  if (playerIds.length === 0) return new Map();
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
        COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id = 39), 0)::int AS pl_assists,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 140), 0)::int AS laliga_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 140), 0)::int AS laliga_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 135), 0)::int AS seriea_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 135), 0)::int AS seriea_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 78), 0)::int AS bundesliga_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 78), 0)::int AS bundesliga_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS big5_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS big5_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
        COALESCE(p.peak_market_value_eur, 0)::int AS peak_value,
        COALESCE(p.record_fee_eur, 0)::int AS record_fee,
        CASE WHEN ${trustedIntlCapsSql('es')} BETWEEN 30 AND 280 THEN ${trustedIntlCapsSql('es')} ELSE 0 END::int AS intl_caps,
        CASE WHEN ${trustedIntlGoalsSql('es')} BETWEEN 1 AND 150 THEN ${trustedIntlGoalsSql('es')} ELSE 0 END::int AS intl_goals
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats es ON es.player_id = p.id
      WHERE p.id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
      GROUP BY p.id, p.name, p.peak_market_value_eur, p.record_fee_eur,
        es.intl_caps, es.intl_goals, es.tm_intl_caps, es.tm_intl_goals
    )
    SELECT id, name, ${sql.raw(metric.col)} AS val
    FROM agg
  `)) as unknown as Array<{ id: string; name: string; val: number }>;

  return new Map(rows.map((row) => [row.id, { name: row.name, val: Number(row.val) || 0 }]));
}

async function recomputeHigherLower(
  question: LmsRevealQuestion,
  answer: LmsRevealAnswer
): Promise<LmsRevealAnswer> {
  const metricId = higherLowerMetricFromPrompt(question.prompt ?? '');
  const metric = HIGHER_LOWER_METRICS.find((m) => m.id === metricId);
  if (!metric) {
    const correct = question.options.find((o) => o.id === answer.correctOptionId);
    return {
      ...answer,
      reveal: correct?.label ?? answer.reveal ?? '',
    };
  }

  const optionPlayers = question.options
    .map((opt) => {
      const playerId = playerIdFromOption(question.id, opt.id);
      return playerId ? { opt, playerId } : null;
    })
    .filter((row): row is { opt: { id: string; label: string }; playerId: string } => row != null);

  if (optionPlayers.length < 2) {
    return { ...answer, reveal: answer.reveal ?? '' };
  }

  const values = await metricValuesForPlayers(
    metric,
    optionPlayers.map((row) => row.playerId)
  );

  const scored = optionPlayers.map(({ opt, playerId }) => {
    const hit = values.get(playerId);
    return {
      optionId: opt.id,
      name: hit?.name || opt.label,
      val: hit?.val ?? 0,
    };
  });

  const ranked = [...scored].sort((a, b) => b.val - a.val || a.name.localeCompare(b.name));
  const hi = ranked[0]!;
  const lo = ranked[1]!;
  const reveal = `${hi.name} (${formatHigherLowerValue(hi.val, metric)}) vs ${lo.name} (${formatHigherLowerValue(lo.val, metric)})`;

  return {
    questionId: answer.questionId,
    correctOptionId: hi.optionId,
    reveal,
  };
}

function recomputeOddOneOut(
  question: LmsRevealQuestion,
  answer: LmsRevealAnswer
): LmsRevealAnswer {
  const correct = question.options.find((o) => o.id === answer.correctOptionId);
  const name = correct?.label?.trim() || 'Correct answer';
  const sub = question.subPrompt?.trim() ?? '';

  const neverClub = sub.match(/^Who never played for (.+)\?$/i);
  if (neverClub?.[1]) {
    return { ...answer, reveal: `${name} never played for ${neverClub[1]}` };
  }

  const neverLeague = sub.match(/^Who never played in the (.+)\?$/i);
  if (neverLeague?.[1]) {
    return { ...answer, reveal: `${name} never played in the ${neverLeague[1]}` };
  }

  const threeLeague = sub.match(/^Three (.+) clubs$/i);
  if (threeLeague?.[1]) {
    return { ...answer, reveal: `${name} — not a ${threeLeague[1]} club` };
  }

  return { ...answer, reveal: name };
}

function recomputeCareerPath(
  question: LmsRevealQuestion,
  answer: LmsRevealAnswer
): LmsRevealAnswer {
  const correct = question.options.find((o) => o.id === answer.correctOptionId);
  const path = careerPathLabel(question.presentation?.careerClubs ?? []);
  if (!correct?.label) return { ...answer, reveal: path || answer.reveal || '' };
  if (!path) return { ...answer, reveal: correct.label };
  return { ...answer, reveal: `${correct.label} — ${path}` };
}

function recomputeWhichClub(
  question: LmsRevealQuestion,
  answer: LmsRevealAnswer
): LmsRevealAnswer {
  const correct = question.options.find((o) => o.id === answer.correctOptionId);
  const club = correct?.label?.trim() || 'Club';
  const names =
    question.presentation?.cluePlayers?.map((p) => p.name).filter(Boolean)
    ?? (question.subPrompt?.split('·').map((s) => s.trim()).filter(Boolean) ?? []);
  if (names.length === 0) return { ...answer, reveal: club };
  return { ...answer, reveal: `${club} (${names.join(', ')})` };
}

/** Rebuild reveal (+ HL correct option) for one LMS question from its current options. */
export async function recomputeLmsQuestionAnswer(
  question: LmsRevealQuestion,
  answer: LmsRevealAnswer
): Promise<LmsRevealAnswer> {
  switch (question.type) {
    case 'higher_lower':
      return recomputeHigherLower(question, answer);
    case 'career_path':
      return recomputeCareerPath(question, answer);
    case 'odd_one_out':
      return recomputeOddOneOut(question, answer);
    case 'which_club':
      return recomputeWhichClub(question, answer);
    case 'image_badge':
    case 'custom_image':
    case 'custom_question':
    default: {
      const correct = question.options.find((o) => o.id === answer.correctOptionId);
      return {
        ...answer,
        reveal: correct?.label ?? answer.reveal ?? '',
      };
    }
  }
}
