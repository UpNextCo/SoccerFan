/**
 * Measure natural Back Yourself pool sizes (tier ≥ 3, no clipping).
 *   npx tsx scripts/analyze-back-yourself-pools.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';

const TIER = 3;
const LO = 10;
const HI = 30;

const NATIONS = [
  'France', 'Spain', 'England', 'Germany', 'Brazil', 'Italy',
  'Netherlands', 'Argentina', 'Portugal', 'Belgium',
  'Croatia', 'Uruguay', 'Colombia', 'Senegal', 'Morocco',
  'Nigeria', 'Poland', 'Denmark', 'Wales', 'Scotland',
  'Mexico', 'Japan', 'South Korea', 'Ghana', 'Serbia',
  'Switzerland', 'Turkey', 'Chile', 'Austria', 'Sweden',
  'Norway', 'USA', 'Ivory Coast', 'Cameroon', 'Egypt',
];

const BIG5 = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
];

function bucket(n: number): string {
  if (n < LO) return `<${LO}`;
  if (n <= HI) return `${LO}-${HI}`;
  if (n <= 50) return '31-50';
  if (n <= 100) return '51-100';
  return '100+';
}

function summarize(label: string, counts: number[], samples: Array<{ label: string; n: number }>) {
  const hist: Record<string, number> = {};
  for (const n of counts) hist[bucket(n)] = (hist[bucket(n)] ?? 0) + 1;
  const inRange = counts.filter((n) => n >= LO && n <= HI);
  const sorted = [...samples].filter((s) => s.n >= LO && s.n <= HI).sort((a, b) => b.n - a.n);
  console.log(`\n=== ${label} (n=${counts.length}) ===`);
  console.log('histogram:', hist);
  console.log(`in ${LO}-${HI}: ${inRange.length} (${counts.length ? ((inRange.length / counts.length) * 100).toFixed(0) : 0}%)`);
  if (inRange.length) {
    const avg = inRange.reduce((a, b) => a + b, 0) / inRange.length;
    console.log(`in-range avg=${avg.toFixed(1)} min=${Math.min(...inRange)} max=${Math.max(...inRange)}`);
  }
  console.log('sample in-range (top 12):');
  for (const s of sorted.slice(0, 12)) console.log(`  ${s.n.toString().padStart(2)}  ${s.label}`);
  console.log('sample too-big (top 8):');
  for (const s of [...samples].filter((x) => x.n > HI).sort((a, b) => b.n - a.n).slice(0, 8)) {
    console.log(`  ${s.n.toString().padStart(3)}  ${s.label}`);
  }
  console.log('sample too-small (top 8):');
  for (const s of [...samples].filter((x) => x.n > 0 && x.n < LO).sort((a, b) => b.n - a.n).slice(0, 8)) {
    console.log(`  ${s.n.toString().padStart(2)}  ${s.label}`);
  }
}

async function main() {
  // --- Club-only (Big-5 clubs with any famous) ---
  const clubs = (await db.execute(sql`
    SELECT club, league_id, n FROM (
      SELECT s.team_name AS club, s.league_id,
             COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= ${TIER})::int AS n
      FROM player_stats s JOIN players p ON p.id = s.player_id
      WHERE s.league_id IN (39, 140, 135, 78, 61)
        AND s.appearances > 0 AND s.team_name IS NOT NULL
        AND s.team_name NOT ILIKE '%U18%' AND s.team_name NOT ILIKE '%U19%'
        AND s.team_name NOT ILIKE '%U21%' AND s.team_name NOT ILIKE '%U23%'
        AND s.team_name NOT ILIKE '%Youth%'
      GROUP BY s.team_name, s.league_id
    ) t
    WHERE n >= 5
    ORDER BY n DESC
  `)) as unknown as Array<{ club: string; league_id: number; n: number }>;

  // True club pool = stats ∪ career (same as generator)
  const clubSamples: Array<{ label: string; n: number }> = [];
  for (const c of clubs.slice(0, 80)) {
    const rows = (await db.execute(sql`
      SELECT COUNT(DISTINCT p.id)::int AS n FROM players p
      WHERE p.market_value_tier >= ${TIER}
        AND (
          EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.team_name = ${c.club} AND m.appearances > 0)
          OR EXISTS (SELECT 1 FROM player_career cr WHERE cr.player_id = p.id AND cr.team_name = ${c.club} AND cr.team_id > 0)
        )
    `)) as unknown as Array<{ n: number }>;
    clubSamples.push({ label: `${c.club} (L${c.league_id})`, n: rows[0]?.n ?? 0 });
  }
  summarize(
    'club (past∪present, tier≥3) — top 80 by stats fame',
    clubSamples.map((s) => s.n),
    clubSamples
  );

  // --- Nationality-only ---
  const natSamples: Array<{ label: string; n: number }> = [];
  for (const nat of NATIONS) {
    const rows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM players
      WHERE market_value_tier >= ${TIER} AND nationality = ${nat}
    `)) as unknown as Array<{ n: number }>;
    natSamples.push({ label: nat, n: rows[0]?.n ?? 0 });
  }
  summarize('nationality-only (tier≥3)', natSamples.map((s) => s.n), natSamples);

  // --- Nat × league ---
  const natLeagueSamples: Array<{ label: string; n: number }> = [];
  for (const league of BIG5) {
    for (const nat of NATIONS) {
      const rows = (await db.execute(sql`
        SELECT COUNT(DISTINCT p.id)::int AS n FROM players p
        WHERE p.market_value_tier >= ${TIER}
          AND p.nationality = ${nat}
          AND EXISTS (
            SELECT 1 FROM player_stats m
            WHERE m.player_id = p.id AND m.league_id = ${league.id} AND m.appearances > 0
          )
      `)) as unknown as Array<{ n: number }>;
      const n = rows[0]?.n ?? 0;
      if (n >= 5) natLeagueSamples.push({ label: `${nat} · ${league.name}`, n });
    }
  }
  summarize('nat × league (tier≥3, n≥5)', natLeagueSamples.map((s) => s.n), natLeagueSamples);

  // --- Nat × club (discovery across all big-5 club names we have) ---
  const clubNames = clubs.map((c) => c.club);
  const natClubRows = (await db.execute(sql`
    SELECT p.nationality, club, COUNT(DISTINCT p.id)::int AS n
    FROM players p
    JOIN (
      SELECT player_id, team_name AS club FROM player_stats
      WHERE appearances > 0 AND team_name IS NOT NULL
        AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
      UNION
      SELECT player_id, team_name FROM player_career
      WHERE team_id > 0 AND team_name IS NOT NULL
        AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
    ) clubs ON clubs.player_id = p.id
    WHERE p.market_value_tier >= ${TIER}
      AND p.nationality IS NOT NULL AND p.nationality <> 'Unknown'
    GROUP BY p.nationality, club
    HAVING COUNT(DISTINCT p.id) >= 5
    ORDER BY n DESC
  `)) as unknown as Array<{ nationality: string; club: string; n: number }>;
  const natClubSamples = natClubRows.map((r) => ({
    label: `${r.nationality} · ${r.club}`,
    n: r.n,
  }));
  summarize('nat × club (tier≥3, n≥5)', natClubSamples.map((s) => s.n), natClubSamples);

  // --- Position × club (exploratory) ---
  const posClub = (await db.execute(sql`
    SELECT p.position, s.team_name AS club, COUNT(DISTINCT p.id)::int AS n
    FROM players p
    JOIN player_stats s ON s.player_id = p.id AND s.appearances > 0
    WHERE p.market_value_tier >= ${TIER}
      AND p.position IN ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')
      AND s.team_name IN (${sql.join(clubNames.slice(0, 40).map((c) => sql`${c}`), sql`, `)})
    GROUP BY p.position, s.team_name
    HAVING COUNT(DISTINCT p.id) >= 5
    ORDER BY n DESC
    LIMIT 200
  `)) as unknown as Array<{ position: string; club: string; n: number }>;
  // Note: stats-only for speed; still useful signal
  summarize(
    'position × club (stats-only exploratory, top clubs)',
    posClub.map((r) => r.n),
    posClub.map((r) => ({ label: `${r.position} · ${r.club}`, n: r.n }))
  );

  // --- Summary recommendation ---
  const score = (samples: Array<{ n: number }>) => {
    const inR = samples.filter((s) => s.n >= LO && s.n <= HI).length;
    return { total: samples.length, inRange: inR, pct: samples.length ? Math.round((inR / samples.length) * 100) : 0 };
  };
  console.log('\n=== RECOMMENDATION SNAPSHOT ===');
  console.log('club:', score(clubSamples));
  console.log('nationality:', score(natSamples));
  console.log('nat_league:', score(natLeagueSamples));
  console.log('nat_club:', score(natClubSamples));
  console.log('pos_club (exploratory):', score(posClub.map((r) => ({ n: r.n }))));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
