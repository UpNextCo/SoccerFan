/**
 * Build "interesting relationship" Tower prompts and store them in the tower_prompts bank
 * (the same bank the daily draw uses). Difficulty comes from interesting INTERSECTIONS of
 * famous entities, not obscurity — teammates, managers, finals, World Cups.
 *
 * Each prompt's valid answers are precomputed here (a closed id set, rule.validIds) using
 * the verified data we ingested, so validation is an exact membership test. Tier is set by
 * how many RECALLABLE answers exist (a fan can actually name one), and prompts with no
 * gettable answer are dropped.
 *
 * Pure DB. Idempotent (upsert by prompt_norm). Usage: DATABASE_URL=... npm run job:build-relationships
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { normClub, playersUnderManager, rankManagersByProminence, topManagerNorms, TOP_MANAGER_PAIR_COUNT, TOP_MANAGER_SINGLE_COUNT } from '../services/managerRules.js';
import { sampleFamousPlayers } from '../services/towerRules.js';

const CLUB_LEAGUES = sql`(39,140,135,78,61,2,3,135)`; // exclude national teams (1,4)

async function resolvePlayer(name: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT p.id, COALESCE(SUM(s.appearances),0)::int AS apps
    FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
    WHERE p.search_text = ${normalizeSearchText(name)} OR lower(p.name) = ${name.toLowerCase()}
    GROUP BY p.id ORDER BY apps DESC LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Players who shared a club-season (same team_name + season, club comps only) with EVERY anchor. */
async function teammatesOf(anchorIds: string[]): Promise<string[]> {
  if (anchorIds.length === 0) return [];
  const exists = anchorIds.map(
    (a) => sql`EXISTS (
      SELECT 1 FROM player_stats sp JOIN player_stats sa
        ON sp.team_name = sa.team_name AND sp.season = sa.season
      WHERE sp.player_id = p.id AND sa.player_id = ${a}::uuid
        AND sp.appearances > 0 AND sa.appearances > 0
        AND sp.league_id NOT IN (1,4) AND sa.league_id NOT IN (1,4))`
  );
  const notSelf = sql.join(anchorIds.map((a) => sql`p.id <> ${a}::uuid`), sql` AND `);
  const rows = (await db.execute(sql`
    SELECT p.id FROM players p WHERE ${notSelf} AND ${sql.join(exists, sql` AND `)}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

type FinalMode = 'scored' | 'started' | 'won' | 'played';
async function finalsSet(competition: string | null, mode: FinalMode): Promise<string[]> {
  const comp = competition ? sql`AND competition = ${competition}` : sql``;
  const cond =
    mode === 'scored' ? sql`AND goals > 0` : mode === 'started' ? sql`AND started` : mode === 'won' ? sql`AND won` : sql``;
  const rows = (await db.execute(sql`
    SELECT DISTINCT player_id AS id FROM final_appearances
    WHERE player_id IS NOT NULL ${comp} ${cond}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

/** World Cup (league 1) / Euro (league 4) participation. */
async function intlSet(league: number, mode: 'played' | 'scored'): Promise<string[]> {
  const cond = mode === 'scored' ? sql`AND s.goals > 0` : sql`AND s.appearances > 0`;
  const rows = (await db.execute(sql`
    SELECT DISTINCT s.player_id AS id FROM player_stats s WHERE s.league_id = ${league} ${cond}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
// Winning country per edition (FBref team names). Used to derive "won" from participation.
const COPA_WINNERS: Record<number, string> = { 2007: 'Brazil', 2011: 'Uruguay', 2015: 'Chile', 2016: 'Chile', 2019: 'Brazil', 2021: 'Argentina', 2024: 'Argentina' };
// NB: FBref stores Ivory Coast as "Côte d'Ivoire".
const AFCON_WINNERS: Record<number, string> = { 2008: 'Egypt', 2010: 'Egypt', 2012: 'Zambia', 2013: 'Nigeria', 2015: "Côte d'Ivoire", 2017: 'Cameroon', 2019: 'Algeria', 2021: 'Senegal', 2023: "Côte d'Ivoire" };

async function wonIntl(league: number, winners: Record<number, string>): Promise<string[]> {
  const conds = Object.entries(winners).map(([y, c]) => sql`(s.season = ${Number(y)} AND s.team_name = ${c})`);
  const rows = (await db.execute(sql`
    SELECT DISTINCT s.player_id AS id FROM player_stats s
    WHERE s.league_id = ${league} AND s.appearances > 0 AND (${sql.join(conds, sql` OR `)})
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function playedWcSeasons(seasons: number[]): Promise<string[]> {
  const exists = seasons.map(
    (yr) => sql`EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id = p.id AND s.league_id = 1 AND s.season = ${yr} AND s.appearances > 0)`
  );
  const rows = (await db.execute(sql`SELECT p.id FROM players p WHERE ${sql.join(exists, sql` AND `)}`)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
async function scoredWcCount(minTournaments: number): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT player_id AS id FROM player_stats WHERE league_id = 1 AND goals > 0
    GROUP BY player_id HAVING COUNT(DISTINCT season) >= ${minTournaments}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** size, RECALLABLE answers, STARS (tier-5), and BEST answer fame (max market_value_tier). */
async function statsForIds(ids: string[]): Promise<{ size: number; recallable: number; stars: number; bestTier: number }> {
  if (ids.length === 0) return { size: 0, recallable: 0, stars: 0, bestTier: 0 };
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.market_value_tier AS mvt,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39,140,135,78,61)),0) AS big5,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2),0) AS ucl,
        COALESCE(SUM(s.appearances),0) AS total
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      WHERE p.id IN (${idList}) GROUP BY p.id, p.market_value_tier
    )
    SELECT COUNT(*)::int AS size,
           COUNT(*) FILTER (WHERE mvt >= 4 OR big5 >= 60 OR ucl >= 35 OR total >= 250)::int AS recallable,
           COUNT(*) FILTER (WHERE mvt >= 5)::int AS stars,
           COALESCE(MAX(mvt),0)::int AS "bestTier"
    FROM agg
  `)) as unknown as Array<{ size: number; recallable: number; stars: number; bestTier: number }>;
  const r = rows[0];
  return { size: r?.size ?? 0, recallable: r?.recallable ?? 0, stars: r?.stars ?? 0, bestTier: r?.bestTier ?? 0 };
}

interface PromptDef {
  text: string;
  build: () => Promise<string[]>;
}

async function awardSet(award: string, placements?: string[]): Promise<string[]> {
  const pl = placements ? sql`AND placement IN (${sql.join(placements.map((p) => sql`${p}`), sql`, `)})` : sql``;
  const rows = (await db.execute(sql`
    SELECT DISTINCT player_id AS id FROM player_awards WHERE player_id IS NOT NULL AND award = ${award} ${pl}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function defs(): Promise<PromptDef[]> {
  const out: PromptDef[] = [];
  const tm = (text: string, ...names: string[]): PromptDef => ({
    text,
    build: async () => {
      const ids = (await Promise.all(names.map(resolvePlayer))).filter((x): x is string => !!x);
      if (ids.length !== names.length) return [];
      return teammatesOf(ids);
    },
  });

  // --- Managers: played under (single = easier, pairs = harder). Generated dynamically from the
  // manager_tenures bank, but capped to the most prominent coaches (Ferguson, Mourinho, Guardiola…)
  // so fringe pairings (Rose + Rangnick) never ship. Thin/impossible pools are still dropped by
  // the recallable filter at store time.
  const managerRows = (await db.execute(sql`
    SELECT DISTINCT manager, manager_norm AS "managerNorm" FROM manager_tenures ORDER BY manager
  `)) as unknown as Array<{ manager: string; managerNorm: string }>;

  // Compute each manager's player set ONCE, then intersect in memory for all pairs — 125 sets
  // beats 7,750 pairwise DB round-trips.
  const setByNorm = new Map<string, Set<string>>();
  for (const m of managerRows) {
    setByNorm.set(m.managerNorm, await playersUnderManager(m.managerNorm));
  }

  const rankedManagers = await rankManagersByProminence(managerRows, setByNorm);
  const topSingles = topManagerNorms(rankedManagers, TOP_MANAGER_SINGLE_COUNT);
  const topPairs = topManagerNorms(rankedManagers, TOP_MANAGER_PAIR_COUNT);

  for (const m of managerRows) {
    if (!topSingles.has(m.managerNorm)) continue;
    const ids = setByNorm.get(m.managerNorm)!;
    if (ids.size < 12) continue; // too thin to be a fair "name one" prompt
    out.push({ text: `Name a player who played under ${m.manager}.`, build: async () => [...ids] });
  }

  const MIN_PAIR_POOL = 3; // below this even elite knowledge can't fairly find the link
  const MIN_PAIR_RECALLABLE = 8; // manager pairs need several gettable answers, not 3 obscure links
  for (let i = 0; i < managerRows.length; i += 1) {
    for (let j = i + 1; j < managerRows.length; j += 1) {
      const a = managerRows[i]!;
      const b = managerRows[j]!;
      if (!topPairs.has(a.managerNorm) || !topPairs.has(b.managerNorm)) continue;
      const setA = setByNorm.get(a.managerNorm)!;
      const setB = setByNorm.get(b.managerNorm)!;
      if (setA.size === 0 || setB.size === 0) continue;
      const inter = [...setA].filter((id) => setB.has(id));
      if (inter.length < MIN_PAIR_POOL) continue;
      const { recallable } = await statsForIds(inter);
      if (recallable < MIN_PAIR_RECALLABLE) continue;
      out.push({ text: `Name a player who played under both ${a.manager} and ${b.manager}.`, build: async () => inter });
    }
  }

  // --- Finals ---
  out.push({ text: 'Name a player who scored in a Champions League final.', build: () => finalsSet('Champions League', 'scored') });
  out.push({ text: 'Name a player who scored in a World Cup final.', build: () => finalsSet('World Cup', 'scored') });
  out.push({ text: 'Name a player who scored in a European Championship final.', build: () => finalsSet('Euro', 'scored') });
  out.push({ text: 'Name a player who started a Champions League final.', build: () => finalsSet('Champions League', 'started') });
  out.push({ text: 'Name a player who started a World Cup final.', build: () => finalsSet('World Cup', 'started') });
  out.push({ text: 'Name a player who won the World Cup.', build: () => finalsSet('World Cup', 'won') });
  out.push({ text: 'Name a player who played in a Europa League final.', build: () => finalsSet('Europa League', 'played') });
  out.push({ text: 'Name a player who scored in a Europa League final.', build: () => finalsSet('Europa League', 'scored') });
  out.push({ text: 'Name a player who won the Europa League.', build: () => finalsSet('Europa League', 'won') });

  // --- Awards (from player_awards) ---
  out.push({ text: "Name a Ballon d'Or winner.", build: () => awardSet("Ballon d'Or", ['1st']) });
  out.push({ text: "Name a player who finished on the Ballon d'Or podium.", build: () => awardSet("Ballon d'Or", ['1st', '2nd', '3rd']) });
  out.push({ text: 'Name a European Golden Shoe winner.', build: () => awardSet('European Golden Shoe') });
  out.push({ text: 'Name a World Cup Golden Boot winner.', build: () => awardSet('World Cup Golden Boot') });
  // Crossovers (fun + hard)
  out.push({ text: 'Name a player who scored in both a Champions League final and a World Cup final.', build: async () => intersect(await finalsSet('Champions League', 'scored'), await finalsSet('World Cup', 'scored')) });
  out.push({ text: 'Name a player who played in both a Champions League final and a World Cup final.', build: async () => intersect(await finalsSet('Champions League', 'played'), await finalsSet('World Cup', 'played')) });
  out.push({ text: 'Name a player who won both the Champions League and the World Cup.', build: async () => intersect(await finalsSet('Champions League', 'won'), await finalsSet('World Cup', 'won')) });

  // --- World Cup / Euro ---
  out.push({ text: 'Name a player who scored at a World Cup.', build: () => intlSet(1, 'scored') });
  out.push({ text: 'Name a player who scored at a European Championship.', build: () => intlSet(4, 'scored') });
  out.push({ text: 'Name a player who scored at three different World Cups.', build: () => scoredWcCount(3) });
  out.push({ text: 'Name a player who played at the 2010 and 2022 World Cups.', build: () => playedWcSeasons([2010, 2022]) });
  out.push({ text: 'Name a player who played at the 2006 and 2018 World Cups.', build: () => playedWcSeasons([2006, 2018]) });
  out.push({ text: 'Name a player who scored at both a World Cup and a European Championship.', build: async () => intersect(await intlSet(1, 'scored'), await intlSet(4, 'scored')) });
  out.push({ text: 'Name a player who played at the Copa América.', build: () => intlSet(9, 'played') });
  out.push({ text: 'Name a player who scored at the Copa América.', build: () => intlSet(9, 'scored') });
  out.push({ text: 'Name a player who won the Copa América.', build: () => wonIntl(9, COPA_WINNERS) });
  out.push({ text: 'Name a player who played at the Africa Cup of Nations.', build: () => intlSet(6, 'played') });
  out.push({ text: 'Name a player who scored at the Africa Cup of Nations.', build: () => intlSet(6, 'scored') });
  out.push({ text: 'Name a player who won the Africa Cup of Nations.', build: () => wonIntl(6, AFCON_WINNERS) });

  // --- Teammate graph (cross-club pairs are the interesting ones) ---
  out.push(tm('Name a player who played with both Lionel Messi and Cristiano Ronaldo.', 'Lionel Messi', 'Cristiano Ronaldo'));
  out.push(tm('Name a player who played with both Cristiano Ronaldo and Wayne Rooney.', 'Cristiano Ronaldo', 'Wayne Rooney'));
  out.push(tm('Name a player who played with both Zlatan Ibrahimović and Lionel Messi.', 'Zlatan Ibrahimović', 'Lionel Messi'));
  out.push(tm('Name a player who played with both Gareth Bale and Harry Kane.', 'Gareth Bale', 'Harry Kane'));
  out.push(tm('Name a player who played with both Thierry Henry and Lionel Messi.', 'Thierry Henry', 'Lionel Messi'));
  out.push(tm('Name a player who played with both Kylian Mbappé and Neymar.', 'Kylian Mbappé', 'Neymar'));
  out.push(tm('Name a player who played with both David Beckham and Cristiano Ronaldo.', 'David Beckham', 'Cristiano Ronaldo'));
  out.push(tm('Name a player who played with both Frank Lampard and Didier Drogba.', 'Frank Lampard', 'Didier Drogba'));
  out.push(tm('Name a player who played with both Andrea Pirlo and Kaká.', 'Andrea Pirlo', 'Kaká'));
  out.push(tm('Name a player who played with both Steven Gerrard and Luis Suárez.', 'Steven Gerrard', 'Luis Suárez'));
  out.push(tm('Name a player who played with both Karim Benzema and Cristiano Ronaldo.', 'Karim Benzema', 'Cristiano Ronaldo'));
  out.push(tm('Name a player who played with both Ronaldinho and Lionel Messi.', 'Ronaldinho', 'Lionel Messi'));

  // --- Teammate triples (3-way — small, surprising, elite) ---
  out.push(tm('Name a player who played with Lionel Messi, Luis Suárez and Neymar.', 'Lionel Messi', 'Luis Suárez', 'Neymar'));
  out.push(tm('Name a player who played with Cristiano Ronaldo, Gareth Bale and Karim Benzema.', 'Cristiano Ronaldo', 'Gareth Bale', 'Karim Benzema'));
  out.push(tm('Name a player who played with Xavi, Andrés Iniesta and Lionel Messi.', 'Xavi', 'Andrés Iniesta', 'Lionel Messi'));
  out.push(tm('Name a player who played with Andrea Pirlo, Paolo Maldini and Kaká.', 'Andrea Pirlo', 'Paolo Maldini', 'Kaká'));
  out.push(tm('Name a player who played with Wayne Rooney, Cristiano Ronaldo and Carlos Tévez.', 'Wayne Rooney', 'Cristiano Ronaldo', 'Carlos Tévez'));
  out.push(tm('Name a player who played with Kevin De Bruyne, Sergio Agüero and David Silva.', 'Kevin De Bruyne', 'Sergio Agüero', 'David Silva'));
  out.push(tm('Name a player who played with Robert Lewandowski, Thomas Müller and Arjen Robben.', 'Robert Lewandowski', 'Thomas Müller', 'Arjen Robben'));
  out.push(tm('Name a player who played with Steven Gerrard, Fernando Torres and Luis Suárez.', 'Steven Gerrard', 'Fernando Torres', 'Luis Suárez'));

  // --- Finals crossovers (elite/fun intersections) ---
  out.push({ text: 'Name a player who scored in both a Champions League final and a Europa League final.', build: async () => intersect(await finalsSet('Champions League', 'scored'), await finalsSet('Europa League', 'scored')) });
  out.push({ text: 'Name a player who won both the Champions League and the Europa League.', build: async () => intersect(await finalsSet('Champions League', 'won'), await finalsSet('Europa League', 'won')) });
  out.push({ text: 'Name a player who scored in both a World Cup final and a European Championship final.', build: async () => intersect(await finalsSet('World Cup', 'scored'), await finalsSet('Euro', 'scored')) });
  out.push({ text: 'Name a player who scored in a Champions League final and won the World Cup.', build: async () => intersect(await finalsSet('Champions League', 'scored'), await finalsSet('World Cup', 'won')) });

  // --- Award crossovers ---
  out.push({ text: "Name a player who won both the Ballon d'Or and the World Cup.", build: async () => intersect(await awardSet("Ballon d'Or", ['1st']), await finalsSet('World Cup', 'won')) });
  out.push({ text: "Name a player who won the Ballon d'Or and a Champions League final.", build: async () => intersect(await awardSet("Ballon d'Or", ['1st']), await finalsSet('Champions League', 'won')) });
  out.push({ text: 'Name a player who won the European Golden Shoe and a Champions League final.', build: async () => intersect(await awardSet('European Golden Shoe'), await finalsSet('Champions League', 'won')) });

  return out;
}

/**
 * Two different difficulty models:
 *  - ACHIEVEMENT prompts ("won the Ballon d'Or and the World Cup", "150 PL goals") are
 *    easy/medium — a megastar accomplished it and is the obvious answer; abundance of
 *    obscure others doesn't make it harder.
 *  - CONNECTION prompts ("played under both X and Y", "played with both A and B") require
 *    traversing football history, so difficulty rises as the linking pool shrinks.
 */
function tierFor(recallable: number, stars: number, isConnection: boolean): { tier: 'easy' | 'medium' | 'hard' | 'elite'; difficulty: number } {
  if (recallable >= 120 || stars >= 16) return { tier: 'easy', difficulty: 18 }; // huge / all-megastar pool
  if (isConnection) {
    if (recallable >= 40) return { tier: 'medium', difficulty: 45 };
    if (recallable >= 15) return { tier: 'hard', difficulty: 62 };
    return { tier: 'elite', difficulty: 82 }; // a rare link (<15 recallable) — genuinely tough
  }
  return { tier: 'medium', difficulty: 45 }; // achievement — gettable via the obvious name
}

/** A "connection" = who LINKS two people/clubs (mental traversal), not an accomplishment. */
function isConnectionPrompt(text: string): boolean {
  return /\bplayed (under|with)\b/i.test(text);
}

function normPrompt(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function main() {
  const prompts = await defs();
  let stored = 0;
  let skipped = 0;
  const summary: Array<{ tier: string; recallable: number; size: number; prompt: string }> = [];
  const storedManagerNorms: string[] = [];

  for (const p of prompts) {
    let ids: string[] = [];
    try {
      ids = await p.build();
    } catch (e) {
      console.warn(`  build failed: ${p.text} — ${(e as Error).message}`);
      skipped += 1;
      continue;
    }
    ids = [...new Set(ids)];
    const { size, recallable, stars } = await statsForIds(ids);
    if (size < 1 || recallable < 2) {
      console.log(`  skip (size=${size}, recallable=${recallable}): ${p.text}`);
      skipped += 1;
      continue;
    }
    const { tier, difficulty } = tierFor(recallable, stars, isConnectionPrompt(p.text));
    const samples = await sampleFamousPlayers({ validIds: ids }, 6);
    const rule = { validIds: ids, label: p.text };
    await db.execute(sql`
      INSERT INTO tower_prompts (prompt, prompt_norm, rule, answer_type, tier, difficulty, valid_answers, sample_answers, status)
      VALUES (${p.text}, ${normPrompt(p.text)}, ${JSON.stringify(rule)}::jsonb, 'player', ${tier}, ${difficulty}, ${size}, ${JSON.stringify(samples)}::jsonb, 'active')
      ON CONFLICT (prompt_norm) DO UPDATE SET
        rule = EXCLUDED.rule, tier = EXCLUDED.tier, difficulty = EXCLUDED.difficulty,
        valid_answers = EXCLUDED.valid_answers, sample_answers = EXCLUDED.sample_answers, status = 'active'
    `);
    stored += 1;
    summary.push({ tier, recallable, size, prompt: p.text });
    if (/\bplayed under\b/i.test(p.text)) storedManagerNorms.push(normPrompt(p.text));
  }

  if (storedManagerNorms.length) {
    await db.execute(sql`
      UPDATE tower_prompts SET status = 'rejected'
      WHERE status = 'active'
        AND prompt ILIKE 'Name a player who played under%'
        AND prompt_norm NOT IN (${sql.join(storedManagerNorms.map((n) => sql`${n}`), sql`, `)})
    `);
  }

  summary.sort((a, b) => (a.tier === b.tier ? b.recallable - a.recallable : a.tier.localeCompare(b.tier)));
  console.log(`\nStored ${stored} relationship prompts (${skipped} skipped).`);
  console.log(`Manager cap: top ${TOP_MANAGER_SINGLE_COUNT} singles · top ${TOP_MANAGER_PAIR_COUNT} pairs.\n`);
  for (const s of summary) {
    console.log(`  [${s.tier.padEnd(6)}] size ${String(s.size).padStart(4)} · recallable ${String(s.recallable).padStart(3)}  ${s.prompt}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
