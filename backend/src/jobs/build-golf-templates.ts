/**
 * Expand the Golf question bank with deterministic, database-verifiable prompts.
 *
 * This deliberately creates narrower intersections (clubs, nationalities, positions,
 * and stat thresholds) so Golf gains variety without shipping 100+ answer lists.
 *
 * Usage:
 *   npm run job:build-golf-templates
 *   npm run job:build-golf-templates -- --dry
 */
import 'dotenv/config';
import { db } from '../db/index.js';
import { towerPrompts } from '../db/schema.js';
import {
  countRecallablePlayers,
  countValidPlayers,
  sampleFamousPlayers,
  towerVocab,
  type TowerRule,
} from '../services/towerRules.js';
import { golfPromptCopy } from '../services/footballGolfGenerator.js';

interface Candidate {
  prompt: string;
  rule: TowerRule;
}

function promptNorm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addCandidate(
  target: Map<string, Candidate>,
  prompt: string,
  rule: TowerRule
): void {
  const copy = golfPromptCopy(prompt);
  target.set(promptNorm(copy), { prompt: copy, rule });
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const vocab = await towerVocab();
  const clubs = vocab.clubs.slice(0, 18);
  const nationalities = vocab.nationalities.slice(0, 24);
  const candidates = new Map<string, Candidate>();

  for (let first = 0; first < clubs.length; first += 1) {
    for (let second = first + 1; second < clubs.length; second += 1) {
      const a = clubs[first]!;
      const b = clubs[second]!;
      addCandidate(candidates, `Name players who played for both ${a} and ${b}.`, {
        playedFor: [a, b],
      });
    }
  }

  for (const nationality of nationalities) {
    addCandidate(
      candidates,
      `Name ${nationality} players who played in the Premier League.`,
      { nationality, leaguePlayed: 'Premier League' }
    );
    for (const minimum of [25, 50, 100]) {
      addCandidate(
        candidates,
        `Name ${nationality} players with ${minimum}+ Premier League appearances.`,
        { nationality, minPlApps: minimum }
      );
    }
    addCandidate(
      candidates,
      `Name ${nationality} players who won the Champions League.`,
      { nationality, uclWinner: true }
    );
  }

  for (const club of clubs) {
    addCandidate(candidates, `Name goalkeepers who played for ${club}.`, {
      position: 'Goalkeeper',
      playedFor: [club],
    });
    addCandidate(candidates, `Name defenders who played for ${club}.`, {
      position: 'Defender',
      playedFor: [club],
    });
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
    if (validAnswers < 8 || validAnswers > 100) {
      skipped += 1;
      continue;
    }
    const recallable = await countRecallablePlayers(candidate.rule);
    if (recallable < 8) {
      skipped += 1;
      continue;
    }
    const sampleAnswers = await sampleFamousPlayers(candidate.rule, 8);
    const tier = recallable >= 20 ? 'easy' : recallable >= 12 ? 'medium' : 'hard';
    const difficulty = recallable >= 20 ? 25 : recallable >= 12 ? 50 : 72;

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
