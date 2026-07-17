import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { isNationalTeam, isYouthOrReserveSide, nationSet } from '../../../utils/nationalTeam.js';
import type {
  LMSBuildContext,
  LMSBuilderResult,
  LMSCareerClubPublic,
} from '../types.js';
import {
  careerPrestigeBand,
  pickPlausibleCareerDistractors,
  preferredCareerOverlap,
} from '../plausibility.js';
import { isHouseholdIndexed, playerUsedKey } from '../recognition.js';
import { famousPlayers, makeOptionId, seededIndex } from '../shared.js';

interface CareerRow {
  player_id: string;
  name: string;
  nationality: string;
  prestige: number;
  current_club: string;
  clubs: string[];
}

export interface CareerTransferRow {
  player_id: string;
  transfer_date: string | null;
  transfer_type: string;
  from_team_name: string | null;
  from_logo_url: string | null;
  to_team_name: string | null;
  to_logo_url: string | null;
}

let cachedCareerRows: CareerRow[] | null = null;
let cachedCareerTransfers: Map<string, CareerTransferRow[]> | null = null;

export async function buildCareerPath(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const index = ctx.clubIndex;
  const pool = ctx.famousPool;
  if (!index || !pool) return null;

  const nations = await nationSet();
  const minOverlap = 1;
  const preferredOverlap = preferredCareerOverlap(ctx.difficulty.tier);
  const band = careerPrestigeBand(ctx.difficulty.tier);

  let rows = cachedCareerRows;
  if (!rows) rows = (await db.execute(sql`
    WITH club_order AS (
      SELECT pc.player_id,
        pc.team_name,
        MIN(pc.season_from) AS sf
      FROM player_career pc
      JOIN players p ON p.id = pc.player_id
      WHERE p.market_value_tier >= 4 AND pc.team_id > 0
        AND NOT (
          (
            EXISTS (SELECT 1 FROM players _n WHERE _n.nationality <> '' AND _n.nationality = pc.team_name)
            OR EXISTS (
              SELECT 1 FROM players _n
              WHERE _n.nationality <> ''
                AND _n.nationality = regexp_replace(pc.team_name, '\\s+U\\d{1,2}(\\s+W)?$', '', 'i')
            )
            OR pc.team_name ~* '\\s+(Olympics?|Olympic)$'
          )
          AND NOT EXISTS (SELECT 1 FROM teams _t WHERE _t.id = pc.team_id AND _t.league_id IS NOT NULL)
        )
      GROUP BY pc.player_id, pc.team_name
    ),
    paths AS (
      SELECT co.player_id,
        array_agg(co.team_name ORDER BY co.sf, co.team_name) AS clubs
      FROM club_order co
      GROUP BY co.player_id
      HAVING count(*) >= 3
    )
    SELECT p.id AS player_id, p.name, p.nationality, p.current_club, paths.clubs,
      (p.market_value_tier * 10)::int AS prestige
    FROM paths
    JOIN players p ON p.id = paths.player_id
    WHERE array_length(paths.clubs, 1) >= 3
    ORDER BY p.market_value_tier DESC, p.peak_market_value_eur DESC NULLS LAST
    LIMIT 500
  `)) as unknown as CareerRow[];
  cachedCareerRows = rows;

  if (rows.length < 20) return null;
  const transfersByPlayer =
    cachedCareerTransfers ?? await loadCareerTransfers(rows.map((row) => row.player_id));
  cachedCareerTransfers = transfersByPlayer;

  const start = seededIndex(ctx.seed, rows.length);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const row = rows[(start + attempt) % rows.length]!;
    if (ctx.usedKeys.has(playerUsedKey(row.player_id))) continue;
    if (index && !isHouseholdIndexed(index, row.player_id)) continue;
    const fallback = buildFallbackCareerPath(row.clubs, row.current_club, nations);
    const transferPath = buildTransferCareerPath(
      transfersByPlayer.get(row.player_id) ?? [],
      row.current_club,
      nations
    );
    const fullPath = transferPath.length >= 3 ? transferPath : fallback;
    const path = fitCareerPath(fullPath, 6);
    const pathNames = path.map((club) => club.name);
    if (path.length < 3 || new Set(pathNames).size < 3) continue;

    const targetPrestige = index.prestigeByPlayer.get(row.player_id) ?? row.prestige;
    let distractors = pickPlausibleCareerDistractors(
      pool,
      index,
      row.player_id,
      targetPrestige,
      row.nationality,
      pathNames,
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
        pathNames,
        minOverlap,
        band,
        `${ctx.seed}:d2`
      );
    }
    if (distractors.length < 3) continue;
    if (distractors.some((d) => ctx.usedKeys.has(playerUsedKey(d.id)))) continue;
    if (distractors.some((d) => index && !isHouseholdIndexed(index, d.id))) continue;

    const repeatKey = `cp:${row.player_id}:${path.map(careerClubLabel).join('>')}`;
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
      extraUsedKeys: [
        playerUsedKey(row.player_id),
        ...distractors.map((d) => playerUsedKey(d.id)),
      ],
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
          careerClubs: path,
          careerPathVersion: 2,
        },
      },
      answer: {
        questionId,
        correctOptionId: makeOptionId(questionId, row.player_id),
        reveal: `${row.name} — ${path.map(careerClubLabel).join(' → ')}`,
      },
    };
  }
  return null;
}

async function loadCareerTransfers(playerIds: string[]): Promise<Map<string, CareerTransferRow[]>> {
  const result = new Map<string, CareerTransferRow[]>();
  if (playerIds.length === 0) return result;
  const ids = sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT pt.player_id,
      pt.transfer_date::text,
      pt.transfer_type,
      COALESCE(from_team.name, pt.from_team_name) AS from_team_name,
      from_team.logo_url AS from_logo_url,
      COALESCE(to_team.name, pt.to_team_name) AS to_team_name,
      to_team.logo_url AS to_logo_url
    FROM player_transfers pt
    LEFT JOIN teams from_team ON from_team.id = pt.from_team_id
    LEFT JOIN teams to_team ON to_team.id = pt.to_team_id
    WHERE pt.player_id IN (${ids})
    ORDER BY pt.player_id, pt.transfer_date NULLS LAST, pt.id
  `)) as unknown as CareerTransferRow[];
  for (const row of rows) {
    const list = result.get(row.player_id) ?? [];
    list.push(row);
    result.set(row.player_id, list);
  }
  return result;
}

function usableClub(name: string | null, nations: Set<string>): name is string {
  return Boolean(
    name?.trim() &&
    !isNationalTeam(name, nations) &&
    !isYouthOrReserveSide(name)
  );
}

function clubKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/footballclub$/, '')
    .replace(/fc$/, '');
}

function sameClub(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && clubKey(a) === clubKey(b));
}

function appendCareerClub(
  path: LMSCareerClubPublic[],
  club: LMSCareerClubPublic
): void {
  if (!club.name.trim()) return;
  const previous = path.at(-1);
  if (previous && sameClub(previous.name, club.name) && previous.note === club.note) return;
  path.push(club);
}

function isLoanTransfer(type: string): boolean {
  return type.toLowerCase().includes('loan');
}

/**
 * Turn transfer events into the actual travelled path. Temporary parent-club returns immediately
 * followed by another loan are suppressed, while the final return is retained.
 */
export function buildTransferCareerPath(
  rows: CareerTransferRow[],
  _currentClub: string,
  nations: Set<string>
): LMSCareerClubPublic[] {
  const path: LMSCareerClubPublic[] = [];
  const first = rows[0];
  if (first && usableClub(first.from_team_name, nations)) {
    appendCareerClub(path, {
      name: first.from_team_name,
      logoUrl: first.from_logo_url ?? undefined,
    });
  }
  rows.forEach((row, index) => {
    if (!usableClub(row.to_team_name, nations)) return;
    const next = rows[index + 1];
    const loan = isLoanTransfer(row.transfer_type);
    const returningToKnownClub = path.some((club) => sameClub(club.name, row.to_team_name));
    const temporaryReturn =
      !loan &&
      returningToKnownClub &&
      next != null &&
      isLoanTransfer(next.transfer_type) &&
      sameClub(row.to_team_name, next.from_team_name);
    if (temporaryReturn) return;
    appendCareerClub(path, {
      name: row.to_team_name,
      logoUrl: row.to_logo_url ?? undefined,
      ...(loan ? { note: 'loan' as const } : {}),
    });
  });
  return path;
}

export function buildFallbackCareerPath(
  clubs: string[],
  currentClub: string,
  nations: Set<string>
): LMSCareerClubPublic[] {
  const path: LMSCareerClubPublic[] = [];
  for (const name of clubs) {
    if (!usableClub(name, nations)) continue;
    appendCareerClub(path, { name });
  }
  if (usableClub(currentClub, nations) && !sameClub(path.at(-1)?.name, currentClub)) {
    appendCareerClub(path, { name: currentClub });
  }
  return path;
}

/** Keep the whole path when possible; otherwise sample the full timeline while preserving endpoints. */
export function fitCareerPath(
  path: LMSCareerClubPublic[],
  maximum: number
): LMSCareerClubPublic[] {
  if (path.length <= maximum) return path;
  const selected: LMSCareerClubPublic[] = [];
  const last = path.length - 1;
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index * last) / (maximum - 1));
    appendCareerClub(selected, path[sourceIndex]!);
  }
  return selected;
}

function careerClubLabel(club: LMSCareerClubPublic): string {
  return `${club.name}${club.note === 'loan' ? ' (loan)' : ''}`;
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
