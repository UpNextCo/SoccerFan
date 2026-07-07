import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { makeOptionId, pickN, seededIndex } from '../shared.js';

interface TeamRow {
  id: number;
  name: string;
  logo_url: string;
  league_id: number;
}

const TOP5 = [39, 140, 135, 78, 61];

export async function buildImageBadge(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;

  const rows = (await db.execute(sql`
    SELECT id, name, logo_url, league_id
    FROM teams
    WHERE logo_url IS NOT NULL AND logo_url <> ''
      AND league_id IN (${sql.join(TOP5.map((id) => sql`${id}`), sql`, `)})
    ORDER BY name
  `)) as unknown as TeamRow[];

  if (rows.length < 8) return null;

  const start = seededIndex(ctx.seed, rows.length);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const team = rows[(start + attempt) % rows.length]!;
    const repeatKey = `img:${team.id}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

    const wrong = rows.filter((t) => t.id !== team.id && t.league_id === team.league_id);
    const fallback = rows.filter((t) => t.id !== team.id);
    const pool = wrong.length >= 3 ? wrong : fallback;
    const distractors = pickN(pool, `${ctx.seed}:img`, 3);
    if (distractors.length < 3) continue;

    const options = shuffleOptions(
      [
        { id: makeOptionId(questionId, String(team.id)), label: team.name },
        ...distractors.map((t) => ({ id: makeOptionId(questionId, String(t.id)), label: t.name })),
      ],
      ctx.seed
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'image_badge',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Which club is this?',
        options,
        presentation: {
          layout: 'image_header',
          imageUrl: team.logo_url,
          imageBlur: 12,
        },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, String(team.id)),
        reveal: team.name,
      },
    };
  }
  return null;
}

function shuffleOptions<T extends { id: string; label: string }>(items: T[], seed: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    let h = 0;
    const s = `${seed}:imgopt:${i}`;
    for (let j = 0; j < s.length; j += 1) h = (h << 5) - h + s.charCodeAt(j);
    const k = Math.abs(h) % (i + 1);
    [arr[i], arr[k]] = [arr[k]!, arr[i]!];
  }
  return arr;
}
