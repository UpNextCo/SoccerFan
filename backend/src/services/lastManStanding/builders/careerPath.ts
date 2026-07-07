import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { isNationalTeam, isYouthOrReserveSide, nationSet } from '../../../utils/nationalTeam.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import {
  careerPrestigeBand,
  pickPlausibleCareerDistractors,
  preferredCareerOverlap,
} from '../plausibility.js';
import { famousPlayers, makeOptionId, seededIndex } from '../shared.js';

interface CareerRow {
  player_id: string;
  name: string;
  nationality: string;
  prestige: number;
  clubs: string[];
}

export async function buildCareerPath(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const index = ctx.clubIndex;
  const pool = ctx.famousPool;
  if (!index || !pool) return null;

  const nations = await nationSet();
  const minOverlap = 1;
  const preferredOverlap = preferredCareerOverlap(ctx.difficulty.tier);
  const band = careerPrestigeBand(ctx.difficulty.tier);

  const rows = (await db.execute(sql`
    WITH club_order AS (
      SELECT pc.player_id,
        pc.team_name,
        MIN(pc.season_from) AS sf
      FROM player_career pc
      JOIN players p ON p.id = pc.player_id
      WHERE p.market_value_tier >= 4 AND pc.team_id > 0
      GROUP BY pc.player_id, pc.team_name
    ),
    paths AS (
      SELECT co.player_id,
        array_agg(co.team_name ORDER BY co.sf, co.team_name) AS clubs
      FROM club_order co
      GROUP BY co.player_id
      HAVING count(*) >= 3
    )
    SELECT p.id AS player_id, p.name, p.nationality, paths.clubs,
      (p.market_value_tier * 10)::int AS prestige
    FROM paths
    JOIN players p ON p.id = paths.player_id
    WHERE array_length(paths.clubs, 1) >= 3
    ORDER BY p.market_value_tier DESC, p.peak_market_value_eur DESC NULLS LAST
    LIMIT 500
  `)) as unknown as CareerRow[];

  if (rows.length < 20) return null;

  const start = seededIndex(ctx.seed, rows.length);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    const clubs = filterClubPath(row.clubs, nations);
    if (clubs.length < 3) continue;

    const pathLen = ctx.signature ? Math.min(4, clubs.length) : 3;
    const maxStart = clubs.length - pathLen;
    const startIdx = seededIndex(`${ctx.seed}:path`, maxStart + 1);
    const path = clubs.slice(startIdx, startIdx + pathLen);
    if (path.length < 3 || new Set(path).size < path.length) continue;

    const targetPrestige = index.prestigeByPlayer.get(row.player_id) ?? row.prestige;
    let distractors = pickPlausibleCareerDistractors(
      pool,
      index,
      row.player_id,
      targetPrestige,
      row.nationality,
      path,
      preferredOverlap,
      band,
      `${ctx.seed}:d`
    );
    if (distractors.length < 3) {
      distractors = pickPlausibleCareerDistractors(
        pool,
        index,
        row.player_id,
        targetPrestige,
        row.nationality,
        path,
        minOverlap,
        band,
        `${ctx.seed}:d2`
      );
    }
    if (distractors.length < 3) continue;

    const repeatKey = `cp:${row.player_id}:${path.join('>')}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

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
        subPrompt: 'Club career path',
        options,
        presentation: {
          layout: 'stack',
          careerClubs: path.map((name) => ({ name })),
        },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, row.player_id),
        reveal: `${row.name} — ${path.join(' → ')}`,
      },
    };
  }
  return null;
}

function filterClubPath(clubs: string[], nations: Set<string>): string[] {
  const out: string[] = [];
  for (const name of clubs) {
    if (!name?.trim()) continue;
    if (isNationalTeam(name, nations)) continue;
    if (isYouthOrReserveSide(name)) continue;
    if (out[out.length - 1] === name) continue;
    out.push(name);
  }
  return out;
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
