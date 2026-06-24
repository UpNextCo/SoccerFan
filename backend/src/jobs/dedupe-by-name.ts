/**
 * Merge same-name duplicates that the DOB pass can't reach — typically an
 * API-Football row (2010+, has DOB) and an FBref pre-2010 row (no DOB) for the
 * SAME famous player (Cristiano Ronaldo ×2, Ederson ×3).
 *
 * Exact name + nationality alone is NOT enough (many different "José García"s),
 * so a dup is only merged with strong same-person evidence:
 *   - it has no stats (empty stub), OR
 *   - it shares a club with the survivor, OR
 *   - it has the same non-null birth_date as the survivor.
 *
 * Pure DB, zero API. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

const CHILD: Array<{ table: string; keys: string[] }> = [
  { table: 'player_stats', keys: ['league_id', 'season', 'team_id'] },
  { table: 'player_transfers', keys: ['transfer_date', 'from_team_id', 'to_team_id'] },
  { table: 'player_honours', keys: ['competition', 'season', 'placement'] },
  { table: 'player_career', keys: ['team_id', 'season_from'] },
];

function normClub(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function repoint(table: string, keys: string[], dup: string, canon: string): Promise<void> {
  const cond = keys.map((k) => sql`c.${sql.raw(k)} IS NOT DISTINCT FROM c2.${sql.raw(k)}`);
  await db.execute(sql`
    UPDATE ${sql.raw(table)} c SET player_id = ${canon}
    WHERE c.player_id = ${dup}
      AND NOT EXISTS (
        SELECT 1 FROM ${sql.raw(table)} c2
        WHERE c2.player_id = ${canon} AND ${sql.join(cond, sql` AND `)}
      )
  `);
}

interface Member {
  id: string;
  name: string;
  externalId: string | null;
  dob: string | null;
  apps: number;
  statRows: number;
  clubs: Set<string>;
  aliases: string[];
  searchText: string;
  mv: number | null;
  pv: number | null;
  rf: number | null;
}

async function main() {
  console.log(`Dedupe by name + shared-club evidence — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const groups = (await db.execute(sql`
    SELECT lower(trim(name)) AS ln, nationality, array_agg(id) AS ids
    FROM players
    GROUP BY lower(trim(name)), nationality
    HAVING COUNT(*) > 1
  `)) as unknown as Array<{ ln: string; nationality: string; ids: string[] }>;
  console.log(`${groups.length} exact name+nationality clusters`);

  const allIds = groups.flatMap((g) => g.ids);
  const idList = sql.join(allIds.map((id) => sql`${id}`), sql`, `);

  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.external_id AS external_id, p.birth_date::text AS dob,
           p.aliases, p.search_text AS search_text,
           p.market_value_eur AS mv, p.peak_market_value_eur AS pv, p.record_fee_eur AS rf,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps,
           COALESCE((SELECT COUNT(*) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS stat_rows,
           COALESCE((SELECT array_agg(DISTINCT team_name) FROM player_stats s WHERE s.player_id = p.id AND team_name IS NOT NULL), ARRAY[]::text[]) AS clubs
    FROM players p WHERE p.id IN (${idList})
  `)) as unknown as Array<{
    id: string; name: string; external_id: string | null; dob: string | null; aliases: string[]; search_text: string;
    mv: number | null; pv: number | null; rf: number | null; apps: number; stat_rows: number; clubs: string[];
  }>;

  const byId = new Map<string, Member>(
    rows.map((r) => [r.id, {
      id: r.id, name: r.name, externalId: r.external_id, dob: r.dob, apps: r.apps, statRows: r.stat_rows,
      clubs: new Set((r.clubs ?? []).map(normClub)),
      aliases: Array.isArray(r.aliases) ? r.aliases : [], searchText: r.search_text,
      mv: r.mv, pv: r.pv, rf: r.rf,
    }])
  );

  let clusters = 0;
  let merges = 0;
  let skipped = 0;
  const examples: string[] = [];

  for (const g of groups) {
    const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length < 2) continue;

    const canon = [...members].sort((a, b) => {
      const ext = Number(Boolean(b.externalId)) - Number(Boolean(a.externalId));
      if (ext !== 0) return ext;
      if (b.apps !== a.apps) return b.apps - a.apps;
      return b.statRows - a.statRows;
    })[0]!;

    const dups = members.filter((m) => m.id !== canon.id);
    const sharesClub = (d: Member): boolean => {
      for (const c of d.clubs) if (canon.clubs.has(c)) return true;
      return false;
    };
    const sameDob = (d: Member): boolean => Boolean(d.dob && canon.dob && d.dob === canon.dob);
    const safe = dups.filter((d) => d.statRows === 0 || sharesClub(d) || sameDob(d));
    const unsafe = dups.filter((d) => !(d.statRows === 0 || sharesClub(d) || sameDob(d)));
    skipped += unsafe.length;
    if (safe.length === 0) continue;
    clusters += 1;

    const aliasSet = new Set<string>([...canon.aliases, canon.name]);
    let searchText = canon.searchText;
    let externalId = canon.externalId;
    let dob = canon.dob;
    let mv = canon.mv;
    let pv = canon.pv;
    let rf = canon.rf;
    for (const d of safe) {
      for (const a of d.aliases) aliasSet.add(a);
      aliasSet.add(d.name);
      searchText = `${searchText} ${d.searchText}`;
      externalId = externalId ?? d.externalId;
      dob = dob ?? d.dob;
      mv = mv ?? d.mv;
      pv = Math.max(pv ?? 0, d.pv ?? 0) || pv || d.pv;
      rf = Math.max(rf ?? 0, d.rf ?? 0) || rf || d.rf;
    }

    if (examples.length < 30) {
      examples.push(`${canon.name} (${g.nationality}) ⇐ ${safe.length} dup${safe.length > 1 ? 's' : ''}${unsafe.length ? ` · kept ${unsafe.length} different` : ''}`);
    }

    if (APPLY) {
      for (const d of safe) {
        for (const { table, keys } of CHILD) await repoint(table, keys, d.id, canon.id);
        await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${canon.id} WHERE answer_player_id = ${d.id}`);
        await db.execute(sql`DELETE FROM players WHERE id = ${d.id}`);
        merges += 1;
      }
      const dedupSearch = [...new Set(searchText.split(/\s+/).filter(Boolean))].join(' ');
      await db.execute(sql`
        UPDATE players SET external_id = ${externalId}, birth_date = ${dob}, aliases = ${JSON.stringify([...aliasSet])}::jsonb,
          search_text = ${dedupSearch}, market_value_eur = ${mv}, peak_market_value_eur = ${pv}, record_fee_eur = ${rf}
        WHERE id = ${canon.id}
      `);
    } else {
      merges += safe.length;
    }
  }

  console.log(`\n${APPLY ? 'Merged' : 'Would merge'} ${merges} duplicates across ${clusters} clusters · ${skipped} different-person rows kept apart`);
  console.log('\nSamples:');
  for (const e of examples) console.log(`  ${e}`);
  if (!APPLY) console.log('\n(DRY RUN — re-run with "apply" to write.)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
