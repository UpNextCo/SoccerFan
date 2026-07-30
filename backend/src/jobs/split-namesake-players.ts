/**
 * Split two different footballers who share a name back into two player rows.
 *
 * Historical backfills match players by name, and football is full of namesakes a generation apart. Where
 * one already existed, the older man's career was stacked onto the younger one's row, so a single player
 * ends up holding two careers:
 *
 *   Ronaldo      — Ronaldo Nazário's 1996-2004 Barcelona/Inter/Real record, on a Brazilian born in 1990
 *   Alan Smith   — Arsenal's 1992-94 goals, on the Leeds striker born in 1980
 *   El Diouf     — El Hadji Diouf's career, on a player born in 2004
 *
 * The tell is a season the row's owner cannot have played: nobody appears in a top division before their
 * MIN_DEBUT_AGE birthday. Everything at or before that cut belongs to the namesake and is moved to a new
 * row, leaving the original with only its own career. This matters beyond wrong totals in Target Man —
 * `player_career` drives Club Chain, so a borrowed spell invents teammates (anyone at Barcelona in 1997
 * "played with" a man who was seven at the time).
 *
 * The row that KEEPS its identity is the one with the birth date, since that is what the cut is derived
 * from and it usually carries the api-football profile too. The split-off row gets the same name — they
 * genuinely share it — but no birth date or market value, so fame-ranked puzzle selection leaves it alone
 * until someone fills it in.
 *
 * Only the seasons are used to divide the two. A namesake pair born close together would not split
 * cleanly, but the ones this finds are decades apart.
 *
 * Usage:
 *   npm run job:split-namesake-players            # dry run + review CSV
 *   npm run job:split-namesake-players -- --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { buildPlayerSearchFields } from '../utils/playerSearch.js';

/** Youngest a top-flight debut is credible at. Seasons before this are somebody else's. */
const MIN_DEBUT_AGE = 15;

/** `players.age` is NOT NULL and we do not know the namesake's, so stand in the same value the FBref
 *  import uses for a historical player. Their birth date stays null, which is what marks it as unknown. */
const PLACEHOLDER_AGE = 25;

const APPLY = process.argv.includes('--apply');
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'namesake_split_review.csv';

interface Candidate {
  playerId: string;
  name: string;
  position: string;
  birthDate: string;
  cut: number;
  statRows: number;
  goals: number;
  careerRows: number;
  honourRows: number;
  transferRows: number;
  seasonFrom: number;
  seasonTo: number;
  clubs: string;
  lastClub: string | null;
  lastLeague: string | null;
}

async function findCandidates(): Promise<Candidate[]> {
  return (await db.execute(sql`
    WITH affected AS (
      SELECT p.id AS player_id, p.name, p.position, p.birth_date,
             extract(year FROM p.birth_date)::int + ${MIN_DEBUT_AGE} AS cut
      FROM players p
      WHERE p.birth_date IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM player_stats s
          WHERE s.player_id = p.id AND s.season < extract(year FROM p.birth_date) + ${MIN_DEBUT_AGE}
        )
    )
    SELECT
      a.player_id AS "playerId",
      a.name,
      a.position,
      a.birth_date::text AS "birthDate",
      a.cut,
      st.rows AS "statRows",
      st.goals,
      st.season_from AS "seasonFrom",
      st.season_to AS "seasonTo",
      st.clubs,
      st.last_club AS "lastClub",
      st.last_league AS "lastLeague",
      COALESCE(ca.rows, 0) AS "careerRows",
      COALESCE(ho.rows, 0) AS "honourRows",
      COALESCE(tr.rows, 0) AS "transferRows"
    FROM affected a
    JOIN LATERAL (
      SELECT count(*)::int AS rows, COALESCE(sum(s.goals), 0)::int AS goals,
             min(s.season)::int AS season_from, max(s.season)::int AS season_to,
             string_agg(DISTINCT s.team_name, ' / ') AS clubs,
             (array_agg(s.team_name ORDER BY s.season DESC))[1] AS last_club,
             (array_agg(s.league_name ORDER BY s.season DESC))[1] AS last_league
      FROM player_stats s WHERE s.player_id = a.player_id AND s.season < a.cut
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS rows FROM player_career c
      WHERE c.player_id = a.player_id AND c.season_from < a.cut
    ) ca ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS rows FROM player_honours h
      WHERE h.player_id = a.player_id AND h.season ~ '^\\d{4}' AND left(h.season, 4)::int < a.cut
    ) ho ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS rows FROM player_transfers t
      WHERE t.player_id = a.player_id AND t.transfer_date IS NOT NULL
        AND extract(year FROM t.transfer_date) < a.cut
    ) tr ON true
    ORDER BY st.goals DESC, st.rows DESC
  `)) as unknown as Candidate[];
}

async function main(): Promise<void> {
  const candidates = await findCandidates();
  console.log(`Players holding a namesake's career: ${candidates.length}`);

  const csv = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  writeFileSync(
    REVIEW_PATH,
    [
      'name,keeps_birth_date,seasons_moved,goals_moved,clubs_moved,stat_rows,career_rows,honours,transfers',
      ...candidates.map((c) =>
        [
          csv(c.name),
          csv(c.birthDate),
          csv(`${c.seasonFrom}-${c.seasonTo}`),
          c.goals,
          csv(c.clubs ?? ''),
          c.statRows,
          c.careerRows,
          c.honourRows,
          c.transferRows,
        ].join(',')
      ),
    ].join('\n') + '\n'
  );

  const totals = candidates.reduce(
    (acc, c) => ({
      stats: acc.stats + c.statRows,
      career: acc.career + c.careerRows,
      honours: acc.honours + c.honourRows,
      transfers: acc.transfers + c.transferRows,
    }),
    { stats: 0, career: 0, honours: 0, transfers: 0 }
  );
  console.log(`  stat rows to move    : ${totals.stats}`);
  console.log(`  career rows to move  : ${totals.career}   (these are the false Club Chain links)`);
  console.log(`  honours to move      : ${totals.honours}`);
  console.log(`  transfers to move    : ${totals.transfers}`);
  console.log(`  review CSV           : ${REVIEW_PATH}`);
  console.log('\nBiggest splits:');
  for (const c of candidates.slice(0, 12)) {
    console.log(
      `  ${c.name.padEnd(22)} born ${c.birthDate} · moving ${c.seasonFrom}-${c.seasonTo}, ${c.goals} goals (${c.clubs ?? '?'})`
    );
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    return;
  }

  let done = 0;
  for (const c of candidates) {
    // Per player in one transaction: a half-moved career is worse than either whole.
    await db.transaction(async (tx) => {
      const fields = buildPlayerSearchFields(c.name);
      const inserted = (await tx.execute(sql`
        INSERT INTO players (external_id, name, aliases, nationality, position, age, current_club,
                             current_league, market_value_tier, search_text)
        VALUES (NULL, ${fields.name}, ${JSON.stringify(fields.aliases)}::jsonb, 'Unknown', ${c.position},
                ${PLACEHOLDER_AGE}, ${c.lastClub ?? 'Unknown'}, ${c.lastLeague}, 3, ${fields.searchText})
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      const newId = inserted[0]!.id;

      await tx.execute(sql`
        UPDATE player_stats SET player_id = ${newId}
        WHERE player_id = ${c.playerId} AND season < ${c.cut}
      `);
      await tx.execute(sql`
        UPDATE player_career SET player_id = ${newId}
        WHERE player_id = ${c.playerId} AND season_from < ${c.cut}
      `);
      await tx.execute(sql`
        UPDATE player_honours SET player_id = ${newId}
        WHERE player_id = ${c.playerId} AND season ~ '^\\d{4}' AND left(season, 4)::int < ${c.cut}
      `);
      await tx.execute(sql`
        UPDATE player_transfers SET player_id = ${newId}
        WHERE player_id = ${c.playerId} AND transfer_date IS NOT NULL
          AND extract(year FROM transfer_date) < ${c.cut}
      `);
    });
    done += 1;
    if (done % 20 === 0) console.log(`  split ${done}/${candidates.length}`);
  }
  console.log(`\nSplit ${done} players. Re-run job:refresh-club-chain-paths — the teammate graph has changed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
