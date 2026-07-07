import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { BIG6, makeOptionId, pickN, seededIndex } from '../shared.js';

type OddTemplate = 'goalkeeper' | 'english_club' | 'big_six';

export async function buildOddOneOut(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const templates: OddTemplate[] = ['goalkeeper', 'english_club', 'big_six'];
  const template = templates[seededIndex(`${ctx.seed}:odd`, templates.length)]!;
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;

  if (template === 'goalkeeper') {
    return buildGoalkeeperOdd(ctx, questionId);
  }
  if (template === 'english_club') {
    return buildEnglishClubOdd(ctx, questionId);
  }
  return buildBigSixOdd(ctx, questionId);
}

async function buildGoalkeeperOdd(ctx: LMSBuildContext, questionId: string): Promise<LMSBuilderResult | null> {
  const outfield = (await db.execute(sql`
    SELECT id, name FROM players
    WHERE market_value_tier >= 4 AND position <> 'Goalkeeper'
    ORDER BY market_value_tier DESC, peak_market_value_eur DESC NULLS LAST
    LIMIT 80
  `)) as unknown as Array<{ id: string; name: string }>;
  const keepers = (await db.execute(sql`
    SELECT id, name FROM players
    WHERE market_value_tier >= 4 AND position = 'Goalkeeper'
    ORDER BY market_value_tier DESC
    LIMIT 40
  `)) as unknown as Array<{ id: string; name: string }>;
  if (outfield.length < 3 || keepers.length < 1) return null;

  const three = pickN(outfield, `${ctx.seed}:of`, 3);
  const odd = keepers[seededIndex(`${ctx.seed}:gk`, keepers.length)]!;
  const repeatKey = `ooo:gk:${odd.id}:${three.map((p) => p.id).join(',')}`;

  const options = shuffleFour(
    [
      ...three.map((p) => ({ id: makeOptionId(questionId, p.id), label: p.name })),
      { id: makeOptionId(questionId, odd.id), label: odd.name },
    ],
    ctx.seed
  );

  return {
    repeatKey,
    question: {
      id: questionId,
      type: 'odd_one_out',
      slot: ctx.slot,
      signature: ctx.signature,
      prompt: 'Odd one out',
      subPrompt: 'Three outfield players — one goalkeeper',
      options,
      presentation: { layout: 'grid' },
    },
    answer: {
      questionId,
      correctOptionId: makeOptionId(questionId, odd.id),
      reveal: `${odd.name} — the only goalkeeper`,
    },
  };
}

async function buildEnglishClubOdd(ctx: LMSBuildContext, questionId: string): Promise<LMSBuilderResult | null> {
  const english = ['Chelsea', 'Liverpool', 'Arsenal', 'Manchester United', 'Manchester City', 'Tottenham'];
  const foreign = ['Real Madrid', 'Barcelona', 'Bayern München', 'Juventus', 'Paris Saint-Germain', 'Inter Milan'];
  const eng = english[seededIndex(`${ctx.seed}:eng`, english.length)]!;
  const forClub = foreign[seededIndex(`${ctx.seed}:for`, foreign.length)]!;
  const repeatKey = `ooo:club:${eng}:${forClub}`;

  const options = shuffleFour(
    [
      { id: makeOptionId(questionId, 'eng1'), label: eng },
      { id: makeOptionId(questionId, 'eng2'), label: english[(seededIndex(`${ctx.seed}:e2`, english.length))]! },
      { id: makeOptionId(questionId, 'eng3'), label: english[(seededIndex(`${ctx.seed}:e3`, english.length))]! },
      { id: makeOptionId(questionId, 'for'), label: forClub },
    ].filter((v, i, a) => a.findIndex((x) => x.label === v.label) === i),
    ctx.seed
  );
  if (options.length < 4) return null;

  return {
    repeatKey,
    question: {
      id: questionId,
      type: 'odd_one_out',
      slot: ctx.slot,
      signature: ctx.signature,
      prompt: 'Odd one out',
      subPrompt: 'Three English clubs — one isn\'t',
      options: options.slice(0, 4),
      presentation: { layout: 'grid' },
    },
    answer: {
      questionId,
      correctOptionId: makeOptionId(questionId, 'for'),
      reveal: `${forClub} — not an English club`,
    },
  };
}

async function buildBigSixOdd(ctx: LMSBuildContext, questionId: string): Promise<LMSBuilderResult | null> {
  const nonBig = ['Leicester City', 'West Ham United', 'Everton', 'Aston Villa', 'Newcastle United'];
  const oddClub = nonBig[seededIndex(`${ctx.seed}:nb`, nonBig.length)]!;
  const bigPick = pickN(BIG6, `${ctx.seed}:b6`, 3);
  const repeatKey = `ooo:big6:${oddClub}`;

  const options = shuffleFour(
    [
      ...bigPick.map((c, i) => ({ id: makeOptionId(questionId, `b${i}`), label: c })),
      { id: makeOptionId(questionId, 'odd'), label: oddClub },
    ],
    ctx.seed
  );

  return {
    repeatKey,
    question: {
      id: questionId,
      type: 'odd_one_out',
      slot: ctx.slot,
      signature: ctx.signature,
      prompt: 'Odd one out',
      subPrompt: 'Three Big Six clubs — one isn\'t',
      options,
      presentation: { layout: 'grid' },
    },
    answer: {
      questionId,
      correctOptionId: makeOptionId(questionId, 'odd'),
      reveal: `${oddClub} — not a Big Six club`,
    },
  };
}

function shuffleFour<T extends { id: string; label: string }>(items: T[], seed: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    let h = 0;
    const s = `${seed}:sh:${i}`;
    for (let j = 0; j < s.length; j += 1) h = (h << 5) - h + s.charCodeAt(j);
    const k = Math.abs(h) % (i + 1);
    [arr[i], arr[k]] = [arr[k]!, arr[i]!];
  }
  return arr.slice(0, 4);
}
