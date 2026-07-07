import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import {
  FAMOUS_CLUBS_BY_LEAGUE,
  famousClubsInLeague,
  isFamousEnough,
  LEAGUE_LABELS,
  MIN_NAME_PRESTIGE,
  SHARED_CLUB_CANDIDATES,
} from '../fame.js';
import { maxOddPrestigeSpread, playerPlayedInLeague, prestigeSpread } from '../plausibility.js';
import { famousPlayers, makeOptionId, pickN, seededIndex } from '../shared.js';

type OddTemplate = 'shared_club' | 'league_players' | 'league_club';

export async function buildOddOneOut(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const templates: OddTemplate[] = ['shared_club', 'league_players', 'league_club'];
  const order = seededIndex(`${ctx.seed}:odd`, templates.length);
  const rotated = [...templates.slice(order), ...templates.slice(0, order)];

  for (const template of rotated) {
    const built =
      template === 'shared_club'
        ? await buildSharedClubOdd(ctx)
        : template === 'league_players'
          ? await buildLeaguePlayersOdd(ctx)
          : await buildLeagueClubOdd(ctx);
    if (built) return built;
  }
  return null;
}

/** Three famous players who all played for the same big club — one famous player who never did. */
async function buildSharedClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 250));
  const index = ctx.clubIndex;
  if (!index) return null;

  const maxSpread = maxOddPrestigeSpread(ctx.difficulty.tier);
  const famousPool = pool.filter((p) => p.prestige >= MIN_NAME_PRESTIGE);

  const clubOrder = seededShuffleClubs(`${ctx.seed}:clubs`);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const club = clubOrder[attempt % clubOrder.length]!;
    const leagueId = index.leagueByClub.get(club);
    if (leagueId == null) continue;

    const members = famousPool.filter((p) => index.clubsByPlayer.get(p.id)?.has(club));
    if (members.length < 4) continue;

    const three = pickN(members, `${ctx.seed}:sc3:${attempt}`, 3);
    const avgPrestige = three.reduce((s, p) => s + p.prestige, 0) / 3;

    const outsiders = famousPool.filter((p) => {
      if (members.some((m) => m.id === p.id)) return false;
      if (index.clubsByPlayer.get(p.id)?.has(club)) return false;
      if (!playerPlayedInLeague(index, p.id, leagueId)) return false;
      return Math.abs(p.prestige - avgPrestige) <= maxSpread + 3;
    });
    if (outsiders.length < 2) continue;

    const odd = outsiders[seededIndex(`${ctx.seed}:oddp:${attempt}`, outsiders.length)]!;
    const fourIds = [...three.map((p) => p.id), odd.id];
    if (prestigeSpread(index, fourIds) > maxSpread + 2) continue;

    const repeatKey = `ooo:club:${club}:${odd.id}`;
    if (ctx.usedKeys.has(repeatKey)) continue;

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
        subPrompt: `Who never played for ${club}?`,
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, odd.id),
        reveal: `${odd.name} never played for ${club}`,
      },
    };
  }
  return null;
}

/** Three famous players with a real spell in a top league — one famous player who never did. */
async function buildLeaguePlayersOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const pool = ctx.famousPool ?? (await famousPlayers(4, 250));
  const index = ctx.clubIndex;
  if (!index) return null;

  const maxSpread = maxOddPrestigeSpread(ctx.difficulty.tier);
  const leagueIds = [39, 140, 135, 78, 61];

  const rows = (await db.execute(sql`
    SELECT ps.league_id, p.id, SUM(ps.appearances)::int AS apps
    FROM player_stats ps
    JOIN players p ON p.id = ps.player_id
    WHERE p.market_value_tier >= 4
      AND ps.league_id IN (${sql.join(leagueIds.map((id) => sql`${id}`), sql`, `)})
    GROUP BY ps.league_id, p.id
    HAVING SUM(ps.appearances) >= 30
  `)) as unknown as Array<{ league_id: number; id: string; apps: number }>;

  const byLeague = new Map<number, string[]>();
  for (const r of rows) {
    if (!isFamousEnough(index, r.id)) continue;
    const list = byLeague.get(r.league_id) ?? [];
    list.push(r.id);
    byLeague.set(r.league_id, list);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const leagueId = leagueIds[seededIndex(`${ctx.seed}:lgp:${attempt}`, leagueIds.length)]!;
    const inLeague = byLeague.get(leagueId) ?? [];
    if (inLeague.length < 6) continue;

    const inPool = pool.filter((p) => inLeague.includes(p.id) && p.prestige >= MIN_NAME_PRESTIGE);
    if (inPool.length < 4) continue;

    const three = pickN(inPool, `${ctx.seed}:lp3:${attempt}`, 3);
    const avgPrestige = three.reduce((s, p) => s + p.prestige, 0) / 3;

    const outsiders = pool.filter((p) => {
      if (three.some((t) => t.id === p.id)) return false;
      if (playerPlayedInLeague(index, p.id, leagueId)) return false;
      if (p.prestige < MIN_NAME_PRESTIGE - 4) return false;
      return Math.abs(p.prestige - avgPrestige) <= maxSpread + 2;
    });
    if (outsiders.length < 2) continue;

    const odd = outsiders[seededIndex(`${ctx.seed}:lpo:${attempt}`, outsiders.length)]!;
    const fourIds = [...three.map((p) => p.id), odd.id];
    if (prestigeSpread(index, fourIds) > maxSpread + 2) continue;

    const label = LEAGUE_LABELS[leagueId] ?? 'this league';
    const repeatKey = `ooo:lgp:${leagueId}:${odd.id}`;

    const options = shuffleFour(
      [
        ...three.map((p) => ({ id: makeOptionId(questionId, p.id), label: p.name })),
        { id: makeOptionId(questionId, odd.id), label: odd.name },
      ],
      `${ctx.seed}:lp:${attempt}`
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'odd_one_out',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Odd one out',
        subPrompt: `All played in the ${label}`,
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, odd.id),
        reveal: `${odd.name} never played in the ${label}`,
      },
    };
  }
  return null;
}

/** Three famous clubs from one top league — one famous club from another. */
async function buildLeagueClubOdd(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const leagueIds = [39, 140, 135, 78, 61] as const;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const mainId = leagueIds[seededIndex(`${ctx.seed}:lg:${attempt}`, leagueIds.length)]!;
    const others = leagueIds.filter((id) => id !== mainId);
    const oddLeagueId = others[seededIndex(`${ctx.seed}:olg:${attempt}`, others.length)]!;

    const mainPool = FAMOUS_CLUBS_BY_LEAGUE[mainId] ?? [];
    const oddPool = FAMOUS_CLUBS_BY_LEAGUE[oddLeagueId] ?? [];
    if (mainPool.length < 4 || oddPool.length < 2) continue;

    const threeClubs = pickN([...mainPool], `${ctx.seed}:lc3:${attempt}`, 3);
    const oddClub = oddPool[seededIndex(`${ctx.seed}:oc:${attempt}`, oddPool.length)]!;
    if (threeClubs.includes(oddClub)) continue;

    const repeatKey = `ooo:lg:${mainId}:${oddClub}`;
    const mainLabel = LEAGUE_LABELS[mainId] ?? 'league';

    const options = shuffleFour(
      [
        ...threeClubs.map((c, i) => ({ id: makeOptionId(questionId, `m${i}`), label: c })),
        { id: makeOptionId(questionId, 'odd'), label: oddClub },
      ],
      `${ctx.seed}:lc:${attempt}`
    );

    return {
      repeatKey,
      question: {
        id: questionId,
        type: 'odd_one_out',
        slot: ctx.slot,
        signature: ctx.signature,
        prompt: 'Odd one out',
        subPrompt: `Three ${mainLabel} clubs`,
        options,
        presentation: { layout: 'grid' },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, 'odd'),
        reveal: `${oddClub} — not a ${mainLabel} club`,
      },
    };
  }
  return null;
}

function seededShuffleClubs(seed: string): string[] {
  const arr = [...SHARED_CLUB_CANDIDATES];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    let h = 0;
    const s = `${seed}:${i}`;
    for (let j = 0; j < s.length; j += 1) h = (h << 5) - h + s.charCodeAt(j);
    const k = Math.abs(h) % (i + 1);
    [arr[i], arr[k]] = [arr[k]!, arr[i]!];
  }
  return arr;
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
