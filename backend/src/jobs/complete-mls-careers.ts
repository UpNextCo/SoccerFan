/**
 * Backfill famous US / MLS-touching careers: missing clubs from Wikidata P54, scrape-map
 * entries, and a TM season-target file. Indoor sides are skipped.
 *
 *   npx tsx src/jobs/complete-mls-careers.ts
 *   npx tsx src/jobs/complete-mls-careers.ts --apply
 *   npx tsx src/jobs/complete-mls-careers.ts --apply --targets-only
 *   npx tsx src/jobs/complete-mls-careers.ts --apply --us-only
 *   npx tsx src/jobs/complete-mls-careers.ts --apply --player=649774d6-39ef-4552-9b9c-22d0090cebf3
 */
import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  isNationalTeam,
  isYouthNationalOrOlympicSide,
  isYouthOrReserveSide,
  nationSet,
} from '../utils/nationalTeam.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const TARGETS_ONLY = process.argv.includes('--targets-only');
const US_ONLY = process.argv.includes('--us-only');
const PLAYER_FILTER = process.argv.find((a) => a.startsWith('--player='))?.slice(9) ?? null;
const DIR = 'transferdata';
const FAMOUS_TIER = 4;
const MLS_LEAGUE_ID = 253;
const UA = 'BallKnowledge/1.0 (football quiz app; contact via repository)';
const WD = 'https://www.wikidata.org/w/api.php';
const PAUSE_MS = 800;
const DONE_PATH = join(DIR, 'wd_mls_career_done.txt');

const CLUB_ALIASES: Record<string, string> = {
  'la galaxy': 'los angeles galaxy',
  'los angeles galaxy': 'los angeles galaxy',
  'club de futbol america': 'club america',
  'club leon': 'leon',
  leon: 'leon',
  'san jose earthquakes': 'san jose earthquakes',
  'houston dynamo': 'houston dynamo',
  'houston dynamo fc': 'houston dynamo',
  'new york red bulls': 'new york red bulls',
  'ny red bulls': 'new york red bulls',
  'new york red bull': 'new york red bulls',
  'inter miami': 'inter miami',
  'inter miami cf': 'inter miami',
  'club internacional de futbol miami': 'inter miami',
  'cf montreal': 'cf montreal',
  'seattle sounders': 'seattle sounders',
  'seattle sounders fc': 'seattle sounders',
  'dc united': 'dc united',
  'd c united': 'dc united',
  'columbus crew': 'columbus crew',
  'columbus crew sc': 'columbus crew',
  'sporting kansas city': 'sporting kansas city',
  'new england revolution': 'new england revolution',
  'chicago fire': 'chicago fire',
  'chicago fire fc': 'chicago fire',
  'fc dallas': 'fc dallas',
  'real salt lake': 'real salt lake',
  'portland timbers': 'portland timbers',
  'vancouver whitecaps': 'vancouver whitecaps',
  'vancouver whitecaps fc': 'vancouver whitecaps',
  'philadelphia union': 'philadelphia union',
  'orlando city': 'orlando city',
  'orlando city sc': 'orlando city',
  'atlanta united': 'atlanta united',
  'atlanta united fc': 'atlanta united',
  'minnesota united': 'minnesota united',
  'minnesota united fc': 'minnesota united',
  'los angeles fc': 'los angeles fc',
  'lafc': 'los angeles fc',
  'nashville sc': 'nashville sc',
  'austin fc': 'austin',
  'st louis city': 'st louis city',
  'st louis city sc': 'st louis city',
  'bayer 04 leverkusen': 'bayer leverkusen',
  'bayer leverkusen': 'bayer leverkusen',
  'fc bayern munich': 'bayern munchen',
  'bayern munich': 'bayern munchen',
  'everton f c': 'everton',
  everton: 'everton',
};

interface PoolPlayer {
  id: string;
  name: string;
  tmId: string | null;
  dob: string | null;
  nationality: string;
  currentClub: string;
  currentLeague: string;
  tier: number;
  clubs: number;
  tmCareerGoals: number | null;
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

function isIndoorOrNonAssoc(label: string): boolean {
  return /indoor|futsal|beach soccer|sockers|arena soccer|\bmasl\b|\bmisl\b/i.test(label);
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
  if (isWikiNationalSide(label, nations) || isIndoorOrNonAssoc(label)) return null;

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

function mergeOverlapping(spells: Array<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  const sorted = [...spells].sort((a, b) => a.from - b.from);
  const out: Array<{ from: number; to: number }> = [];
  for (const spell of sorted) {
    const last = out[out.length - 1];
    if (last && spell.from <= last.to + 1) last.to = Math.max(last.to, spell.to);
    else out.push({ ...spell });
  }
  return out;
}

async function main(): Promise<void> {
  const nations = await nationSet();
  const pool = (await db.execute(sql`
    SELECT p.id, p.name, p.tm_player_id AS "tmId", p.birth_date::text AS dob, p.nationality,
           p.current_club AS "currentClub", p.current_league AS "currentLeague",
           p.market_value_tier AS tier,
           (SELECT COUNT(*)::int FROM player_career pc WHERE pc.player_id = p.id AND pc.team_id > 0) AS clubs,
           e.tm_career_goals AS "tmCareerGoals"
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    WHERE (
        (p.nationality IN ('United States', 'USA') AND p.market_value_tier >= ${FAMOUS_TIER})
        OR p.current_league ILIKE '%MLS%'
        OR p.current_league ILIKE 'Major League Soccer'
        OR EXISTS (
          SELECT 1 FROM player_career pc
          WHERE pc.player_id = p.id
            AND (
              EXISTS (SELECT 1 FROM teams t WHERE t.id = pc.team_id AND t.league_id = ${MLS_LEAGUE_ID})
              OR pc.team_name ILIKE '%galaxy%'
              OR pc.team_name ILIKE '%earthquakes%'
              OR pc.team_name ILIKE '%inter miami%'
            )
        )
        OR EXISTS (
          SELECT 1 FROM player_stats s
          WHERE s.player_id = p.id AND s.league_id = ${MLS_LEAGUE_ID}
        )
      )
      ${PLAYER_FILTER ? sql`AND p.id = ${PLAYER_FILTER}::uuid` : sql``}
    ORDER BY p.market_value_tier DESC NULLS LAST, p.name
  `)) as unknown as PoolPlayer[];

  const famous = pool.filter((p) => p.tier >= FAMOUS_TIER);
  // Retirees like Donovan often sit below the live-squad fame floor; still fill their clubs.
  const withTm = pool.filter(
    (p) =>
      p.tmId &&
      (PLAYER_FILTER ||
        ((p.tier >= 3 || /united states|usa/i.test(p.nationality)) &&
          (!US_ONLY || /united states|usa/i.test(p.nationality))))
  );
  const noGoals = withTm.filter((p) => p.tmCareerGoals == null);
  const staleCurrent = pool.filter((p) => {
    const club = p.currentClub.trim().toLowerCase();
    if (!club || ['unknown', 'without club', 'retired', 'free agent'].includes(club)) return false;
    const european =
      /everton|arsenal|chelsea|liverpool|united|city|tottenham|bayern|dortmund|leverkusen|madrid|barcelona|milan|juventus|roma|napoli|psg|marseille|lyon|ajax/i.test(
        p.currentClub
      );
    return european && /united states|usa/i.test(p.nationality);
  });

  console.log(`US / MLS rows: ${pool.length}; famous: ${famous.length} (${withTm.length} with TM id)`);
  console.log(`Missing tm_career_goals: ${noGoals.length}`);
  console.log(`US players whose current_club still looks European: ${staleCurrent.length}`);
  for (const p of staleCurrent.slice(0, 25)) {
    console.log(`  ${p.name.padEnd(28)} ${p.currentClub} (${p.currentLeague}) clubs=${p.clubs} goals=${p.tmCareerGoals}`);
  }
  console.log('Missing career totals:');
  for (const p of noGoals.slice(0, 40)) {
    console.log(`  ${p.name.padEnd(28)} tm=${p.tmId} clubs=${p.clubs}`);
  }

  const donovan = pool.find((p) => p.name === 'Landon Donovan');
  if (donovan) {
    const career = (await db.execute(sql`
      SELECT team_name, season_from, season_to FROM player_career
      WHERE player_id = ${donovan.id}::uuid ORDER BY season_from, team_name
    `)) as unknown as Array<{ team_name: string; season_from: number; season_to: number | null }>;
    console.log(
      `Landon Donovan: current=${donovan.currentClub} / ${donovan.currentLeague} goals=${donovan.tmCareerGoals}`
    );
    console.log(
      `  career: ${career.map((c) => `${c.team_name} ${c.season_from}–${c.season_to ?? ''}`).join(', ') || '(none)'}`
    );
  }

  const mapPath = join(DIR, 'tm_id_map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapEntry[];
  const mapped = new Set(map.map((m) => m.ourId));
  const mapAdds = withTm.filter((s) => s.tmId && !mapped.has(s.id));
  const targets = noGoals
    .filter((p) => p.dob && p.tmId)
    .map((p) => ({
      ourId: p.id,
      tmId: p.tmId!,
      code: 'x',
      name: p.name,
      dob: p.dob!.slice(0, 10),
    }));
  const targetsPath = join(DIR, 'tm_targets_mls.json');
  console.log(`tm_id_map entries to add: ${mapAdds.length}`);
  console.log(`MLS scrape targets (missing TM goals): ${targets.length}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write clubs, tm_id_map, and scrape targets.');
    return;
  }

  for (const s of mapAdds) {
    map.push({ ourId: s.id, tmId: s.tmId!, code: 'x', name: s.name });
  }
  writeFileSync(mapPath, JSON.stringify(map));
  if (!PLAYER_FILTER) {
    writeFileSync(targetsPath, JSON.stringify(targets, null, 0));
    console.log(`Wrote ${mapAdds.length} map entries and ${targets.length} scrape targets.`);
  } else {
    console.log(`Wrote ${mapAdds.length} map entries (targets file left unchanged for a single-player run).`);
  }
  if (TARGETS_ONLY) return;

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

  const done = new Set(
    existsSync(DONE_PATH)
      ? readFileSync(DONE_PATH, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      : []
  );
  const pending = withTm.filter((s) => s.tmId && (PLAYER_FILTER || !done.has(s.id)));
  console.log(`Wikidata career lookups remaining: ${pending.length}`);

  let rewritten = 0;
  const unmatched = new Set<string>();
  for (let i = 0; i < pending.length; i += 1) {
    const player = pending[i]!;
    try {
      const qid = await qidForTmId(player.tmId!);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      if (!qid) {
        console.log(`  ${player.name}: no Wikidata item for tm=${player.tmId}`);
        if (APPLY && !PLAYER_FILTER) appendFileSync(DONE_PATH, `${player.id}\n`);
        continue;
      }
      const spells = await spellsForQid(qid);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      const existing = (await db.execute(sql`
        SELECT team_id, team_name, season_from, season_to
        FROM player_career WHERE player_id = ${player.id}::uuid
      `)) as unknown as Array<{
        team_id: number;
        team_name: string;
        season_from: number;
        season_to: number | null;
      }>;
      const byTeam = new Map<number, { team: TeamRow; spells: Array<{ from: number; to: number }> }>();
      for (const spell of spells) {
        const team = resolveTeam(spell.label, teams, nations);
        if (!team) {
          if (!isWikiNationalSide(spell.label, nations) && !isIndoorOrNonAssoc(spell.label)) {
            unmatched.add(spell.label);
          }
          continue;
        }
        const bucket = byTeam.get(team.id) ?? { team, spells: [] };
        bucket.spells.push({ from: spell.from, to: spell.to });
        byTeam.set(team.id, bucket);
      }
      const notes: string[] = [];
      for (const { team, spells: raw } of byTeam.values()) {
        const wikiStints = mergeOverlapping(raw);
        const have = existing.filter((row) => row.team_id === team.id);
        const same =
          have.length === wikiStints.length &&
          wikiStints.every((stint, idx) => {
            const row = have[idx]!;
            return row.season_from === stint.from && (row.season_to ?? row.season_from) === stint.to;
          });
        if (same) continue;
        const shouldRewrite = have.length === 0 || wikiStints.length > have.length;
        const shouldWiden =
          have.length === 1 &&
          wikiStints.length === 1 &&
          (wikiStints[0]!.from < have[0]!.season_from ||
            wikiStints[0]!.to > (have[0]!.season_to ?? have[0]!.season_from));
        if (!shouldRewrite && !shouldWiden) continue;
        const next =
          shouldWiden && have[0] && wikiStints[0]
            ? [
                {
                  from: Math.min(have[0].season_from, wikiStints[0].from),
                  to: Math.max(have[0].season_to ?? have[0].season_from, wikiStints[0].to),
                },
              ]
            : wikiStints;
        notes.push(
          `${team.name} ${have.map((r) => `${r.season_from}–${r.season_to ?? ''}`).join('+') || '(none)'} -> ${next.map((s) => `${s.from}–${s.to}`).join(' + ')}`
        );
        if (APPLY) {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              DELETE FROM player_career
              WHERE player_id = ${player.id}::uuid AND team_id = ${team.id}
            `);
            const values = next.map(
              (s) => sql`(${player.id}::uuid, ${team.id}, ${team.name}, ${s.from}, ${s.to}, now())`
            );
            await tx.execute(sql`
              INSERT INTO player_career (player_id, team_id, team_name, season_from, season_to, updated_at)
              VALUES ${sql.join(values, sql`, `)}
              ON CONFLICT (player_id, team_id, season_from)
              DO UPDATE SET season_to = excluded.season_to, team_name = excluded.team_name, updated_at = now()
            `);
          });
          rewritten += next.length;
        }
      }
      if (notes.length > 0) console.log(`  ${player.name}: ${notes.join('; ')}`);
      if (APPLY && !PLAYER_FILTER) appendFileSync(DONE_PATH, `${player.id}\n`);
    } catch (error) {
      console.warn(`  ${player.name}: ${error instanceof Error ? error.message : error}`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
      console.log(`  looked up ${i + 1}/${pending.length}`);
    }
  }

  if (unmatched.size > 0) {
    console.log(`Unresolved club labels (${unmatched.size}):`);
    for (const club of [...unmatched].sort().slice(0, 40)) console.log(`  ${club}`);
  }
  console.log(`Rewrote ${rewritten} player_career spells.`);
  if (donovan) {
    const career = (await db.execute(sql`
      SELECT team_name, season_from, season_to FROM player_career
      WHERE player_id = ${donovan.id}::uuid ORDER BY season_from, team_name
    `)) as unknown as Array<{ team_name: string; season_from: number; season_to: number | null }>;
    console.log(
      `Donovan career now: ${career.map((c) => `${c.team_name} ${c.season_from}–${c.season_to ?? ''}`).join(', ')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
