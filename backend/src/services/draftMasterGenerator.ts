/**
 * Draft Master daily puzzle generator. Picks a scoring category (rotated by date) and 11 varied,
 * DB-validated "nationality × league" prompts — each guaranteed to have several famous, real
 * qualifiers (a player of that nationality who actually played in that league). Prompts are
 * spread across nationalities and leagues for variety. Contributions/eligibility are scored at
 * play time via the valuation endpoint, so no answer payload is needed here.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const CATEGORIES = ['goals', 'assists', 'goalsPlusAssists', 'appearances', 'appearancesMinusYellowCards'] as const;
export type DraftCategory = (typeof CATEGORIES)[number];

const LEAGUE_NAME: Record<number, string> = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
};

interface Prompt { id: string; nationality: string; league: string }
export interface DraftMasterPuzzleJson {
  modeId: 'draft_master';
  puzzleId: string;
  date: string;
  category: DraftCategory;
  formation: '4-3-3';
  prompts: Prompt[];
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) { h = (h << 5) - h + input.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

export async function generateDraftMasterPuzzle(date: string): Promise<DraftMasterPuzzleJson | null> {
  const category = CATEGORIES[dayNumber(date) % CATEGORIES.length]!;

  // Viable prompts: a nationality × big-5 league with enough FAMOUS real qualifiers that a fan
  // can name several (guarantees solvability + recognisability).
  const rows = (await db.execute(sql`
    SELECT p.nationality AS nat, s.league_id AS league,
      COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= 3) AS famous
    FROM players p JOIN player_stats s ON s.player_id = p.id
    WHERE s.league_id IN (39, 140, 135, 78, 61) AND s.appearances > 0 AND p.nationality <> 'Unknown'
    GROUP BY p.nationality, s.league_id
    HAVING COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= 3) >= 5
  `)) as unknown as Array<{ nat: string; league: number; famous: number }>;
  if (rows.length < 11) return null;

  // Deterministic daily shuffle.
  const seed = hashString(`${date}:draft_master`);
  const ranked = rows
    .map((r, i) => ({ r, j: (hashString(`${seed}:${r.nat}:${r.league}:${i}`) % 1000) / 1000 }))
    .sort((a, b) => b.j - a.j)
    .map((x) => x.r);

  // Pick 11 with spread: a nationality appears at most twice, a league at most 3 times, so the XI
  // mixes home-league picks with trickier "foreign league" ones rather than all PL / all Spain.
  const picked: Prompt[] = [];
  const natCount = new Map<string, number>();
  const leagueCount = new Map<number, number>();
  for (const r of ranked) {
    if (picked.length >= 11) break;
    if ((natCount.get(r.nat) ?? 0) >= 2) continue;
    if ((leagueCount.get(r.league) ?? 0) >= 3) continue;
    natCount.set(r.nat, (natCount.get(r.nat) ?? 0) + 1);
    leagueCount.set(r.league, (leagueCount.get(r.league) ?? 0) + 1);
    picked.push({ id: `dm-${picked.length}`, nationality: r.nat, league: LEAGUE_NAME[r.league]! });
  }
  if (picked.length < 11) return null;

  return {
    modeId: 'draft_master',
    puzzleId: `${date}-draft_master`,
    date,
    category,
    formation: '4-3-3',
    prompts: picked,
  };
}

/**
 * Value + eligibility for a Draft Master pick: the player's league-career stat for the category,
 * and their appearances in that league (apps > 0 ⇒ they truly played it).
 */
export async function draftMasterValue(
  leagueId: number,
  category: DraftCategory,
  playerId: string
): Promise<{ value: number; apps: number }> {
  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(goals), 0)::int AS goals, COALESCE(SUM(assists), 0)::int AS assists,
           COALESCE(SUM(appearances), 0)::int AS apps, COALESCE(SUM(yellow_cards), 0)::int AS yc
    FROM player_stats WHERE player_id = ${playerId}::uuid AND league_id = ${leagueId}
  `)) as unknown as Array<{ goals: number; assists: number; apps: number; yc: number }>;
  const t = rows[0] ?? { goals: 0, assists: 0, apps: 0, yc: 0 };
  let value = 0;
  switch (category) {
    case 'goals': value = t.goals; break;
    case 'assists': value = t.assists; break;
    case 'goalsPlusAssists': value = t.goals + t.assists; break;
    case 'appearances': value = t.apps; break;
    case 'appearancesMinusYellowCards': value = t.apps - t.yc; break;
  }
  return { value, apps: t.apps };
}
