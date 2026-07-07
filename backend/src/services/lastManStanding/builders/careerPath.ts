import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { isNationalTeam, isYouthOrReserveSide, nationSet } from '../../../utils/nationalTeam.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import type { FamousPlayer } from '../shared.js';
import { famousPlayers, makeOptionId, pickN, seededIndex } from '../shared.js';

interface CareerRow {
  player_id: string;
  name: string;
  nationality: string;
  clubs: string[];
}

export async function buildCareerPath(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const nations = await nationSet();

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
    SELECT p.id AS player_id, p.name, p.nationality, paths.clubs
    FROM paths
    JOIN players p ON p.id = paths.player_id
    WHERE array_length(paths.clubs, 1) >= 3
    ORDER BY p.market_value_tier DESC, p.peak_market_value_eur DESC NULLS LAST
    LIMIT 500
  `)) as unknown as CareerRow[];

  if (rows.length < 20) return null;

  const pool = ctx.famousPool ?? (await famousPlayers(4, 300));
  const start = seededIndex(ctx.seed, rows.length);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    const clubs = filterClubPath(row.clubs, nations);
    if (clubs.length < 3) continue;

    const pathLen = ctx.signature ? Math.min(4, clubs.length) : 3;
    const maxStart = clubs.length - pathLen;
    const startIdx = seededIndex(`${ctx.seed}:path`, maxStart + 1);
    const path = clubs.slice(startIdx, startIdx + pathLen);
    if (path.length < 3) continue;

    // Require at least two distinct clubs (no duplicate spell noise).
    if (new Set(path).size < path.length) continue;

    const distractors = pickCareerDistractors(pool, row.player_id, row.nationality, ctx.seed);
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

function pickCareerDistractors(
  pool: FamousPlayer[],
  targetId: string,
  nationality: string,
  seed: string
): FamousPlayer[] {
  const nat = nationality.trim();
  const sameNat = pool.filter((p) => p.id !== targetId && p.nationality === nat);
  if (sameNat.length >= 3) return pickN(sameNat, `${seed}:d`, 3);

  const target = pool.find((p) => p.id === targetId);
  const band = target?.prestige ?? 50;
  const similar = pool.filter(
    (p) => p.id !== targetId && p.nationality !== nat && Math.abs(p.prestige - band) <= 18
  );
  const candidates = [...sameNat];
  for (const p of similar) {
    if (!candidates.some((c) => c.id === p.id)) candidates.push(p);
  }
  return candidates.length >= 3 ? pickN(candidates, `${seed}:d`, 3) : [];
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
