/**
 * Merge historical player rows that are the same footballer split across several rows.
 *
 * Players with no api-football profile were created by name from whichever backfill ran first — big-5
 * league seasons, Champions League, internationals, each a separate pass. When a pass spelled the name
 * differently the next one did not recognise it and inserted another row, so one career ends up scattered:
 * Pierre van Hooijdonk exists three times (Forest, Feyenoord, Netherlands), Jan Vennegoor of Hesselink
 * four. Restoring the mangled surnames made this visible, since the fragments now share a display name.
 *
 * A scattered career is not just untidy. Club Chain reads `player_career`, so a player whose Forest years
 * and Feyenoord years sit on different rows links to the team-mates of neither — the chain is broken at
 * exactly the point the two spells should join.
 *
 * Two rows are merged only when they share a display name AND a club. Sharing a name is not enough:
 * namesakes are common, and "Fali" at Cádiz in 1992 is not "Fali" at Barcelona in 2007. Requiring a club
 * in common errs toward leaving a career split, which costs a link, rather than fusing two people, which
 * invents a career. Rows carrying a birth date or an api-football id are never touched — those identities
 * are confirmed, and `job:split-namesake-players` is what separates careers wrongly joined under one.
 *
 * Usage:
 *   npm run job:merge-fragmented-players            # dry run + review CSV
 *   npm run job:merge-fragmented-players -- --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'fragmented_players_review.csv';

/** Child tables keyed by player, and the columns that must stay unique per player after a merge. */
const CHILD_TABLES: Array<{ table: string; unique: string[] }> = [
  { table: 'player_stats', unique: ['league_id', 'season', 'team_id'] },
  { table: 'player_career', unique: ['team_id', 'season_from'] },
  { table: 'player_honours', unique: ['competition', 'season', 'placement'] },
  { table: 'player_transfers', unique: ['transfer_date', 'from_team_id', 'to_team_id'] },
];

interface Fragment {
  id: string;
  name: string;
  statRows: number;
  clubs: string[];
  seasonFrom: number | null;
  seasonTo: number | null;
}

async function loadFragments(): Promise<Fragment[]> {
  return (await db.execute(sql`
    SELECT p.id, p.name,
           COALESCE(st.rows, 0) AS "statRows",
           COALESCE(st.clubs, ARRAY[]::text[]) AS clubs,
           st.season_from AS "seasonFrom",
           st.season_to AS "seasonTo"
    FROM players p
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS rows,
             array_agg(DISTINCT s.team_name) FILTER (WHERE s.team_name IS NOT NULL) AS clubs,
             min(s.season)::int AS season_from, max(s.season)::int AS season_to
      FROM player_stats s WHERE s.player_id = p.id
    ) st ON true
    WHERE p.external_id IS NULL AND p.birth_date IS NULL
      AND p.name IN (
        SELECT name FROM players
        WHERE external_id IS NULL AND birth_date IS NULL
        GROUP BY name HAVING count(*) > 1
      )
    ORDER BY p.name, COALESCE(st.rows, 0) DESC
  `)) as unknown as Fragment[];
}

/** Clubs compared on a normalized name; the passes spell accents inconsistently (Gijón / Gijon). */
function clubKeys(fragment: Fragment): Set<string> {
  return new Set(fragment.clubs.map((c) => normalizeSearchText(c)).filter(Boolean));
}

/** Group one name's rows into sets that share at least one club, chaining through common clubs. */
function clusterByClub(fragments: Fragment[]): Fragment[][] {
  const parent = fragments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const keys = fragments.map(clubKeys);
  for (let i = 0; i < fragments.length; i += 1) {
    for (let j = i + 1; j < fragments.length; j += 1) {
      if ([...keys[i]!].some((k) => keys[j]!.has(k))) union(i, j);
    }
  }

  const groups = new Map<number, Fragment[]>();
  for (let i = 0; i < fragments.length; i += 1) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(fragments[i]!);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

async function main(): Promise<void> {
  const fragments = await loadFragments();
  const byName = new Map<string, Fragment[]>();
  for (const f of fragments) (byName.get(f.name) ?? byName.set(f.name, []).get(f.name)!).push(f);

  const merges: Array<{ keep: Fragment; absorb: Fragment[] }> = [];
  for (const group of byName.values()) {
    for (const cluster of clusterByClub(group)) {
      // The row with the most stats survives, so the fewest rows have to move.
      const sorted = [...cluster].sort((a, b) => b.statRows - a.statRows);
      merges.push({ keep: sorted[0]!, absorb: sorted.slice(1) });
    }
  }

  const csv = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  writeFileSync(
    REVIEW_PATH,
    [
      'name,keeps_seasons,absorbs_seasons,shared_clubs,rows_merged',
      ...merges.map((m) =>
        [
          csv(m.keep.name),
          csv(`${m.keep.seasonFrom}-${m.keep.seasonTo}`),
          csv(m.absorb.map((a) => `${a.seasonFrom}-${a.seasonTo}`).join(' + ')),
          csv([...clubKeys(m.keep)].join(' / ')),
          m.absorb.reduce((n, a) => n + a.statRows, 0),
        ].join(',')
      ),
    ].join('\n') + '\n'
  );

  console.log(`Fragmented careers to merge : ${merges.length}`);
  console.log(`Rows to absorb              : ${merges.reduce((n, m) => n + m.absorb.length, 0)}`);
  console.log(`Review CSV                  : ${REVIEW_PATH}`);
  for (const m of merges.slice(0, 12)) {
    console.log(
      `  ${m.keep.name.padEnd(28)} ${m.keep.seasonFrom}-${m.keep.seasonTo}  <-  ${m.absorb
        .map((a) => `${a.seasonFrom}-${a.seasonTo}`)
        .join(', ')}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    return;
  }

  let merged = 0;
  for (const m of merges) {
    await db.transaction(async (tx) => {
      for (const absorbed of m.absorb) {
        for (const { table, unique } of CHILD_TABLES) {
          const match = sql.join(
            unique.map((col) => sql`keeper.${sql.identifier(col)} IS NOT DISTINCT FROM dup.${sql.identifier(col)}`),
            sql` AND `
          );
          // Repoint what the survivor does not already have, then drop the rest: both rows can hold the
          // same club-season, and the unique index would reject the move.
          await tx.execute(sql`
            UPDATE ${sql.identifier(table)} dup SET player_id = ${m.keep.id}
            WHERE dup.player_id = ${absorbed.id}
              AND NOT EXISTS (
                SELECT 1 FROM ${sql.identifier(table)} keeper
                WHERE keeper.player_id = ${m.keep.id} AND ${match}
              )
          `);
          await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE player_id = ${absorbed.id}`);
        }
        await tx.execute(sql`DELETE FROM players WHERE id = ${absorbed.id}`);
      }
    });
    merged += 1;
    if (merged % 20 === 0) console.log(`  merged ${merged}/${merges.length}`);
  }
  console.log(`\nMerged ${merged} careers. Re-run job:refresh-club-chain-paths — the teammate graph has changed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
