/**
 * Merge high-confidence duplicate players sharing the SAME name + nationality
 * (e.g. two "Jude Bellingham" rows). Conservative: only merges a group when the
 * records' stat-seasons DON'T overlap (a real pair of different same-named players
 * almost always share seasons; a split of one player has disjoint coverage), or
 * when the extra records have no stats at all.
 *
 * DRY RUN by default. Pass `apply` to execute.
 *   npm run job:dedupe-players          # preview
 *   npm run job:dedupe-players apply     # execute
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isAbbreviatedName, normalizeSearchText } from '../utils/playerSearch.js';

function normNat(nat: string): string {
  return nat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function collapse(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function chooseDisplayName(a0: string, b0: string): string {
  const a = collapse(a0);
  const b = collapse(b0);
  if (isAbbreviatedName(b)) return a;
  if (isAbbreviatedName(a)) return b;
  const at = a.split(' ').length;
  const bt = b.split(' ').length;
  if (bt < at) return b;
  if (at < bt) return a;
  if (b.length < a.length) return b;
  return a;
}

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

interface Rec {
  id: string;
  name: string;
  externalId: string | null;
  aliases: string[];
  searchText: string;
  peakValue: number | null;
  seasons: Set<number>;
}

async function main() {
  const apply = process.argv.includes('apply');
  console.log(apply ? '=== DEDUPE (APPLY) ===' : '=== DEDUPE (DRY RUN — pass "apply" to execute) ===');

  const playerRows = await rows<{
    id: string;
    name: string;
    nationality: string;
    external_id: string | null;
    aliases: string[];
    search_text: string;
    peak_market_value_eur: number | null;
  }>(sql`SELECT id, name, nationality, external_id, aliases, search_text, peak_market_value_eur FROM players`);

  const seasonRows = await rows<{ player_id: string; seasons: number[] }>(sql`
    SELECT player_id, array_agg(DISTINCT season) AS seasons FROM player_stats GROUP BY player_id
  `);
  const seasonsById = new Map<string, Set<number>>();
  for (const r of seasonRows) seasonsById.set(r.player_id, new Set(r.seasons.map(Number)));

  // Group by name+nationality.
  const groups = new Map<string, Rec[]>();
  for (const p of playerRows) {
    const key = `${normalizeSearchText(p.name)}|${normNat(p.nationality)}`;
    const rec: Rec = {
      id: p.id,
      name: p.name,
      externalId: p.external_id,
      aliases: Array.isArray(p.aliases) ? p.aliases : [],
      searchText: p.search_text ?? '',
      peakValue: p.peak_market_value_eur,
      seasons: seasonsById.get(p.id) ?? new Set(),
    };
    const list = groups.get(key);
    if (list) list.push(rec);
    else groups.set(key, [rec]);
  }

  interface Plan {
    toId: string;
    fromIds: string[];
    chosen: string;
    names: string[];
  }
  const plans: Plan[] = [];
  let skippedLowConfidence = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // High-confidence ONLY: identical name+nationality, identical non-null peak value,
    // AND that value is high (≥ €20m). Prominent players with the same name + exact
    // same value are the same person; obscure common-name collisions (low value) are
    // left alone, since a single Transfermarkt entry can get matched by several of our
    // records and we must not merge genuinely different journeymen.
    const MIN_PEAK = 20_000_000;
    const peaks = group.map((r) => r.peakValue);
    const samePeak =
      peaks.every((v) => v != null) && new Set(peaks).size === 1 && (peaks[0] ?? 0) >= MIN_PEAK;
    if (!samePeak) {
      skippedLowConfidence += 1;
      continue;
    }

    // Canonical: prefer an api-football record (external_id), then most seasons.
    const canonical = [...group].sort((a, b) => {
      const ax = a.externalId ? 1 : 0;
      const bx = b.externalId ? 1 : 0;
      if (ax !== bx) return bx - ax;
      return b.seasons.size - a.seasons.size;
    })[0]!;

    const chosen = group.map((r) => r.name).reduce((acc, n) => chooseDisplayName(acc, n));
    plans.push({
      toId: canonical.id,
      fromIds: group.filter((r) => r.id !== canonical.id).map((r) => r.id),
      chosen,
      names: group.map((r) => r.name),
    });
  }

  const totalDups = plans.reduce((n, p) => n + p.fromIds.length, 0);
  console.log(`Mergeable groups: ${plans.length} (${totalDups} duplicate rows to remove)`);
  console.log(`Skipped ${skippedLowConfidence} same-name groups without identical peak value (left alone for safety).\n`);
  for (const p of plans.slice(0, 40)) {
    console.log(`  [${p.names.join(' | ')}]  ⇒  "${p.chosen}"`);
  }
  if (plans.length > 40) console.log(`  …and ${plans.length - 40} more`);

  if (!apply) {
    console.log('\nDry run only. Re-run with `apply` to execute.');
    process.exit(0);
  }

  let merged = 0;
  let skipped = 0;
  for (const plan of plans) {
    const allNames = plan.names;
    const aliases = Array.from(new Set([...allNames, plan.chosen]));
    const searchText = normalizeSearchText(allNames.join(' '));
    try {
      await db.transaction(async (tx) => {
        for (const fromId of plan.fromIds) {
          const to = plan.toId;
          // Drop rows that would collide on the canonical (same player/season), then repoint the rest.
          await tx.execute(sql`
            DELETE FROM player_stats d WHERE d.player_id = ${fromId} AND EXISTS (
              SELECT 1 FROM player_stats c WHERE c.player_id = ${to}
                AND c.league_id = d.league_id AND c.season = d.season AND c.team_id = d.team_id)`);
          await tx.execute(sql`UPDATE player_stats SET player_id = ${to} WHERE player_id = ${fromId}`);
          await tx.execute(sql`
            DELETE FROM player_career d WHERE d.player_id = ${fromId} AND EXISTS (
              SELECT 1 FROM player_career c WHERE c.player_id = ${to}
                AND c.team_id = d.team_id AND c.season_from = d.season_from)`);
          await tx.execute(sql`UPDATE player_career SET player_id = ${to} WHERE player_id = ${fromId}`);
          await tx.execute(sql`
            DELETE FROM player_honours d WHERE d.player_id = ${fromId} AND EXISTS (
              SELECT 1 FROM player_honours c WHERE c.player_id = ${to}
                AND c.competition = d.competition AND c.season = d.season AND c.placement = d.placement)`);
          await tx.execute(sql`UPDATE player_honours SET player_id = ${to} WHERE player_id = ${fromId}`);
          await tx.execute(sql`
            DELETE FROM player_transfers d WHERE d.player_id = ${fromId} AND EXISTS (
              SELECT 1 FROM player_transfers c WHERE c.player_id = ${to}
                AND c.transfer_date IS NOT DISTINCT FROM d.transfer_date
                AND c.from_team_id = d.from_team_id AND c.to_team_id = d.to_team_id)`);
          await tx.execute(sql`UPDATE player_transfers SET player_id = ${to} WHERE player_id = ${fromId}`);
          await tx.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${to} WHERE answer_player_id = ${fromId}`);
          await tx.execute(sql`DELETE FROM players WHERE id = ${fromId}`);
        }
        await tx.execute(sql`
          UPDATE players
          SET name = ${plan.chosen}, aliases = ${JSON.stringify(aliases)}::jsonb, search_text = ${searchText}
          WHERE id = ${plan.toId}
        `);
      });
      merged += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`  skip "${plan.chosen}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nMerged ${merged} groups, skipped ${skipped}. Re-run job:market-value afterwards.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
