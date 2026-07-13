import { ensureLastManStandingPuzzle } from './dailyService.js';
import { todayUTC } from '../utils/dailyDate.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1_000;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function preGenerateLastManStanding(): Promise<void> {
  const today = todayUTC();
  const dates = [today, addDays(today, 1)];
  const results = await Promise.allSettled(
    dates.map((date) => ensureLastManStandingPuzzle(date))
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const detail =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`LMS pre-generation failed for ${dates[index]}: ${detail}`);
    }
  });
}

/**
 * Keep LMS ready before clients request a bundle. Tomorrow is generated as well as today so
 * local-midnight clients are covered while the server is still on the previous UTC date.
 */
export function startDailyPreGeneration(): void {
  void preGenerateLastManStanding();
  const timer = setInterval(() => {
    void preGenerateLastManStanding();
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
