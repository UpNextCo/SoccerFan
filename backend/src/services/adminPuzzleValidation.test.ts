import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePuzzleReport } from './adminPuzzleValidation.js';
import { monthLockStatusError, workflowTransitionError } from './adminWorkflow.js';
import { oneMoreEligibilityErrors } from './oneMoreEligibility.js';
import { validateQuestionTemplateActivation } from './questionTemplateValidation.js';
import { towerRuleSchema } from './towerRuleSchema.js';
import {
  buildGolfHoleFromEvaluation,
  dedupeGolfPlayers,
  golfPromptCopy,
  golfQualityWarnings,
  suggestGolfPar,
  type GolfRuleEvaluation,
} from './footballGolfGenerator.js';
import { compareGolfAnswerIds } from './adminGolfAuthoring.js';

test('requires the persisted 4x4 Bingo contract', () => {
  const categories = Array.from({ length: 16 }, (_, index) => ({
    id: `category-${index}`,
    title: `Category ${index}`,
    type: 'nationality',
    matchingRule: `Nation ${index}`,
  }));
  const players = Array.from({ length: 16 }, (_, index) => ({
    id: `player-${index}`,
    name: `Player ${index}`,
    nationality: `Nation ${index}`,
    position: 'Forward',
    clubs: [],
    leagues: [],
    trophies: [],
    awards: [],
    stats: {},
  }));
  assert.equal(validatePuzzleReport('football_bingo', { categories, players }, null).ok, true);
  assert.equal(validatePuzzleReport(
    'football_bingo',
    { categories: categories.slice(0, 9), players: players.slice(0, 9) },
    null
  ).ok, false);
});

test('enforces generated -> approved -> locked while preserving unlocks', () => {
  assert.equal(workflowTransitionError('generated', 'approved'), null);
  assert.equal(workflowTransitionError('approved', 'locked'), null);
  assert.match(workflowTransitionError('generated', 'locked') ?? '', /Invalid workflow transition/);
  assert.equal(workflowTransitionError('locked', 'generated'), null);
  assert.equal(workflowTransitionError('approved', 'generated'), null);
  assert.match(monthLockStatusError('generated') ?? '', /must be approved/);
  assert.equal(monthLockStatusError('approved'), null);
  assert.equal(monthLockStatusError('locked'), null);
});

test('applies One More participation, goalkeeper, and event coverage gates', () => {
  assert.deepEqual(oneMoreEligibilityErrors(
    { goalLike: false },
    { participation: 0, position: 'Forward', birthYear: 1995, value: 10 },
    20
  ), ['Player has no participation for this metric.']);
  assert.deepEqual(oneMoreEligibilityErrors(
    { goalLike: true },
    { participation: 1, position: 'Goalkeeper', birthYear: 1995, value: 30 },
    20
  ), ['Goalkeepers are not eligible for this goal-like metric.']);
  assert.deepEqual(oneMoreEligibilityErrors(
    { goalLike: true, eventBased: true },
    { participation: 1, position: 'Forward', birthYear: 1989, value: 10 },
    20
  ), ['Distractor is outside the covered era for this event-based metric.']);
  assert.deepEqual(oneMoreEligibilityErrors(
    { goalLike: true, eventBased: true },
    { participation: 1, position: 'Forward', birthYear: 1989, value: 20 },
    20
  ), []);
});

test('validates active One More template configuration', () => {
  const metrics = new Set(['pl_goals']);
  assert.deepEqual(validateQuestionTemplateActivation({
    mode: 'one_more',
    config: { metricId: 'pl_goals', threshold: 20, valueNoun: 'goals' },
  }, metrics), { ok: true });
  assert.equal(validateQuestionTemplateActivation({
    mode: 'one_more',
    config: { metricId: 'unknown', threshold: 20, valueNoun: 'goals' },
  }, metrics).ok, false);
  assert.equal(validateQuestionTemplateActivation({
    mode: 'one_more',
    config: { metricId: 'pl_goals', threshold: 20 },
  }, metrics).ok, false);
  assert.equal(validateQuestionTemplateActivation({
    mode: 'football_bingo',
    config: {},
  }, metrics).ok, false);
});

test('validates a complete aligned LMS payload', () => {
  const questions = Array.from({ length: 10 }, (_, index) => {
    const questionId = `q-${index + 1}`;
    const type = index === 0 ? 'higher_lower' : 'odd_one_out';
    const count = type === 'higher_lower' ? 2 : 4;
    return {
      id: questionId,
      type,
      slot: index + 1,
      prompt: `Question ${index + 1}`,
      options: Array.from({ length: count }, (__, optionIndex) => ({
        id: `${questionId}-o${optionIndex + 1}`,
        label: `Option ${optionIndex + 1}`,
      })),
    };
  });
  const answer = {
    questions: questions.map((question) => ({
      questionId: question.id,
      correctOptionId: question.options[0]!.id,
    })),
  };
  assert.equal(validatePuzzleReport('last_man_standing', { questions }, answer).ok, true);

  questions[1]!.options.pop();
  const report = validatePuzzleReport('last_man_standing', { questions }, answer);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((entry) => entry.path === 'puzzleJson.questions.1.options'));
});

test('requires One More threshold sides and aligned hidden values', () => {
  const rounds = Array.from({ length: 10 }, (_, index) => ({
    options: [
      { id: `above-${index}`, name: 'Above', value: 11 },
      { id: `below-${index}`, name: 'Below', value: 9 },
    ],
  }));
  const valuesByRound = rounds.map((round) => Object.fromEntries(
    round.options.map((option) => [option.id, option.value])
  ));
  const puzzle = {
    metricId: 'metric',
    minimum: 10,
    title: 'Test metric',
    valueNoun: 'goals',
    rounds,
  };
  assert.equal(validatePuzzleReport('one_more', puzzle, { valuesByRound }).ok, true);

  valuesByRound[3]![`below-3`] = 12;
  const report = validatePuzzleReport('one_more', puzzle, { valuesByRound });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((entry) => entry.path === 'puzzleJson.rounds.3'));
});

test('checks Golf numbering, answer sufficiency, and total par', () => {
  const holes = Array.from({ length: 9 }, (_, index) => ({
    holeNumber: index + 1,
    prompt: `Hole ${index + 1}`,
    par: 2,
    target: 2,
    answers: [
      { id: `p-${index}-1`, name: 'Player A' },
      { id: `p-${index}-2`, name: 'Player B' },
    ],
  }));
  assert.equal(validatePuzzleReport('football_golf', { totalPar: 18, holes }, null).ok, true);
  assert.equal(
    validatePuzzleReport(
      'football_golf',
      { totalPar: 18, holes: holes.map((hole) => ({ ...hole, rule: {} })) },
      null
    ).ok,
    true
  );
  const duplicateTemplate = '00000000-0000-4000-8000-000000000001';
  assert.equal(
    validatePuzzleReport(
      'football_golf',
      {
        totalPar: 18,
        holes: holes.map((hole, index) => ({
          ...hole,
          ...(index < 2 ? { templateId: duplicateTemplate } : {}),
        })),
      },
      null
    ).ok,
    false
  );
  assert.equal(validatePuzzleReport('football_golf', { totalPar: 20, holes }, null).ok, false);
});

test('accepts only declarative closed Tower rule fields', () => {
  assert.equal(towerRuleSchema.safeParse({ playedFor: ['Arsenal', 'Chelsea'] }).success, true);
  assert.equal(towerRuleSchema.safeParse({ sql: 'SELECT * FROM players' }).success, false);
  assert.equal(towerRuleSchema.safeParse({}).success, false);
  assert.equal(towerRuleSchema.safeParse({
    validIds: ['00000000-0000-4000-8000-000000000001'],
    minPlApps: 1,
  }).success, false);
  assert.equal(towerRuleSchema.safeParse({
    validIds: ['not-a-uuid'],
  }).success, false);
});

test('uses plural player-facing Golf prompt copy', () => {
  assert.equal(
    golfPromptCopy('Name a player who scored in a Champions League final.'),
    'Name players who scored in a Champions League final.'
  );
  assert.equal(
    golfPromptCopy('Name a Brazilian who has played in the Premier League.'),
    'Name Brazilian players who have played in the Premier League.'
  );
  assert.equal(
    golfPromptCopy('Name a Champions League winner.'),
    'Name Champions League winners.'
  );
});

test('dedupes Golf names and derives bounded authoring output', () => {
  const players = [
    { id: 'a', name: 'José Reyes', mvt: 4, pl: 30, big5: 80, ucl: 5, total: 100, finals: 0, awards: 0 },
    { id: 'b', name: 'Jose Reyes', mvt: 2, pl: 5, big5: 20, ucl: 0, total: 40, finals: 0, awards: 0 },
  ];
  const deduped = dedupeGolfPlayers(players);
  assert.equal(deduped.players.length, 1);
  assert.equal(deduped.players[0]!.id, 'a');
  assert.equal(deduped.removed, 1);
  assert.equal(suggestGolfPar(8), 2);
  assert.equal(suggestGolfPar(9), 3);
  assert.equal(suggestGolfPar(12), 4);
  assert.ok(golfQualityWarnings('Played for both clubs', 'Clubs', {
    total: 2,
    nameable: 2,
    duplicateNamesRemoved: 1,
  }).length >= 2);

  const evaluation: GolfRuleEvaluation = {
    prompt: 'Played for both Arsenal and Chelsea',
    rule: { playedFor: ['Arsenal', 'Chelsea'] },
    category: 'Clubs',
    answers: [{ id: 'a', name: 'Player A', aliases: [], rarity: 'common' }],
    hints: [],
    counts: {
      total: 1,
      nameable: 1,
      duplicateNamesRemoved: 0,
      rarity: { common: 1, uncommon: 0, rare: 0, ultraRare: 0 },
    },
    qualityWarnings: [],
    suggestedPar: 2,
    suggestedTarget: 2,
  };
  const hole = buildGolfHoleFromEvaluation(evaluation, {
    holeNumber: 3,
    holeId: 'custom-hole',
    templateId: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(hole.id, 'custom-hole');
  assert.deepEqual(hole.rule, evaluation.rule);
  assert.equal(hole.templateId, '00000000-0000-4000-8000-000000000001');
});

test('compares stored Golf answer ids exactly', () => {
  assert.deepEqual(compareGolfAnswerIds(['a', 'b'], ['b', 'a']), {
    valid: true,
    expectedCount: 2,
    storedCount: 2,
    missingAnswerIds: [],
    staleAnswerIds: [],
  });
  assert.deepEqual(compareGolfAnswerIds(['a', 'b'], ['a', 'c']), {
    valid: false,
    expectedCount: 2,
    storedCount: 2,
    missingAnswerIds: ['b'],
    staleAnswerIds: ['c'],
  });
});

test('checks Club Chain endpoint and length synchronization', () => {
  const puzzle = {
    start: { id: 'start', name: 'Start' },
    target: { id: 'target', name: 'Target' },
    shortestPathLength: 2,
    maxMoves: 6,
  };
  const answer = {
    shortestPathPlayerIds: ['start', 'middle', 'target'],
    shortestPathLength: 2,
  };
  assert.equal(validatePuzzleReport('club_chain', puzzle, answer).ok, true);
  answer.shortestPathPlayerIds[2] = 'other';
  assert.equal(validatePuzzleReport('club_chain', puzzle, answer).ok, false);
});

test('checks Target Man answer synchronization', () => {
  const puzzle = {
    categoryId: 'pl-goals',
    categoryLabel: 'Premier League goals',
    title: 'Premier League goals',
    target: 500,
    valueNoun: 'goals',
    offNoun: 'goals',
    unit: null,
  };
  const answer = {
    modeId: 'target_man',
    answer: { categoryId: 'pl-goals', target: 500 },
  };
  assert.equal(validatePuzzleReport('target_man', puzzle, answer).ok, true);
  answer.answer.target = 501;
  assert.equal(validatePuzzleReport('target_man', puzzle, answer).ok, false);
});
