import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { famousClubsInLeague, isFamousEnough, MIN_NAME_PRESTIGE } from '../fame.js';
import { associationAt, maxClueAssociation } from '../plausibility.js';
import { clubUsedKey, isHouseholdIndexed, playerUsedKey } from '../recognition.js';
import { BIG6, makeOptionId, pickN, seededIndex, seededShuffle } from '../shared.js';

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

  // Prefer well-known clubs with several famous alumni (secondary spells).
  const clubs = [...byClub.entries()]
    .filter(([name, players]) => {
      const leagueId = players[0]?.league_id;
      if (leagueId == null) return false;
      const famous = players.filter((p) => isFamousEnough(index, p.player_id));
      const isKnownClub = famousClubsInLeague(leagueId).includes(name);
      return famous.length >= 4 && isKnownClub;
    })
    .sort((a, b) => {
      const fa = a[1].filter((p) => isFamousEnough(index, p.player_id)).length;
      const fb = b[1].filter((p) => isFamousEnough(index, p.player_id)).length;
      return fb - fa;
    });

  if (clubs.length < 3) return null;

  const start = seededIndex(ctx.seed, clubs.length);
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const [teamName, roster] = clubs[(start + attempt) % clubs.length]!;
    const leagueId = roster[0]?.league_id;
    if (leagueId == null) continue;

    const cluePool = roster
      .filter((p) => {
        if (!isFamousEnough(index, p.player_id)) return false;
        if (!isHouseholdIndexed(index, p.player_id)) return false;
        const assoc = associationAt(index, p.player_id, teamName) || p.assoc;
        const primary = index.primaryClubByPlayer.get(p.player_id);
        if (primary === teamName) return false;
        return assoc >= 0.08 && assoc <= maxAssoc;
      })
      .sort(
        (a, b) =>
          (index.prestigeByPlayer.get(b.player_id) ?? 0) - (index.prestigeByPlayer.get(a.player_id) ?? 0)
      );

    if (cluePool.length < 4) continue;

    // Famous names, but not the most iconic pair at this club.
    const pickFrom = cluePool.slice(0, Math.min(12, cluePool.length));
    const picked = pickN(pickFrom, `${ctx.seed}:names:${attempt}`, 3);
    const avgPrestige =
      picked.reduce((s, p) => s + (index.prestigeByPlayer.get(p.player_id) ?? 0), 0) / 3;
    if (avgPrestige < MIN_NAME_PRESTIGE) continue;
    if (isGiveawayWhichClub(teamName, picked, index)) continue;
    if (picked.some((p) => ctx.usedKeys.has(playerUsedKey(p.player_id)))) continue;

    const repeatKey = clubUsedKey(teamName);
    if (ctx.usedKeys.has(repeatKey)) continue;

    const famousWrong = famousClubsInLeague(leagueId, teamName);
    const overlappingWrong = famousWrong.filter((club) =>
      picked.some((p) => index.clubsByPlayer.get(p.player_id)?.has(club))
    );
    const wrongPool =
      overlappingWrong.length >= 3
        ? overlappingWrong
        : famousWrong.length >= 4
          ? famousWrong
          : [];
    if (wrongPool.length < 3) continue;

    const distractors = pickN(wrongPool, `${ctx.seed}:clubs:${attempt}`, 3);

    const options = shuffleOptions(
      [
        { id: makeOptionId(questionId, 'correct'), label: teamName },
        ...distractors.map((c, i) => ({ id: makeOptionId(questionId, `w${i}`), label: c })),
      ],
      `${ctx.seed}:${attempt}`
    );

    return {
      repeatKey,
      extraUsedKeys: [
        ...picked.map((p) => playerUsedKey(p.player_id)),
      ],
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
  return seededShuffle(items, seed);
}

/** Three megastars at a Big Six club is a giveaway even if spells were brief. */
function isGiveawayWhichClub(
  teamName: string,
  picked: ClubPlayerRow[],
  index: import('../plausibility.js').PlayerClubIndex
): boolean {
  if (!BIG6.includes(teamName)) return false;
  const prestiges = picked.map((p) => index.prestigeByPlayer.get(p.player_id) ?? 0);
  if (prestiges.every((pr) => pr >= 68)) return true;
  const subtle = picked.filter((p) => {
    const assoc = associationAt(index, p.player_id, teamName) || p.assoc;
    return assoc < 0.2;
  });
  return subtle.length === 0 && prestiges.filter((pr) => pr >= 62).length >= 3;
}
