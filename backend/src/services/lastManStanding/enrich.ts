import { inArray, sql } from 'drizzle-orm';
import { resolveHeadshot } from '../../constants/footballMedia.js';
import { db } from '../../db/index.js';
import { players } from '../../db/schema.js';
import { getPhotoOverrides } from '../photoOverrides.js';
import type { LMSBuilderResult, LMSQuestionPublic } from './types.js';
import { teamLogoForClub } from './shared.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PlayerRow {
  id: string;
  name: string;
  nationality: string;
  position: string;
  api_football_id: number | null;
}

let overrideCache: Map<string, string | null> | null = null;

async function photoOverrides(): Promise<Map<string, string | null>> {
  if (!overrideCache) overrideCache = await getPhotoOverrides();
  return overrideCache;
}

function playerIdFromOption(questionId: string, optionId: string): string | null {
  const suffix = optionId.startsWith(`${questionId}-`)
    ? optionId.slice(questionId.length + 1)
    : optionId;
  return UUID_RE.test(suffix) ? suffix : null;
}

function isClubOptionQuestion(q: LMSQuestionPublic): boolean {
  return q.type === 'which_club' || q.type === 'image_badge' || isClubOddOneOut(q);
}

function isClubOddOneOut(q: LMSQuestionPublic): boolean {
  if (q.type !== 'odd_one_out') return false;
  const sub = q.subPrompt?.toLowerCase() ?? '';
  return sub.includes('clubs') || sub.includes('club');
}

async function loadPlayers(ids: string[]): Promise<Map<string, PlayerRow>> {
  if (ids.length === 0) return new Map();
  const rows = (await db
    .select({
      id: players.id,
      name: players.name,
      nationality: players.nationality,
      position: players.position,
      api_football_id: players.apiFootballId,
    })
    .from(players)
    .where(inArray(players.id, ids))) as PlayerRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadPlayersByNames(names: string[]): Promise<Map<string, PlayerRow>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = (await db.execute(sql`
    SELECT id, name, nationality, position, api_football_id
    FROM players
    WHERE name IN (${sql.join(unique.map((n) => sql`${n}`), sql`, `)})
      AND market_value_tier >= 4
  `)) as unknown as PlayerRow[];
  const map = new Map<string, PlayerRow>();
  for (const r of rows) map.set(r.name, r);
  return map;
}

export async function enrichLMSBuilderResult(result: LMSBuilderResult): Promise<LMSBuilderResult> {
  const overrides = await photoOverrides();
  const question = { ...result.question };
  let presentation = question.presentation ? { ...question.presentation } : undefined;

  if (presentation?.careerClubs?.length) {
    presentation.careerClubs = await Promise.all(
      presentation.careerClubs.map(async (club) => ({
        ...club,
        logoUrl: club.logoUrl ?? (await teamLogoForClub(club.name)),
      }))
    );
    question.presentation = presentation;
  }

  const clueNames =
    question.type === 'which_club'
      ? (
          presentation?.cluePlayers?.map((player) => player.name) ??
          question.subPrompt?.split('·').map((name) => name.trim()).filter(Boolean) ??
          []
        )
      : [];
  const cluePlayerIds =
    presentation?.cluePlayers
      ?.map((player) => player.id)
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)) ??
    [];
  const playerIds = [
    ...question.options
    .map((o) => playerIdFromOption(question.id, o.id))
    .filter((id): id is string => id != null),
    ...cluePlayerIds,
  ];
  const byId = await loadPlayers(playerIds);
  const byName = isClubOptionQuestion(question)
    ? new Map<string, PlayerRow>()
    : await loadPlayersByNames(question.options.map((o) => o.label));
  const clueByName =
    question.type === 'which_club'
      ? await loadPlayersByNames(clueNames)
      : new Map<string, PlayerRow>();

  if (question.type === 'which_club' && clueNames.length > 0) {
    const existingByName = new Map(
      (presentation?.cluePlayers ?? []).map((player) => [player.name, player])
    );
    presentation = {
      ...(presentation ?? {}),
      cluePlayers: clueNames.map((name) => {
        const existing = existingByName.get(name);
        const row =
          (existing?.id ? byId.get(existing.id) : undefined) ??
          clueByName.get(name);
        if (!row) return existing ?? { name };
        return {
          id: row.id,
          name: row.name,
          headshotUrl:
            resolveHeadshot(overrides.get(row.id), row.api_football_id) ??
            existing?.headshotUrl,
          nationality: row.nationality,
          position: row.position || undefined,
        };
      }),
    };
    question.presentation = presentation;
  }

  question.options = await Promise.all(
    question.options.map(async (opt) => {
      if (isClubOptionQuestion(question)) {
        const logo = opt.teamLogoUrl ?? (await teamLogoForClub(opt.label));
        return { ...opt, teamLogoUrl: logo ?? opt.teamLogoUrl };
      }

      const pid = playerIdFromOption(question.id, opt.id);
      const row = (pid ? byId.get(pid) : undefined) ?? byName.get(opt.label);
      if (!row) return opt;

      return {
        ...opt,
        headshotUrl:
          resolveHeadshot(overrides.get(row.id), row.api_football_id) ?? opt.headshotUrl,
        nationality: row.nationality,
        position: row.position,
      };
    })
  );

  return { ...result, question };
}

export function resetLMSEnrichCache(): void {
  overrideCache = null;
}
