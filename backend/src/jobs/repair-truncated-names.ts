/**
 * Restore display names that lost part of the player's surname.
 *
 * `formatDisplayName` shortens a legal name to the fan-facing one ("Raheem Shaquille Sterling" ->
 * "Raheem Sterling") by keeping the first given name and the surname. That needs the API profile's
 * firstname/lastname split to know where the surname begins. FBref supplies neither — just one already
 * fan-facing string — so every middle token looked like a middle NAME and the surname itself was cut:
 *
 *   Matt Le Tissier         -> Matt Tissier
 *   Marco van Basten        -> Marco Basten
 *   Paolo Di Canio          -> Paolo Canio
 *   Jimmy Floyd Hasselbaink -> Jimmy Hasselbaink
 *
 * `playerSearch.ts` no longer truncates a bare name, so this repairs the rows already written. The name
 * FBref gave us survives as the first alias, which is what gets restored — search already worked, since
 * the aliases and search text always held the full spelling; it was only the displayed name that was wrong.
 *
 * Players carrying an api-football `external_id` are left alone: their names come from a real profile
 * split and are correct, and `job:refresh-player-search` owns them.
 *
 * Usage:
 *   npm run job:repair-truncated-names            # dry run + review CSV
 *   npm run job:repair-truncated-names -- --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { buildPlayerSearchFields, normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'truncated_names_review.csv';

interface PlayerRow {
  id: string;
  name: string;
  aliases: string[] | null;
}

/**
 * True when `full` is the same name as `name` with tokens restored in the middle — the exact damage
 * truncation does. Requiring the first and last token to survive in order keeps this from renaming a
 * player to an unrelated alias (a nickname, a maiden name, a transliteration).
 */
function isRestorationOf(name: string, full: string): boolean {
  const short = normalizeSearchText(name).split(/\s+/).filter(Boolean);
  const long = normalizeSearchText(full).split(/\s+/).filter(Boolean);
  if (short.length < 2 || long.length <= short.length) return false;
  return short[0] === long[0] && short[short.length - 1] === long[long.length - 1];
}

async function main(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT id, name, aliases FROM players WHERE external_id IS NULL AND aliases IS NOT NULL
  `)) as unknown as PlayerRow[];
  console.log(`Players without an api-football profile: ${rows.length.toLocaleString()}`);

  const fixes: Array<{ id: string; from: string; to: string }> = [];
  for (const row of rows) {
    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    // The source name is the first alias — buildPlayerSearchFields seeds the alias set with it.
    const source = aliases.find((a) => isRestorationOf(row.name, a));
    if (!source || source.trim() === row.name) continue;
    fixes.push({ id: row.id, from: row.name, to: source.trim() });
  }

  const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
  writeFileSync(
    REVIEW_PATH,
    ['stored_as,restored_to', ...fixes.map((f) => `${csv(f.from)},${csv(f.to)}`)].join('\n') + '\n'
  );
  console.log(`Names to restore : ${fixes.length.toLocaleString()}`);
  console.log(`Review CSV       : ${REVIEW_PATH}`);
  for (const f of fixes.slice(0, 15)) console.log(`  ${f.from}  ->  ${f.to}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    return;
  }

  let done = 0;
  for (let i = 0; i < fixes.length; i += 200) {
    const batch = fixes.slice(i, i + 200);
    await db.transaction(async (tx) => {
      for (const fix of batch) {
        // Recomputed rather than patched so aliases and search text stay consistent with the new name.
        const fields = buildPlayerSearchFields(fix.to);
        await tx.execute(sql`
          UPDATE players
          SET name = ${fields.name},
              aliases = ${JSON.stringify(fields.aliases)}::jsonb,
              search_text = ${fields.searchText}
          WHERE id = ${fix.id}
        `);
      }
    });
    done += batch.length;
    console.log(`  restored ${done}/${fixes.length}`);
  }
  console.log(`\nRestored ${done.toLocaleString()} display names.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
