/**
 * Flag player records that are probably TWO+ different people merged under one common
 * name (e.g. the three "Júlio César"s). Read-only — reports candidates for manual review.
 *
 * Signals (each is essentially impossible for a single real career):
 *   • two genuinely different NATIONAL teams (after collapsing successor states like
 *     Yugoslavia→Serbia, Czechoslovakia→Czech, USSR→Russia)
 *   • a Goalkeeper with a real goal tally (keeper merged with an outfielder, or a
 *     mislabelled position) — a few legit penalty-taking keepers (Butt, Ceni) will show
 *   • an implausible career span (>26 seasons) — softer, shown only as extra evidence
 *
 * NB: this targets two-PEOPLE-one-name conflation. Duplicate stat ROWS (same season from
 * multiple sources / team-name variants) are a separate dedup and intentionally ignored.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/audit-conflations.ts [limit]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/** Collapse national-team names that are the same footballing lineage. */
function canonNation(n: string): string {
  const s = n.toLowerCase();
  if (/yugoslav|serbia|s ?& ?m\b|serbia and montenegro/.test(s)) return 'Serbia/Yugoslavia';
  if (/czech|slovak/.test(s)) return 'Czech/Slovak';
  if (/soviet|ussr|\bcis\b|russia/.test(s)) return 'Russia/USSR';
  if (/germany/.test(s)) return 'Germany';
  if (/ireland/.test(s)) return 'Ireland';
  return n;
}

interface Row {
  id: string;
  name: string;
  position: string;
  min_s: number;
  max_s: number;
  goals: number;
  nat_list: string[];
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : 80;

  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.position,
      MIN(st.season) AS min_s, MAX(st.season) AS max_s,
      COALESCE(SUM(st.goals), 0)::int AS goals,
      COALESCE(array_agg(DISTINCT st.team_name) FILTER (WHERE st.league_id = 1), ARRAY[]::text[]) AS nat_list
    FROM players p JOIN player_stats st ON st.player_id = p.id
    GROUP BY p.id, p.name, p.position
  `)) as unknown as Row[];

  const scored = rows.map((r) => {
    const reasons: string[] = [];
    const nations = [...new Set((r.nat_list ?? []).map(canonNation))];
    if (nations.length > 1) reasons.push(`${nations.length} nations [${nations.join(', ')}]`);
    if (r.position === 'Goalkeeper' && r.goals >= 8) reasons.push(`GK with ${r.goals} goals`);
    const span = r.max_s - r.min_s;
    const strong = reasons.length;
    if (strong > 0 && span > 26) reasons.push(`${span}-yr span (${r.min_s}–${r.max_s})`);
    return { r, reasons, strong, span };
  })
    .filter((x) => x.strong > 0)
    .sort((a, b) => b.strong - a.strong || b.span - a.span);

  console.log(`${scored.length} suspected conflations (showing up to ${limit}):\n`);
  for (const s of scored.slice(0, limit)) {
    console.log(`  [${s.strong}] ${s.r.name} (${s.r.position}) — ${s.reasons.join(' · ')}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
