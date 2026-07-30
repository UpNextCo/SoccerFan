/**
 * Reconcile `player_career` season ranges against the appearance evidence in `player_stats`.
 *
 * `player_career` comes from API-Football, whose spell dates are shallow and often wrong, and Club
 * Chain reads it to decide whether two players were ever teammates. Three failure modes, all visible
 * in the live data:
 *
 *   1. Starts too late  — Gerrard's Liverpool spell began 1998, we stored 2005; Owen's began 1996, we
 *      stored 2002. Their stored ranges did not overlap, so the game rejected a pairing that played
 *      six seasons together.
 *   2. Ends too late    — Gerrard's Liverpool spell ran to 2017 (he left in 2015), making him a
 *      "teammate" of Salah, van Dijk and Robertson.
 *   3. Stints merged    — two separate spells at one club collapse into a single range (Cristiano at
 *      United stored as 2003–2021), inventing teammates for every season in between.
 *
 * `player_stats` already holds the truth: one row per club per season the player actually played. So
 * each spell is rebuilt from the seasons we have appearances for.
 *
 *   - Every stats season is attached to the stint it falls in, or failing that the nearest one, so
 *     multi-stint players keep their stints separate.
 *   - A stint's start moves EARLIER only, keeping the stored value when it predates our coverage
 *     (youth years, leagues we hold no stats for).
 *   - A stint's end moves to the last season we have appearances for, in either direction — this is
 *     what removes the phantom teammates. Spells running to the present are left alone, since stats
 *     for the current season lag.
 *   - A stint is SPLIT at a gap of SPLIT_GAP_SEASONS or more, but ONLY when the player turns up at
 *     another club during that gap. Plenty of stats rows carry appearances with no club name at all
 *     (Gerrard 2010–2013), and treating those as a departure would cut a continuous Liverpool career
 *     in half and lose his links to Suárez and Coutinho.
 *
 * A spell with no appearance evidence at all is never touched — absent evidence is not evidence of
 * absence, and those spells are all we have for pre-coverage eras. For the same reason a spell's end
 * is left alone when unattributed appearances sit between our last sighting and the stored end.
 *
 * Usage:
 *   npm run job:reconcile-career-seasons              # dry run + review CSV
 *   npm run job:reconcile-career-seasons -- --apply   # write to the database
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubCareerOnlySql } from '../utils/nationalTeam.js';
import { statsClubSeasonCte, statsTeamNameKeySql } from '../utils/statsClubEvidence.js';
import {
  formatSpells,
  reconcileStints,
  sameSpells,
  type SeasonContext,
  type Stint,
} from '../services/careerSeasonReconciler.js';

/** Spells reaching this close to now are treated as ongoing, so their end is never pulled in. */
const ONGOING_FROM = new Date().getUTCFullYear() - 1;

const APPLY = process.argv.includes('--apply');
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'career_seasons_review.csv';

interface CareerGroup {
  playerId: string;
  playerName: string;
  teamId: number;
  teamName: string;
  stints: Stint[];
}

interface PlayerEvidence {
  /** teamId -> seasons with appearances at that club. */
  byClub: Map<number, number[]>;
  /** Seasons with appearances but no identifiable club. */
  unknown: Set<number>;
}

async function load(): Promise<{ groups: Map<string, CareerGroup>; evidence: Map<string, PlayerEvidence> }> {
  const careerRows = (await db.execute(sql`
    SELECT pc.player_id, p.name AS player_name, pc.team_id, pc.team_name, pc.season_from, pc.season_to
    FROM player_career pc
    JOIN players p ON p.id = pc.player_id
    WHERE pc.team_id > 0 AND ${clubCareerOnlySql('pc')}
    ORDER BY pc.player_id, pc.team_id, pc.season_from
  `)) as unknown as Array<{
    player_id: string;
    player_name: string;
    team_id: number;
    team_name: string;
    season_from: number;
    season_to: number | null;
  }>;

  const groups = new Map<string, CareerGroup>();
  for (const row of careerRows) {
    const key = `${row.player_id}|${row.team_id}`;
    const group =
      groups.get(key) ??
      groups.set(key, {
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        teamName: row.team_name,
        stints: [],
      }).get(key)!;
    group.stints.push({ from: row.season_from, to: row.season_to ?? row.season_from });
  }

  // team_id 0 marks an appearance we cannot pin to a club: either a blank team_name (common — Gerrard
  // 2010-2013) or a name absent from `teams`. Those seasons prove the player was playing somewhere,
  // which is enough to stop a hole in our data being read as leaving the club.
  const evidenceRows = (await db.execute(sql`
    WITH ${statsClubSeasonCte()}
    SELECT player_id, team_id, season FROM stats_club_season
    UNION ALL
    SELECT s.player_id, 0 AS team_id, s.season::int AS season
    FROM player_stats s
    LEFT JOIN team_map tm ON tm.name_key = ${statsTeamNameKeySql(sql`s.team_name`)}
    WHERE COALESCE(s.appearances, 0) > 0
      AND s.season IS NOT NULL
      AND tm.team_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM nations n WHERE n.name = s.team_name)
      AND COALESCE(s.team_name, '') !~* '\\s+U\\d{1,2}(\\s+W)?$'
      AND COALESCE(s.team_name, '') !~* '\\s+(Olympics?|Olympic)$'
  `)) as unknown as Array<{ player_id: string; team_id: number; season: number }>;

  const evidence = new Map<string, PlayerEvidence>();
  for (const row of evidenceRows) {
    const player =
      evidence.get(row.player_id) ??
      evidence.set(row.player_id, { byClub: new Map(), unknown: new Set() }).get(row.player_id)!;
    if (row.team_id === 0) {
      player.unknown.add(row.season);
      continue;
    }
    const seasons = player.byClub.get(row.team_id) ?? player.byClub.set(row.team_id, []).get(row.team_id)!;
    seasons.push(row.season);
  }

  return { groups, evidence };
}

async function main(): Promise<void> {
  console.log('Loading career spells and stats appearance evidence...');
  const { groups, evidence } = await load();
  const clubSeasonsFor = (group: CareerGroup): number[] | undefined =>
    evidence.get(group.playerId)?.byClub.get(group.teamId);
  console.log(`  club spells      : ${groups.size.toLocaleString()} (player, club) groups`);
  console.log(`  with evidence    : ${[...groups.values()].filter((g) => clubSeasonsFor(g)).length.toLocaleString()}`);

  const changes: Array<CareerGroup & { spells: Stint[] }> = [];
  const review: string[] = ['player,club,before,after,change'];
  const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
  let startsWidened = 0;
  let endsPulledIn = 0;
  let split = 0;

  for (const group of groups.values()) {
    const clubSeasons = clubSeasonsFor(group);
    if (!clubSeasons) continue;
    const player = evidence.get(group.playerId)!;

    const context: SeasonContext = {
      departedDuring: (from, to) => {
        for (const [teamId, teamSeasons] of player.byClub) {
          if (teamId === group.teamId) continue;
          if (teamSeasons.some((s) => s >= from && s <= to)) return true;
        }
        return false;
      },
      unknownDuring: (from, to) => {
        for (const season of player.unknown) if (season >= from && season <= to) return true;
        return false;
      },
    };

    const reconciled = reconcileStints(group.stints, clubSeasons, context, ONGOING_FROM);
    if (!reconciled || sameSpells(group.stints, reconciled)) continue;

    changes.push({ ...group, spells: reconciled });

    const startedEarlier = reconciled[0]!.from < group.stints[0]!.from;
    const endedSooner = reconciled.at(-1)!.to < group.stints.at(-1)!.to;
    const wasSplit = reconciled.length > group.stints.length;
    if (startedEarlier) startsWidened += 1;
    if (endedSooner) endsPulledIn += 1;
    if (wasSplit) split += 1;

    const kinds = [
      startedEarlier ? 'start earlier' : null,
      endedSooner ? 'end pulled in' : null,
      wasSplit ? 'stint split' : null,
    ].filter(Boolean);
    review.push(
      [
        csv(group.playerName),
        csv(group.teamName),
        csv(formatSpells(group.stints)),
        csv(formatSpells(reconciled)),
        csv(kinds.join(' + ')),
      ].join(',')
    );
  }

  writeFileSync(REVIEW_PATH, review.join('\n') + '\n');

  console.log(`\nSpells to rewrite : ${changes.length.toLocaleString()}`);
  console.log(`  start moved earlier : ${startsWidened.toLocaleString()}  (restores real teammate links)`);
  console.log(`  end pulled in       : ${endsPulledIn.toLocaleString()}  (removes phantom teammates)`);
  console.log(`  stint split         : ${split.toLocaleString()}`);
  console.log(`  review CSV          : ${REVIEW_PATH}`);

  for (const name of ['Steven Gerrard', 'Michael Owen', 'Cristiano Ronaldo', 'Paul Pogba']) {
    for (const c of changes.filter((x) => x.playerName === name).slice(0, 4)) {
      console.log(`  ${name} @ ${c.teamName}: ${formatSpells(c.stints)} -> ${formatSpells(c.spells)}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    return;
  }

  let done = 0;
  // Two statements per batch, not two per spell: a remote database over a proxy spends nearly all of
  // this job's wall clock on round trips, and the connection is dropped long before per-spell writes
  // can finish.
  for (let i = 0; i < changes.length; i += 250) {
    const batch = changes.slice(i, i + 250);
    // Replace each (player, club) wholesale: a reconciled start changes season_from, which is part of
    // the unique key, so updating in place can collide with a sibling stint mid-flight.
    await db.transaction(async (tx) => {
      const pairs = batch.map((c) => sql`(${c.playerId}::uuid, ${c.teamId}::int)`);
      await tx.execute(sql`
        DELETE FROM player_career pc
        USING (VALUES ${sql.join(pairs, sql`, `)}) AS v(player_id, team_id)
        WHERE pc.player_id = v.player_id AND pc.team_id = v.team_id
      `);
      const values = batch.flatMap((c) =>
        c.spells.map((s) => sql`(${c.playerId}::uuid, ${c.teamId}, ${c.teamName}, ${s.from}, ${s.to}, now())`)
      );
      await tx.execute(sql`
        INSERT INTO player_career (player_id, team_id, team_name, season_from, season_to, updated_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (player_id, team_id, season_from)
        DO UPDATE SET season_to = excluded.season_to, updated_at = now()
      `);
    });
    done += batch.length;
    console.log(`  rewritten ${done}/${changes.length}`);
  }
  console.log(`\nRewrote ${done.toLocaleString()} club spells.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
