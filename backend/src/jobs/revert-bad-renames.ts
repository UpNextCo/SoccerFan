/**
 * Undo false DOB renames. A rename is wrong when the displayed name shares NO name
 * token with the player's other aliases (a different same-DOB person was grabbed) AND
 * the player is non-prominent (<50 top-flight apps, so likely not in Transfermarkt).
 * Restores the legal name preserved in aliases. Prominent nickname fixes (Isco) and
 * token-sharing renames (Fran Navarro) are kept.
 *
 * Pure DB, zero API. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';
const PROMINENT_APPS = 50;

function tokenize(s: string): string[] {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ')
    .split(/\s+/).filter((t) => t.length > 1);
}

/** Aliases that read like a real display name: 2+ word tokens, no bare initials. */
function isDisplayAlias(alias: string): boolean {
  const raw = alias.trim().split(/\s+/).filter(Boolean);
  if (raw.length < 2) return false;
  if (raw.some((tok) => /^[A-Za-z\u00C0-\u024F]\.?$/.test(tok))) return false;
  return true;
}

async function main() {
  console.log(`Revert false DOB renames — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.aliases,
           COALESCE((SELECT SUM(appearances) FROM player_stats s
                     WHERE s.player_id = p.id AND s.league_id IN (39,140,135,78,61,2,3)), 0)::int AS apps
    FROM players p
    WHERE p.birth_date IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; aliases: string[]; apps: number }>;

  interface Fix {
    id: string;
    from: string;
    to: string;
  }
  const fixes: Fix[] = [];

  for (const p of rows) {
    if (p.apps >= PROMINENT_APPS) continue; // trust prominent matches
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    const nameToks = new Set(tokenize(p.name));
    if (nameToks.size === 0) continue;

    // Tokens from the OTHER aliases (the real-identity cluster).
    const otherToks = new Set<string>();
    for (const a of aliases) {
      if (a === p.name) continue;
      for (const t of tokenize(a)) otherToks.add(t);
    }
    if (otherToks.size === 0) continue;

    let shared = false;
    for (const t of nameToks) if (otherToks.has(t)) shared = true;
    if (shared) continue; // token-sharing rename — keep

    // Current name is an outlier vs the alias cluster → restore best legal alias.
    const candidates = aliases.filter((a) => a !== p.name && isDisplayAlias(a));
    if (candidates.length === 0) continue;
    const restored = candidates.sort((a, b) => {
      const ta = a.trim().split(/\s+/).length;
      const tb = b.trim().split(/\s+/).length;
      if (tb !== ta) return tb - ta; // prefer the fuller legal name
      return b.length - a.length;
    })[0]!;

    if (restored === p.name) continue;
    fixes.push({ id: p.id, from: p.name, to: restored });
  }

  console.log(`${APPLY ? 'Reverting' : 'Would revert'} ${fixes.length} false renames`);
  console.log('\nSamples:');
  for (const f of fixes.slice(0, 30)) console.log(`  ${f.from}  →  ${f.to}`);

  if (APPLY) {
    for (let i = 0; i < fixes.length; i += 300) {
      const batch = fixes.slice(i, i + 300);
      const tuples = batch.map((f) => sql`(${f.id}::uuid, ${f.to}::text)`);
      await db.execute(sql`
        UPDATE players AS p SET name = v.nm
        FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, nm)
        WHERE p.id = v.id
      `);
    }
    console.log(`\nReverted ${fixes.length} names.`);
  } else {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
