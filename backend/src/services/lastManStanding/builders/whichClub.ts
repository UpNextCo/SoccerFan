import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { makeOptionId, pickN, seededIndex } from '../shared.js';

interface ClubTeammatesRow {
  team_name: string;
  league_id: number | null;
  names: string[];
}

const TOP5 = new Set([39, 140, 135, 78, 61]);

export async function buildWhichClub(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;

  const rows = (await db.execute(sql`
    WITH spells AS (
      SELECT DISTINCT ps.team_name, ps.league_id, p.name, p.market_value_tier,
        (p.market_value_tier * 10)::int AS prestige
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      WHERE p.market_value_tier >= 4
        AND ps.appearances >= 25
        AND ps.team_name IS NOT NULL
        AND ps.team_name <> ''
    ),
    grouped AS (
      SELECT team_name,
        max(league_id) AS league_id,
        array_agg(name ORDER BY prestige, name) AS names,
        count(*)::int AS n
      FROM spells
      GROUP BY team_name
      HAVING count(*) >= 8
    )
    SELECT team_name, league_id, names
    FROM grouped
    ORDER BY n DESC
    LIMIT 100
  `)) as unknown as ClubTeammatesRow[];

  const eligible = rows.filter((r) => r.league_id != null && TOP5.has(r.league_id));
  if (eligible.length < 5) return null;

  const start = seededIndex(ctx.seed, eligible.length);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const row = eligible[(start + attempt) % eligible.length]!;
    const names = row.names ?? [];
    if (names.length < 6) continue;

    // Prefer less obvious names (skip the top 2 most famous at the club).
    const pool = names.slice(2);
    if (pool.length < 3) continue;
    const picked = pickN(pool, `${ctx.seed}:names`, 3);
    const repeatKey = `wc:${row.team_name}:${picked.join(',')}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

    const wrongClubs = eligible
      .filter((r) => r.team_name !== row.team_name && r.league_id === row.league_id)
      .map((r) => r.team_name);
    const distractors = pickN(wrongClubs, `${ctx.seed}:clubs`, 3);
    if (distractors.length < 3) continue;

    const options = shuffleOptions(
      [
        { id: makeOptionId(questionId, 'correct'), label: row.team_name },
        ...distractors.map((c, i) => ({ id: makeOptionId(questionId, `w${i}`), label: c })),
      ],
      ctx.seed
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'which_club',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Which club did they all play for?',
        subPrompt: picked.join(' · '),
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, 'correct'),
        reveal: `${row.team_name} (${picked.join(', ')})`,
      },
    };
  }
  return null;
}

function shuffleOptions<T extends { id: string; label: string }>(items: T[], seed: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    let h = 0;
    const s = `${seed}:wc:${i}`;
    for (let j = 0; j < s.length; j += 1) h = (h << 5) - h + s.charCodeAt(j);
    const k = Math.abs(h) % (i + 1);
    [arr[i], arr[k]] = [arr[k]!, arr[i]!];
  }
  return arr;
}
