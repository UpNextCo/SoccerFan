/**
 * Import senior international caps + goals scraped by scripts/tm_scrape_intl.py into
 * player_extra_stats.tm_intl_caps / tm_intl_goals.
 *
 * These land in NEW columns rather than overwriting intl_caps / intl_goals so the older Wikipedia and
 * players.csv values stay available (and reversible). They exist because both old sources are wrong in
 * opposite directions: players.csv sometimes stored CLUB appearances as caps (Iker Muniain 270, really
 * 2), while the Wikipedia lists miss real scorers entirely (Gareth Bale 0, really 40).
 *
 * Matching is by Transfermarkt id (players.tm_player_id), so remapped player UUIDs still get the scrape.
 *
 * Refused:
 *   - youth header ("Portugal U21")
 *   - true dual internationals where the header team is not the player's stored nationality
 *     (Malouda French Guiana vs France). Successor-state careers (Serbia / Serbia and Montenegro /
 *     Yugoslavia) count as one side.
 *
 * Usage: npx tsx src/jobs/import-tm-intl.ts [transferdataDir] [--apply]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';
import { canonicalNationality } from '../utils/nationality.js';
import { INTL_CAPS_FALLBACK_MAX, INTL_CAPS_SANITY_MAX } from '../services/statMetrics.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const APPLY = process.argv.includes('--apply');

/**
 * Sides that are neither youth nor the senior national team: Olympic squads ("Brazil Olympic",
 * "Uruguay Olympia") and the second-string setups Transfermarkt keeps as separate teams
 * ("Deutschland A2 (1999-2001)", "Germany B (1951-1986)", "Germany Team 2006 (2001-2005)").
 */
const SECONDARY_SIDE = /\bolympi(?:a|c|cs)\b|\bA2\b|\bB\s*\(|\bteam\s+\d{4}\b/i;

/** Historical predecessors / alternate labels that still describe one senior career. */
const SUCCESSOR_CLUSTERS: string[][] = [
  ['serbia', 'serbia and montenegro', 'yugoslavia', 'serbia-montenegro'],
  ['montenegro', 'serbia and montenegro', 'yugoslavia', 'serbia-montenegro'],
  ['czech republic', 'czechia', 'czechoslovakia'],
  ['slovakia', 'czechoslovakia'],
  ['russia', 'cis', 'soviet union', 'ussr'],
  ['ukraine', 'soviet union', 'ussr'],
  ['germany', 'east germany', 'west germany', 'germany dr', 'german democratic republic'],
  ['yemen', 'south yemen', 'north yemen', 'yemen ar', 'yemen pdr'],
  ['congo', 'zaire', 'dr congo', 'congo dr', 'democratic republic of the congo'],
  ['indonesia', 'dutch east indies'],
];

interface Line {
  ourId: string;
  tmId: string;
  team: string | null;
  caps: number | null;
  goals: number | null;
  teams?: string[];
}

const isSeniorSide = (team: string): boolean => !isYouthOrReserveSide(team) && !SECONDARY_SIDE.test(team);

function nationKey(name: string): string {
  return canonicalNationality(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clusterId(name: string): string {
  const key = nationKey(name);
  for (let i = 0; i < SUCCESSOR_CLUSTERS.length; i += 1) {
    if (SUCCESSOR_CLUSTERS[i]!.some((alias) => key === alias || key.includes(alias))) {
      return `cluster:${i}`;
    }
  }
  return `solo:${key}`;
}

/** Collapse Serbia+Yugoslavia etc. into one identity for ambiguity checks. */
function distinctSeniorCareers(teams: string[]): string[] {
  const ids = new Set<string>();
  for (const team of teams.filter(isSeniorSide)) {
    ids.add(clusterId(team));
  }
  return [...ids];
}

function nationalityMatchesHeader(playerNationality: string | null, headerTeam: string): boolean {
  if (!playerNationality) return false;
  return clusterId(playerNationality) === clusterId(headerTeam)
    || nationKey(playerNationality) === nationKey(headerTeam);
}

async function main() {
  const text = readFileSync(join(DIR, 'tm_intl.jsonl'), 'utf8').trim();
  const lines = text ? text.split('\n').map((l) => JSON.parse(l) as Line) : [];

  // Prefer the latest scrape per TM id (file may contain remapped ourIds over time).
  const byTm = new Map<string, Line>();
  for (const ln of lines) {
    if (!ln.tmId) continue;
    byTm.set(String(ln.tmId), ln);
  }

  const tmIds = [...byTm.keys()];
  console.log(`scraped rows      : ${lines.length}`);
  console.log(`unique tm ids     : ${tmIds.length}`);

  const players = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, p.tm_player_id,
           COALESCE(e.intl_caps, 0)::int AS caps,
           COALESCE(e.intl_goals, 0)::int AS goals,
           e.tm_intl_caps
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    WHERE p.tm_player_id = ANY(${sql`ARRAY[${sql.join(tmIds.map((id) => sql`${id}`), sql`, `)}]`})
  `)) as unknown as Array<{
    id: string;
    name: string;
    nationality: string | null;
    tm_player_id: string;
    caps: number;
    goals: number;
    tm_intl_caps: number | null;
  }>;

  const byTmPlayer = new Map(players.map((p) => [String(p.tm_player_id), p]));
  console.log(`matched in DB     : ${byTmPlayer.size}`);

  const keep = new Map<string, { caps: number; goals: number; team: string; name: string; was: number }>();
  let noCaps = 0;
  let youth = 0;
  let insane = 0;
  let unmatched = 0;
  let ambiguousSkipped = 0;
  let successorCollapsed = 0;
  let nationalityRescued = 0;
  let impossibleRescued = 0;

  for (const [tmId, ln] of byTm) {
    const player = byTmPlayer.get(tmId);
    if (!player) { unmatched++; continue; }
    if (ln.caps === null) { noCaps++; continue; }
    if (ln.caps < 0 || ln.caps > INTL_CAPS_SANITY_MAX) { insane++; continue; }

    // Header team is sometimes missing from older scrapes even when Caps/Goals parsed.
    // Fall back to the senior side list (prefer the player's stored nationality).
    const seniors = (ln.teams ?? []).filter(isSeniorSide);
    let team = ln.team && isSeniorSide(ln.team) ? ln.team : null;
    if (!team) {
      team = seniors.find((t) => nationalityMatchesHeader(player.nationality, t))
        ?? seniors[0]
        ?? null;
    }
    if (!team) { youth++; continue; }

    const value = {
      caps: ln.caps,
      goals: Math.max(0, ln.goals ?? 0),
      team,
      name: player.name,
      was: player.caps,
    };

    const careers = distinctSeniorCareers(ln.teams ?? [team]);
    if (careers.length <= 1) {
      if ((ln.teams ?? []).filter(isSeniorSide).length > 1) successorCollapsed += 1;
      keep.set(player.id, value);
      continue;
    }

    // True multi-nation record: accept only when the header matches our stored nationality,
    // or when wiki caps are impossible (club-appearance bug).
    if (nationalityMatchesHeader(player.nationality, team)) {
      nationalityRescued += 1;
      keep.set(player.id, value);
      continue;
    }
    if (player.caps > INTL_CAPS_FALLBACK_MAX) {
      impossibleRescued += 1;
      keep.set(player.id, value);
      continue;
    }
    ambiguousSkipped += 1;
  }

  console.log(`no caps on page   : ${noCaps}`);
  console.log(`youth/Olympic side: ${youth}`);
  console.log(`out of sane range : ${insane}`);
  console.log(`unmatched tm ids  : ${unmatched}`);
  console.log(`successor collapsed: ${successorCollapsed}`);
  console.log(`nationality rescue: ${nationalityRescued}`);
  console.log(`impossible wiki rescue: ${impossibleRescued}`);
  console.log(`true dual skipped : ${ambiguousSkipped}`);
  console.log(`to write          : ${keep.size}`);

  const capDrops = [...keep.values()]
    .filter((d) => d.was - d.caps >= 20)
    .sort((a, b) => (b.was - b.caps) - (a.was - a.caps));
  const capGains = [...keep.values()]
    .filter((d) => d.caps - d.was >= 20)
    .sort((a, b) => (b.caps - a.was) - (a.caps - a.was));
  console.log(`\n--- wiki was 20+ higher (likely club-apps bug) ---`);
  for (const d of capDrops.slice(0, 15)) {
    console.log(`  ${String(d.was).padStart(4)} -> ${String(d.caps).padEnd(4)} ${d.name} (${d.team})`);
  }
  console.log(`\n--- TM is 20+ higher (wiki undercount) ---`);
  for (const d of capGains.slice(0, 20)) {
    console.log(`  ${String(d.was).padStart(4)} -> ${String(d.caps).padEnd(4)} ${d.name} (${d.team})`);
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
    process.exit(0);
  }

  const rows = [...keep.entries()];
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const tuples = batch.map(([pid, v]) => sql`(${pid}::uuid, ${v.caps}, ${v.goals})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, tm_intl_caps, tm_intl_goals)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE
        SET tm_intl_caps = EXCLUDED.tm_intl_caps,
            tm_intl_goals = EXCLUDED.tm_intl_goals,
            updated_at = now()
    `);
    written += batch.length;
  }
  console.log(`\nWrote tm_intl_caps/goals for ${written} players.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
