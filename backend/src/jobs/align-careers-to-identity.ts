/**
 * Make Club Chain / club membership correct for merge-smell players by stripping clubs
 * that don't belong to their Transfermarkt identity (or deconflicted identity).
 *
 * Scope: merge-smell players only (same detector as compute-verified-club-counts).
 * Does NOT touch anyone else.
 *
 * Allowlist:
 *   1. TM transfers.csv for tm_player_id when present (name+DOB matched identity)
 *   2. Else deconflict keep-set from player_stats (drop namesake clubs that hard-conflict)
 *
 * Then DELETE player_career + player_stats rows whose club is not on the allowlist.
 * Never deletes the player row. Never invents new team_ids.
 *
 *   npx tsx src/jobs/align-careers-to-identity.ts
 *   npx tsx src/jobs/align-careers-to-identity.ts --apply
 */
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';
import { clubKey } from '../utils/clubCanonical.js';

const APPLY = process.argv.includes('--apply');
const DIR = 'transferdata';
const HARD_APPS = 20;

/**
 * When TM transfers.csv has no senior history for a mapped id, use a curated senior-club
 * allowlist (name+DOB identity). Only for known pollution cases — prefer CSV when present.
 */
const TM_CLUB_OVERRIDES: Record<string, string[]> = {
  // Adriano Correia (1984-10-26)
  '34495': [
    'Coritiba',
    'Sevilla',
    'Barcelona',
    'Beşiktaş',
    'Besiktas',
    'Athletico Paranaense',
    'Athlético Paranaense',
    'KAS Eupen',
    'Eupen',
  ],
  // Emerson Ferreira (1976-04-04) — tm id 70 is stale in CSV but DOB matches
  '70': ['Santos', 'Bayer Leverkusen', 'AS Roma', 'Roma', 'Juventus', 'Miami FC', 'Miami'],
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

async function streamCsv(
  path: string,
  onRow: (cols: string[], idx: Record<string, number>) => void
): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let idx: Record<string, number> | null = null;
  for await (const line of rl) {
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (!idx) {
      idx = {};
      cols.forEach((c, i) => {
        idx![c] = i;
      });
      continue;
    }
    onRow(cols, idx);
  }
}

function isJunkClub(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^without club$/i.test(n) || /^retired$/i.test(n)) return true;
  if (isYouthOrReserveSide(n) || /\bU\d{1,2}\b/i.test(n)) return true;
  return false;
}

/** TM youth rows still prove the senior club (Chelsea U21 → Chelsea). */
function seniorFromTm(name: string): string | null {
  const n = name.trim();
  if (!n || /^without club$/i.test(n) || /^retired$/i.test(n)) return null;
  const stripped = n
    .replace(/\s+U\d{1,2}(\s+W)?.*$/i, '')
    .replace(/\s+(Youth|Jugend|Yth\.?|II|B|Reserves?|Academy|Amateurs)$/i, '')
    .replace(/\s+Next Gen$/i, '')
    .trim();
  if (!stripped || stripped.length < 2) return null;
  return stripped;
}

const CLUB_ALIASES: Record<string, string> = {
  olympiacos: 'olympiakos',
  olympiakos: 'olympiakos',
  copenhagen: 'kobenhavn',
  kobenhavn: 'kobenhavn',
  'fc kobenhavn': 'kobenhavn',
  'football club kobenhavn': 'kobenhavn',
  'saint etienne': 'saint etienne',
  'st etienne': 'saint etienne',
  'avs fs': 'avs',
  'avs futebol': 'avs',
  'avs futebol sad': 'avs',
  'shakhtar d': 'shakhtar',
  'shakhtar donetsk': 'shakhtar',
  'psv eindhoven': 'psv',
  psv: 'psv',
  'stade rennais': 'rennes',
  rennes: 'rennes',
  'paris saint germain': 'psg',
  'paris sg': 'psg',
  psg: 'psg',
};

function clubCore(raw: string): string {
  let base = clubKey(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[.–—_-]+/g, ' ')
    .replace(
      /\b(football club|futbol club|futebol clube|calcio|associazione sportiva|societa sportiva|società sportiva|sporting club|olympique|syndesmos filathlon|kulubu|kulubu|peiraios|sad|s\.?a\.?d\.?|von \d+|19\d{2}|20\d{2})\b/g,
      ' '
    )
    .replace(/\b(royal|reial|the|de|da|do|di|cf|fc|afc|sc|ac|uc|as|ss|us|st)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CLUB_ALIASES[base] ?? base;
}

function coreTokens(raw: string): string[] {
  return clubCore(raw).split(' ').filter((t) => t.length >= 3);
}

function sameClub(a: string, b: string): boolean {
  const ca = clubCore(a);
  const cb = clubCore(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (CLUB_ALIASES[ca] && CLUB_ALIASES[ca] === CLUB_ALIASES[cb]) return true;
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

function onAllowlist(name: string, allow: string[]): boolean {
  if (isJunkClub(name)) return false;
  return allow.some((a) => sameClub(a, name));
}

function deconflictKeep(
  clubApps: Map<string, number>,
  seasonApps: Map<string, Map<number, number>>
): string[] {
  const clubs = [...clubApps.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep: string[] = [];
  const conflicts = (a: string, b: string): boolean => {
    const sa = seasonApps.get(a);
    const sb = seasonApps.get(b);
    if (!sa || !sb) return false;
    for (const [season, appsA] of sa) {
      if (appsA < HARD_APPS) continue;
      if ((sb.get(season) ?? 0) >= HARD_APPS) return true;
    }
    return false;
  };
  for (const [club] of clubs) {
    if (!keep.some((k) => conflicts(k, club))) keep.push(club);
  }
  return keep;
}

async function main() {
  console.log(APPLY ? 'APPLY — stripping non-identity clubs' : 'DRY RUN — pass --apply to write');

  const targets = (await db.execute(sql`
    WITH season_clubs AS (
      SELECT player_id FROM player_stats
      WHERE appearances > 0 AND team_name IS NOT NULL AND team_name <> '' AND league_id NOT IN (1, 4)
      GROUP BY player_id, season
      HAVING COUNT(DISTINCT lower(team_name)) >= 3
    ),
    hard_dual AS (
      SELECT player_id FROM (
        SELECT player_id, season FROM player_stats
        WHERE appearances >= ${HARD_APPS} AND team_name IS NOT NULL AND team_name <> '' AND league_id NOT IN (1, 4)
        GROUP BY player_id, season
        HAVING COUNT(DISTINCT lower(team_name)) >= 2
      ) s GROUP BY player_id HAVING COUNT(*) >= 2
    ),
    club_n AS (
      SELECT player_id, COUNT(DISTINCT lower(team_name))::int AS n FROM (
        SELECT player_id, team_name FROM player_career WHERE team_id > 0
        UNION
        SELECT player_id, team_name FROM player_stats
        WHERE appearances > 0 AND team_name IS NOT NULL AND league_id NOT IN (1, 4)
      ) u GROUP BY player_id
    )
    SELECT DISTINCT p.id, p.name, p.tm_player_id
    FROM players p
    LEFT JOIN club_n c ON c.player_id = p.id
    WHERE p.id IN (SELECT player_id FROM season_clubs)
       OR p.id IN (SELECT player_id FROM hard_dual)
       OR (COALESCE(c.n, 0) >= 12 AND (position(' ' in p.name) = 0 OR length(p.name) <= 6))
       OR p.tm_player_id IN ('34495', '70')
    ORDER BY p.name
  `)) as unknown as Array<{
    id: string;
    name: string;
    tm_player_id: string | null;
  }>;
  console.log(`Merge-smell targets: ${targets.length}`);

  const tmIds = new Set(targets.map((t) => t.tm_player_id).filter((x): x is string => !!x));
  const tmClubs = new Map<string, string[]>();
  await streamCsv(join(DIR, 'transfers.csv'), (cols, ix) => {
    const tmId = cols[ix.player_id!]?.trim() ?? '';
    if (!tmIds.has(tmId)) return;
    for (const col of ['to_club_name', 'from_club_name'] as const) {
      const name = cols[ix[col]!]?.trim() ?? '';
      const senior = seniorFromTm(name);
      if (!senior || isYouthOrReserveSide(senior)) continue;
      const list = tmClubs.get(tmId) ?? [];
      if (!list.some((x) => sameClub(x, senior))) list.push(senior);
      tmClubs.set(tmId, list);
    }
  });
  console.log(`TM transfer allowlists: ${tmClubs.size}`);

  let careerDeleted = 0;
  let statsDeleted = 0;
  const watch = ['Nenê', 'Emerson', 'Adriano', 'Willian', 'Zanka'];

  for (const t of targets) {
    const rows = (await db.execute(sql`
      SELECT lower(team_name) AS club, season, SUM(appearances)::int AS apps
      FROM player_stats
      WHERE player_id = ${t.id}::uuid
        AND appearances > 0 AND team_name IS NOT NULL AND team_name <> ''
        AND league_id NOT IN (1, 4)
      GROUP BY lower(team_name), season
    `)) as unknown as Array<{ club: string; season: number; apps: number }>;

    const clubApps = new Map<string, number>();
    const seasonApps = new Map<string, Map<number, number>>();
    for (const r of rows) {
      if (isJunkClub(r.club)) continue;
      clubApps.set(r.club, (clubApps.get(r.club) ?? 0) + r.apps);
      const sm = seasonApps.get(r.club) ?? new Map();
      sm.set(r.season, (sm.get(r.season) ?? 0) + r.apps);
      seasonApps.set(r.club, sm);
    }

    let allow: string[] = [];
    let source = 'deconflict';
    if (t.tm_player_id && tmClubs.has(t.tm_player_id) && tmClubs.get(t.tm_player_id)!.length >= 3) {
      allow = tmClubs.get(t.tm_player_id)!;
      source = 'tm_transfers';
    } else if (t.tm_player_id && TM_CLUB_OVERRIDES[t.tm_player_id]) {
      allow = TM_CLUB_OVERRIDES[t.tm_player_id]!;
      source = 'tm_override';
    } else {
      allow = deconflictKeep(clubApps, seasonApps);
      // Drop fringe namesake clubs that never overlap the seed club's years and aren't large.
      if (allow.length && clubApps.size) {
        const seed = [...clubApps.entries()].sort((a, b) => b[1] - a[1])[0]!;
        const seedSeasons = [...(seasonApps.get(seed[0])?.keys() ?? [])];
        const seedFirst = Math.min(...seedSeasons);
        const seedLast = Math.max(...seedSeasons);
        const minApps = Math.max(25, Math.floor(seed[1] * 0.35));
        allow = allow.filter((c) => {
          if (sameClub(c, seed[0])) return true;
          const apps = clubApps.get(c) ?? 0;
          if (apps >= minApps) return true;
          const seasons = [...(seasonApps.get(c)?.keys() ?? [])];
          if (!seasons.length) return false;
          const first = Math.min(...seasons);
          const last = Math.max(...seasons);
          return last >= seedFirst && first <= seedLast; // overlap seed era
        });
      }
    }

    if (allow.length < 2) {
      console.log(`  skip ${t.name}: allowlist too small (${allow.length}) via ${source}`);
      continue;
    }

    const career = (await db.execute(sql`
      SELECT team_id, team_name, season_from, season_to FROM player_career
      WHERE player_id = ${t.id}::uuid AND team_id > 0
    `)) as unknown as Array<{
      team_id: number;
      team_name: string;
      season_from: number;
      season_to: number | null;
    }>;

    const careerDrop = career.filter((c) => !onAllowlist(c.team_name, allow));
    const statsClubs = [...clubApps.keys()];
    const statsDrop = statsClubs.filter((c) => !onAllowlist(c, allow));

    if (watch.includes(t.name) || careerDrop.length || statsDrop.length) {
      console.log(
        `  ${t.name} [${source}] keep≈${allow.length}` +
          (careerDrop.length ? ` career-drop: ${careerDrop.map((c) => c.team_name).join(', ')}` : '') +
          (statsDrop.length ? ` stats-drop: ${statsDrop.slice(0, 8).join(', ')}${statsDrop.length > 8 ? '…' : ''}` : '')
      );
    }

    if (!APPLY) {
      careerDeleted += careerDrop.length;
      statsDeleted += statsDrop.length;
      continue;
    }

    for (const c of careerDrop) {
      await db.execute(sql`
        DELETE FROM player_career
        WHERE player_id = ${t.id}::uuid
          AND team_id = ${c.team_id}
          AND season_from = ${c.season_from}
          AND team_name = ${c.team_name}
      `);
      careerDeleted += 1;
    }

    for (const club of statsDrop) {
      const res = (await db.execute(sql`
        DELETE FROM player_stats
        WHERE player_id = ${t.id}::uuid
          AND team_name IS NOT NULL
          AND lower(team_name) = ${club}
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      statsDeleted += res.length;
    }

    // National-team scrap on career (Brazil on club-merged Adriano, etc.)
    await db.execute(sql`
      DELETE FROM player_career
      WHERE player_id = ${t.id}::uuid
        AND team_id > 0
        AND EXISTS (
          SELECT 1 FROM players p
          WHERE p.id = ${t.id}::uuid
            AND (
              p.nationality = player_career.team_name
              OR p.nationality = regexp_replace(player_career.team_name, '\\s+U\\d+.*$', '', 'i')
            )
        )
    `);
  }

  console.log(`\nCareer rows ${APPLY ? 'deleted' : 'would delete'}: ${careerDeleted}`);
  console.log(`Stats club-keys ${APPLY ? 'deleted' : 'would delete'}: ${statsDeleted}`);

  if (APPLY) {
    console.log('\nNext:');
    console.log('  npm run job:refresh-club-chain-paths -- --apply');
    console.log('  npm run job:regenerate-draft-most-clubs');
  } else {
    console.log('\nRe-run with --apply to write.');
  }

  // Post-state for watch list
  for (const name of watch) {
    const p = targets.find((t) => t.name === name);
    if (!p) continue;
    const career = (await db.execute(sql`
      SELECT team_name, season_from, season_to FROM player_career
      WHERE player_id = ${p.id}::uuid AND team_id > 0 ORDER BY season_from
    `)) as unknown as Array<{ team_name: string; season_from: number; season_to: number | null }>;
    if (APPLY) {
      console.log(
        `  ${name} career now: ${career.map((c) => c.team_name).join(', ') || '(none)'}`
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
