/**
 * API-Football uses the season *start* year (2026/27 → 2026).
 * Override with INGEST_SEASON=2026 in env if needed.
 */
export function resolveIngestSeason(now = new Date()): number {
  const fromEnv = process.env.INGEST_SEASON?.trim();
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 2000) return parsed;
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1–12 UTC

  // Aug–Dec: current campaign (e.g. Aug 2026 → 2026/27)
  if (month >= 8) return year;

  // Jun–Jul: off-season — ingest upcoming squads (2026/27)
  if (month >= 6) return year;

  // Jan–May: still in the campaign that started the previous calendar year
  return year - 1;
}

export const INGEST_LEAGUES = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
] as const;
