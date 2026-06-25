/**
 * Backfill "Champions League winner" into player_honours for WHOLE winning squads.
 *
 * final_appearances only lists players who APPEARED in the final, so squad members who
 * won without playing it (e.g. Rivaldo, AC Milan 2003) are missed by the uclWinner rule.
 *
 * We derive each winning club-season from the final-winners' OWN UCL stats (so the club
 * name is in our canonical form — no "Milan" vs "AC Milan" mismatch), then credit every
 * player who made a UCL appearance for that club in that season.
 *
 * Idempotent (ON CONFLICT DO NOTHING). DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

// Winning (team_name, season) in our canonical names, taken from the winners' own UCL
// rows that season. A mid-season transfer can attach a winner to a second club, so per
// season we keep only the DOMINANT club (most winners share it) and require >=5 of them —
// this drops spurious clubs like PSG-2019 (lost final) / Celtic-2024.
const WINNING_CLUB_SEASONS = sql`
  SELECT season, team_name FROM (
    SELECT ws.season, ws.team_name,
           COUNT(DISTINCT fa.player_id) AS n,
           ROW_NUMBER() OVER (PARTITION BY ws.season ORDER BY COUNT(DISTINCT fa.player_id) DESC) AS rk
    FROM final_appearances fa
    JOIN player_stats ws ON ws.player_id = fa.player_id AND ws.season = fa.season
                         AND ws.league_id = 2 AND ws.appearances > 0
    WHERE fa.competition = 'Champions League' AND fa.won = true
    GROUP BY ws.season, ws.team_name
  ) t WHERE rk = 1 AND n >= 5
`;

// Everyone with a UCL appearance for a winning club that season = a winner.
const SQUAD = sql`
  SELECT DISTINCT ps.player_id, ps.season
  FROM player_stats ps
  JOIN (${WINNING_CLUB_SEASONS}) win ON ps.team_name = win.team_name AND ps.season = win.season
  WHERE ps.league_id = 2 AND ps.appearances > 0
`;

async function main() {
  console.log(`Backfill UCL winners → player_honours — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const clubSeasons = (await db.execute(sql`SELECT * FROM (${WINNING_CLUB_SEASONS}) x ORDER BY season`)) as unknown as Array<{ team_name: string; season: number }>;
  console.log('Winning club-seasons detected:');
  console.table(clubSeasons);

  const would = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM (${SQUAD}) s
    WHERE NOT EXISTS (
      SELECT 1 FROM player_honours h
      WHERE h.player_id = s.player_id AND h.competition ILIKE '%champions league%'
        AND h.placement ILIKE '%winner%' AND h.season = s.season::text
    )
  `)) as unknown as Array<{ n: number }>;
  console.log(`\n${APPLY ? 'Inserting' : 'Would insert'} ${would[0]?.n ?? 0} new winner rows.`);

  const rivaldo = (await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM (${SQUAD}) s JOIN players p ON p.id = s.player_id WHERE p.name = 'Rivaldo') AS hit
  `)) as unknown as Array<{ hit: boolean }>;
  console.log(`Rivaldo captured as a winner: ${rivaldo[0]?.hit}`);

  if (APPLY) {
    await db.execute(sql`
      INSERT INTO player_honours (player_id, competition, season, placement)
      SELECT s.player_id, 'UEFA Champions League', s.season::text, 'winner' FROM (${SQUAD}) s
      ON CONFLICT (player_id, competition, season, placement) DO NOTHING
    `);
    console.log('Done.');
  } else {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
