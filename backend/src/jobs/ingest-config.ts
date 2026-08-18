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

export type IngestLeague = { id: number; name: string };

/** EFL domestic leagues — not part of the default big-5 rotation. Target via INGEST_LEAGUE_IDS. */
export const EFL_LEAGUES: IngestLeague[] = [
  { id: 40, name: 'Championship' },
  { id: 41, name: 'League One' },
  { id: 42, name: 'League Two' },
];

const EFL_LEAGUE_IDS = new Set(EFL_LEAGUES.map((l) => l.id));

export function isEflLeagueId(leagueId: number): boolean {
  return EFL_LEAGUE_IDS.has(leagueId);
}

/** Continental cups — ingested for stats only (NOT part of the domestic-league
 *  rotation used by generators / loadIngestPlayers). Target via INGEST_LEAGUE_IDS. */
export const CUP_COMPETITIONS: IngestLeague[] = [
  { id: 2, name: 'UEFA Champions League' },
  { id: 3, name: 'UEFA Europa League' },
];

/** English domestic cups — stats only, same targeting pattern as CUP_COMPETITIONS. */
export const ENGLISH_CUPS: IngestLeague[] = [
  { id: 45, name: 'FA Cup' },
  { id: 48, name: 'EFL Cup' },
];

/** Domestic leagues that may receive squad ingest (big-5 + EFL). Cups are excluded. */
export const DOMESTIC_INGEST_LEAGUES: IngestLeague[] = [...INGEST_LEAGUES, ...EFL_LEAGUES];

/** Every competition we can pull season stats for. */
export const ALL_STATS_COMPETITIONS: IngestLeague[] = [
  ...INGEST_LEAGUES,
  ...EFL_LEAGUES,
  ...CUP_COMPETITIONS,
  ...ENGLISH_CUPS,
];

function parseLeagueTokens(raw: string): string[] {
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function competitionMatches(comp: IngestLeague, token: string): boolean {
  return (
    token === String(comp.id) ||
    comp.name.toLowerCase() === token ||
    comp.name.toLowerCase().includes(token)
  );
}

function pickCompetitions(pool: IngestLeague[], raw: string, label: string): IngestLeague[] {
  const tokens = parseLeagueTokens(raw);
  const picked = pool.filter((comp) => tokens.some((token) => competitionMatches(comp, token)));
  if (picked.length === 0) {
    const available = pool.map((c) => `${c.id}=${c.name}`).join(', ');
    throw new Error(`INGEST_LEAGUE_IDS matched no ${label}. Available: ${available}`);
  }
  return picked;
}

/**
 * Domestic leagues to ingest SQUADS for. Defaults to the big-5.
 * INGEST_LEAGUE_IDS may select EFL divisions (40/41/42) without changing the default rotation.
 * Cups are never returned here — they have no home squads.
 */
export function resolveIngestLeagues(): IngestLeague[] {
  const raw = process.env.INGEST_LEAGUE_IDS?.trim();
  if (!raw) return [...INGEST_LEAGUES];
  return pickCompetitions(DOMESTIC_INGEST_LEAGUES, raw, 'leagues');
}

/**
 * Competitions to ingest STATS for. Defaults to the domestic big-5, but
 * INGEST_LEAGUE_IDS may also select EFL leagues and cups
 * (2 = UCL, 3 = Europa, 40–42 = EFL, 45 = FA Cup, 48 = EFL Cup).
 */
export function resolveStatsCompetitions(): IngestLeague[] {
  const raw = process.env.INGEST_LEAGUE_IDS?.trim();
  if (!raw) return [...INGEST_LEAGUES];
  return pickCompetitions(ALL_STATS_COMPETITIONS, raw, 'competitions');
}

/** How many past seasons of stats to pull (default 2 = ~2024 + 2025). */
export function resolveIngestSeasonsBack(): number[] {
  const back = Number(process.env.INGEST_SEASONS_BACK ?? 2);
  const count = Number.isFinite(back) && back > 0 ? Math.min(back, 8) : 2;
  const current = resolveIngestSeason();
  return Array.from({ length: count }, (_, i) => current - i).filter((s) => s >= 2000);
}

const LEAGUE_NAME_ALIASES: Record<string, number> = {
  Championship: 40,
  'EFL Championship': 40,
  'League One': 41,
  'League 1': 41,
  'EFL League One': 41,
  'League Two': 42,
  'League 2': 42,
  'EFL League Two': 42,
  'FA Cup': 45,
  'EFL Cup': 48,
  'League Cup': 48,
  'Carabao Cup': 48,
  'Football League Cup': 48,
  'UEFA Champions League': 2,
  'Champions League': 2,
  'UEFA Europa League': 3,
  'Europa League': 3,
};

export const LEAGUE_ID_BY_NAME: Record<string, number> = {
  ...Object.fromEntries(INGEST_LEAGUES.map((l) => [l.name, l.id])),
  ...Object.fromEntries(EFL_LEAGUES.map((l) => [l.name, l.id])),
  ...LEAGUE_NAME_ALIASES,
};
