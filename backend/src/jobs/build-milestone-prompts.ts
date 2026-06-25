/**
 * Build all-era milestone / career Tower prompts (closed-set) from data we already have.
 * "Milestones football fans actually know": 100+ Champions League appearances, 50+ CL
 * goals, 500+ top-5-league appearances, one-club players. Computed from player_stats
 * (1991/1995→2025), so legends count. Stored in the tower_prompts bank like the other
 * relationship prompts; validation is exact membership.
 *
 * Pure DB. Idempotent (upsert by prompt_norm). Usage: DATABASE_URL=... npm run job:build-milestones
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sampleFamousPlayers } from '../services/towerRules.js';

const BIG5 = sql`(39,140,135,78,61)`;

async function ids(query: ReturnType<typeof sql>): Promise<string[]> {
  const rows = (await db.execute(query)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function statsForIds(idArr: string[]): Promise<{ size: number; recallable: number; stars: number; bestTier: number }> {
  if (idArr.length === 0) return { size: 0, recallable: 0, stars: 0, bestTier: 0 };
  const idList = sql.join(idArr.map((i) => sql`${i}::uuid`), sql`, `);
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

// Milestones are achievements — a megastar is the obvious answer, so easy/medium only.
function tierFor(recallable: number, stars: number): { tier: 'easy' | 'medium' | 'hard' | 'elite'; difficulty: number } {
  if (recallable >= 120 || stars >= 16) return { tier: 'easy', difficulty: 18 };
  return { tier: 'medium', difficulty: 45 };
}
const normPrompt = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

interface Def {
  text: string;
  build: () => Promise<string[]>;
}

const DEFS: Def[] = [
  {
    text: 'Name a player with 100+ Champions League appearances.',
    build: () => ids(sql`SELECT player_id AS id FROM player_stats WHERE league_id=2 GROUP BY player_id HAVING SUM(appearances)>=100`),
  },
  {
    text: 'Name a player with 50+ Champions League goals.',
    build: () => ids(sql`SELECT player_id AS id FROM player_stats WHERE league_id=2 GROUP BY player_id HAVING SUM(goals)>=50`),
  },
  {
    text: "Name a player with 500+ appearances in Europe's top-5 leagues.",
    build: () => ids(sql`SELECT player_id AS id FROM player_stats WHERE league_id IN ${BIG5} GROUP BY player_id HAVING SUM(appearances)>=500`),
  },
  {
    text: 'Name a player with 150+ Premier League goals.',
    build: () => ids(sql`SELECT player_id AS id FROM player_stats WHERE league_id=39 GROUP BY player_id HAVING SUM(goals)>=150`),
  },
  {
    // single distinct club across club competitions, with a real career (200+ apps)
    text: 'Name a one-club player (their whole club career at a single club).',
    build: () =>
      ids(sql`
        SELECT player_id AS id FROM (
          SELECT s.player_id, COUNT(DISTINCT s.team_name) AS clubs, SUM(s.appearances) AS apps
          FROM player_stats s
          WHERE s.league_id NOT IN (1,4) AND s.team_name IS NOT NULL AND s.team_name <> ''
          GROUP BY s.player_id
        ) x WHERE clubs = 1 AND apps >= 200`),
  },
];

async function main() {
  let stored = 0;
  const summary: Array<{ tier: string; size: number; recallable: number; prompt: string }> = [];
  for (const d of DEFS) {
    const idArr = [...new Set(await d.build())];
    const { size, recallable, stars } = await statsForIds(idArr);
    if (size < 1 || recallable < 2) {
      console.log(`  skip (size=${size}, recallable=${recallable}): ${d.text}`);
      continue;
    }
    const { tier, difficulty } = tierFor(recallable, stars);
    const samples = await sampleFamousPlayers({ validIds: idArr }, 6);
    const rule = { validIds: idArr, label: d.text };
    await db.execute(sql`
      INSERT INTO tower_prompts (prompt, prompt_norm, rule, answer_type, tier, difficulty, valid_answers, sample_answers, status)
      VALUES (${d.text}, ${normPrompt(d.text)}, ${JSON.stringify(rule)}::jsonb, 'player', ${tier}, ${difficulty}, ${size}, ${JSON.stringify(samples)}::jsonb, 'active')
      ON CONFLICT (prompt_norm) DO UPDATE SET
        rule = EXCLUDED.rule, tier = EXCLUDED.tier, difficulty = EXCLUDED.difficulty,
        valid_answers = EXCLUDED.valid_answers, sample_answers = EXCLUDED.sample_answers, status = 'active'
    `);
    stored += 1;
    summary.push({ tier, size, recallable, prompt: d.text });
    console.log(`  [${tier}] size ${size} · recallable ${recallable} · e.g. ${samples.slice(0, 4).join(', ')}`);
  }
  console.log(`\nStored ${stored} milestone prompts.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
