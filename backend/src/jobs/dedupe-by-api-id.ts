/**
 * Merge player rows that share the same api_football_id — they are provably the same person (the id
 * was assigned by a strict DOB + nationality + name match). This catches split records that name-based
 * dedupe misses, e.g. "Kaká" vs "Ricardo dos Santos Leite", "Pedri" vs "Pedro González López".
 *
 * Survivor = the record fans know: highest market_value_tier, then most appearances, then the shorter
 * name. Every child row (stats/honours/finals/awards/extra-stats/WC/daily) is repointed to the
 * survivor (conflict-avoiding where the table has natural keys) before the duplicate is deleted, so
 * no data is lost. Player-level fields + aliases are folded into the survivor.
 *
 * DRY RUN by default. Pass "apply" to write: npm run job:dedupe-api-id apply
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

// Cascade-FK children with a natural key — repoint only rows that won't collide with the survivor's
// (the rest are dropped when the duplicate is deleted). [] means one-row-per-player (player_id is PK).
const CHILD_KEYED: Array<{ table: string; keys: string[] }> = [
  { table: 'player_stats', keys: ['league_id', 'season', 'team_id'] },
  { table: 'player_transfers', keys: ['transfer_date', 'from_team_id', 'to_team_id'] },
  { table: 'player_honours', keys: ['competition', 'season', 'placement'] },
  { table: 'player_career', keys: ['team_id', 'season_from'] },
  { table: 'player_awards', keys: ['award', 'year', 'placement'] },
  { table: 'final_appearances', keys: ['competition', 'season'] },
  { table: 'player_extra_stats', keys: [] },
];

// Tables we simply move to the survivor (set-null FKs / no harmful collision).
const REPOINT_ALL = ['wc_squads', 'wc_memorable', 'wc_match_events'];

interface Member {
  id: string;
  name: string;
  mvt: number;
  apps: number;
  statRows: number;
  aliases: string[];
  searchText: string;
  externalId: string | null;
  marketValueEur: number | null;
  peakMarketValueEur: number | null;
  recordFeeEur: number | null;
  hasBirth: boolean;
  foot: string | null;
  subPosition: string | null;
}

async function repoint(table: string, keys: string[], dup: string, canon: string): Promise<void> {
  const sameKey = keys.length
    ? sql` AND ${sql.join(keys.map((k) => sql`c.${sql.raw(k)} IS NOT DISTINCT FROM c2.${sql.raw(k)}`), sql` AND `)}`
    : sql``;
  await db.execute(sql`
    UPDATE ${sql.raw(table)} c SET player_id = ${canon}
    WHERE c.player_id = ${dup}
      AND NOT EXISTS (SELECT 1 FROM ${sql.raw(table)} c2 WHERE c2.player_id = ${canon}${sameKey})
  `);
}

async function mergeOne(canon: Member, dup: Member): Promise<void> {
  for (const { table, keys } of CHILD_KEYED) await repoint(table, keys, dup.id, canon.id);
  for (const table of REPOINT_ALL) {
    await db.execute(sql`UPDATE ${sql.raw(table)} SET player_id = ${canon.id} WHERE player_id = ${dup.id}`);
  }
  await db.execute(sql`UPDATE wc_match_events SET assist_player_id = ${canon.id} WHERE assist_player_id = ${dup.id}`);
  await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${canon.id} WHERE answer_player_id = ${dup.id}`);
  await db.execute(sql`DELETE FROM players WHERE id = ${dup.id}`);
}

async function main() {
  console.log(`Dedupe by api_football_id — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const groups = (await db.execute(sql`
    SELECT api_football_id, array_agg(id) AS ids
    FROM players WHERE api_football_id IS NOT NULL
    GROUP BY api_football_id HAVING COUNT(*) > 1
  `)) as unknown as Array<{ api_football_id: number; ids: string[] }>;
  console.log(`${groups.length} api_football_id clusters with >1 row`);
  if (groups.length === 0) { process.exit(0); }

  const allIds = groups.flatMap((g) => g.ids);
  const idList = sql.join(allIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.market_value_tier AS mvt, p.aliases, p.search_text AS search_text,
           p.external_id AS external_id, p.market_value_eur AS mv, p.peak_market_value_eur AS pv,
           p.record_fee_eur AS rf, (p.birth_date IS NOT NULL) AS has_birth, p.foot, p.sub_position AS sub_position,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps,
           COALESCE((SELECT COUNT(*) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS stat_rows
    FROM players p WHERE p.id IN (${idList})
  `)) as unknown as Array<{
    id: string; name: string; mvt: number; aliases: string[]; search_text: string; external_id: string | null;
    mv: number | null; pv: number | null; rf: number | null; has_birth: boolean; foot: string | null;
    sub_position: string | null; apps: number; stat_rows: number;
  }>;

  const byId = new Map<string, Member>(rows.map((r) => [r.id, {
    id: r.id, name: r.name, mvt: r.mvt, apps: r.apps, statRows: r.stat_rows,
    aliases: Array.isArray(r.aliases) ? r.aliases : [], searchText: r.search_text, externalId: r.external_id,
    marketValueEur: r.mv, peakMarketValueEur: r.pv, recordFeeEur: r.rf, hasBirth: r.has_birth,
    foot: r.foot, subPosition: r.sub_position,
  }]));

  let clusters = 0;
  let merges = 0;
  const examples: string[] = [];

  for (const g of groups) {
    const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length < 2) continue;

    // Survivor: the name fans know — highest fame tier, then most apps, then the shorter name.
    const canon = [...members].sort((a, b) => {
      if (b.mvt !== a.mvt) return b.mvt - a.mvt;
      if (b.apps !== a.apps) return b.apps - a.apps;
      if (a.name.length !== b.name.length) return a.name.length - b.name.length;
      return a.id < b.id ? -1 : 1;
    })[0]!;
    const dups = members.filter((m) => m.id !== canon.id);
    if (dups.length === 0) continue;
    clusters += 1;

    const aliasSet = new Set<string>([...canon.aliases, canon.name]);
    let searchText = canon.searchText;
    let externalId = canon.externalId;
    let mv = canon.marketValueEur;
    let pv = canon.peakMarketValueEur;
    let rf = canon.recordFeeEur;
    let foot = canon.foot;
    let subPos = canon.subPosition;
    const takeBirthFrom = canon.hasBirth ? null : dups.find((d) => d.hasBirth)?.id ?? null;
    for (const d of dups) {
      for (const a of d.aliases) aliasSet.add(a);
      aliasSet.add(d.name);
      searchText = `${searchText} ${d.searchText}`;
      externalId = externalId ?? d.externalId;
      mv = Math.max(mv ?? 0, d.marketValueEur ?? 0) || mv || d.marketValueEur;
      pv = Math.max(pv ?? 0, d.peakMarketValueEur ?? 0) || pv || d.peakMarketValueEur;
      rf = Math.max(rf ?? 0, d.recordFeeEur ?? 0) || rf || d.recordFeeEur;
      foot = foot ?? d.foot;
      subPos = subPos ?? d.subPosition;
    }

    if (examples.length < 30) examples.push(`${canon.name} (mvt${canon.mvt}) ⇐ [${dups.map((d) => `${d.name} (mvt${d.mvt})`).join(', ')}]`);

    if (APPLY) {
      for (const d of dups) { await mergeOne(canon, d); merges += 1; }
      const dedupSearch = [...new Set(searchText.split(/\s+/).filter(Boolean))].join(' ');
      await db.execute(sql`
        UPDATE players SET
          external_id = ${externalId},
          aliases = ${JSON.stringify([...aliasSet])}::jsonb,
          search_text = ${dedupSearch},
          market_value_eur = ${mv},
          peak_market_value_eur = ${pv},
          record_fee_eur = ${rf},
          foot = ${foot},
          sub_position = ${subPos}${takeBirthFrom ? sql`,
          birth_date = (SELECT birth_date FROM players WHERE id = ${takeBirthFrom})` : sql``}
        WHERE id = ${canon.id}
      `);
    } else {
      merges += dups.length;
    }
  }

  console.log(`\n${APPLY ? 'Merged' : 'Would merge'} ${merges} duplicate rows across ${clusters} clusters`);
  console.log('\nSurvivor ⇐ [merged]:');
  for (const e of examples) console.log(`  ${e}`);
  if (!APPLY) console.log('\n(DRY RUN — re-run with "apply" to write.)');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
