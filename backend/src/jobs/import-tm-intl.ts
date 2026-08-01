/**
 * Import senior international caps + goals scraped by scripts/tm_scrape_intl.py into
 * player_extra_stats.tm_intl_caps / tm_intl_goals.
 *
 * These land in NEW columns rather than overwriting intl_caps / intl_goals so the older Wikipedia and
 * players.csv values stay available (and reversible). They exist because both old sources are wrong in
 * opposite directions: players.csv sometimes stored CLUB appearances as caps (Iker Muniain 270, really
 * 2), while the Wikipedia lists miss real scorers entirely (Gareth Bale 0, really 40).
 *
 * Two kinds of row are refused:
 *   - youth: a header reading "Portugal U21" is not a senior total.
 *   - ambiguous: the header describes only the player's LATEST national team, so anyone with two senior
 *     sides can be described by the wrong one — Malouda's 4 French Guiana caps standing in for his 80
 *     for France, Šuker's 2 for Yugoslavia for his 69 for Croatia. Per-team splits aren't in the HTML,
 *     so those players keep whatever we already hold (which is usually the main-team figure).
 *
 * Usage: npx tsx src/jobs/import-tm-intl.ts [transferdataDir] [--apply]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';
import { INTL_CAPS_FALLBACK_MAX, INTL_CAPS_SANITY_MAX } from '../services/statMetrics.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const APPLY = process.argv.includes('--apply');

/**
 * Sides that are neither youth nor the senior national team: Olympic squads ("Brazil Olympic",
 * "Uruguay Olympia") and the second-string setups Transfermarkt keeps as separate teams
 * ("Deutschland A2 (1999-2001)", "Germany B (1951-1986)", "Germany Team 2006 (2001-2005)").
 * Counting these as senior would make a one-nation player look like a dual international and cost
 * them the correction.
 */
const SECONDARY_SIDE = /\bolympi(?:a|c|cs)\b|\bA2\b|\bB\s*\(|\bteam\s+\d{4}\b/i;

interface Line {
  ourId: string;
  tmId: string;
  team: string | null;
  caps: number | null;
  goals: number | null;
  /** Every national team on the player's record, senior and youth. */
  teams?: string[];
}

const isSeniorSide = (team: string): boolean => !isYouthOrReserveSide(team) && !SECONDARY_SIDE.test(team);

async function main() {
  const text = readFileSync(join(DIR, 'tm_intl.jsonl'), 'utf8').trim();
  const lines = text ? text.split('\n').map((l) => JSON.parse(l) as Line) : [];

  const keep = new Map<string, { caps: number; goals: number; team: string }>();
  const ambiguous = new Map<string, { caps: number; goals: number; team: string; teams: string[] }>();
  let noCaps = 0;
  let youth = 0;
  let insane = 0;
  for (const ln of lines) {
    if (ln.caps === null || ln.team === null) { noCaps++; continue; }
    if (!isSeniorSide(ln.team)) { youth++; continue; }
    if (ln.caps < 0 || ln.caps > INTL_CAPS_SANITY_MAX) { insane++; continue; }
    const value = { caps: ln.caps, goals: Math.max(0, ln.goals ?? 0), team: ln.team };
    const seniorSides = (ln.teams ?? []).filter(isSeniorSide);
    if (seniorSides.length > 1) ambiguous.set(ln.ourId, { ...value, teams: seniorSides });
    else keep.set(ln.ourId, value);
  }

  console.log(`scraped rows      : ${lines.length}`);
  console.log(`no caps on page   : ${noCaps}   (uncapped players, or a fetch that failed)`);
  console.log(`youth/Olympic side: ${youth}`);
  console.log(`out of sane range : ${insane}`);
  console.log(`two senior sides  : ${ambiguous.size}   (header names only the latest of them)`);

  // Stored values for everything in play, so ambiguous players can be judged against what we hold.
  const ids = [...keep.keys(), ...ambiguous.keys()];
  if (!ids.length) process.exit(0);
  const idArr = sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]`;
  const stored = (await db.execute(sql`
    SELECT p.id, p.name, COALESCE(e.intl_caps, 0)::int AS caps, COALESCE(e.intl_goals, 0)::int AS goals
    FROM players p LEFT JOIN player_extra_stats e ON e.player_id = p.id
    WHERE p.id = ANY(${idArr})
  `)) as unknown as Array<{ id: string; name: string; caps: number; goals: number }>;
  const storedById = new Map(stored.map((s) => [s.id, s]));

  // A dual international normally keeps their stored caps, because the header may describe the minor
  // team. But when the stored figure is beyond any real career it's the club-appearance bug (Iñaki
  // Williams on 230), and even an ambiguous Transfermarkt number beats known nonsense.
  const rescued: string[] = [];
  for (const [id, value] of ambiguous) {
    if ((storedById.get(id)?.caps ?? 0) <= INTL_CAPS_FALLBACK_MAX) continue;
    keep.set(id, value);
    ambiguous.delete(id);
    rescued.push(storedById.get(id)?.name ?? id);
  }
  if (rescued.length) console.log(`  of those, ${rescued.length} had impossible stored caps and take the TM value: ${rescued.join(', ')}`);
  console.log(`to write          : ${keep.size}`);

  const current = stored.filter((s) => keep.has(s.id));
  const diffs = current
    .map((c) => ({ name: c.name, was: c, now: keep.get(c.id)! }))
    .filter((d) => d.was.caps !== d.now.caps || d.was.goals !== d.now.goals);
  const capDrops = diffs.filter((d) => d.was.caps - d.now.caps >= 20).sort((a, b) => (b.was.caps - b.now.caps) - (a.was.caps - a.now.caps));
  const goalGains = diffs.filter((d) => d.now.goals - d.was.goals >= 10).sort((a, b) => (b.now.goals - b.was.goals) - (a.now.goals - a.was.goals));
  console.log(`\ndisagreements     : ${diffs.length} of ${current.length}`);
  console.log(`\n--- caps we were overstating by 20+ (players.csv club-appearance bug) ---`);
  for (const d of capDrops.slice(0, 15)) console.log(`  ${String(d.was.caps).padStart(4)} -> ${String(d.now.caps).padEnd(4)} ${d.name}`);
  console.log(`\n--- international goals we were missing (10+) ---`);
  for (const d of goalGains.slice(0, 15)) console.log(`  ${String(d.was.goals).padStart(4)} -> ${String(d.now.goals).padEnd(4)} ${d.name}`);

  if (ambiguous.size) {
    console.log(`\n--- skipped: two senior national teams, keeping our stored caps ---`);
    for (const [id, a] of [...ambiguous].slice(0, 12)) {
      const row = storedById.get(id);
      if (row) console.log(`  ${String(row.caps).padStart(4)} caps kept  ${row.name}  (${a.teams.join(' / ')})`);
    }
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
  console.log(`\nWrote international caps/goals for ${written} players.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
