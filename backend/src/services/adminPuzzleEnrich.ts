import { leagueLogoUrl, resolveHeadshot } from '../constants/footballMedia.js';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';
import { resolveAdminBingoPlayer, resolveAdminPlayer } from './adminEntitySearch.js';
import {
  recomputeBattleOptimalLineup,
  type BattlePuzzleJson,
} from './battleGenerator.js';
import {
  refreshBackYourselfAnswer,
  type BackYourselfCategory,
  type BackYourselfPuzzlePublic,
} from './backYourselfGenerator.js';
import { LMS_PUZZLE_VERSION } from './lastManStanding/types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LMSOption = {
  id: string;
  label: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
  nationality?: string;
  position?: string;
};

type LMSQuestion = {
  id: string;
  type: string;
  slot: number;
  prompt?: string;
  subPrompt?: string;
  options: LMSOption[];
  presentation?: {
    layout?: string;
    imageUrl?: string;
    imageBlur?: number;
    careerClubs?: Array<{ name: string; logoUrl?: string; note?: 'loan' }>;
    cluePlayers?: Array<{
      id?: string;
      name: string;
      headshotUrl?: string;
      nationality?: string;
      position?: string;
    }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type LMSPuzzle = {
  version?: number;
  questions: LMSQuestion[];
  [k: string]: unknown;
};

type LMSAnswer = {
  questions: Array<{
    questionId: string;
    correctOptionId: string;
    reveal?: string;
  }>;
};

function playerIdFromOption(questionId: string, optionId: string): string | null {
  const suffix = optionId.startsWith(`${questionId}-`)
    ? optionId.slice(questionId.length + 1)
    : optionId;
  return UUID_RE.test(suffix) ? suffix : null;
}

function isClubQuestion(q: LMSQuestion): boolean {
  if (q.type === 'which_club' || q.type === 'image_badge') return true;
  if (q.type !== 'odd_one_out') return false;
  const sub = q.subPrompt?.toLowerCase() ?? '';
  return sub.includes('club');
}

/**
 * Re-hydrate LMS media from selected option ids/labels so admin edits always ship
 * correct headshots / badge logos / blurred imageUrl.
 */
export async function enrichAdminLMSPuzzle(
  puzzleJson: unknown,
  answerJson: unknown
): Promise<{ puzzleJson: LMSPuzzle; answerJson: LMSAnswer }> {
  const puzzle = structuredClone(puzzleJson) as LMSPuzzle;
  const answer = structuredClone(answerJson) as LMSAnswer;
  if (!Array.isArray(puzzle.questions)) return { puzzleJson: puzzle, answerJson: answer };

  const playerIds = new Set<string>();
  const cluePlayerNames = new Set<string>();
  for (const q of puzzle.questions) {
    for (const cluePlayer of q.presentation?.cluePlayers ?? []) {
      if (cluePlayer.id && UUID_RE.test(cluePlayer.id)) playerIds.add(cluePlayer.id);
    }
    if (q.type === 'which_club') {
      for (const name of q.subPrompt?.split('·').map((value) => value.trim()) ?? []) {
        if (name) cluePlayerNames.add(name);
      }
    }
    if (q.type === 'custom_image') continue;
    if (isClubQuestion(q)) continue;
    for (const o of q.options ?? []) {
      const pid = playerIdFromOption(q.id, o.id);
      if (pid) playerIds.add(pid);
    }
  }

  const overrides = await getPhotoOverrides();
  const playerMap = new Map<
    string,
    { id: string; name: string; nationality: string; position: string; apiFootballId: number | null }
  >();
  if (playerIds.size > 0) {
    const rows = await db
      .select({
        id: players.id,
        name: players.name,
        nationality: players.nationality,
        position: players.position,
        apiFootballId: players.apiFootballId,
      })
      .from(players)
      .where(inArray(players.id, [...playerIds]));
    for (const r of rows) playerMap.set(r.id, r);
  }
  const cluePlayerMap = new Map<
    string,
    { id: string; name: string; nationality: string; position: string; apiFootballId: number | null }
  >();
  if (cluePlayerNames.size > 0) {
    const rows = await db
      .select({
        id: players.id,
        name: players.name,
        nationality: players.nationality,
        position: players.position,
        apiFootballId: players.apiFootballId,
      })
      .from(players)
      .where(inArray(players.name, [...cluePlayerNames]));
    for (const row of rows) cluePlayerMap.set(row.name, row);
  }

  for (const q of puzzle.questions) {
    const ans = answer.questions?.find((x) => x.questionId === q.id);
    if (q.type === 'custom_image') {
      q.options = await Promise.all(
        (q.options ?? []).map(async (option) => ({
          ...option,
          teamLogoUrl:
            (await lookupTeamLogo(option.label, ''))?.logoUrl ??
            option.teamLogoUrl,
        }))
      );
      continue;
    }

    if (isClubQuestion(q)) {
      if (q.type === 'which_club') {
        const cluePlayers: Array<{
          id?: string;
          name: string;
          headshotUrl?: string;
          nationality?: string;
          position?: string;
        }> =
          q.presentation?.cluePlayers?.length
            ? q.presentation.cluePlayers
            : (q.subPrompt?.split('·').map((name) => ({ name: name.trim() })) ?? []);
        q.presentation = {
          ...(q.presentation ?? {}),
          cluePlayers: cluePlayers.map((cluePlayer) => {
            const row =
              (cluePlayer.id ? playerMap.get(cluePlayer.id) : undefined) ??
              cluePlayerMap.get(cluePlayer.name);
            if (!row) return cluePlayer;
            return {
              id: row.id,
              name: row.name,
              headshotUrl:
                resolveHeadshot(overrides.get(row.id), row.apiFootballId) ??
                cluePlayer.headshotUrl,
              nationality: row.nationality,
              position: row.position || undefined,
            };
          }),
        };
      }
      q.options = await Promise.all(
        (q.options ?? []).map(async (opt) => {
          const logo = (await lookupTeamLogo(opt.label, ''))?.logoUrl ?? opt.teamLogoUrl;
          return {
            id: opt.id,
            label: opt.label,
            teamLogoUrl: logo,
          };
        })
      );

      if (q.type === 'image_badge' && ans) {
        const correct = q.options.find((o) => o.id === ans.correctOptionId);
        if (correct) {
          q.presentation = {
            ...(q.presentation ?? {}),
            layout: 'image_header',
            imageUrl: correct.teamLogoUrl || q.presentation?.imageUrl,
            imageBlur: q.presentation?.imageBlur ?? 6,
          };
          ans.reveal = correct.label;
        }
      }
      continue;
    }

    q.options = (q.options ?? []).map((opt) => {
      const pid = playerIdFromOption(q.id, opt.id);
      const row = pid ? playerMap.get(pid) : undefined;
      if (!row) {
        // Keep label but drop stale headshot if we can't resolve — better blank than wrong face.
        return {
          id: opt.id,
          label: opt.label,
          headshotUrl: opt.headshotUrl,
          teamLogoUrl: opt.teamLogoUrl,
          nationality: opt.nationality,
          position: opt.position,
        };
      }
      return {
        id: opt.id,
        label: row.name || opt.label,
        headshotUrl: resolveHeadshot(overrides.get(row.id), row.apiFootballId) ?? undefined,
        nationality: row.nationality,
        position: row.position || undefined,
      };
    });

    if (Array.isArray(q.presentation?.careerClubs)) {
      q.presentation = {
        ...q.presentation,
        careerClubs: await Promise.all(
          q.presentation.careerClubs.map(async (club) => ({
            ...club,
            name: club.name,
            logoUrl: (await lookupTeamLogo(club.name, ''))?.logoUrl ?? club.logoUrl,
          }))
        ),
      };
    }
  }

  puzzle.version = LMS_PUZZLE_VERSION;
  return { puzzleJson: puzzle, answerJson: answer };
}

export async function enrichAdminOneMorePuzzle(puzzleJson: unknown): Promise<unknown> {
  const puzzle = structuredClone(puzzleJson) as {
    rounds?: Array<{ options?: Array<Record<string, unknown>> }>;
  };
  if (!Array.isArray(puzzle.rounds)) return puzzleJson;

  for (const round of puzzle.rounds) {
    if (!Array.isArray(round.options)) continue;
    round.options = await Promise.all(
      round.options.map(async (opt) => {
        const id = typeof opt.id === 'string' ? opt.id : null;
        if (!id || !UUID_RE.test(id)) return opt;
        const resolved = await resolveAdminPlayer(id);
        if (!resolved) return opt;
        return {
          ...opt,
          id: resolved.id,
          name: resolved.name,
          nationality: resolved.nationality,
          position: resolved.position,
          clubs: resolved.clubs,
          headshotUrl: resolved.headshotUrl,
          teamId: resolved.teamId,
          teamLogoUrl: resolved.teamLogoUrl,
          value: opt.value,
        };
      })
    );
  }
  return puzzle;
}

export async function enrichAdminClubChainPuzzle(puzzleJson: unknown): Promise<unknown> {
  const puzzle = structuredClone(puzzleJson) as {
    start?: Record<string, unknown>;
    target?: Record<string, unknown>;
  };
  for (const key of ['start', 'target'] as const) {
    const card = puzzle[key];
    const id = typeof card?.id === 'string' ? card.id : null;
    if (!id || !UUID_RE.test(id)) continue;
    const resolved = await resolveAdminPlayer(id);
    if (!resolved) continue;
    puzzle[key] = {
      ...card,
      id: resolved.id,
      name: resolved.name,
      club: resolved.club,
      nationality: resolved.nationality,
      position: resolved.position,
      headshotUrl: resolved.headshotUrl,
    };
  }
  return puzzle;
}

/** Attach player headshots to Golf answers for the ops editor (batch lookup). */
export async function enrichAdminGolfPuzzle(puzzleJson: unknown): Promise<unknown> {
  const puzzle = structuredClone(puzzleJson) as {
    holes?: Array<{
      rule?: unknown;
      templateId?: unknown;
      answers?: Array<{ id?: string; headshotUrl?: string; [key: string]: unknown }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };

  puzzle.holes = (puzzle.holes ?? []).map((hole) => {
    const rule = hole.rule;
    if (
      rule &&
      typeof rule === 'object' &&
      !Array.isArray(rule) &&
      Object.keys(rule).length === 0
    ) {
      const { rule: _rule, templateId: _templateId, ...rest } = hole;
      return rest;
    }
    return hole;
  });

  const ids = new Set<string>();
  for (const hole of puzzle.holes ?? []) {
    for (const answer of hole.answers ?? []) {
      if (typeof answer.id === 'string' && UUID_RE.test(answer.id)) ids.add(answer.id);
    }
  }
  if (ids.size === 0) return puzzle;

  const overrides = await getPhotoOverrides();
  const rows = await db
    .select({
      id: players.id,
      apiFootballId: players.apiFootballId,
    })
    .from(players)
    .where(inArray(players.id, [...ids]));
  const headshots = new Map(
    rows.map((row) => [
      row.id,
      resolveHeadshot(overrides.get(row.id), row.apiFootballId) ?? undefined,
    ])
  );

  for (const hole of puzzle.holes ?? []) {
    hole.answers = (hole.answers ?? []).map((answer) => {
      if (typeof answer.id !== 'string') return answer;
      const headshotUrl = headshots.get(answer.id);
      return headshotUrl ? { ...answer, headshotUrl } : answer;
    });
  }
  return puzzle;
}

export async function enrichAdminBingoPuzzle(puzzleJson: unknown): Promise<unknown> {
  const puzzle = structuredClone(puzzleJson) as {
    players?: Array<Record<string, unknown>>;
    categories?: Array<Record<string, unknown>>;
  };
  if (Array.isArray(puzzle.players)) {
    puzzle.players = await Promise.all(
      puzzle.players.map(async (pl) => {
        const id = typeof pl.id === 'string' ? pl.id : null;
        if (!id || !UUID_RE.test(id)) return pl;
        const resolved = await resolveAdminBingoPlayer(id);
        return resolved ? { ...pl, ...resolved } : pl;
      })
    );
  }
  if (Array.isArray(puzzle.categories)) {
    puzzle.categories = await Promise.all(
      puzzle.categories.map(async (cat) => {
        const iconType = String(cat.iconType ?? '');
        const type = String(cat.type ?? '');
        if (iconType === 'clubBadge' || type === 'playedForClub') {
          const name = String(cat.matchingRule ?? '');
          if (!name) return cat;
          const logo = await lookupTeamLogo(name, '');
          return { ...cat, logoUrl: logo?.logoUrl ?? cat.logoUrl };
        }
        if (iconType === 'nationClub' || type === 'nationClub') {
          const club = String(cat.matchingRule ?? '').split('|')[1] ?? '';
          if (!club) return cat;
          const logo = await lookupTeamLogo(club, '');
          return { ...cat, logoUrl: logo?.logoUrl ?? cat.logoUrl };
        }
        if (iconType === 'clubCombo' || type === 'clubCombo') {
          const [a, b] = String(cat.matchingRule ?? '').split('|');
          const la = a ? await lookupTeamLogo(a, '') : null;
          const lb = b ? await lookupTeamLogo(b, '') : null;
          return {
            ...cat,
            logoUrl: la?.logoUrl ?? cat.logoUrl,
            logo2Url: lb?.logoUrl ?? cat.logo2Url,
          };
        }
        return cat;
      })
    );
  }
  return puzzle;
}

/**
 * Re-hydrate Draft XI media and re-solve the optimal XI from the current constraint chips.
 * Ops constraint edits only update labels unless we recompute here — that stale XI would also
 * ship to the app as the perfect-score reference.
 */
export async function enrichAdminDraftPuzzle(
  puzzleJson: unknown,
  opts?: { requireOptimal?: boolean }
): Promise<unknown> {
  const puzzle = structuredClone(puzzleJson) as BattlePuzzleJson & {
    constraints: Array<BattlePuzzleJson['constraints'][number] & { type?: string }>;
    optimalLineup: Array<
      BattlePuzzleJson['optimalLineup'][number] & { headshotUrl?: string | null }
    >;
    optimalScore: number;
  };

  if (Array.isArray(puzzle.constraints)) {
    puzzle.constraints = await Promise.all(
      puzzle.constraints.map(async (c) => {
        const type = String(c.type ?? '');
        const normalizedType =
          type === 'natLeague' ? 'nat_league' : type === 'natClub' ? 'nat_club' : type;
        const base = {
          ...c,
          type: normalizedType as BattlePuzzleJson['constraints'][number]['type'],
        };
        if ((normalizedType === 'club' || normalizedType === 'nat_club') && c.club) {
          const logo = await lookupTeamLogo(c.club, c.leagueName ?? '');
          return {
            ...base,
            teamId: logo?.teamId ?? c.teamId ?? null,
            logoUrl: logo?.logoUrl ?? c.logoUrl ?? null,
          };
        }
        if (
          (normalizedType === 'league' || normalizedType === 'nat_league') &&
          c.leagueId != null
        ) {
          return { ...base, logoUrl: leagueLogoUrl(c.leagueId), teamId: null };
        }
        return base;
      })
    );
  }

  const solved = await recomputeBattleOptimalLineup(puzzle);
  if (solved) {
    puzzle.optimalScore = solved.optimalScore;
    puzzle.optimalLineup = solved.optimalLineup;
  } else if (opts?.requireOptimal) {
    throw new Error(
      'Could not solve an optimal XI for these Draft constraints. Check each chip still has eligible players.'
    );
  }

  if (Array.isArray(puzzle.optimalLineup)) {
    puzzle.optimalLineup = await Promise.all(
      puzzle.optimalLineup.map(async (pick) => {
        const id = typeof pick.playerId === 'string' ? pick.playerId : null;
        if (!id || !UUID_RE.test(id)) return pick;
        const resolved = await resolveAdminPlayer(id);
        if (!resolved) return pick;
        return {
          ...pick,
          playerName: resolved.name || pick.playerName,
          headshotUrl:
            resolved.headshotUrl ??
            (pick as { headshotUrl?: string | null }).headshotUrl ??
            null,
        };
      })
    );
  }

  return puzzle;
}

/**
 * Refresh Back Yourself logos + valid player pool from the current category chip.
 */
export async function enrichAdminBackYourselfPuzzle(
  puzzleJson: unknown,
  answerJson: unknown,
  opts?: { requirePoolBounds?: boolean }
): Promise<{ puzzleJson: unknown; answerJson: unknown }> {
  const puzzle = structuredClone(puzzleJson) as BackYourselfPuzzlePublic;
  if (!puzzle?.category) {
    throw new Error('Back Yourself puzzle is missing a category');
  }
  const refreshed = await refreshBackYourselfAnswer(puzzle.category as BackYourselfCategory);
  if (opts?.requirePoolBounds && (refreshed.maxPool < 10 || refreshed.maxPool > 120)) {
    throw new Error(
      `Player pool size ${refreshed.maxPool} is outside 10–120. Pick a different category.`
    );
  }
  puzzle.category = refreshed.category;
  puzzle.maxPool = refreshed.maxPool;
  puzzle.xpCap = refreshed.xpCap;
  const answer = {
    modeId: 'back_yourself' as const,
    validPlayerIds: refreshed.validPlayerIds,
    ...((answerJson && typeof answerJson === 'object' ? answerJson : {}) as object),
  };
  return { puzzleJson: puzzle, answerJson: { ...answer, validPlayerIds: refreshed.validPlayerIds } };
}

export async function enrichAdminPuzzleForSave(
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown
): Promise<{ puzzleJson: unknown; answerJson: unknown }> {
  switch (modeId) {
    case 'last_man_standing': {
      const enriched = await enrichAdminLMSPuzzle(puzzleJson, answerJson);
      return enriched;
    }
    case 'one_more':
      return { puzzleJson: await enrichAdminOneMorePuzzle(puzzleJson), answerJson };
    case 'club_chain':
      return { puzzleJson: await enrichAdminClubChainPuzzle(puzzleJson), answerJson };
    case 'football_bingo':
      return { puzzleJson: await enrichAdminBingoPuzzle(puzzleJson), answerJson };
    case 'football_golf':
      return { puzzleJson: await enrichAdminGolfPuzzle(puzzleJson), answerJson };
    case 'draft_master':
      return {
        puzzleJson: await enrichAdminDraftPuzzle(puzzleJson, { requireOptimal: true }),
        answerJson,
      };
    case 'back_yourself':
      return enrichAdminBackYourselfPuzzle(puzzleJson, answerJson, { requirePoolBounds: true });
    default:
      return { puzzleJson, answerJson };
  }
}
