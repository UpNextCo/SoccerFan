import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { associationAt, maxClueAssociation } from '../plausibility.js';
import { makeOptionId, pickN, seededIndex } from '../shared.js';

interface ClubPlayerRow {
  player_id: string;
  name: string;
  team_name: string;
  league_id: number | null;
  assoc: number;
}

const TOP5 = new Set([39, 140, 135, 78, 61]);

export async function buildWhichClub(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const index = ctx.clubIndex;
  if (!index) return null;

  const maxAssoc = maxClueAssociation(ctx.difficulty.tier);

  const rows = (await db.execute(sql`
    WITH per_club AS (
      SELECT ps.player_id, p.name, ps.team_name, MAX(ps.league_id) AS league_id,
        SUM(ps.appearances)::int AS apps
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      WHERE p.market_value_tier >= 4 AND ps.appearances >= 15
        AND ps.team_name IS NOT NULL AND ps.team_name <> ''
      GROUP BY ps.player_id, p.name, ps.team_name
    ),
    totals AS (
      SELECT player_id, SUM(apps)::int AS total_apps FROM per_club GROUP BY player_id
    )
    SELECT pc.player_id, pc.name, pc.team_name, pc.league_id,
      pc.apps::float / NULLIF(t.total_apps, 0) AS assoc
    FROM per_club pc
    JOIN totals t ON t.player_id = pc.player_id
  `)) as unknown as ClubPlayerRow[];

  const byClub = new Map<string, ClubPlayerRow[]>();
  for (const r of rows) {
    if (r.league_id == null || !TOP5.has(r.league_id)) continue;
    const list = byClub.get(r.team_name) ?? [];
    list.push(r);
    byClub.set(r.team_name, list);
  }

  const clubs = [...byClub.entries()].filter(([, players]) => players.length >= 8);
  if (clubs.length < 5) return null;

  const start = seededIndex(ctx.seed, clubs.length);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const [teamName, roster] = clubs[(start + attempt) % clubs.length]!;
    const leagueId = roster[0]?.league_id;
    if (leagueId == null) continue;

    const cluePool = roster.filter((p) => {
      const assoc = associationAt(index, p.player_id, teamName) || p.assoc;
      const primary = index.primaryClubByPlayer.get(p.player_id);
      if (primary === teamName) return false;
      return assoc > 0.08 && assoc <= maxAssoc;
    });
    if (cluePool.length < 4) continue;

    const picked = pickN(cluePool, `${ctx.seed}:names`, 3);
    const repeatKey = `wc:${teamName}:${picked.map((p) => p.player_id).join(',')}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

    const wrongClubCandidates = clubs
      .filter(([name]) => name !== teamName)
      .filter(([, players]) => players[0]?.league_id === leagueId)
      .map(([name]) => name);

    const overlappingWrong = wrongClubCandidates.filter((club) =>
      picked.some((p) => (index.clubsByPlayer.get(p.player_id)?.has(club) ?? false))
    );
    const wrongPool =
      overlappingWrong.length >= 3
        ? overlappingWrong
        : wrongClubCandidates.length >= 3
          ? wrongClubCandidates
          : [];
    if (wrongPool.length < 3) continue;

    const distractors = pickN(wrongPool, `${ctx.seed}:clubs`, 3);

    const options = shuffleOptions(
      [
        { id: makeOptionId(questionId, 'correct'), label: teamName },
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
        subPrompt: picked.map((p) => p.name).join(' · '),
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, 'correct'),
        reveal: `${teamName} (${picked.map((p) => p.name).join(', ')})`,
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
