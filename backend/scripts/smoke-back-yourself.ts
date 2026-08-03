/**
 * Quick smoke test for Back Yourself generator + XP.
 *   npx tsx scripts/smoke-back-yourself.ts [YYYY-MM-DD]
 */
import 'dotenv/config';
import {
  backYourselfXp,
  generateBackYourselfPuzzle,
  playerMatchesBackYourselfCategory,
  scoreBackYourself,
} from '../src/services/backYourselfGenerator.js';

async function main() {
  const date = process.argv[2] ?? '2026-08-10';

  console.log('XP formula checks:');
  for (const [pledge, maxPool] of [
    [20, 20],
    [18, 20],
    [15, 20],
    [10, 20],
    [1, 20],
  ] as const) {
    console.log(`  pledge=${pledge}/${maxPool} -> ${backYourselfXp(pledge, maxPool)} XP`);
  }
  console.log(
    'score lose:',
    scoreBackYourself({
      pledge: 10,
      namedPlayerIds: ['a'],
      mistakes: 3,
      maxPool: 20,
      validNamedCount: 1,
    })
  );
  console.log(
    'score short:',
    scoreBackYourself({
      pledge: 10,
      namedPlayerIds: ['a'],
      mistakes: 1,
      maxPool: 20,
      validNamedCount: 5,
    })
  );
  console.log(
    'score win:',
    scoreBackYourself({
      pledge: 10,
      namedPlayerIds: ['a'],
      mistakes: 1,
      maxPool: 20,
      validNamedCount: 10,
    })
  );

  console.log(`\nGenerating puzzle for ${date}...`);
  const t0 = Date.now();
  const result = await generateBackYourselfPuzzle(date);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!result) {
    console.error('NO PUZZLE');
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        label: result.puzzle.category.label,
        type: result.puzzle.category.type,
        maxPool: result.puzzle.maxPool,
        validIds: result.answer.validPlayerIds.length,
        mistakesAllowed: result.puzzle.mistakesAllowed,
      },
      null,
      2
    )
  );

  const sampleId = result.answer.validPlayerIds[0];
  const match = await playerMatchesBackYourselfCategory(sampleId, result.puzzle.category);
  console.log('sample player matches:', match, sampleId);

  // Wrong player: pick a random high-profile id unlikely to fit — just ensure false for empty uuid shape fails.
  // Use a second valid id from a different category if possible by checking a nonsense id.
  const nonsense = '00000000-0000-0000-0000-000000000001';
  const noMatch = await playerMatchesBackYourselfCategory(nonsense, result.puzzle.category);
  console.log('nonsense player matches:', noMatch);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
