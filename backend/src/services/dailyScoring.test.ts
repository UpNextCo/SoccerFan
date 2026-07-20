import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clubChainXp,
  golfHoleXp,
  resolveCompletionScore,
  scoreFootballGolf,
} from './dailyScoring.js';

const holes = [2, 3, 3, 4, 4].map((par, index) => ({
  id: `hole-${index + 1}`,
  par,
  answers: Array.from({ length: 4 }, (_, answerIndex) => ({
    id: `player-${index + 1}-${answerIndex + 1}`,
    rarity: 'ultraRare',
  })),
}));

function answerAt(relativeToPar: number, courseHoles = holes) {
  return {
    holes: courseHoles.map((hole) => ({
      holeId: hole.id,
      matchedIds: [hole.answers[0]!.id],
      shots: hole.par + relativeToPar,
      skipped: false,
    })),
  };
}

test('Football Golf per-hole XP matches the five-hole client table', () => {
  assert.equal(golfHoleXp(-3), 160);
  assert.equal(golfHoleXp(-2), 160);
  assert.equal(golfHoleXp(-1), 130);
  assert.equal(golfHoleXp(0), 60);
  assert.equal(golfHoleXp(1), 25);
  assert.equal(golfHoleXp(2), 0);
});

test('Football Golf authoritative totals cap at 800', () => {
  const row = { puzzleJson: { holes }, answerJson: null };
  const eagleHoles = holes.map((hole) => ({ ...hole, par: 4 }));
  assert.deepEqual(
    scoreFootballGolf(
      { puzzleJson: { holes: eagleHoles }, answerJson: null },
      answerAt(-2, eagleHoles)
    ),
    { score: 800, won: true }
  );
  assert.deepEqual(scoreFootballGolf(row, answerAt(-1)), { score: 650, won: true });
  assert.deepEqual(scoreFootballGolf(row, answerAt(0)), { score: 300, won: true });
});

test('Football Golf scoring requires each canonical hole exactly once', () => {
  const row = { puzzleJson: { holes }, answerJson: null };
  const missing = answerAt(0);
  missing.holes.pop();
  assert.equal(scoreFootballGolf(row, missing), null);

  const duplicate = answerAt(0);
  duplicate.holes[4] = { ...duplicate.holes[0]! };
  assert.equal(scoreFootballGolf(row, duplicate), null);

  const incomplete = answerAt(0);
  incomplete.holes[0]!.matchedIds = [];
  assert.equal(scoreFootballGolf(row, incomplete), null);
});

test('Football Golf can still be won with a validated skip when the course total is par or better', () => {
  const answer = answerAt(-1);
  answer.holes[0] = {
    holeId: holes[0]!.id,
    matchedIds: [],
    shots: 4,
    skipped: true,
  };
  assert.deepEqual(
    scoreFootballGolf({ puzzleJson: { holes }, answerJson: null }, answer),
    { score: 520, won: true }
  );
});

test('malformed Football Golf answers are rejected instead of earning client-reported XP', async () => {
  const row = { puzzleJson: { holes }, answerJson: null };
  const fourHoles = answerAt(0);
  fourHoles.holes.pop();
  await assert.rejects(
    resolveCompletionScore('football_golf', row, {
      score: 800,
      won: true,
      answer: fourHoles,
    }),
    /Invalid Football Golf answer payload/
  );

  const duplicate = answerAt(0);
  duplicate.holes[4] = { ...duplicate.holes[0]! };
  await assert.rejects(
    resolveCompletionScore('football_golf', row, {
      score: 800,
      won: true,
      answer: duplicate,
    }),
    /Invalid Football Golf answer payload/
  );
});

test('legacy Football Golf completion without an answer still uses clamped fallback', async () => {
  assert.deepEqual(
    await resolveCompletionScore(
      'football_golf',
      { puzzleJson: { holes }, answerJson: null },
      { score: 999, won: true }
    ),
    { score: 800, won: true }
  );
});

test('Club Chain XP deducts 150 per wrong guess from medal base', () => {
  assert.equal(clubChainXp(true, 2, 2, 0), 1000);
  assert.equal(clubChainXp(true, 2, 2, 1), 850);
  assert.equal(clubChainXp(true, 2, 2, 2), 700);
  assert.equal(clubChainXp(true, 4, 2, 1), 600); // silver 750 - 150
  assert.equal(clubChainXp(false, 2, 2, 3), 0);
});
