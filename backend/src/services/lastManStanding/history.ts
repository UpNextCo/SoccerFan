import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { dailyPuzzles } from '../../db/schema.js';
import {
  collectLMSHistoryUsedKeys,
  extractLMSUsedKeys,
  LMS_BROAD_RESOURCE_LOOKBACK_DAYS,
  LMS_EXACT_SIGNATURE_LOOKBACK_DAYS,
} from './freshness.js';

export { extractLMSUsedKeys as extractRepeatKeys };

/** Keys from recent dailies to reduce cross-day repetition (pairs, clubs, career targets). */
function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export async function loadRecentLMSUsedKeys(
  beforeDate: string,
  exactLookbackDays = LMS_EXACT_SIGNATURE_LOOKBACK_DAYS,
  broadLookbackDays = LMS_BROAD_RESOURCE_LOOKBACK_DAYS
): Promise<Set<string>> {
  const exactCutoffDate = subtractDays(beforeDate, exactLookbackDays);
  const broadCutoffDate = subtractDays(beforeDate, broadLookbackDays);
  const rows = await db
    .select({
      date: dailyPuzzles.date,
      puzzleJson: dailyPuzzles.puzzleJson,
      answerJson: dailyPuzzles.answerJson,
    })
    .from(dailyPuzzles)
    .where(
      and(
        eq(dailyPuzzles.modeId, 'last_man_standing'),
        gte(dailyPuzzles.date, exactCutoffDate),
        lt(dailyPuzzles.date, beforeDate)
      )
    )
    .orderBy(desc(dailyPuzzles.date));

  return collectLMSHistoryUsedKeys(rows, broadCutoffDate);
}
