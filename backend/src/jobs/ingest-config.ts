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

export type IngestLeague = (typeof INGEST_LEAGUES)[number];

export function resolveIngestLeagues(): IngestLeague[] {
  const raw = process.env.INGEST_LEAGUE_IDS?.trim();
  if (!raw) return [...INGEST_LEAGUES];

  const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const picked = INGEST_LEAGUES.filter((league) =>
    tokens.some(
      (token) =>
        token === String(league.id) ||
        league.name.toLowerCase() === token ||
        league.name.toLowerCase().includes(token)
    )
  );

  if (picked.length === 0) {
    const available = INGEST_LEAGUES.map((l) => `${l.id}=${l.name}`).join(', ');
    throw new Error(`INGEST_LEAGUE_IDS matched no leagues. Available: ${available}`);
  }

  return [...picked];
}

/** How many past seasons of stats to pull (default 2 = ~2024 + 2025). */
export function resolveIngestSeasonsBack(): number[] {
  const back = Number(process.env.INGEST_SEASONS_BACK ?? 2);
  const count = Number.isFinite(back) && back > 0 ? Math.min(back, 8) : 2;
  const current = resolveIngestSeason();
  return Array.from({ length: count }, (_, i) => current - i).filter((s) => s >= 2000);
}

export const LEAGUE_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  INGEST_LEAGUES.map((l) => [l.name, l.id])
);
