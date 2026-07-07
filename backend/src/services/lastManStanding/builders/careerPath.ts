import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { famousPlayers, makeOptionId, pickN, seededIndex } from '../shared.js';

interface CareerRow {
  player_id: string;
  name: string;
  clubs: string[];
}

export async function buildCareerPath(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const rows = (await db.execute(sql`
    WITH club_order AS (
      SELECT pc.player_id,
        pc.team_name,
        MIN(pc.season_from) AS sf
      FROM player_career pc
      JOIN players p ON p.id = pc.player_id
      WHERE p.market_value_tier >= 4
      GROUP BY pc.player_id, pc.team_name
    ),
    paths AS (
      SELECT co.player_id,
        array_agg(co.team_name ORDER BY co.sf) AS clubs
      FROM club_order co
      GROUP BY co.player_id
      HAVING count(*) >= 3
    )
    SELECT p.id AS player_id, p.name, paths.clubs
    FROM paths
    JOIN players p ON p.id = paths.player_id
    WHERE array_length(paths.clubs, 1) >= 3
    ORDER BY p.market_value_tier DESC, p.peak_market_value_eur DESC NULLS LAST
    LIMIT 400
  `)) as unknown as CareerRow[];

  if (rows.length < 20) return null;

  const start = seededIndex(ctx.seed, rows.length);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    const clubs = row.clubs.filter(Boolean);
    if (clubs.length < 3) continue;

    const take = ctx.signature ? Math.min(4, clubs.length) : 3;
    const startIdx = seededIndex(`${ctx.seed}:path`, Math.max(1, clubs.length - take + 1));
    const path = clubs.slice(startIdx, startIdx + take);
    if (path.length < 3) continue;

    const repeatKey = `cp:${row.player_id}:${path.join('>')}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

    const pool = ctx.famousPool ?? await famousPlayers(4, 300);
    const wrong = pool
      .filter((p) => p.id !== row.player_id)
      .filter((p) => p.name !== row.name);
    const distractors = pickN(wrong, `${ctx.seed}:d`, 3);
    if (distractors.length < 3) continue;

    const careerClubs = path.map((name) => ({ name, logoUrl: undefined as string | undefined }));

    const options = seededShuffleOptions(
      [
        { id: makeOptionId(questionId, row.player_id), label: row.name },
        ...distractors.map((d) => ({ id: makeOptionId(questionId, d.id), label: d.name })),
      ],
      ctx.seed
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'career_path',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: ctx.signature ? 'Signature round — who is this?' : 'Who is this player?',
        subPrompt: path.join(' → '),
        options,
        presentation: { layout: 'stack', careerClubs },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, row.player_id),
        reveal: row.name,
      },
    };
  }
  return null;
}

function seededShuffleOptions<T extends { id: string }>(items: T[], seed: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    let h = 0;
    const s = `${seed}:opt:${i}`;
    for (let j = 0; j < s.length; j += 1) h = (h << 5) - h + s.charCodeAt(j);
    const k = Math.abs(h) % (i + 1);
    [arr[i], arr[k]] = [arr[k]!, arr[i]!];
  }
  return arr;
}
