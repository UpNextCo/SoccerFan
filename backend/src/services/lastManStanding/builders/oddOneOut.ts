import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import {
  maxOddPrestigeSpread,
  playerPlayedInLeague,
  prestigeSpread,
} from '../plausibility.js';
import { famousPlayers, makeOptionId, pickN, seededIndex } from '../shared.js';

type OddTemplate = 'shared_club' | 'nationality' | 'league_club';

export async function buildOddOneOut(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const templates: OddTemplate[] = ['shared_club', 'nationality', 'league_club'];
  const order = seededIndex(`${ctx.seed}:odd`, templates.length);
  const rotated = [...templates.slice(order), ...templates.slice(0, order)];

  for (const template of rotated) {
    const built =
      template === 'shared_club'
        ? await buildSharedClubOdd(ctx)
        : template === 'nationality'
          ? await buildNationalityOdd(ctx)
          : await buildLeagueClubOdd(ctx);
    if (built) return built;
  }
  return null;
}

/** Three players who all played for the same club — one plausible outsider who didn't. */
async function buildSharedClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 400));
  const index = ctx.clubIndex;
  if (!index) return null;

  const maxSpread = maxOddPrestigeSpread(ctx.difficulty.tier);

  const rows = (await db.execute(sql`
    WITH per_club AS (
      SELECT ps.player_id, ps.team_name, SUM(ps.appearances)::int AS apps
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      WHERE p.market_value_tier >= 4 AND ps.appearances >= 15
      GROUP BY ps.player_id, ps.team_name
    ),
    totals AS (
      SELECT player_id, SUM(apps)::int AS total FROM per_club GROUP BY player_id
    ),
    scored AS (
      SELECT pc.player_id, pc.team_name, pc.apps::float / NULLIF(t.total, 0) AS assoc
      FROM per_club pc JOIN totals t ON t.player_id = pc.player_id
    ),
    grouped AS (
      SELECT team_name, array_agg(player_id ORDER BY assoc DESC) AS ids, count(*)::int AS n
      FROM scored
      WHERE assoc BETWEEN 0.12 AND 0.55
      GROUP BY team_name
      HAVING count(*) >= 6
    )
    SELECT team_name, ids FROM grouped ORDER BY n DESC LIMIT 80
  `)) as unknown as Array<{ team_name: string; ids: string[] }>;

  if (rows.length < 5) return null;

  const start = seededIndex(ctx.seed, rows.length);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    const leagueId = index.leagueByClub.get(row.team_name);
    if (leagueId == null) continue;

    const memberIds = new Set(row.ids ?? []);
    const memberPool = pool.filter((p) => memberIds.has(p.id));
    if (memberPool.length < 4) continue;

    const three = pickN(memberPool, `${ctx.seed}:sc3`, 3);
    const avgPrestige = three.reduce((s, p) => s + p.prestige, 0) / 3;

    const outsiders = pool.filter((p) => {
      if (memberIds.has(p.id)) return false;
      if (index.clubsByPlayer.get(p.id)?.has(row.team_name)) return false;
      if (!playerPlayedInLeague(index, p.id, leagueId)) return false;
      if (Math.abs(p.prestige - avgPrestige) > maxSpread) return false;
      return true;
    });
    if (outsiders.length < 3) continue;

    const odd = outsiders[seededIndex(`${ctx.seed}:oddp`, outsiders.length)]!;
    const fourIds = [...three.map((p) => p.id), odd.id];
    if (prestigeSpread(index, fourIds) > maxSpread + 2) continue;

    const repeatKey = `ooo:club:${row.team_name}:${odd.id}`;

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
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, odd.id),
        reveal: `${odd.name} never played for ${row.team_name}`,
      },
    };
  }
  return null;
}

/** Three players of the same nationality — one from another nation, matched fame. */
async function buildNationalityOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 400));
  const index = ctx.clubIndex;
  if (!index) return null;

  const maxSpread = maxOddPrestigeSpread(ctx.difficulty.tier);

  const byNat = new Map<string, typeof pool>();
  for (const p of pool) {
    const list = byNat.get(p.nationality) ?? [];
    list.push(p);
    byNat.set(p.nationality, list);
  }

  const viableNats = [...byNat.entries()].filter(([, list]) => list.length >= 6);
  if (viableNats.length < 4) return null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const natPick = viableNats[seededIndex(`${ctx.seed}:nat:${attempt}`, viableNats.length)]!;
    const [nat, members] = natPick;
    const three = pickN(members, `${ctx.seed}:nat3:${attempt}`, 3);
    const avgPrestige = three.reduce((s, p) => s + p.prestige, 0) / 3;

    const oddCandidates = pool.filter((p) => {
      if (p.nationality === nat) return false;
      if (three.some((t) => t.id === p.id)) return false;
      return Math.abs(p.prestige - avgPrestige) <= maxSpread;
    });
    if (oddCandidates.length < 2) continue;

    oddCandidates.sort(
      (a, b) => Math.abs(a.prestige - avgPrestige) - Math.abs(b.prestige - avgPrestige)
    );
    const odd = oddCandidates[seededIndex(`${ctx.seed}:onat:${attempt}`, Math.min(5, oddCandidates.length))]!;
    const fourIds = [...three.map((p) => p.id), odd.id];
    if (prestigeSpread(index, fourIds) > maxSpread) continue;

    const repeatKey = `ooo:nat:${nat}:${odd.id}`;
    const options = shuffleFour(
      [
        ...three.map((p) => ({ id: makeOptionId(questionId, p.id), label: p.name })),
        { id: makeOptionId(questionId, odd.id), label: odd.name },
      ],
      `${ctx.seed}:${attempt}`
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'odd_one_out',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Odd one out',
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, odd.id),
        reveal: `${odd.name} (${odd.nationality}) — the others are ${nat}`,
      },
    };
  }
  return null;
}

/** Three clubs from the same league — one from another top league (similar tier names). */
async function buildLeagueClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const TOP5 = [39, 140, 135, 78, 61];
  const midTier = (names: string[]) => {
    const slice = names.slice(4, Math.max(5, names.length - 4));
    return slice.length >= 4 ? slice : names;
  };

  const rows = (await db.execute(sql`
    SELECT league_id, array_agg(name ORDER BY name) AS names
    FROM teams
    WHERE league_id IN (${sql.join(TOP5.map((id) => sql`${id}`), sql`, `)})
      AND logo_url IS NOT NULL AND logo_url <> ''
    GROUP BY league_id
  `)) as unknown as Array<{ league_id: number; names: string[] }>;

  if (rows.length < 3) return null;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const main = rows[seededIndex(`${ctx.seed}:lg:${attempt}`, rows.length)]!;
    const others = rows.filter((r) => r.league_id !== main.league_id);
    if (others.length < 1) continue;

    const mainPool = midTier(main.names ?? []);
    const oddLeague = others[seededIndex(`${ctx.seed}:olg:${attempt}`, others.length)]!;
    const oddPool = midTier(oddLeague.names ?? []);
    if (mainPool.length < 3 || oddPool.length < 2) continue;

    const threeClubs = pickN(mainPool, `${ctx.seed}:lc3:${attempt}`, 3);
    const oddClub = oddPool[seededIndex(`${ctx.seed}:oc:${attempt}`, oddPool.length)]!;
    if (threeClubs.includes(oddClub)) continue;

    const repeatKey = `ooo:lg:${main.league_id}:${oddClub}`;

    const options = shuffleFour(
      [
        ...threeClubs.map((c, i) => ({ id: makeOptionId(questionId, `m${i}`), label: c })),
        { id: makeOptionId(questionId, 'odd'), label: oddClub },
      ],
      `${ctx.seed}:${attempt}`
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'odd_one_out',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Odd one out',
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, 'odd'),
        reveal: `${oddClub} — different league`,
      },
    };
  }
  return null;
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
