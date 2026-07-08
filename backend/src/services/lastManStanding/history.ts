import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { dailyPuzzles } from '../../db/schema.js';
import { clubUsedKey, hlPairUsedKey, playerUsedKey } from './recognition.js';
import type { LastManStandingAnswer, LastManStandingPuzzle } from './types.js';

const DEFAULT_LOOKBACK_DAYS = 21;

function playerIdFromOption(questionId: string, optionId: string): string | null {
  if (!optionId.startsWith(`${questionId}-`)) return null;
  const rest = optionId.slice(questionId.length + 1);
  if (rest === 'correct' || rest === 'odd' || rest.startsWith('w') || rest.startsWith('m')) return null;
  if (/^\d+$/.test(rest)) return null;
  return rest;
}

function hlMetricFromPrompt(prompt: string): string | null {
  if (prompt.includes('Premier League goals')) return 'pl_goals';
  if (prompt.includes('Champions League goals')) return 'cl_goals';
  if (prompt.includes('Champions League appearances')) return 'cl_apps';
  if (prompt.includes('international')) return 'intl_caps';
  if (prompt.includes('value')) return 'peak_value';
  return null;
}

/**
 * Reconstruct dedupe keys from a stored daily.
 * Kept intentionally narrow — block memorable pairs/clubs, not every name that appeared.
 */
export function extractRepeatKeys(
  puzzle: LastManStandingPuzzle,
  answer: LastManStandingAnswer
): string[] {
  const keys: string[] = [];
  const ansById = new Map(answer.questions.map((a) => [a.questionId, a]));

  for (const q of puzzle.questions) {
    const ans = ansById.get(q.id);
    if (!ans) continue;

    switch (q.type) {
      case 'higher_lower': {
        const metricId = hlMetricFromPrompt(q.prompt);
        const ids = q.options
          .map((o) => playerIdFromOption(q.id, o.id))
          .filter((id): id is string => id != null);
        if (ids.length === 2 && metricId) {
          keys.push(hlPairUsedKey(ids[0]!, ids[1]!, metricId));
        }
        break;
      }
      case 'image_badge': {
        const correct = q.options.find((o) => o.id === ans.correctOptionId);
        if (correct) keys.push(clubUsedKey(correct.label));
        break;
      }
      case 'which_club': {
        const correct = q.options.find((o) => o.id === ans.correctOptionId);
        if (correct) keys.push(clubUsedKey(correct.label));
        break;
      }
      case 'career_path': {
        const pid = playerIdFromOption(q.id, ans.correctOptionId);
        if (pid) keys.push(playerUsedKey(pid));
        break;
      }
      case 'odd_one_out': {
        if (q.subPrompt?.startsWith('Who never played for ')) {
          const club = q.subPrompt.slice('Who never played for '.length).replace(/\?$/, '');
          keys.push(clubUsedKey(club));
        }
        break;
      }
      default:
        break;
    }
  }

  return keys;
}

/** Keys from recent dailies to reduce cross-day repetition (pairs, clubs, career targets). */
export async function loadRecentLMSUsedKeys(
  beforeDate: string,
  lookbackDays = DEFAULT_LOOKBACK_DAYS
): Promise<Set<string>> {
  const rows = await db
    .select({
      puzzleJson: dailyPuzzles.puzzleJson,
      answerJson: dailyPuzzles.answerJson,
    })
    .from(dailyPuzzles)
    .where(
      and(
        eq(dailyPuzzles.modeId, 'last_man_standing'),
        lt(dailyPuzzles.date, beforeDate)
      )
    )
    .orderBy(desc(dailyPuzzles.date))
    .limit(lookbackDays);

  const used = new Set<string>();
  for (const row of rows) {
    const puzzle = row.puzzleJson as LastManStandingPuzzle;
    const answer = row.answerJson as LastManStandingAnswer;
    if (!puzzle?.questions?.length || !answer?.questions?.length) continue;
    for (const key of extractRepeatKeys(puzzle, answer)) {
      used.add(key);
    }
  }
  return used;
}
