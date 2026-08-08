/**
 * Expand the Golf question bank with fun, database-verifiable prompts.
 *
 * Prefer broad season snapshots, club eras, career journeys, finals and
 * tournament moments over nationality × league filter stacks.
 *
 * Usage:
 *   npm run job:build-golf-templates
 *   npm run job:build-golf-templates -- --dry
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { towerPrompts } from '../db/schema.js';
import {
  countRecallablePlayers,
  countValidPlayers,
  sampleFamousPlayers,
  towerVocab,
  type TowerRule,
} from '../services/towerRules.js';
import {
  categoryFor,
  golfPromptCopy,
} from '../services/footballGolfGenerator.js';

interface Candidate {
  prompt: string;
  rule: TowerRule;
}

/** Managers players actually remember being managed by. */
const FAMOUS_MANAGERS = [
  'Pep Guardiola',
  'José Mourinho',
  'Sir Alex Ferguson',
  'Carlo Ancelotti',
  'Jürgen Klopp',
  'Arsène Wenger',
  'Diego Simeone',
  'Antonio Conte',
  'Unai Emery',
  'Thomas Tuchel',
  'Zinedine Zidane',
  'Louis van Gaal',
  'Rafael Benítez',
  'Claudio Ranieri',
  'Mauricio Pochettino',
  'Erik ten Hag',
  'Mikel Arteta',
  'Xavi',
  'Frank Lampard',
  'Steven Gerrard',
  'Ole Gunnar Solskjær',
  'Nuno Espírito Santo',
  'Brendan Rodgers',
  'Roberto Mancini',
  'Manuel Pellegrini',
  'Massimiliano Allegri',
  'Luciano Spalletti',
  'Julian Nagelsmann',
  'Hans-Dieter Flick',
  'Luis Enrique',
] as const;

const CLUB_ERAS = [
  ['Arsenal', 2003],
  ['Arsenal', 2022],
  ['Chelsea', 2004],
  ['Chelsea', 2011],
  ['Inter', 2009],
  ['Barcelona', 2008],
  ['Barcelona', 2014],
  ['Bayern München', 2012],
  ['Bayern München', 2019],
  ['Leicester', 2015],
  ['Real Madrid', 2016],
  ['Real Madrid', 2021],
  ['Liverpool', 2019],
  ['Manchester City', 2017],
  ['Manchester City', 2022],
  ['Manchester United', 2007],
  ['Manchester United', 2012],
  ['Tottenham', 2016],
  ['Juventus', 2011],
  ['AC Milan', 2002],
  ['Paris Saint Germain', 2020],
  ['Atlético Madrid', 2013],
  ['Borussia Dortmund', 2011],
] as const;

const DIRECT_TRANSFERS = [
  ['Chelsea', 'Arsenal'],
  ['Arsenal', 'Chelsea'],
  ['Arsenal', 'Barcelona'],
  ['Manchester United', 'Real Madrid'],
  ['Tottenham', 'Real Madrid'],
  ['Liverpool', 'Barcelona'],
  ['Juventus', 'Manchester United'],
  ['Borussia Dortmund', 'Bayern München'],
  ['Atlético Madrid', 'Chelsea'],
  ['Roma', 'Liverpool'],
  ['Ajax', 'Barcelona'],
  ['Benfica', 'Manchester United'],
  ['Southampton', 'Liverpool'],
  ['Everton', 'Manchester United'],
] as const;

function promptNorm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function seasonLabel(season: number): string {
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`;
}

function addCandidate(
  target: Map<string, Candidate>,
  prompt: string,
  rule: TowerRule
): void {
  const copy = golfPromptCopy(prompt);
  target.set(promptNorm(copy), { prompt: copy, rule });
}

function qualityGates(
  category: string,
  validAnswers: number,
  recallable: number
): boolean {
  // Transfers are naturally small; keep a lower floor so iconic moves still ship.
  const minValid = category === 'Transfers' ? 8 : 20;
  const minRecallable = category === 'Transfers' ? 6 : 12;
  const maximumAnswers =
    category === 'Seasons' || category === 'Tournaments' ? 220 : 120;
  return (
    validAnswers >= minValid &&
    validAnswers <= maximumAnswers &&
    recallable >= minRecallable
  );
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const vocab = await towerVocab();
  const clubs = vocab.clubs.slice(0, 16);
  const candidates = new Map<string, Candidate>();

  // Career journeys — dual-club careers between major sides.
  for (let first = 0; first < clubs.length; first += 1) {
    for (let second = first + 1; second < clubs.length; second += 1) {
      const a = clubs[first]!;
      const b = clubs[second]!;
      addCandidate(candidates, `Name players who played for both ${a} and ${b}.`, {
        playedFor: [a, b],
      });
    }
  }

  // Season snapshots — broad, nameable scoring/assisting pools.
  const leagueSeasons = [
    { id: 39, name: 'Premier League' },
    { id: 140, name: 'La Liga' },
    { id: 135, name: 'Serie A' },
    { id: 78, name: 'Bundesliga' },
    { id: 61, name: 'Ligue 1' },
    { id: 2, name: 'Champions League' },
  ];
  for (const league of leagueSeasons) {
    for (const season of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
      addCandidate(
        candidates,
        `Name players who scored in the ${seasonLabel(season)} ${league.name} season.`,
        {
          seasonStat: {
            leagueId: league.id,
            season,
            metric: 'goals',
            minimum: 1,
          },
        }
      );
      addCandidate(
        candidates,
        `Name players with 10+ goals in the ${seasonLabel(season)} ${league.name} season.`,
        {
          seasonStat: {
            leagueId: league.id,
            season,
            metric: 'goals',
            minimum: 10,
          },
        }
      );
      addCandidate(
        candidates,
        `Name players with 5+ assists in the ${seasonLabel(season)} ${league.name} season.`,
        {
          seasonStat: {
            leagueId: league.id,
            season,
            metric: 'assists',
            minimum: 5,
          },
        }
      );
      if (league.name === 'Premier League' || league.name === 'Champions League') {
        addCandidate(
          candidates,
          `Name players with 15+ goals in the ${seasonLabel(season)} ${league.name} season.`,
          {
            seasonStat: {
              leagueId: league.id,
              season,
              metric: 'goals',
              minimum: 15,
            },
          }
        );
      }
    }
  }

  // Club eras / title-winning and iconic squad seasons.
  for (const [club, season] of CLUB_ERAS) {
    addCandidate(
      candidates,
      `Name players who appeared for ${club} in ${seasonLabel(season)}.`,
      { clubSeason: { club, season } }
    );
  }

  // Managers — only household names.
  const managerRows = (await db.execute(
    sql`SELECT DISTINCT manager FROM manager_tenures ORDER BY manager`
  )) as unknown as Array<{ manager: string }>;
  const managerSet = new Set(
    managerRows.map((row) => row.manager.trim().toLowerCase())
  );
  for (const manager of FAMOUS_MANAGERS) {
    if (!managerSet.has(manager.toLowerCase())) continue;
    addCandidate(candidates, `Name players who played under ${manager}.`, {
      managedBy: manager,
    });
  }

  // Direct transfers between big clubs.
  for (const [fromClub, toClub] of DIRECT_TRANSFERS) {
    addCandidate(
      candidates,
      `Name players who moved directly from ${fromClub} to ${toClub}.`,
      { directTransfer: { fromClub, toClub } }
    );
  }

  // Iconic achievements / finals / tournaments.
  addCandidate(candidates, 'Name players who scored in a Champions League final.', {
    finalAppearance: { competition: 'Champions League', scored: true },
  });
  addCandidate(candidates, 'Name players who won a Champions League final.', {
    finalAppearance: { competition: 'Champions League', won: true },
  });
  addCandidate(candidates, 'Name players who scored in a World Cup final.', {
    finalAppearance: { competition: 'World Cup', scored: true },
  });
  addCandidate(candidates, 'Name players who won a World Cup final.', {
    finalAppearance: { competition: 'World Cup', won: true },
  });
  addCandidate(candidates, 'Name players who scored in a European Championship final.', {
    finalAppearance: { competition: 'Euro', scored: true },
  });
  addCandidate(candidates, 'Name players who won a European Championship final.', {
    finalAppearance: { competition: 'Euro', won: true },
  });

  for (const year of [2006, 2010, 2014, 2018, 2022, 2026]) {
    addCandidate(candidates, `Name players who scored at the ${year} World Cup.`, {
      worldCupScorerYear: year,
    });
  }

  for (const minimum of [2, 3, 5]) {
    addCandidate(candidates, `Name players with ${minimum}+ career hat-tricks.`, {
      minCareerHattricks: minimum,
    });
  }
  for (const minimum of [3, 5, 8, 10]) {
    addCandidate(
      candidates,
      `Name players with ${minimum}+ Champions League knockout goals.`,
      { minUclKnockoutGoals: minimum }
    );
  }

  // Club UCL scorers — broad career achievement, not nationality filters.
  for (const club of clubs.slice(0, 12)) {
    addCandidate(
      candidates,
      `Name players who played for ${club} and scored in the Champions League.`,
      { playedFor: [club], minUclGoals: 1 }
    );
  }

  let accepted = 0;
  let skipped = 0;
  for (const candidate of candidates.values()) {
    const validAnswers = await countValidPlayers(candidate.rule);
    const category = categoryFor(candidate.rule, candidate.prompt);
    const recallable = await countRecallablePlayers(candidate.rule);
    if (!qualityGates(category, validAnswers, recallable)) {
      skipped += 1;
      continue;
    }
    const sampleAnswers = await sampleFamousPlayers(candidate.rule, 8);
    const tier = recallable >= 24 ? 'easy' : recallable >= 14 ? 'medium' : 'hard';
    const difficulty = recallable >= 24 ? 25 : recallable >= 14 ? 50 : 72;

    if (!dry) {
      await db
        .insert(towerPrompts)
        .values({
          prompt: candidate.prompt,
          promptNorm: promptNorm(candidate.prompt),
          rule: candidate.rule,
          answerType: 'player',
          tier,
          difficulty,
          validAnswers,
          sampleAnswers,
          status: 'active',
        })
        .onConflictDoNothing();
    }
    accepted += 1;
    console.log(
      `${dry ? '[dry] ' : ''}${candidate.prompt} · ${validAnswers} answers · ${recallable} recognisable`
    );
  }

  console.log(
    `Golf template build complete: ${accepted} accepted, ${skipped} rejected by quality gates.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
