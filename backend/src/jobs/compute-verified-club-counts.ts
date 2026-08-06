/**
 * Compute a de-poisoned "senior clubs played for" count for merge-smell players ONLY.
 *
 * Writes player_extra_stats.verified_club_count. Does NOT delete career/stats rows.
 * Draft XI / most_clubs reads this via mostClubsSub when present; everyone else
 * keeps the normal career∪stats count.
 *
 * Merge smell = any season with 3+ senior clubs in player_stats (impossible for one
 * person beyond a mid-season move), or mononym with ≥12 distinct senior clubs.
 *
 * Count method:
 *   1. If Transfermarkt transfers.csv has moves for tm_player_id AND that count is LOWER
 *      than the live raw count → use it (cleanup only; never inflate via obscure TM clubs)
 *   2. Else greedy keep: sort clubs by apps, keep a club unless it hard-conflicts with an
 *      already-kept club (same season, both ≥10 apps — namesake collision, not a transfer)
 *
 *   npx tsx src/jobs/compute-verified-club-counts.ts
 *   npx tsx src/jobs/compute-verified-club-counts.ts --apply
 */
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';

const APPLY = process.argv.includes('--apply');
const DIR = 'transferdata';
/** Both clubs need this many apps in the same season to count as a namesake clash.
 *  Mid-season transfers rarely put 20+ on both sides; merged identities often do. */
const HARD_APPS = 20;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

async function streamCsv(
  path: string,
  onRow: (cols: string[], idx: Record<string, number>) => void
): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let idx: Record<string, number> | null = null;
  for await (const line of rl) {
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (!idx) {
      idx = {};
      cols.forEach((c, i) => {
        idx![c] = i;
      });
      continue;
    }
    onRow(cols, idx);
  }
}

function isJunkClub(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (isYouthOrReserveSide(n)) return true;
  if (/^without club$/i.test(n) || /^retired$/i.test(n)) return true;
  if (/\bU\d{1,2}\b/i.test(n)) return true;
  return false;
}

function deconflictedCount(
  clubApps: Map<string, number>,
  seasonApps: Map<string, Map<number, number>>
): { keep: string[]; drop: string[] } {
  const clubs = [...clubApps.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep: string[] = [];
  const drop: string[] = [];

  const conflicts = (a: string, b: string): boolean => {
    const sa = seasonApps.get(a);
    const sb = seasonApps.get(b);
    if (!sa || !sb) return false;
    for (const [season, appsA] of sa) {
      if (appsA < HARD_APPS) continue;
      const appsB = sb.get(season) ?? 0;
      if (appsB >= HARD_APPS) return true;
    }
    return false;
  };

  for (const [club] of clubs) {
    if (keep.some((k) => conflicts(k, club))) drop.push(club);
    else keep.push(club);
  }
  return { keep, drop };
}

async function main() {
  console.log(APPLY ? 'APPLY — writing verified_club_count' : 'DRY RUN — pass --apply to write');

  await db.execute(sql`
    ALTER TABLE player_extra_stats
    ADD COLUMN IF NOT EXISTS verified_club_count integer
  `);

  // Clear previous run so players who no longer smell fall back to the live metric.
  if (APPLY) {
    await db.execute(sql`UPDATE player_extra_stats SET verified_club_count = NULL, updated_at = now()
      WHERE verified_club_count IS NOT NULL`);
  }

  const smell = (await db.execute(sql`
    WITH season_clubs AS (
      -- 3+ clubs in one season: impossible beyond a double move / bad merge
      SELECT player_id, season, COUNT(DISTINCT lower(team_name))::int AS n
      FROM player_stats
      WHERE appearances > 0 AND team_name IS NOT NULL AND team_name <> ''
        AND league_id NOT IN (1, 4)
      GROUP BY player_id, season
      HAVING COUNT(DISTINCT lower(team_name)) >= 3
    ),
    hard_dual AS (
      -- 2+ seasons where two clubs each have ≥10 apps: repeated namesake overlap
      -- (Nenê PSG∩Cagliari). A single mid-season transfer only makes one such season.
      SELECT player_id FROM (
        SELECT player_id, season
        FROM player_stats
        WHERE appearances >= ${HARD_APPS}
          AND team_name IS NOT NULL AND team_name <> ''
          AND league_id NOT IN (1, 4)
        GROUP BY player_id, season
        HAVING COUNT(DISTINCT lower(team_name)) >= 2
      ) s
      GROUP BY player_id
      HAVING COUNT(*) >= 2
    ),
    club_n AS (
      SELECT player_id, COUNT(DISTINCT lower(team_name))::int AS n FROM (
        SELECT player_id, team_name FROM player_career WHERE team_id > 0
        UNION
        SELECT player_id, team_name FROM player_stats
        WHERE appearances > 0 AND team_name IS NOT NULL AND league_id NOT IN (1, 4)
      ) u GROUP BY player_id
    )
    SELECT DISTINCT p.id, p.name, p.tm_player_id, COALESCE(c.n, 0)::int AS raw_n
    FROM players p
    LEFT JOIN club_n c ON c.player_id = p.id
    WHERE p.id IN (SELECT player_id FROM season_clubs)
       OR p.id IN (SELECT player_id FROM hard_dual)
       OR (
         COALESCE(c.n, 0) >= 12
         AND (position(' ' in p.name) = 0 OR length(p.name) <= 6)
       )
    ORDER BY raw_n DESC
  `)) as unknown as Array<{ id: string; name: string; tm_player_id: string | null; raw_n: number }>;

  console.log(`Merge-smell players: ${smell.length}`);

  const tmIds = new Set(smell.map((p) => p.tm_player_id).filter((x): x is string => !!x));
  const tmClubs = new Map<string, Set<string>>();
  if (tmIds.size) {
    await streamCsv(join(DIR, 'transfers.csv'), (cols, ix) => {
      const tmId = cols[ix.player_id!]?.trim() ?? '';
      if (!tmIds.has(tmId)) return;
      for (const col of ['to_club_name', 'from_club_name'] as const) {
        const name = cols[ix[col]!]?.trim() ?? '';
        if (isJunkClub(name)) continue;
        (tmClubs.get(tmId) ?? tmClubs.set(tmId, new Set()).get(tmId)!).add(name.toLowerCase());
      }
    });
  }
  console.log(`TM transfer histories available: ${tmClubs.size}`);

  const results: Array<{ id: string; name: string; raw: number; verified: number; source: string; dropped: string }> = [];

  for (const p of smell) {
    const rows = (await db.execute(sql`
      SELECT lower(team_name) AS club, season, SUM(appearances)::int AS apps
      FROM player_stats
      WHERE player_id = ${p.id}::uuid
        AND appearances > 0
        AND team_name IS NOT NULL AND team_name <> ''
        AND league_id NOT IN (1, 4)
      GROUP BY lower(team_name), season
    `)) as unknown as Array<{ club: string; season: number; apps: number }>;

    const clubApps = new Map<string, number>();
    const seasonApps = new Map<string, Map<number, number>>();
    for (const r of rows) {
      if (isJunkClub(r.club)) continue;
      clubApps.set(r.club, (clubApps.get(r.club) ?? 0) + r.apps);
      const sm = seasonApps.get(r.club) ?? new Map();
      sm.set(r.season, (sm.get(r.season) ?? 0) + r.apps);
      seasonApps.set(r.club, sm);
    }

    // Career-only clubs (no stats) — include if they don't overlap a kept club's seasons hard.
    const careerOnly = (await db.execute(sql`
      SELECT lower(team_name) AS club, season_from, COALESCE(season_to, season_from) AS season_to
      FROM player_career
      WHERE player_id = ${p.id}::uuid AND team_id > 0
        AND NOT EXISTS (
          SELECT 1 FROM player_stats s
          WHERE s.player_id = ${p.id}::uuid AND s.appearances > 0 AND s.team_name IS NOT NULL
            AND lower(s.team_name) = lower(player_career.team_name)
        )
    `)) as unknown as Array<{ club: string; season_from: number; season_to: number }>;

    const { keep, drop } = deconflictedCount(clubApps, seasonApps);

    for (const c of careerOnly) {
      if (isJunkClub(c.club)) continue;
      if (keep.includes(c.club) || drop.includes(c.club)) continue;
      // Treat career spell as soft seasons with HARD_APPS so it conflicts with kept clubs in range.
      const sm = new Map<number, number>();
      for (let y = c.season_from; y <= c.season_to; y += 1) sm.set(y, HARD_APPS);
      let conflicts = false;
      for (const k of keep) {
        const ks = seasonApps.get(k);
        if (!ks) continue;
        for (const [season, appsK] of ks) {
          if (appsK >= HARD_APPS && sm.has(season)) {
            conflicts = true;
            break;
          }
        }
        if (conflicts) break;
      }
      if (conflicts) drop.push(c.club);
      else {
        keep.push(c.club);
        seasonApps.set(c.club, sm);
        clubApps.set(c.club, 1);
      }
    }

    let verified = keep.length;
    let source = 'deconflict';
    let droppedNote = drop.slice(0, 6).join(', ') + (drop.length > 6 ? '…' : '');

    // TM transfers may win only when they reduce the live count (never inflate).
    if (p.tm_player_id && tmClubs.has(p.tm_player_id)) {
      const tmN = tmClubs.get(p.tm_player_id)!.size;
      if (tmN > 0 && tmN < p.raw_n && tmN < keep.length) {
        verified = tmN;
        source = 'tm_transfers';
        droppedNote = '';
      }
    }

    const isMononym = !p.name.includes(' ') || p.name.length <= 6;
    // Non-mononyms: only accept mild cleanups / TM reductions. Aggressive deconflict
    // on dual-loan seasons wrongly strips real clubs (Kiko Femenía − Villarreal, etc.).
    if (source === 'deconflict' && !isMononym && verified < p.raw_n * 0.75) {
      continue;
    }
    if (verified >= p.raw_n) continue; // nothing to fix

    results.push({
      id: p.id,
      name: p.name,
      raw: p.raw_n,
      verified,
      source,
      dropped: droppedNote,
    });
  }

  results.sort((a, b) => b.raw - a.raw);
  console.log('\nSample (raw → verified):');
  for (const r of results.slice(0, 25)) {
    console.log(
      `  ${r.name.padEnd(20)} ${String(r.raw).padStart(2)} → ${String(r.verified).padStart(2)}  [${r.source}]` +
        (r.dropped ? `  drop: ${r.dropped}` : '')
    );
  }

  const samples = ['Nenê', 'Emerson', 'Adriano', 'Álvaro Morata', 'Gervinho', 'Willian'];
  console.log('\nWatch list:');
  for (const name of samples) {
    const hits = results.filter((r) => r.name === name);
    if (!hits.length) console.log(`  ${name}: (no merge smell — live metric unchanged)`);
    for (const r of hits) console.log(`  ${r.name}: ${r.raw} → ${r.verified} (${r.source})`);
  }

  if (!APPLY) {
    console.log(`\nWould write verified_club_count for ${results.length} players.`);
    process.exit(0);
  }

  for (let i = 0; i < results.length; i += 200) {
    const batch = results.slice(i, i + 200);
    const tuples = batch.map((r) => sql`(${r.id}::uuid, ${r.verified})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, verified_club_count)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE
        SET verified_club_count = EXCLUDED.verified_club_count,
            updated_at = now()
    `);
  }
  console.log(`\nWrote verified_club_count for ${results.length} players.`);
  console.log('Next: npm run job:regenerate-draft-most-clubs');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
