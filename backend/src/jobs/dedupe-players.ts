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
  let skippedOverlap = 0;

  let skippedObscure = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Prominence gate: only dedupe players notable enough to be confidently the
    // same person (a real market value). Obscure same-name lower-league players
    // are left alone — merging them risks combining two different people.
    if (!group.some((r) => r.peakValue != null)) {
      skippedObscure += 1;
      continue;
    }

    // Overlap check across records that HAVE stats.
    const withStats = group.filter((r) => r.seasons.size > 0);
    const seen = new Set<number>();
    let overlap = false;
    for (const r of withStats) {
      for (const s of r.seasons) {
        if (seen.has(s)) {
          overlap = true;
          break;
        }
        seen.add(s);
      }
      if (overlap) break;
    }
    if (overlap) {
      skippedOverlap += 1;
      continue; // likely genuinely different people sharing a name
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
  console.log(`Skipped ${skippedOverlap} groups with overlapping seasons (different people).`);
  console.log(`Skipped ${skippedObscure} groups with no market value (obscure — left alone for safety).\n`);
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
          await tx.execute(sql`UPDATE player_stats SET player_id = ${plan.toId} WHERE player_id = ${fromId}`);
          await tx.execute(sql`UPDATE player_career SET player_id = ${plan.toId} WHERE player_id = ${fromId}`);
          await tx.execute(sql`UPDATE player_honours SET player_id = ${plan.toId} WHERE player_id = ${fromId}`);
          await tx.execute(sql`UPDATE player_transfers SET player_id = ${plan.toId} WHERE player_id = ${fromId}`);
          await tx.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${plan.toId} WHERE answer_player_id = ${fromId}`);
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
