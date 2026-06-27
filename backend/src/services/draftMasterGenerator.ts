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

  // Viable prompts: a nationality × big-5 league needs ≥6 players who are BOTH famous-ish
  // (market_value_tier ≥ 3) AND actually had a real tenure in that league (≥40 league apps, not a
  // late-career cameo). This is what makes a combo genuinely nameable — it excludes e.g.
  // "Serbia + Ligue 1" where the only "qualifiers" are brief Matić/Kežman spells.
  const rows = (await db.execute(sql`
    WITH pl AS (
      SELECT p.id, p.nationality AS nat, s.league_id AS lg, p.market_value_tier AS mvt,
             SUM(s.appearances)::int AS apps
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE s.league_id IN (39, 140, 135, 78, 61) AND p.nationality <> 'Unknown'
      GROUP BY p.id, p.nationality, s.league_id, p.market_value_tier
    )
    SELECT nat, lg AS league, COUNT(*) FILTER (WHERE mvt >= 3 AND apps >= 40) AS famous
    FROM pl GROUP BY nat, lg
    HAVING COUNT(*) FILTER (WHERE mvt >= 3 AND apps >= 40) >= 6
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
