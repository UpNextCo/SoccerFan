/**
 * Restore player_stats / player_career clubs deleted by the bad mononym "component trim".
 *
 * Source of truth: Transfermarkt appearances.csv for the player's tm_player_id
 * (already matched onto players via name + DOB). Gap-fill only — never overwrites
 * existing rows.
 *
 *   npx tsx src/jobs/restore-component-trim-damage.ts
 *   npx tsx src/jobs/restore-component-trim-damage.ts --apply
 */
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubKey, buildClubDisplayMap } from '../utils/clubCanonical.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';

const APPLY = process.argv.includes('--apply');
const DIR = 'transferdata';

/** Players named in the bad trim apply log (exact display names). */
const DAMAGED_NAMES = [
  'Nenê',
  'Jádson',
  'Aílton',
  'Gervinho',
  'Campanharo',
  'Zanka',
  'Jeffrén',
  'Maurides',
  'Caiuby',
  'Willian',
  'Adryan',
  'Rafinha',
  'Nani',
  'Roberto',
  'Nathan',
  'Juanfran',
  'Amauri',
  'Éder',
  'Juanito',
  'Émerson',
];

const COMP_TO_LEAGUE: Record<string, { id: number; name: string }> = {
  GB1: { id: 39, name: 'Premier League' },
  ES1: { id: 140, name: 'La Liga' },
  IT1: { id: 135, name: 'Serie A' },
  L1: { id: 78, name: 'Bundesliga' },
  FR1: { id: 61, name: 'Ligue 1' },
  CL: { id: 2, name: 'UEFA Champions League' },
  EL: { id: 3, name: 'UEFA Europa League' },
  PO1: { id: 94, name: 'Primeira Liga' },
  NL1: { id: 88, name: 'Eredivisie' },
  TR1: { id: 203, name: 'Süper Lig' },
  BE1: { id: 144, name: 'Jupiler Pro League' },
  DK1: { id: 119, name: 'Superliga' },
  SC1: { id: 179, name: 'Scottish Premiership' },
  GR1: { id: 197, name: 'Super League Greece' },
  RU1: { id: 235, name: 'Premier League' },
  UKR1: { id: 333, name: 'Premier League' },
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

function seasonOf(date: string): number | null {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}

/** Strip legal/suffix noise so "AS Roma" matches "Associazione Sportiva Roma". */
function clubCore(raw: string): string {
  return clubKey(raw)
    .replace(
      /\b(football club|futbol club|futebol clube|calcio|associazione sportiva|societa sportiva|società sportiva|sporting club|olympique|syndesmos filathlon|kulubu|kulübü|sad|s\.?a\.?d\.?|von \d+|19\d{2}|20\d{2})\b/g,
      ' '
    )
    .replace(/\b(royal|reial|the|de|da|do|di|cf|fc|afc|sc|ac|uc|as|ss|us)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coreTokens(raw: string): string[] {
  return clubCore(raw).split(' ').filter((t) => t.length >= 4);
}

function sameClub(a: string, b: string): boolean {
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  // Every token of the shorter name must appear as a whole token in the longer.
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

function playerHasClub(existing: Set<string>, candidate: string): boolean {
  if (existing.has(clubKey(candidate))) return true;
  for (const e of existing) {
    if (sameClub(e, candidate)) return true;
  }
  return false;
}

/** Shorten Transfermarkt legal names to spellings closer to our DB. */
function shortenTmName(raw: string): string {
  return raw
    .replace(/\s*\(\s*-?\s*\d{4}\s*\)\s*$/g, '')
    .replace(/\s+Football Club$/i, '')
    .replace(/\s+Futbol Club$/i, '')
    .replace(/\s+Futebol Clube$/i, '')
    .replace(/\s+Calcio(\s+\d+)?$/i, '')
    .replace(/^Associazione Sportiva\s+/i, '')
    .replace(/^Società Sportiva\s+/i, '')
    .replace(/^Sporting Clube de Portugal$/i, 'Sporting CP')
    .replace(/^Sporting Clube de\s+/i, 'Sporting ')
    .replace(/\s+Spor Kulübü$/i, '')
    .replace(/\s+Kulübü$/i, '')
    .replace(/\s+S\.?\s*A\.?\s*D\.?$/i, '')
    .replace(/^Olympiakos Syndesmos Filathlon\s+/i, 'Olympiakos ')
    .replace(/^Eindhovense Voetbalvereniging Philips Sport Vereniging$/i, 'PSV')
    .replace(/^Fußball-Club\s+/i, '')
    .replace(/\s+von \d+$/i, '')
    .replace(/^Royal Sporting Club\s+/i, '')
    .replace(/^UC\s+/i, '')
    .trim();
}

/** Prefer a corpus spelling only when it is a real alias, not a shorter country fragment. */
function preferredSpelling(candidate: string, corpus: string[]): string {
  const candTokens = coreTokens(candidate);
  const matches = corpus.filter((n) => {
    if (isYouthOrReserveSide(n) || /\bU\d{1,2}\b/i.test(n) || /\s+II$/i.test(n)) return false;
    if (!sameClub(n, candidate)) return false;
    const nt = coreTokens(n);
    // Reject fragments: "Portugal"≠Sporting, "Real"≠Zaragoza — need the distinctive token.
    if (candTokens.length >= 2 && nt.length < 2) return false;
    return true;
  });
  if (!matches.length) return shortenTmName(candidate);
  return matches.sort((x, y) => x.length - y.length || x.localeCompare(y))[0]!;
}

type Agg = {
  apps: number;
  goals: number;
  assists: number;
  minutes: number;
  clubName: string;
  clubId: number;
};

async function main() {
  console.log(APPLY ? 'APPLY — restoring from TM appearances' : 'DRY RUN — pass --apply to write');

  const players = (await db.execute(sql`
    SELECT id, name, tm_player_id
    FROM players
    WHERE tm_player_id IS NOT NULL
      AND name IN (${sql.join(
        DAMAGED_NAMES.map((n) => sql`${n}`),
        sql`, `
      )})
  `)) as unknown as Array<{ id: string; name: string; tm_player_id: string }>;

  const byTm = new Map<string, { id: string; name: string }>();
  for (const p of players) {
    // Prefer first mapped row; namesakes with distinct tm ids each restore independently.
    if (!byTm.has(p.tm_player_id)) byTm.set(p.tm_player_id, { id: p.id, name: p.name });
  }
  console.log(`Damaged-name players with tm_player_id: ${byTm.size}`);

  const clubNames = new Map<string, string>();
  await streamCsv(join(DIR, 'clubs.csv'), (cols, ix) => {
    const id = cols[ix.club_id!]?.trim() ?? '';
    const name = cols[ix.name!]?.trim() ?? '';
    if (id && name) clubNames.set(id, name);
  });

  // Existing spellings so restored rows unify with Club Chain / mostClubs.
  const existingNames = (
    (await db.execute(sql`
      SELECT DISTINCT team_name AS n FROM player_stats WHERE team_name IS NOT NULL AND team_name <> ''
      UNION
      SELECT DISTINCT team_name AS n FROM player_career WHERE team_id > 0
    `)) as unknown as Array<{ n: string }>
  ).map((r) => r.n);
  const displayMap = buildClubDisplayMap(existingNames);

  const existingStats = new Set<string>();
  /** Clubs already on the player before restore — skip re-inserting these. */
  const alreadyHadClub = new Map<string, Set<string>>();
  const statsRows = (await db.execute(sql`
    SELECT player_id, league_id, season, team_id, team_name
    FROM player_stats
    WHERE player_id IN (${sql.join(
      [...byTm.values()].map((p) => sql`${p.id}::uuid`),
      sql`, `
    )})
  `)) as unknown as Array<{
    player_id: string;
    league_id: number;
    season: number;
    team_id: number;
    team_name: string | null;
  }>;
  for (const r of statsRows) {
    existingStats.add(`${r.player_id}|${r.league_id}|${r.season}|${r.team_id}`);
    const set = alreadyHadClub.get(r.player_id) ?? new Set();
    // Store raw names so sameClub() can fuzzy-match TM long forms.
    if (r.team_name) set.add(r.team_name);
    alreadyHadClub.set(r.player_id, set);
  }

  const careerClubs = new Map<string, Set<string>>();
  const careerRows = (await db.execute(sql`
    SELECT player_id, team_name FROM player_career
    WHERE team_id > 0 AND player_id IN (${sql.join(
      [...byTm.values()].map((p) => sql`${p.id}::uuid`),
      sql`, `
    )})
  `)) as unknown as Array<{ player_id: string; team_name: string }>;
  for (const r of careerRows) {
    const set = careerClubs.get(r.player_id) ?? new Set();
    set.add(r.team_name);
    careerClubs.set(r.player_id, set);
  }

  // Aggregate TM appearances → (player, league, season, clubId)
  const agg = new Map<string, Agg>();
  await streamCsv(join(DIR, 'appearances.csv'), (cols, ix) => {
    const tmId = cols[ix.player_id!]?.trim() ?? '';
    const ours = byTm.get(tmId);
    if (!ours) return;
    const clubIdRaw = cols[ix.player_club_id!]?.trim() ?? '';
    const clubId = Number(clubIdRaw);
    if (!clubId) return;
    const rawClub = clubNames.get(clubIdRaw) ?? '';
    if (!rawClub || isYouthOrReserveSide(rawClub) || /\bU\d{1,2}\b/i.test(rawClub)) return;
    const date = cols[ix.date!]?.trim() ?? '';
    const season = seasonOf(date);
    if (season === null) return;
    const comp = cols[ix.competition_id!]?.trim() ?? '';
    const league = COMP_TO_LEAGUE[comp] ?? { id: 9000, name: 'Other' };
    // Skip pure domestic cups when we have no mapped league — still count via career below.
    if (league.id === 9000 && !/^\w+1$|^CL$|^EL$/.test(comp)) {
      // keep cup apps on a catch-all so club still reappears in mostClubs
    }
    const key = `${ours.id}|${league.id}|${season}|${clubId}`;
    const cur = agg.get(key) ?? {
      apps: 0,
      goals: 0,
      assists: 0,
      minutes: 0,
      clubName: rawClub,
      clubId,
    };
    cur.apps += 1;
    cur.goals += Number(cols[ix.goals!] ?? 0) || 0;
    cur.assists += Number(cols[ix.assists!] ?? 0) || 0;
    cur.minutes += Number(cols[ix.minutes_played!] ?? 0) || 0;
    agg.set(key, cur);
  });

  type Ins = {
    playerId: string;
    playerName: string;
    leagueId: number;
    leagueName: string;
    season: number;
    teamId: number;
    teamName: string;
    apps: number;
    goals: number;
    assists: number;
    minutes: number;
  };
  const inserts: Ins[] = [];
  const careerNeed = new Map<string, { playerId: string; teamId: number; teamName: string; from: number; to: number }>();

  for (const [key, a] of agg) {
    const [playerId, lidStr, seasonStr, _cid] = key.split('|');
    const leagueId = Number(lidStr);
    const season = Number(seasonStr);
    const leagueName = Object.values(COMP_TO_LEAGUE).find((l) => l.id === leagueId)?.name ?? 'Other';
    const ck = clubKey(a.clubName);
    const teamName = displayMap.get(ck) ?? a.clubName;
    const playerName = [...byTm.values()].find((p) => p.id === playerId)?.name ?? '?';

    // Track career coverage from every appearance club.
    const cKey = `${playerId}|${a.clubId}`;
    const prev = careerNeed.get(cKey);
    if (!prev) {
      careerNeed.set(cKey, { playerId: playerId!, teamId: a.clubId, teamName, from: season, to: season });
    } else {
      prev.from = Math.min(prev.from, season);
      prev.to = Math.max(prev.to, season);
      prev.teamName = teamName;
    }

    if (existingStats.has(`${playerId}|${leagueId}|${season}|${a.clubId}`)) continue;
    // Club already represented under an API-Football team_id — don't duplicate.
    if (playerHasClub(alreadyHadClub.get(playerId!) ?? new Set(), a.clubName)) continue;
    if (a.apps <= 0) continue;

    const preferred = preferredSpelling(a.clubName, existingNames);
    if (isYouthOrReserveSide(preferred) || /\bU\d{1,2}\b/i.test(preferred) || /\s+II$/i.test(preferred)) {
      continue;
    }

    inserts.push({
      playerId: playerId!,
      playerName,
      leagueId,
      leagueName,
      season,
      teamId: a.clubId,
      teamName: preferred,
      apps: a.apps,
      goals: a.goals,
      assists: a.assists,
      minutes: a.minutes,
    });
  }

  // Career inserts for clubs still missing entirely.
  const careerInserts: Array<{ playerId: string; teamId: number; teamName: string; from: number; to: number }> = [];
  for (const c of careerNeed.values()) {
    const have = careerClubs.get(c.playerId) ?? new Set();
    if (playerHasClub(have, c.teamName)) continue;
    // Only restore career for clubs we're putting back into stats (the trim damage).
    if (!inserts.some((i) => i.playerId === c.playerId && sameClub(i.teamName, c.teamName))) continue;
    const preferred =
      inserts.find((i) => i.playerId === c.playerId && sameClub(i.teamName, c.teamName))?.teamName
      ?? c.teamName;
    careerInserts.push({ ...c, teamName: preferred });
    have.add(preferred);
    careerClubs.set(c.playerId, have);
  }

  // Summarise by player
  const byPlayer = new Map<string, string[]>();
  for (const i of inserts) {
    const list = byPlayer.get(i.playerName) ?? [];
    if (!list.includes(i.teamName)) list.push(i.teamName);
    byPlayer.set(i.playerName, list);
  }
  console.log(`\nStats rows to insert: ${inserts.length}`);
  for (const [name, clubs] of [...byPlayer.entries()].sort()) {
    console.log(`  ${name}: +${clubs.join(', ')}`);
  }
  console.log(`Career rows to insert: ${careerInserts.length}`);

  if (!APPLY) {
    console.log('\nRe-run with --apply to write.');
    process.exit(0);
  }

  let statsAdded = 0;
  for (let i = 0; i < inserts.length; i += 200) {
    const batch = inserts.slice(i, i + 200);
    const tuples = batch.map(
      (x) =>
        sql`(${x.playerId}::uuid, ${x.leagueId}, ${x.leagueName}, ${x.season}, ${x.teamId}, ${x.teamName}, ${x.apps}, ${x.minutes}, ${x.goals}, ${x.assists})`
    );
    await db.execute(sql`
      INSERT INTO player_stats (player_id, league_id, league_name, season, team_id, team_name, appearances, minutes, goals, assists)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT DO NOTHING
    `);
    statsAdded += batch.length;
  }

  let careerAdded = 0;
  for (const c of careerInserts) {
    await db.execute(sql`
      INSERT INTO player_career (player_id, team_id, team_name, season_from, season_to)
      VALUES (${c.playerId}::uuid, ${c.teamId}, ${c.teamName}, ${c.from}, ${c.to})
      ON CONFLICT DO NOTHING
    `);
    careerAdded += 1;
  }

  console.log(`\nInserted stats≈${statsAdded}, career=${careerAdded}`);

  // Quick verification for the worst hits.
  for (const name of ['Gervinho', 'Willian', 'Jeffrén', 'Nani', 'Zanka']) {
    const p = players.find((x) => x.name === name);
    if (!p) continue;
    const clubs = (await db.execute(sql`
      SELECT team_name, SUM(appearances)::int AS apps
      FROM player_stats
      WHERE player_id = ${p.id}::uuid AND appearances > 0 AND team_name IS NOT NULL
      GROUP BY team_name ORDER BY apps DESC
    `)) as unknown as Array<{ team_name: string; apps: number }>;
    console.log(
      `  ${name}: ${clubs.map((c) => `${c.team_name}(${c.apps})`).join(', ')}`
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
