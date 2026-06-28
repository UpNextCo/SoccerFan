import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import type { GuessFeedbackField, PlayerSearchResult } from '../types.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { resolveSearchLimit } from '../utils/playerSearchRank.js';
import { lookupTeamLogos } from './teamService.js';
import { normalizeTeamName } from '../utils/teamName.js';
import { playerHeadshotUrl } from '../constants/footballMedia.js';

type SearchRow = {
  id: string;
  external_id: string | null;
  name: string;
  nationality: string;
  position: string;
  current_club: string;
  current_league: string;
  peak_market_value_eur: number | null;
  market_value_tier: number | null;
  api_football_id: number | null;
};

/** Transfer-budget price for Battle Mode: peak market value, or a tier-based estimate when missing. */
const TIER_PRICE_EUR: Record<number, number> = {
  5: 120_000_000,
  4: 55_000_000,
  3: 22_000_000,
  2: 8_000_000,
  1: 2_000_000,
};
function playerPriceEur(peak: number | null, tier: number | null): number {
  if (peak && peak > 0) return peak;
  return TIER_PRICE_EUR[tier ?? 3] ?? TIER_PRICE_EUR[3]!;
}

export type FeedbackStatus = 'correct' | 'partial' | 'wrong';

export function compareField(
  guess: string | number | null,
  answer: string | number | null,
  field: string
): FeedbackStatus {
  if (guess === answer) return 'correct';

  if (field === 'age' && typeof guess === 'number' && typeof answer === 'number') {
    const diff = Math.abs(guess - answer);
    if (diff <= 2) return 'partial';
  }

  if (field === 'shirtNumber' && typeof guess === 'number' && typeof answer === 'number') {
    const diff = Math.abs(guess - answer);
    if (diff <= 3) return 'partial';
  }

  return 'wrong';
}

export function buildGuessFeedback(
  guessPlayer: typeof players.$inferSelect,
  answerPlayer: typeof players.$inferSelect
): GuessFeedbackField[] {
  const fields: Array<{ field: string; guess: string | number | null; answer: string | number | null }> = [
    { field: 'nationality', guess: guessPlayer.nationality, answer: answerPlayer.nationality },
    { field: 'league', guess: guessPlayer.currentLeague, answer: answerPlayer.currentLeague },
    { field: 'club', guess: guessPlayer.currentClub, answer: answerPlayer.currentClub },
    { field: 'position', guess: guessPlayer.position, answer: answerPlayer.position },
    { field: 'age', guess: guessPlayer.age, answer: answerPlayer.age },
    {
      field: 'shirtNumber',
      guess: guessPlayer.shirtNumber,
      answer: answerPlayer.shirtNumber,
    },
    {
      field: 'foot',
      guess: guessPlayer.foot,
      answer: answerPlayer.foot,
    },
  ];

  return fields.map(({ field, guess, answer }) => {
    const status = compareField(guess, answer, field);
    let hint: 'higher' | 'lower' | undefined;
    if (
      status !== 'correct' &&
      (field === 'age' || field === 'shirtNumber') &&
      typeof guess === 'number' &&
      typeof answer === 'number'
    ) {
      hint = answer > guess ? 'higher' : 'lower';
    }
    return {
      field,
      value: guess,
      status,
      ...(hint ? { hint } : {}),
    };
  });
}

export function isCorrectGuess(
  guessPlayer: typeof players.$inferSelect,
  answerPlayer: typeof players.$inferSelect
): boolean {
  return guessPlayer.id === answerPlayer.id;
}

const TOP5_LEAGUE_NAMES = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];

export async function searchPlayers(
  query: string,
  limit?: number,
  opts?: { currentTop5?: boolean }
): Promise<PlayerSearchResult[]> {
  const normalized = normalizeSearchText(query);

  if (normalized.length < 2) return [];

  const resultLimit = limit ?? resolveSearchLimit(normalized);
  const fetchLimit = Math.min(resultLimit * 4, 48);
  const prefixPattern = `${normalized}%`;
  const wordPattern = `% ${normalized}%`;
  const containsPattern = `%${normalized}%`;
  const top5Filter = opts?.currentTop5
    ? sql`AND p.current_league IN (${sql.join(TOP5_LEAGUE_NAMES.map((n) => sql`${n}`), sql`, `)})`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT
      p.id,
      p.external_id,
      p.name,
      p.nationality,
      p.position,
      p.current_club,
      p.current_league,
      p.peak_market_value_eur,
      p.market_value_tier,
      p.api_football_id,
      (
        CASE
          WHEN lower(p.name) = ${normalized} THEN 200
          WHEN lower(p.name) LIKE ${prefixPattern} THEN 150
          WHEN lower(p.name) LIKE ${wordPattern} THEN 120
          WHEN lower(p.search_text) LIKE ${prefixPattern} THEN 90
          WHEN lower(p.search_text) LIKE ${containsPattern} THEN 50
          ELSE 20
        END
        + CASE WHEN recent.player_id IS NOT NULL THEN 50 ELSE 0 END
        + LEAST(COALESCE(stats.stat_seasons, 0), 12) * 3
        + COALESCE(p.market_value_tier, 3) * 5
        + CASE WHEN p.external_id IS NOT NULL THEN 5 ELSE 0 END
      )::int AS search_score
    FROM players p
    LEFT JOIN (
      SELECT DISTINCT player_id
      FROM player_stats
      WHERE season >= 2024 AND appearances > 0
    ) recent ON recent.player_id = p.id
    LEFT JOIN (
      SELECT player_id, COUNT(DISTINCT season)::int AS stat_seasons
      FROM player_stats
      WHERE appearances > 0
      GROUP BY player_id
    ) stats ON stats.player_id = p.id
    WHERE (
      lower(p.search_text) LIKE ${containsPattern}
      OR lower(p.name) LIKE ${containsPattern}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(p.aliases) AS alias
        WHERE lower(alias) LIKE ${containsPattern}
      )
    )
    ${top5Filter}
    ORDER BY search_score DESC, lower(p.name) ASC
    LIMIT ${fetchLimit}
  `)) as SearchRow[];

  const deduped: PlayerSearchResult[] = [];
  const seen = new Set<string>();

  for (const player of rows) {
    // Dedupe by player IDENTITY, not name — two different people can share a name (e.g. Nico
    // González of Spain vs Argentina), and a name-key would hide the lower-ranked real player.
    const key = player.external_id ?? player.id;
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push({
      id: player.id,
      name: player.name,
      club: player.current_club,
      league: player.current_league,
      nationality: player.nationality,
      position: player.position,
      priceEur: playerPriceEur(player.peak_market_value_eur, player.market_value_tier),
      headshotUrl: playerHeadshotUrl(player.api_football_id) ?? undefined,
    });

    if (deduped.length >= resultLimit) break;
  }

  const logos = await lookupTeamLogos(
    deduped.map((player) => ({ club: player.club, league: player.league }))
  );

  return deduped.map((player) => {
    const key = `${normalizeTeamName(player.club)}|${normalizeSearchText(player.league)}`;
    const logo = logos.get(key);
    if (!logo) return player;
    return {
      ...player,
      teamId: logo.teamId,
      teamLogoUrl: logo.logoUrl,
    };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPlayerById(id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAllPlayers() {
  return db.select().from(players);
}

export async function getPlayerByName(name: string) {
  const rows = await db
    .select()
    .from(players)
    .where(ilike(players.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export function playerToSnapshot(player: typeof players.$inferSelect) {
  return {
    id: player.id,
    name: player.name,
    nationality: player.nationality,
    league: player.currentLeague,
    club: player.currentClub,
    position: player.position,
    age: player.age,
    shirtNumber: player.shirtNumber,
    marketValueTier: player.marketValueTier,
  };
}

export async function findPlayerForGuess(identifier: string) {
  const byId = await getPlayerById(identifier);
  if (byId) return byId;

  const normalized = identifier
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const all = await getAllPlayers();
  return (
    all.find((p) => p.searchText === normalized) ??
    all.find((p) => p.name.toLowerCase() === identifier.toLowerCase()) ??
    all.find((p) => p.aliases.some((a) => a.toLowerCase() === identifier.toLowerCase())) ??
    null
  );
}
