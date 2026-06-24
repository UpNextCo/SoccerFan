/**
 * Merge duplicate player rows that are provably the same human: identical
 * birth_date + nationality + at least one shared name token (so coincidental
 * same-DOB different players are never merged). Requires players.birth_date.
 *
 * Repoints every FK child (stats/career/honours/transfers/daily_puzzles) with
 * conflict-avoidance, folds player-level fields into the survivor, deletes dups.
 *
 * DRY RUN by default. Pass "apply" to write: npm run job:dedupe-dob apply
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

function tokens(name: string): Set<string> {
  return new Set(
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}

/**
 * True only when two names are the SAME person, not just same DOB+surname.
 * Exact token match, OR the shorter name (>=2 tokens) is a full subset of the
 * longer ("John Riise" ⊆ "John Arne Riise"). This rejects twins/siblings
 * (Hamit vs Halil Altintop) and first-name coincidences (Charles Taylor vs
 * Charles Banya), which share a token but are different people.
 */
function isSafeDuplicate(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size === tb.size) {
    for (const t of ta) if (!tb.has(t)) return false;
    return true;
  }
  const [small, big] = ta.size < tb.size ? [ta, tb] : [tb, ta];
  if (small.size < 2) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

interface Member {
  id: string;
  name: string;
  externalId: string | null;
  apps: number;
  statRows: number;
  aliases: string[];
  searchText: string;
  marketValueEur: number | null;
  peakMarketValueEur: number | null;
  recordFeeEur: number | null;
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

async function mergeOne(canon: Member, dup: Member): Promise<void> {
  for (const { table, keys } of CHILD) await repoint(table, keys, dup.id, canon.id);
  await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${canon.id} WHERE answer_player_id = ${dup.id}`);
  // Deleting the dup cascades away any leftover (conflicting) child rows.
  await db.execute(sql`DELETE FROM players WHERE id = ${dup.id}`);
}

async function main() {
  console.log(`Dedupe by DOB+nationality — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const groups = (await db.execute(sql`
    SELECT birth_date::text AS dob, nationality, array_agg(id) AS ids
    FROM players
    WHERE birth_date IS NOT NULL
    GROUP BY birth_date, nationality
    HAVING COUNT(*) > 1
  `)) as unknown as Array<{ dob: string; nationality: string; ids: string[] }>;
  console.log(`${groups.length} DOB+nationality clusters with >1 row`);

  const allIds = groups.flatMap((g) => g.ids);
  if (allIds.length === 0) {
    console.log('Nothing to merge.');
    process.exit(0);
  }

  const idList = sql.join(allIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.external_id AS external_id, p.aliases, p.search_text AS search_text,
           p.market_value_eur AS mv, p.peak_market_value_eur AS pv, p.record_fee_eur AS rf,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps,
           COALESCE((SELECT COUNT(*) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS stat_rows
    FROM players p WHERE p.id IN (${idList})
  `)) as unknown as Array<{
    id: string; name: string; external_id: string | null; aliases: string[]; search_text: string;
    mv: number | null; pv: number | null; rf: number | null; apps: number; stat_rows: number;
  }>;

  const byId = new Map<string, Member>(
    rows.map((r) => [r.id, {
      id: r.id, name: r.name, externalId: r.external_id, apps: r.apps, statRows: r.stat_rows,
      aliases: Array.isArray(r.aliases) ? r.aliases : [], searchText: r.search_text,
      marketValueEur: r.mv, peakMarketValueEur: r.pv, recordFeeEur: r.rf,
    }])
  );

  let clusters = 0;
  let merges = 0;
  let skipped = 0;
  const examples: string[] = [];

  for (const g of groups) {
    const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length < 2) continue;

    // Survivor: prefer a real API-Football row, then the most complete (apps, then stat rows).
    const canon = [...members].sort((a, b) => {
      const ext = Number(Boolean(b.externalId)) - Number(Boolean(a.externalId));
      if (ext !== 0) return ext;
      if (b.apps !== a.apps) return b.apps - a.apps;
      return b.statRows - a.statRows;
    })[0]!;

    const dups = members.filter((m) => m.id !== canon.id);
    // Safety: only merge rows that are provably the same person (exact / subset name).
    const safe = dups.filter((d) => isSafeDuplicate(canon.name, d.name));
    const unsafe = dups.filter((d) => !isSafeDuplicate(canon.name, d.name));
    skipped += unsafe.length;

    if (safe.length === 0) continue;
    clusters += 1;

    // Fold scalar fields + aliases/search into the survivor.
    const aliasSet = new Set<string>([...canon.aliases, canon.name]);
    let searchText = canon.searchText;
    let externalId = canon.externalId;
    let mv = canon.marketValueEur;
    let pv = canon.peakMarketValueEur;
    let rf = canon.recordFeeEur;
    for (const d of safe) {
      for (const a of d.aliases) aliasSet.add(a);
      aliasSet.add(d.name);
      searchText = `${searchText} ${d.searchText}`;
      externalId = externalId ?? d.externalId;
      mv = mv ?? d.marketValueEur;
      pv = Math.max(pv ?? 0, d.peakMarketValueEur ?? 0) || pv || d.peakMarketValueEur;
      rf = Math.max(rf ?? 0, d.recordFeeEur ?? 0) || rf || d.recordFeeEur;
    }

    if (examples.length < 25) {
      examples.push(`${canon.name} ⇐ [${safe.map((d) => d.name).join(', ')}]${unsafe.length ? ` (skipped ${unsafe.length})` : ''}`);
    }

    if (APPLY) {
      for (const d of safe) {
        await mergeOne(canon, d);
        merges += 1;
      }
      const dedupSearch = [...new Set(searchText.split(/\s+/).filter(Boolean))].join(' ');
      await db.execute(sql`
        UPDATE players SET
          external_id = ${externalId},
          aliases = ${JSON.stringify([...aliasSet])}::jsonb,
          search_text = ${dedupSearch},
          market_value_eur = ${mv},
          peak_market_value_eur = ${pv},
          record_fee_eur = ${rf}
        WHERE id = ${canon.id}
      `);
    } else {
      merges += safe.length;
    }
  }

  console.log(`\n${APPLY ? 'Merged' : 'Would merge'} ${merges} duplicate rows across ${clusters} clusters · ${skipped} rows skipped (no shared name token)`);
  console.log('\nSample merges:');
  for (const e of examples) console.log(`  ${e}`);
  if (!APPLY) console.log('\n(DRY RUN — re-run with "apply" to write.)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
