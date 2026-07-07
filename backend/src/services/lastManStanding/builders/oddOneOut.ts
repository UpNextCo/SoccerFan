import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
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

/** Three players who all played for the same club — one famous player who never did. */
async function buildSharedClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 400));

  const rows = (await db.execute(sql`
    WITH spells AS (
      SELECT DISTINCT ps.team_name, p.id, p.name
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      WHERE p.market_value_tier >= 4 AND ps.appearances >= 20 AND ps.team_name IS NOT NULL
    ),
    grouped AS (
      SELECT team_name, array_agg(id ORDER BY name) AS ids, array_agg(name ORDER BY name) AS names,
        count(*)::int AS n
      FROM spells
      GROUP BY team_name
      HAVING count(*) >= 8
    )
    SELECT team_name, ids, names FROM grouped ORDER BY n DESC LIMIT 60
  `)) as unknown as Array<{ team_name: string; ids: string[]; names: string[] }>;

  if (rows.length < 5) return null;

  const start = seededIndex(ctx.seed, rows.length);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    const memberIds = new Set(row.ids ?? []);
    const members = (row.names ?? []).map((name, i) => ({ id: row.ids[i]!, name }));
    if (members.length < 4) continue;

    const three = pickN(members, `${ctx.seed}:sc3`, 3);
    const outsiders = pool.filter((p) => !memberIds.has(p.id));
    if (outsiders.length < 4) continue;
    const odd = outsiders[seededIndex(`${ctx.seed}:oddp`, outsiders.length)]!;
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
        subPrompt: `Who never played for ${row.team_name}?`,
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

/** Three players of the same nationality — one player from a different nation. */
async function buildNationalityOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 400));

  const byNat = new Map<string, typeof pool>();
  for (const p of pool) {
    const list = byNat.get(p.nationality) ?? [];
    list.push(p);
    byNat.set(p.nationality, list);
  }

  const viableNats = [...byNat.entries()].filter(([, list]) => list.length >= 6);
  if (viableNats.length < 4) return null;

  const natPick = viableNats[seededIndex(`${ctx.seed}:nat`, viableNats.length)]!;
  const [nat, members] = natPick;
  const three = pickN(members, `${ctx.seed}:nat3`, 3);
  const avgPrestige = three.reduce((s, p) => s + p.prestige, 0) / three.length;

  const otherNats = viableNats.filter(([n]) => n !== nat);
  const oddNat = otherNats[seededIndex(`${ctx.seed}:onat`, otherNats.length)]![1];
  const oddCandidates = oddNat
    .filter((p) => !three.some((t) => t.id === p.id))
    .sort((a, b) => Math.abs(a.prestige - avgPrestige) - Math.abs(b.prestige - avgPrestige));
  if (oddCandidates.length < 1) return null;
  const odd = oddCandidates[0]!;
  const repeatKey = `ooo:nat:${nat}:${odd.id}`;

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
      reveal: `${odd.name} (${odd.nationality}) — the others are ${nat}`,
    },
  };
}

/** Three clubs from the same league — one club from a different top league. */
async function buildLeagueClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const TOP5 = [39, 140, 135, 78, 61];
  const leagueNames: Record<number, string> = {
    39: 'Premier League',
    140: 'La Liga',
    135: 'Serie A',
    78: 'Bundesliga',
    61: 'Ligue 1',
  };

  const rows = (await db.execute(sql`
    SELECT league_id, array_agg(name ORDER BY name) AS names
    FROM teams
    WHERE league_id IN (${sql.join(TOP5.map((id) => sql`${id}`), sql`, `)})
      AND logo_url IS NOT NULL AND logo_url <> ''
    GROUP BY league_id
  `)) as unknown as Array<{ league_id: number; names: string[] }>;

  if (rows.length < 3) return null;

  const main = rows[seededIndex(`${ctx.seed}:lg`, rows.length)]!;
  const others = rows.filter((r) => r.league_id !== main.league_id);
  if (others.length < 1 || (main.names?.length ?? 0) < 5) return null;

  const oddLeague = others[seededIndex(`${ctx.seed}:olg`, others.length)]!;
  const threeClubs = pickN(main.names, `${ctx.seed}:lc3`, 3);
  const oddClub = oddLeague.names[seededIndex(`${ctx.seed}:oc`, oddLeague.names.length)]!;
  if (threeClubs.includes(oddClub)) return null;

  const repeatKey = `ooo:lg:${main.league_id}:${oddClub}`;

  const options = shuffleFour(
    [
      ...threeClubs.map((c, i) => ({ id: makeOptionId(questionId, `m${i}`), label: c })),
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
      subPrompt: `Three ${leagueNames[main.league_id] ?? 'league'} clubs`,
      options,
      presentation: { layout: 'grid' },
    },
    answer: {
      questionId,
      correctOptionId: makeOptionId(questionId, 'odd'),
      reveal: `${oddClub} — not in the ${leagueNames[main.league_id] ?? 'same league'}`,
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
