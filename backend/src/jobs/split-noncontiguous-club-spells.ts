/**
 * Split a single stored `player_career` row when named `player_stats` seasons at that club
 * are not contiguous (Donovan's Everton loans 2009 and 2011 stored as 2009–2011).
 *
 * Only splits when every stats season already names the club — a hole with no club name is
 * missing data, not a transfer (see careerSeasonReconciler).
 *
 *   npx tsx src/jobs/split-noncontiguous-club-spells.ts
 *   npx tsx src/jobs/split-noncontiguous-club-spells.ts --apply
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubCareerOnlySql } from '../utils/nationalTeam.js';
import { statsClubSeasonCte } from '../utils/statsClubEvidence.js';

const APPLY = process.argv.includes('--apply');

type Group = {
  player_id: string;
  player_name: string;
  team_id: number;
  team_name: string;
  season_from: number;
  season_to: number;
  seasons: number[];
};

function contiguousGroups(seasons: number[]): Array<{ from: number; to: number }> {
  const sorted = [...new Set(seasons)].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const groups: Array<{ from: number; to: number }> = [];
  let from = sorted[0]!;
  let to = sorted[0]!;
  for (const year of sorted.slice(1)) {
    if (year === to + 1) {
      to = year;
      continue;
    }
    groups.push({ from, to });
    from = year;
    to = year;
  }
  groups.push({ from, to });
  return groups;
}

async function main(): Promise<void> {
  const rows = (await db.execute(sql`
    WITH ${statsClubSeasonCte()},
    named AS (
      SELECT player_id, team_id, MIN(team_name) AS team_name, array_agg(season ORDER BY season) AS seasons
      FROM stats_club_season
      GROUP BY player_id, team_id
    )
    SELECT p.name AS player_name, pc.player_id, pc.team_id, pc.team_name,
           MIN(pc.season_from) AS season_from, MAX(COALESCE(pc.season_to, pc.season_from)) AS season_to,
           n.seasons
    FROM player_career pc
    JOIN players p ON p.id = pc.player_id
    JOIN named n ON n.player_id = pc.player_id AND n.team_id = pc.team_id
    WHERE pc.team_id > 0
      AND ${clubCareerOnlySql('pc')}
      AND p.nationality IN ('United States', 'USA')
    GROUP BY p.name, pc.player_id, pc.team_id, pc.team_name, n.seasons
  `)) as unknown as Group[];

  const changes: Array<Group & { groups: Array<{ from: number; to: number }> }> = [];
  for (const row of rows) {
    const groups = contiguousGroups(row.seasons ?? []);
    if (groups.length < 2) continue;
    changes.push({ ...row, groups });
  }

  console.log(`Non-contiguous club spells to split: ${changes.length}`);
  for (const c of changes.slice(0, 30)) {
    console.log(
      `  ${c.player_name} @ ${c.team_name}: ${c.season_from}–${c.season_to} -> ${c.groups.map((g) => `${g.from}–${g.to}`).join(' + ')}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to rewrite these spells.');
    return;
  }

  for (const c of changes) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM player_career
        WHERE player_id = ${c.player_id}::uuid AND team_id = ${c.team_id}
      `);
      const values = c.groups.map(
        (g) => sql`(${c.player_id}::uuid, ${c.team_id}, ${c.team_name}, ${g.from}, ${g.to}, now())`
      );
      await tx.execute(sql`
        INSERT INTO player_career (player_id, team_id, team_name, season_from, season_to, updated_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (player_id, team_id, season_from)
        DO UPDATE SET season_to = excluded.season_to, updated_at = now()
      `);
    });
  }
  console.log(`Split ${changes.length} merged club spells.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
