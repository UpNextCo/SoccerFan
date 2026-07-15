import { resolveHeadshot } from '../constants/footballMedia.js';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';
import { resolveAdminBingoPlayer, resolveAdminPlayer } from './adminEntitySearch.js';

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
    careerClubs?: Array<{ name: string; logoUrl?: string }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type LMSPuzzle = {
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
  for (const q of puzzle.questions) {
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
            name: club.name,
            logoUrl: (await lookupTeamLogo(club.name, ''))?.logoUrl ?? club.logoUrl,
          }))
        ),
      };
    }
  }

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
    case 'football_golf': {
      const puzzle = structuredClone(puzzleJson) as {
        holes?: Array<Record<string, unknown>>;
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
      return { puzzleJson: puzzle, answerJson };
    }
    default:
      return { puzzleJson, answerJson };
  }
}
