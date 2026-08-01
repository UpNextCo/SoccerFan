/**
 * Put a club on the stat rows that arrived without one.
 *
 * `job:import-tm-seasons` gap-filled per-season stats from a Transfermarkt page that lists seasons by
 * competition but never names the club, so ~4,900 rows hold real appearances with an empty team_name —
 * every Championship, Eredivisie, Primeira Liga, Süper Lig and Saudi row we have, plus stragglers in
 * the big-5. Draft XI and Blind Rank answer "who played for this club?" with
 *
 *     SELECT DISTINCT player_id FROM player_stats WHERE team_name = $club AND appearances > 0
 *
 * so those appearances count for nobody: Harry Kane's 13 Championship games on loan at Leicester exist
 * in the database, but the game says he never played for them. The same holds for Ronaldo's Sporting
 * season and his Al-Nassr years.
 *
 * The club history is known — `transferdata/transfers.csv` dates every move — so this reads the moves,
 * turns them into candidate spells, and asks `statsClubAttribution` which one the row belongs to. See
 * that module for how a season and a division narrow three candidates down to one.
 *
 * Names are written in the spelling `player_stats` already uses for that club (via `clubCanonical`), so
 * a newly attributed row unifies with the existing ones instead of creating a second "Leicester City"
 * that the club constraint would treat as a different club.
 *
 * Usage:
 *   npm run job:attribute-stats-clubs            # dry run + review CSV
 *   npm run job:attribute-stats-clubs -- --apply
 */
import 'dotenv/config';
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { buildClubDisplayMap, clubKey } from '../utils/clubCanonical.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';
import { normalizeTeamName } from '../utils/teamName.js';
import {
  attributeRow,
  buildSpells,
  isSeniorClub,
  type Attribution,
  type AttributionEvidence,
  type Transfer,
} from '../services/statsClubAttribution.js';

const APPLY = process.argv.includes('--apply');
const DIR = process.argv.find((a) => !a.startsWith('--') && a.includes('transferdata')) ?? 'transferdata';
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'stats_clubs_review.csv';

/** European competitions, where a club plays alongside its domestic division in the same season. */
const NON_DOMESTIC = new Set([2, 3]);

/**
 * Country of each division we hold, spelled as `competitions.csv` does, so a candidate club can be
 * ruled out on nationality. Transfermarkt calls Austria's top flight "Bundesliga" as well, and the TM
 * gap-fill filed those seasons under the German league id — without this, Red Bull Salzburg lands on 67
 * German Bundesliga rows. Promotion doesn't matter here: the Championship and the Premier League are
 * both England, so Kane's Leicester loan still passes.
 */
const LEAGUE_COUNTRY: Record<number, string> = {
  39: 'England',
  40: 'England',
  140: 'Spain',
  135: 'Italy',
  78: 'Germany',
  61: 'France',
  88: 'Netherlands',
  94: 'Portugal',
  203: 'Türkiye',
  307: 'Saudi Arabia',
  179: 'Scotland',
  253: 'United States',
};

interface BlankRow {
  id: string;
  playerId: string;
  playerName: string;
  tmId: string;
  leagueId: number;
  leagueName: string;
  season: number;
  appearances: number;
  goals: number;
}

/** CSV line split that respects quoted fields (club names contain commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** club_id -> country, via each club's domestic competition. */
async function readClubCountries(): Promise<Map<string, string>> {
  const countryByComp = new Map<string, string>();
  {
    const rl = createInterface({ input: createReadStream(join(DIR, 'competitions.csv')), crlfDelay: Infinity });
    let cols: Record<string, number> | null = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const f = splitCsvLine(line);
      if (!cols) {
        cols = {};
        f.forEach((name, i) => { cols![name.trim()] = i; });
        continue;
      }
      const id = f[cols['competition_id']!]?.trim();
      const country = f[cols['country_name']!]?.trim();
      if (id && country) countryByComp.set(id, country);
    }
  }

  const byClub = new Map<string, string>();
  const rl = createInterface({ input: createReadStream(join(DIR, 'clubs.csv')), crlfDelay: Infinity });
  let cols: Record<string, number> | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    if (!cols) {
      cols = {};
      f.forEach((name, i) => { cols![name.trim()] = i; });
      continue;
    }
    const clubId = f[cols['club_id']!]?.trim();
    const comp = f[cols['domestic_competition_id']!]?.trim();
    const country = comp ? countryByComp.get(comp) : undefined;
    if (clubId && country) byClub.set(clubId, country);
  }
  return byClub;
}

async function readTransfers(wanted: Set<string>): Promise<Map<string, Transfer[]>> {
  const byPlayer = new Map<string, Transfer[]>();
  const rl = createInterface({ input: createReadStream(join(DIR, 'transfers.csv')), crlfDelay: Infinity });
  let cols: Record<string, number> | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    if (!cols) {
      cols = {};
      f.forEach((name, i) => { cols![name.trim()] = i; });
      if (cols['player_id'] === undefined) throw new Error('transfers.csv: no player_id column');
      continue;
    }
    const tmId = f[cols['player_id']!]?.trim() ?? '';
    if (!wanted.has(tmId)) continue;
    const date = f[cols['transfer_date']!]?.trim() ?? '';
    const toClub = f[cols['to_club_name']!]?.trim() ?? '';
    const toClubId = f[cols['to_club_id']!]?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    (byPlayer.get(tmId) ?? byPlayer.set(tmId, []).get(tmId)!).push({ date, toClub, toClubId });
  }
  return byPlayer;
}

/**
 * Transfermarkt abbreviations that no amount of token matching will reach, because the short form
 * shares no whole word with ours ("Nott'm Forest" / "Nottingham Forest") or is ambiguous on its own
 * ("Sporting" is Sporting CP to Transfermarkt; Gijón is always spelled out).
 */
const TM_ALIAS: Record<string, string> = {
  sporting: 'Sporting CP',
  'sheff utd': 'Sheffield Utd',
  'sheff wed': 'Sheffield Wednesday',
  "nott'm forest": 'Nottingham Forest',
  'nottm forest': 'Nottingham Forest',
  'vit. guimaraes': 'Vitória Guimarães',
  'sparta r.': 'Sparta Rotterdam',
  'stade rennais': 'Rennes',
  hamburg: 'Hamburger SV',
  atletico: 'Atlético Madrid',
  'mk dons': 'Milton Keynes Dons',
  'recr. huelva': 'Recreativo Huelva',
  'estudiantes lp': 'Estudiantes',
  'c. rizespor': 'Çaykur Rizespor',
  'y. malatyaspor': 'Yeni Malatyaspor',
  'r. strasbourg': 'Strasbourg',
};

/** Reserve sides Transfermarkt names without the II/B suffix that isYouthOrReserveSide looks for. */
const RESERVE_SIDES = /^(barca atletic|rayo cantabria|castilla)/i;

interface Named {
  name: string;
  teamId: number | null;
  source: string;
}

/**
 * Resolve a Transfermarkt club name to a club we already know, preferring the spelling
 * `player_stats` uses so the attributed row unifies with the existing ones. Returns null rather than
 * inventing a spelling: a novel name would read as a separate club to the club constraint, which is
 * the very bug this job exists to fix.
 */
function makeNamer(
  displayMap: Map<string, string>,
  corpus: string[],
  teams: Array<{ id: number; name: string }>
) {
  const teamByNorm = new Map<string, { id: number; name: string }>();
  const teamsByToken = new Map<string, Array<{ id: number; name: string; tokens: string[] }>>();
  for (const t of teams) {
    const norm = normalizeTeamName(t.name);
    if (!norm) continue;
    if (!teamByNorm.has(norm)) teamByNorm.set(norm, t);
    const tokens = norm.split(' ').filter(Boolean);
    for (const token of tokens) {
      (teamsByToken.get(token) ?? teamsByToken.set(token, []).get(token)!).push({ ...t, tokens });
    }
  }

  const rowsByName = new Map<string, number>();
  for (const name of corpus) rowsByName.set(name, (rowsByName.get(name) ?? 0) + 1);

  const corpusByToken = new Map<string, Array<{ name: string; tokens: string[] }>>();
  for (const name of rowsByName.keys()) {
    const tokens = normalizeTeamName(name).split(' ').filter(Boolean);
    for (const token of tokens) {
      (corpusByToken.get(token) ?? corpusByToken.set(token, []).get(token)!).push({ name, tokens });
    }
  }

  const teamIdFor = (name: string): number | null => teamByNorm.get(normalizeTeamName(name))?.id ?? null;

  /**
   * Clubs whose words are wholly contained in ours or vice versa ("PSV" / "PSV Eindhoven"). Where
   * several distinct clubs still match, the one carrying nearly all the appearances is the intended
   * one — Transfermarkt's "Salzburg" is Red Bull Salzburg (370 rows), not Austria Salzburg (17) — but a
   * genuine pair of rivals splits the rows and is left unresolved instead of guessed at.
   */
  function subsetMatch<T extends { name: string; tokens: string[] }>(
    index: Map<string, T[]>,
    tokens: string[]
  ): T | null {
    const set = new Set(tokens);
    const pool = new Map<T, true>();
    for (const token of tokens) for (const c of index.get(token) ?? []) pool.set(c, true);

    const byKey = new Map<string, T>();
    for (const c of pool.keys()) {
      if (isYouthOrReserveSide(c.name)) continue;
      if (!c.tokens.every((t) => set.has(t)) && !tokens.every((t) => c.tokens.includes(t))) continue;
      byKey.set(clubKey(c.name), c);
    }
    const hits = [...byKey.values()];
    if (hits.length === 0) return null;
    if (hits.length === 1) return hits[0]!;

    const weighed = hits
      .map((h) => ({ hit: h, rows: rowsByName.get(h.name) ?? 0 }))
      .sort((a, b) => b.rows - a.rows);
    const total = weighed.reduce((n, w) => n + w.rows, 0);
    return total > 0 && weighed[0]!.rows / total >= 0.7 ? weighed[0]!.hit : null;
  }

  return (club: string): Named | null => {
    const trimmed = club.trim();
    if (RESERVE_SIDES.test(normalizeTeamName(trimmed))) return null;

    const aliased = TM_ALIAS[normalizeTeamName(trimmed)];
    const candidate = aliased ?? trimmed;

    const key = clubKey(candidate);
    const existing = displayMap.get(key);
    if (existing) return { name: existing, teamId: teamIdFor(existing), source: aliased ? 'alias' : 'player_stats' };

    const norm = normalizeTeamName(candidate);
    const tokens = norm.split(' ').filter(Boolean);
    if (!tokens.length) return null;

    const inCorpus = subsetMatch(corpusByToken, tokens);
    if (inCorpus) return { name: inCorpus.name, teamId: teamIdFor(inCorpus.name), source: 'player_stats~' };

    const exact = teamByNorm.get(norm);
    if (exact) return { name: exact.name, teamId: exact.id, source: 'teams' };

    const inTeams = subsetMatch(teamsByToken, tokens);
    if (inTeams) return { name: inTeams.name, teamId: inTeams.id, source: 'teams~' };

    return null;
  };
}

async function main(): Promise<void> {
  const blanks = (await db.execute(sql`
    SELECT s.id, s.player_id AS "playerId", p.name AS "playerName", p.tm_player_id AS "tmId",
           s.league_id AS "leagueId", s.league_name AS "leagueName", s.season,
           s.appearances, s.goals
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE COALESCE(s.team_name, '') = '' AND p.tm_player_id IS NOT NULL
    ORDER BY p.name, s.season
  `)) as unknown as BlankRow[];
  console.log(`Rows without a club (and reachable via a Transfermarkt id): ${blanks.length.toLocaleString()}`);

  // Evidence comes from the rows that DO name a club.
  const attributed = (await db.execute(sql`
    SELECT player_id AS "playerId", league_id AS "leagueId", season, team_name AS "teamName"
    FROM player_stats WHERE COALESCE(team_name, '') <> ''
  `)) as unknown as Array<{ playerId: string; leagueId: number; season: number; teamName: string }>;

  const clubsInLeagueSeason = new Map<string, Set<string>>();
  const playedForByPlayerSeason = new Map<string, Set<string>>();
  for (const row of attributed) {
    const key = clubKey(row.teamName);
    if (!key) continue;
    const ls = `${row.leagueId}:${row.season}`;
    (clubsInLeagueSeason.get(ls) ?? clubsInLeagueSeason.set(ls, new Set()).get(ls)!).add(key);
    const ps = `${row.playerId}:${row.season}`;
    (playedForByPlayerSeason.get(ps) ?? playedForByPlayerSeason.set(ps, new Set()).get(ps)!).add(key);
  }
  console.log(`Club-naming rows used as evidence: ${attributed.length.toLocaleString()}`);

  const corpus = attributed.map((r) => r.teamName);
  const displayMap = buildClubDisplayMap(corpus);
  const teamRows = (await db.execute(sql`SELECT id, name FROM teams`)) as unknown as Array<{ id: number; name: string }>;
  const nameFor = makeNamer(displayMap, corpus, teamRows);

  const transfers = await readTransfers(new Set(blanks.map((b) => b.tmId)));
  const clubCountries = await readClubCountries();
  console.log(`Players with a transfer history: ${transfers.size.toLocaleString()}`);
  console.log(`Clubs with a known country: ${clubCountries.size.toLocaleString()}`);

  const latestSeason = blanks.reduce((n, b) => Math.max(n, b.season), 2025);
  const spellsByTmId = new Map<string, ReturnType<typeof buildSpells>>();
  for (const [tmId, moves] of transfers) spellsByTmId.set(tmId, buildSpells(moves, latestSeason));

  interface Fix extends BlankRow { club: string; teamId: number | null; source: string; rawClub: string }
  const fixes: Fix[] = [];
  const skipped: Array<BlankRow & { reason: string; detail: string }> = [];

  /**
   * Each round's answers become the next round's evidence. A Champions League row can only be placed
   * once we know which club the player turned out for that season, and that league row often starts
   * blank too — the Eredivisie has no named rows at all. Naming the league rows in round one lets the
   * European rows fall out in round two, and the same holds for the Championship, whose clubs appear in
   * no named row until this job puts them there. Rounds stop as soon as one adds nothing.
   */
  let pending = blanks;
  for (let round = 1; pending.length > 0; round += 1) {
    const stillPending: BlankRow[] = [];
    const roundFixes: Fix[] = [];

    for (const row of pending) {
      const all = spellsByTmId.get(row.tmId) ?? [];
      // Drop clubs from the wrong country before choosing, so a foreign club that merely overlaps the
      // season can't win — and doesn't make the row ambiguous either.
      const leagueCountry = LEAGUE_COUNTRY[row.leagueId];
      const spells = leagueCountry
        ? all.filter((s) => {
            const country = s.clubId ? clubCountries.get(s.clubId) : undefined;
            return !country || country === leagueCountry;
          })
        : all;
      const evidence: AttributionEvidence = {
        clubsInLeagueSeason: (leagueId, season) => clubsInLeagueSeason.get(`${leagueId}:${season}`) ?? new Set(),
        clubsPlayedForBySeason: (season) => playedForByPlayerSeason.get(`${row.playerId}:${season}`) ?? new Set(),
        isDomestic: (leagueId) => !NON_DOMESTIC.has(leagueId),
        key: clubKey,
      };
      const result: Attribution = attributeRow(row, spells, evidence);
      if (result.kind !== 'resolved' || !isSeniorClub(result.club)) {
        stillPending.push(row);
        continue;
      }
      const resolved = nameFor(result.club);
      if (!resolved || isYouthOrReserveSide(resolved.name)) {
        stillPending.push(row);
        continue;
      }
      roundFixes.push({ ...row, club: resolved.name, teamId: resolved.teamId, source: resolved.source, rawClub: result.club });
    }

    console.log(`  round ${round}: resolved ${roundFixes.length}, still open ${stillPending.length}`);
    if (roundFixes.length === 0) {
      // Record why each survivor stayed open, using the evidence as it finally stood.
      for (const row of stillPending) {
        const all = spellsByTmId.get(row.tmId) ?? [];
        const leagueCountry = LEAGUE_COUNTRY[row.leagueId];
        const spells = leagueCountry
          ? all.filter((s) => {
              const country = s.clubId ? clubCountries.get(s.clubId) : undefined;
              return !country || country === leagueCountry;
            })
          : all;
        const result = attributeRow(row, spells, {
          clubsInLeagueSeason: (leagueId, season) => clubsInLeagueSeason.get(`${leagueId}:${season}`) ?? new Set(),
          clubsPlayedForBySeason: (season) => playedForByPlayerSeason.get(`${row.playerId}:${season}`) ?? new Set(),
          isDomestic: (leagueId) => !NON_DOMESTIC.has(leagueId),
          key: clubKey,
        });
        const reason =
          result.kind === 'resolved' ? 'unknown-club' : result.kind === 'ambiguous' ? 'ambiguous' : 'no-candidates';
        const detail = result.kind === 'ambiguous' ? result.candidates.join(' | ') : result.kind === 'resolved' ? result.club : '';
        skipped.push({ ...row, reason, detail });
      }
      break;
    }

    for (const fix of roundFixes) {
      fixes.push(fix);
      const key = clubKey(fix.club);
      const ls = `${fix.leagueId}:${fix.season}`;
      (clubsInLeagueSeason.get(ls) ?? clubsInLeagueSeason.set(ls, new Set()).get(ls)!).add(key);
      const ps = `${fix.playerId}:${fix.season}`;
      (playedForByPlayerSeason.get(ps) ?? playedForByPlayerSeason.set(ps, new Set()).get(ps)!).add(key);
    }
    pending = stillPending;
  }

  const csv = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  writeFileSync(
    REVIEW_PATH,
    [
      'outcome,player,league,season,apps,goals,club,name_source,transfermarkt_name',
      ...fixes.map((f) =>
        [
          'resolved', csv(f.playerName), csv(f.leagueName), f.season, f.appearances, f.goals,
          csv(f.club), f.source, csv(f.rawClub === f.club ? '' : f.rawClub),
        ].join(',')
      ),
      ...skipped.map((s) =>
        [s.reason, csv(s.playerName), csv(s.leagueName), s.season, s.appearances, s.goals, '', '', csv(s.detail)].join(',')
      ),
    ].join('\n') + '\n'
  );

  const bySource = new Map<string, number>();
  for (const f of fixes) bySource.set(f.source, (bySource.get(f.source) ?? 0) + 1);
  const byLeague = new Map<string, { fixed: number; total: number }>();
  for (const r of blanks) {
    const e = byLeague.get(r.leagueName) ?? { fixed: 0, total: 0 };
    e.total += 1;
    byLeague.set(r.leagueName, e);
  }
  for (const f of fixes) byLeague.get(f.leagueName)!.fixed += 1;

  console.log(`\nResolved to a club : ${fixes.length.toLocaleString()}`);
  console.log(`Left blank         : ${skipped.length.toLocaleString()}`);
  console.log('\nBy league:');
  for (const [league, e] of [...byLeague.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${league.padEnd(24)} ${String(e.fixed).padStart(4)} / ${e.total}`);
  }
  console.log('\nName taken from:');
  for (const [source, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source.padEnd(14)} ${n}`);
  }
  console.log(`  with a teams.id     ${fixes.filter((f) => f.teamId !== null).length}`);
  console.log(`\nReview CSV: ${REVIEW_PATH}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    return;
  }

  let done = 0;
  for (let i = 0; i < fixes.length; i += 300) {
    const batch = fixes.slice(i, i + 300);
    await db.transaction(async (tx) => {
      for (const f of batch) {
        // team_id only where it can't collide with the unique (player, league, season, team_id) row.
        await tx.execute(sql`
          UPDATE player_stats s
          SET team_name = ${f.club},
              team_id = CASE
                WHEN ${f.teamId}::int IS NULL THEN s.team_id
                WHEN EXISTS (
                  SELECT 1 FROM player_stats o
                  WHERE o.player_id = s.player_id AND o.league_id = s.league_id
                    AND o.season = s.season AND o.team_id = ${f.teamId}::int AND o.id <> s.id
                ) THEN s.team_id
                ELSE ${f.teamId}::int
              END
          WHERE s.id = ${f.id}
        `);
      }
    });
    done += batch.length;
    console.log(`  updated ${done}/${fixes.length}`);
  }
  console.log(`\nAttributed ${done.toLocaleString()} rows.`);
  console.log('Club Chain reads player_career, not these rows — no path refresh needed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
