/**
 * Quick smoke test for Back Yourself generator + XP.
 *   npx tsx scripts/smoke-back-yourself.ts [YYYY-MM-DD]
 */
import 'dotenv/config';
import {
  backYourselfXp,
  backYourselfXpCap,
  clearBackYourselfCandidateCache,
  generateBackYourselfPuzzle,
  playerMatchesBackYourselfCategory,
  scoreBackYourself,
} from '../src/services/backYourselfGenerator.js';

async function main() {
  const date = process.argv[2] ?? '2026-08-10';

  console.log('XP formula checks (xpCap=40):');
  for (const [pledge, xpCap] of [
    [40, 40],
    [80, 40],
    [30, 40],
    [20, 40],
    [10, 40],
    [1, 40],
  ] as const) {
    console.log(`  pledge=${pledge} xpCap=${xpCap} -> ${backYourselfXp(pledge, xpCap)} XP`);
  }
  console.log('xpCap helpers:', { pool20: backYourselfXpCap(20), pool80: backYourselfXpCap(80) });
  console.log(
    'score lose:',
    scoreBackYourself({
      pledge: 10,
      namedPlayerIds: ['a'],
      mistakes: 3,
      maxPool: 80,
      xpCap: 40,
      validNamedCount: 1,
    })
  );
  console.log(
    'score short:',
    scoreBackYourself({
      pledge: 10,
      namedPlayerIds: ['a'],
      mistakes: 1,
      maxPool: 80,
      xpCap: 40,
      validNamedCount: 5,
    })
  );
  console.log(
    'score win at cap:',
    scoreBackYourself({
      pledge: 40,
      namedPlayerIds: ['a'],
      mistakes: 1,
      maxPool: 80,
      xpCap: 40,
      validNamedCount: 40,
    })
  );
  console.log(
    'score win past cap (same XP):',
    scoreBackYourself({
      pledge: 60,
      namedPlayerIds: ['a'],
      mistakes: 1,
      maxPool: 80,
      xpCap: 40,
      validNamedCount: 60,
    })
  );

  clearBackYourselfCandidateCache();
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
        xpCap: result.puzzle.xpCap,
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

  const nonsense = '00000000-0000-0000-0000-000000000001';
  const noMatch = await playerMatchesBackYourselfCategory(nonsense, result.puzzle.category);
  console.log('nonsense player matches:', noMatch);

  // Sample a few more dates for type diversity.
  console.log('\nSample week:');
  for (let d = 10; d <= 16; d += 1) {
    const day = `2026-08-${String(d).padStart(2, '0')}`;
    const r = await generateBackYourselfPuzzle(day);
    if (!r) {
      console.log(day, 'NONE');
      continue;
    }
    console.log(
      day,
      r.puzzle.category.type.padEnd(18),
      String(r.puzzle.maxPool).padStart(3),
      `cap=${r.puzzle.xpCap}`,
      r.puzzle.category.label
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
