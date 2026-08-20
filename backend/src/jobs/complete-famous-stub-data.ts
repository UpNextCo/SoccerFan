/**
 * Finish famous FBref stubs once they have a Transfermarkt id: missing club spells,
 * crawl-map entries, and a scrape-target file for caps / career totals.
 *
 * Identity mapping writes `players.tm_player_id` only. The season scrape never sees those
 * players until they land in `tm_id_map.json`, and the TM performance grid does not name
 * clubs — so PSV / Cruzeiro / Milan / Corinthians stay missing until we pull P54 from
 * Wikidata.
 *
 *   npx tsx src/jobs/complete-famous-stub-data.ts
 *   npx tsx src/jobs/complete-famous-stub-data.ts --apply
 *   npx tsx src/jobs/complete-famous-stub-data.ts --apply --player=7a9e2e29-ae59-4ff4-975b-928e420338aa
 */
import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';
import {
  isNationalTeam,
  isYouthNationalOrOlympicSide,
  isYouthOrReserveSide,
  nationSet,
} from '../utils/nationalTeam.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const TARGETS_ONLY = process.argv.includes('--targets-only');
const PLAYER_FILTER = process.argv.find((a) => a.startsWith('--player='))?.slice(9) ?? null;
const DIR = 'transferdata';
const FAMOUS_TIER = 4;
const UA = 'BallKnowledge/1.0 (football quiz app; contact via repository)';
const WD = 'https://www.wikidata.org/w/api.php';
const PAUSE_MS = 800;
const DONE_PATH = join(DIR, 'wd_famous_stub_done.txt');

const CLUB_ALIASES: Record<string, string> = {
  'fc barcelona': 'barcelona',
  'inter milan': 'inter',
  internazionale: 'inter',
  'fc internazionale milano': 'inter',
  'ac milan': 'ac milan',
  milan: 'ac milan',
  'psv eindhoven': 'psv eindhoven',
  psv: 'psv eindhoven',
  'cruzeiro e c': 'cruzeiro',
  'cruzeiro ec': 'cruzeiro',
  's c corinthians paulista': 'corinthians',
  'sc corinthians paulista': 'corinthians',
  'corinthians paulista': 'corinthians',
  'real madrid club de futbol': 'real madrid',
  'real madrid cf': 'real madrid',
  'manchester united f c': 'manchester united',
  'manchester city f c': 'manchester city',
  'tottenham hotspur f c': 'tottenham',
  'ajax amsterdam': 'ajax',
  'afc ajax': 'ajax',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'lyon',
  'paris saint-germain fc': 'paris saint germain',
  'paris saint germain fc': 'paris saint germain',
  'fc bayern munich': 'bayern munchen',
  'fc bayern munchen': 'bayern munchen',
  'bayern munich': 'bayern munchen',
  'borussia dortmund': 'borussia dortmund',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
};

interface Stub {
  id: string;
  name: string;
  tmId: string;
  dob: string | null;
}

interface TeamRow {
  id: number;
  name: string;
  key: string;
  leagueId: number | null;
  usage: number;
}

interface WikiSpell {
  label: string;
  from: number;
  to: number;
}

interface MapEntry {
  ourId: string;
  tmId: string;
  code: string;
  name: string;
}

function clubKey(value: string): string {
  return normalizeSearchText(value)
    .replace(/\./g, ' ')
    .replace(/\b(fc|cf|ac|as|sc|ec|afc|ssc|us|the|club|de|football|calcio|futebol)\b/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasedKey(value: string): string {
  const key = clubKey(value);
  return CLUB_ALIASES[key] ?? CLUB_ALIASES[normalizeSearchText(value)] ?? key;
}

function yearFromWd(time: string | undefined): number | null {
  if (!time) return null;
  const match = time.match(/([+-]?)(\d{4})/);
  if (!match) return null;
  const year = Number(match[2]);
  return year >= 1880 && year <= 2030 ? year : null;
}

async function wdGet<T>(params: Record<string, string>): Promise<T> {
  const url = `${WD}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      const wait = res.status === 429 ? 20_000 * attempt : 1500 * attempt;
      console.warn(`  Wikidata HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Wikidata HTTP ${res.status}`);
  }
  throw new Error('Wikidata request failed after retries');
}

async function qidForTmId(tmId: string): Promise<string | null> {
  const data = await wdGet<{ query?: { search?: Array<{ title: string }> } }>({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:P2446=${tmId}`,
    srlimit: '1',
  });
  return data.query?.search?.[0]?.title ?? null;
}

async function spellsForQid(qid: string): Promise<WikiSpell[]> {
  const data = await wdGet<{
    entities?: Record<
      string,
      {
        claims?: {
          P54?: Array<{
            mainsnak?: { datavalue?: { value?: { id?: string } } };
            qualifiers?: {
              P580?: Array<{ datavalue?: { value?: { time?: string } } }>;
              P582?: Array<{ datavalue?: { value?: { time?: string } } }>;
            };
          }>;
        };
      }
    >;
  }>({
    action: 'wbgetentities',
    ids: qid,
    props: 'claims',
  });
  const claims = data.entities?.[qid]?.claims?.P54 ?? [];
  const raw: Array<{ qid: string; from: number; to: number }> = [];
  for (const claim of claims) {
    const teamQid = claim.mainsnak?.datavalue?.value?.id;
    if (!teamQid) continue;
    const from = yearFromWd(claim.qualifiers?.P580?.[0]?.datavalue?.value?.time) ?? 0;
    const to = yearFromWd(claim.qualifiers?.P582?.[0]?.datavalue?.value?.time) ?? from;
    raw.push({ qid: teamQid, from: from || to, to: to || from });
  }
  if (raw.length === 0) return [];

  const labels = await wdGet<{
    entities?: Record<string, { labels?: { en?: { value?: string } } }>;
  }>({
    action: 'wbgetentities',
    ids: [...new Set(raw.map((r) => r.qid))].join('|'),
    props: 'labels',
    languages: 'en',
  });

  const spells: WikiSpell[] = [];
  for (const row of raw) {
    const label = labels.entities?.[row.qid]?.labels?.en?.value?.trim();
    if (!label) continue;
    const from = row.from || row.to;
    const to = row.to || row.from;
    if (!from) continue;
    spells.push({ label, from, to: Math.max(to, from) });
  }
  return spells;
}

function isWikiNationalSide(label: string, nations: Set<string>): boolean {
  if (isYouthOrReserveSide(label) || isYouthNationalOrOlympicSide(label, nations)) return true;
  if (isNationalTeam(label, nations)) return true;
  return /national.+(football|soccer) team|\bnational team\b|olympic|under[- ]?\d|u-?\d{1,2}\b/i.test(label);
}

function resolveTeam(label: string, teams: TeamRow[], nations: Set<string>): TeamRow | null {
  if (isWikiNationalSide(label, nations)) return null;

  const key = aliasedKey(label);
  if (!key) return null;

  const hits = teams.filter((t) => t.key === key || t.key === clubKey(label));
  const usable = hits.filter(
    (t) =>
      !isYouthOrReserveSide(t.name) &&
      !/(\sW|Ladies|Women)$/i.test(t.name) &&
      !isNationalTeam(t.name, nations)
  );
  if (usable.length === 0) return null;
  usable.sort((a, b) => b.usage - a.usage || Number(b.leagueId != null) - Number(a.leagueId != null) || a.id - b.id);
  return usable[0] ?? null;
}

function alreadyHasClub(
  existing: Array<{ team_id: number; team_name: string }>,
  team: TeamRow
): boolean {
  const key = clubKey(team.name);
  return existing.some((row) => row.team_id === team.id || clubKey(row.team_name) === key);
}

async function main(): Promise<void> {
  const nations = await nationSet();
  const teamRows = (await db.execute(sql`
    SELECT t.id, t.name, t.name_norm, t.league_id, COALESCE(u.n, 0)::int AS usage
    FROM teams t
    LEFT JOIN (
      SELECT team_id, COUNT(*)::int AS n FROM player_career GROUP BY team_id
    ) u ON u.team_id = t.id
    WHERE t.id > 0
  `)) as unknown as Array<{ id: number; name: string; name_norm: string; league_id: number | null; usage: number }>;
  const teams: TeamRow[] = teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    key: aliasedKey(t.name) || clubKey(t.name_norm),
    leagueId: t.league_id,
    usage: t.usage,
  }));

  const stubs = (await db.execute(sql`
    SELECT p.id, p.name, p.tm_player_id AS "tmId", p.birth_date::text AS dob
    FROM players p
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND p.tm_player_id IS NOT NULL
      AND p.api_football_id IS NULL
      ${PLAYER_FILTER ? sql`AND p.id = ${PLAYER_FILTER}::uuid` : sql``}
    ORDER BY p.name
  `)) as unknown as Stub[];
  console.log(`Famous stubs with a Transfermarkt id: ${stubs.length}`);

  const mapPath = join(DIR, 'tm_id_map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapEntry[];
  const mapped = new Set(map.map((m) => m.ourId));
  const mapAdds = stubs.filter((s) => !mapped.has(s.id));
  const targetsPath = join(DIR, 'tm_targets_famous_stubs.json');
  const extra = (await db.execute(sql`
    SELECT p.id, p.name, p.tm_player_id, p.birth_date::text AS dob,
           e.tm_career_goals, e.tm_intl_caps
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    WHERE p.id IN (${sql.join(stubs.map((s) => sql`${s.id}::uuid`), sql`, `)})
  `)) as unknown as Array<{
    id: string;
    name: string;
    tm_player_id: string;
    dob: string | null;
    tm_career_goals: number | null;
    tm_intl_caps: number | null;
  }>;
  const targets = extra
    .filter((p) => p.dob && (p.tm_career_goals == null || p.tm_intl_caps == null))
    .map((p) => ({
      ourId: p.id,
      tmId: p.tm_player_id,
      code: 'x',
      name: p.name,
      dob: p.dob!.slice(0, 10),
    }));
  console.log(`tm_id_map entries to add: ${mapAdds.length}`);
  console.log(`Scrape targets (missing TM goals or caps): ${targets.length}`);
  if (APPLY) {
    for (const s of mapAdds) {
      map.push({ ourId: s.id, tmId: s.tmId, code: 'x', name: s.name });
    }
    writeFileSync(mapPath, JSON.stringify(map));
    if (!PLAYER_FILTER) {
      writeFileSync(targetsPath, JSON.stringify(targets, null, 0));
      console.log(`Wrote ${mapAdds.length} map entries and ${targets.length} scrape targets.`);
    } else {
      console.log(`Wrote ${mapAdds.length} map entries (targets file left unchanged for a single-player run).`);
    }
    if (TARGETS_ONLY) return;
  }

  const done = new Set(
    existsSync(DONE_PATH)
      ? readFileSync(DONE_PATH, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      : []
  );

  const inserts: Array<{
    playerId: string;
    playerName: string;
    teamId: number;
    teamName: string;
    seasonFrom: number;
    seasonTo: number;
    via: string;
  }> = [];
  const unmatched: Array<{ player: string; club: string }> = [];
  let wikiEmpty = 0;
  let skippedDone = 0;

  const pending = stubs.filter((s) => !done.has(s.id));
  console.log(`Wikidata career lookups remaining: ${pending.length} (already done ${done.size})`);

  for (let i = 0; i < pending.length; i += 1) {
    const stub = pending[i]!;
    try {
      const qid = await qidForTmId(stub.tmId);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      if (!qid) {
        wikiEmpty += 1;
        console.log(`  ${stub.name}: no Wikidata item for tm=${stub.tmId}`);
        if (APPLY) appendFileSync(DONE_PATH, `${stub.id}\n`);
        continue;
      }
      const spells = await spellsForQid(qid);
      await new Promise((r) => setTimeout(r, PAUSE_MS));

      const existing = (await db.execute(sql`
        SELECT team_id, team_name FROM player_career WHERE player_id = ${stub.id}::uuid
      `)) as unknown as Array<{ team_id: number; team_name: string }>;

      const added: string[] = [];
      const fresh: typeof inserts = [];
      for (const spell of spells) {
        const team = resolveTeam(spell.label, teams, nations);
        if (!team) {
          if (!isWikiNationalSide(spell.label, nations)) {
            unmatched.push({ player: stub.name, club: spell.label });
          }
          continue;
        }
        if (alreadyHasClub(existing, team)) continue;
        existing.push({ team_id: team.id, team_name: team.name });
        const row = {
          playerId: stub.id,
          playerName: stub.name,
          teamId: team.id,
          teamName: team.name,
          seasonFrom: spell.from,
          seasonTo: spell.to,
          via: spell.label,
        };
        inserts.push(row);
        fresh.push(row);
        added.push(`${team.name} ${spell.from}–${spell.to}`);
      }
      if (added.length > 0) console.log(`  ${stub.name}: + ${added.join(', ')}`);
      if (APPLY && fresh.length > 0) {
        await db
          .insert(playerCareer)
          .values(
            fresh.map((row) => ({
              playerId: row.playerId,
              teamId: row.teamId,
              teamName: row.teamName,
              seasonFrom: row.seasonFrom,
              seasonTo: row.seasonTo,
              updatedAt: new Date(),
            }))
          )
          .onConflictDoNothing();
      }
      if (APPLY) appendFileSync(DONE_PATH, `${stub.id}\n`);
    } catch (error) {
      console.warn(`  ${stub.name}: ${error instanceof Error ? error.message : error}`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
      console.log(`  looked up ${i + 1}/${pending.length}`);
    }
  }
  skippedDone = stubs.length - pending.length;

  console.log(`\nClub spells to insert: ${inserts.length}`);
  console.log(`No Wikidata item: ${wikiEmpty}`);
  const uniqueUnmatched = [...new Set(unmatched.map((u) => u.club))].sort();
  if (uniqueUnmatched.length > 0) {
    console.log(`Unresolved club labels (${uniqueUnmatched.length}):`);
    for (const club of uniqueUnmatched.slice(0, 40)) console.log(`  ${club}`);
  }

  console.log(`Already looked up: ${skippedDone}`);
  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write clubs, tm_id_map, and scrape targets.');
    return;
  }

  console.log(`Inserted ${inserts.length} player_career spells this run.`);

  const r9 = (await db.execute(sql`
    SELECT team_name, season_from, season_to
    FROM player_career
    WHERE player_id = ${'7a9e2e29-ae59-4ff4-975b-928e420338aa'}::uuid
    ORDER BY season_from, team_name
  `)) as unknown as Array<{ team_name: string; season_from: number; season_to: number | null }>;
  console.log(
    `R9 career now: ${r9.map((c) => `${c.team_name} ${c.season_from}–${c.season_to ?? ''}`).join(', ') || '(none)'}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
