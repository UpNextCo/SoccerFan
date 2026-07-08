/** Calendar date helpers for daily puzzles (YYYY-MM-DD). */

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(earlier: string, later: string): number {
  const a = new Date(`${earlier}T12:00:00.000Z`).getTime();
  const b = new Date(`${later}T12:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Client sends the user's local calendar day (NYT-style). Fall back to UTC if missing/invalid.
 * Allow up to one day ahead of UTC (UTC+14) and two behind (offline grace).
 */
export function resolveClientDailyDate(clientDate?: string): string {
  if (!clientDate || !/^\d{4}-\d{2}-\d{2}$/.test(clientDate)) return todayUTC();
  const utcToday = todayUTC();
  const ahead = dayDiff(utcToday, clientDate);
  const behind = dayDiff(clientDate, utcToday);
  if (ahead > 1 || behind > 2) return utcToday;
  return clientDate;
}

/** Completions + offline sync: same window as resolveClientDailyDate. */
export function isAcceptableCompletionDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const utcToday = todayUTC();
  return dayDiff(utcToday, date) <= 1 && dayDiff(date, utcToday) <= 2;
}
