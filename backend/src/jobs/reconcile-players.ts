/**
 * Merge name-variant duplicate players created by the FBref backfill into their
 * api-football counterpart (e.g. "Lionel Messi Cuccittini" → "Lionel Messi").
 *
 * High precision: only merges an FBref-only record (no external_id) into an
 * api-football record when ALL hold:
 *   - same nationality
 *   - one name's token set ⊆ the other's (smaller set has ≥2 tokens)
 *   - the FBref record reaches 2008+ (so it plausibly continues into the api era)
 *   - exactly one api candidate matches (no ambiguity)
 *
 * DRY RUN by default — prints proposed merges. Pass `apply` to execute.
 *   npm run job:reconcile-players          # preview
 *   npm run job:reconcile-players apply     # execute
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isAbbreviatedName, normalizeSearchText } from '../utils/playerSearch.js';

function collapse(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Prefer the common name. FBref names are curated common names; api-football often
 *  carries the full legal name. Pick the shorter (non-abbreviated) of the two. */
function chooseDisplayName(apiName: string, fbrefName: string): string {
  const a = collapse(apiName);
  const f = collapse(fbrefName);
  if (isAbbreviatedName(f)) return a;
  if (isAbbreviatedName(a)) return f;
  const at = a.split(' ').length;
  const ft = f.split(' ').length;
  if (ft < at) return f;
  if (at < ft) return a;
  // Same token count (e.g. hyphenated surnames) → prefer the shorter string.
  if (f.length < a.length) return f;
  return a;
}

function tokens(name: string): Set<string> {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ');
  return new Set(cleaned.split(/\s+/).filter((t) => t.length > 1));
}

function normNat(nat: string): string {
  return nat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

interface ApiPlayer {
  id: string;
  name: string;
  nat: string;
  toks: Set<string>;
  aliases: string[];
  searchText: string;
}

async function main() {
  const apply = process.argv.includes('apply');
  console.log(apply ? '=== RECONCILE (APPLY) ===' : '=== RECONCILE (DRY RUN — pass "apply" to execute) ===');

  // api-football players, indexed by normalized nationality.
  const apiRows = await rows<{
    id: string;
    name: string;
    nationality: string;
    aliases: string[];
    search_text: string;
  }>(sql`
    SELECT id, name, nationality, aliases, search_text FROM players WHERE external_id IS NOT NULL
  `);
  const apiByNat = new Map<string, ApiPlayer[]>();
  for (const r of apiRows) {
    const nat = normNat(r.nationality);
    const entry: ApiPlayer = {
      id: r.id,
      name: r.name,
      nat,
      toks: tokens(r.name),
      aliases: Array.isArray(r.aliases) ? r.aliases : [],
      searchText: r.search_text ?? '',
    };
    const list = apiByNat.get(nat);
    if (list) list.push(entry);
    else apiByNat.set(nat, [entry]);
  }
  console.log(`${apiRows.length} api-football players indexed`);

  // FBref-only players that reach 2008+ (candidates to be a split of an api player).
  const dups = await rows<{ id: string; name: string; nationality: string; max_s: number }>(sql`
    SELECT p.id, p.name, p.nationality, MAX(s.season)::int AS max_s
    FROM players p
    JOIN player_stats s ON s.player_id = p.id
    WHERE p.external_id IS NULL
    GROUP BY p.id, p.name, p.nationality
    HAVING MAX(s.season) >= 2008
  `);
  console.log(`${dups.length} FBref-only players reaching 2008+ to check\n`);

  interface Merge {
    fromId: string;
    fromName: string;
    api: ApiPlayer;
    chosen: string;
  }
  const merges: Merge[] = [];

  for (const dup of dups) {
    const nat = normNat(dup.nationality);
    const candidates = apiByNat.get(nat);
    if (!candidates) continue;
    const dupToks = tokens(dup.name);
    if (dupToks.size < 2) continue;

    const hits = candidates.filter((api) => {
      const [small, big] = api.toks.size <= dupToks.size ? [api.toks, dupToks] : [dupToks, api.toks];
      return small.size >= 2 && isSubset(small, big);
    });

    if (hits.length === 1) {
      const api = hits[0]!;
      merges.push({ fromId: dup.id, fromName: dup.name, api, chosen: chooseDisplayName(api.name, dup.name) });
    }
  }

  console.log(`Proposed merges: ${merges.length}\n`);
  for (const m of merges.slice(0, 40)) {
    const renamed = m.chosen !== m.api.name ? `   (renames "${m.api.name}" ⇒ "${m.chosen}")` : '';
    console.log(`  "${m.fromName}" + "${m.api.name}" ⇒ keep "${m.chosen}"${renamed ? '  ✏️' : ''}`);
  }
  if (merges.length > 40) console.log(`  …and ${merges.length - 40} more`);
  console.log(`\n${merges.filter((m) => m.chosen !== m.api.name).length} merges also fix the display name to the common name.`);

  if (!apply) {
    console.log('\nDry run only. Re-run with `apply` to execute.');
    process.exit(0);
  }

  let merged = 0;
  let skipped = 0;
  for (const m of merges) {
    try {
      const aliases = Array.from(new Set([...m.api.aliases, m.api.name, m.fromName, m.chosen]));
      const searchText = `${m.api.searchText} ${normalizeSearchText(m.fromName)}`.trim();
      await db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE player_stats SET player_id = ${m.api.id} WHERE player_id = ${m.fromId}`);
        await tx.execute(sql`UPDATE player_career SET player_id = ${m.api.id} WHERE player_id = ${m.fromId}`);
        await tx.execute(sql`UPDATE player_honours SET player_id = ${m.api.id} WHERE player_id = ${m.fromId}`);
        await tx.execute(sql`UPDATE player_transfers SET player_id = ${m.api.id} WHERE player_id = ${m.fromId}`);
        await tx.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${m.api.id} WHERE answer_player_id = ${m.fromId}`);
        await tx.execute(sql`DELETE FROM players WHERE id = ${m.fromId}`);
        await tx.execute(sql`
          UPDATE players
          SET name = ${m.chosen}, aliases = ${JSON.stringify(aliases)}::jsonb, search_text = ${searchText}
          WHERE id = ${m.api.id}
        `);
      });
      merged += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`  skip "${m.fromName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nMerged ${merged}, skipped ${skipped}. Re-run job:compute-fame afterwards.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
