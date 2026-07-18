import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePuzzleReport } from './adminPuzzleValidation.js';
import { monthLockStatusError, workflowTransitionError } from './adminWorkflow.js';
import { oneMoreEligibilityErrors } from './oneMoreEligibility.js';
import { validateQuestionTemplateActivation } from './questionTemplateValidation.js';
import { towerRuleSchema } from './towerRuleSchema.js';
import {
  buildGolfHoleFromEvaluation,
  categoryFor,
  dedupeGolfPlayers,
  golfCourseSlotFor,
  golfPromptCopy,
  golfPromptPriority,
  golfQualityWarnings,
  golfRuleCandidateAllowed,
  isDullFilterGolfRule,
  isGeographyHeavyGolfRule,
  minNameableForGolfCategory,
  suggestGolfPar,
  PAR_SEQUENCE,
  type GolfRuleEvaluation,
} from './footballGolfGenerator.js';
import {
  FOOTBALL_GOLF_HOLE_COUNT,
  FOOTBALL_GOLF_REQUIRED_RULE_INVENTORY,
} from './footballGolfConstants.js';
import {
  compareGolfAnswerIds,
  dedupeAdminGolfTemplates,
  type AdminGolfTemplate,
} from './adminGolfAuthoring.js';
import { summarizeGolfPlayerNames } from './adminDraftValidation.js';
import { golfRuleSignature, golfRulesSemanticallyEqual } from './golfRuleSignature.js';
import { sanitizePublicPuzzle } from './dailyService.js';

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
  const duplicatedPlayers = players.map((player, index) =>
    index === 15 ? { ...player, id: players[0]!.id, name: players[0]!.name } : player
  );
  const duplicateReport = validatePuzzleReport(
    'football_bingo',
    { categories, players: duplicatedPlayers },
    null
  );
  assert.equal(duplicateReport.ok, false);
  assert.match(
    duplicateReport.issues.find((entry) => entry.path === 'puzzleJson.players')?.message ?? '',
    /Player 0 appears in pool positions 1, 16/
  );
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

test('validates authored LMS custom images and aligned text options', () => {
  const questions = Array.from({ length: 10 }, (_, index) => {
    const questionId = `custom-q-${index + 1}`;
    const custom = index === 2;
    return {
      id: questionId,
      type: custom ? 'custom_image' : 'odd_one_out',
      slot: index + 1,
      prompt: `Question ${index + 1}`,
      options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label, optionIndex) => ({
        id: `${questionId}-o${optionIndex + 1}`,
        label,
      })),
      ...(custom
        ? {
            presentation: {
              layout: 'image_header',
              imageUrl: 'https://ballknowledge-production.up.railway.app/media/00000000-0000-4000-8000-000000000001',
              imageBlur: 0,
            },
          }
        : {}),
    };
  });
  const answer = {
    questions: questions.map((question) => ({
      questionId: question.id,
      correctOptionId: question.options[0]!.id,
    })),
  };
  assert.equal(validatePuzzleReport('last_man_standing', { questions }, answer).ok, true);
  questions[2]!.presentation!.imageBlur = 4;
  assert.equal(validatePuzzleReport('last_man_standing', { questions }, answer).ok, false);
  questions[2]!.presentation!.imageBlur = 0;
  questions[2]!.options[1]!.label = ' Alpha ';
  assert.equal(validatePuzzleReport('last_man_standing', { questions }, answer).ok, false);
});

test('validates authored LMS custom questions with one selected player answer', () => {
  const questions = Array.from({ length: 10 }, (_, index) => {
    const questionId = `text-q-${index + 1}`;
    const custom = index === 2;
    return {
      id: questionId,
      type: custom ? 'custom_question' : 'odd_one_out',
      slot: index + 1,
      prompt: custom
        ? 'What Arsenal goalkeeper suffered a fractured skull in 2006?'
        : `Question ${index + 1}`,
      options: custom
        ? [{
            id: `${questionId}-00000000-0000-4000-8000-000000000001`,
            label: 'Petr Cech',
          }]
        : ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label, optionIndex) => ({
            id: `${questionId}-o${optionIndex + 1}`,
            label,
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

  questions[2]!.options[0]!.id = 'text-q-3-choose-player';
  const report = validatePuzzleReport('last_man_standing', { questions }, answer);
  assert.equal(report.ok, false);
  assert.match(
    report.issues.find((entry) => entry.path.endsWith('.options.0'))?.message ?? '',
    /Choose the correct player/
  );
});

test('hides custom LMS text answers from the public daily bundle', () => {
  const puzzle = {
    questions: [
      {
        id: 'q-1',
        type: 'custom_question',
        prompt: 'Who is the player?',
        options: [{ id: 'q-1-player-id', label: 'Hidden answer' }],
      },
      {
        id: 'q-2',
        type: 'odd_one_out',
        prompt: 'Which player is different?',
        options: [{ id: 'q-2-a', label: 'Visible choice' }],
      },
    ],
  };
  const sanitized = sanitizePublicPuzzle('last_man_standing', puzzle) as typeof puzzle;
  assert.deepEqual(sanitized.questions[0]!.options, []);
  assert.deepEqual(sanitized.questions[1]!.options, puzzle.questions[1]!.options);
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
  const holes = Array.from({ length: FOOTBALL_GOLF_HOLE_COUNT }, (_, index) => ({
    holeNumber: index + 1,
    prompt: `Hole ${index + 1}`,
    par: 2,
    target: 2,
    answers: [
      { id: `p-${index}-1`, name: 'Player A' },
      { id: `p-${index}-2`, name: 'Player B' },
    ],
  }));
  assert.equal(validatePuzzleReport('football_golf', { totalPar: 10, holes }, null).ok, true);
  assert.equal(
    validatePuzzleReport(
      'football_golf',
      { totalPar: 10, holes: holes.map((hole) => ({ ...hole, rule: {} })) },
      null
    ).ok,
    true
  );
  const duplicateTemplate = '00000000-0000-4000-8000-000000000001';
  assert.equal(
    validatePuzzleReport(
      'football_golf',
      {
        totalPar: 10,
        holes: holes.map((hole, index) => ({
          ...hole,
          ...(index < 2 ? { templateId: duplicateTemplate } : {}),
        })),
      },
      null
    ).ok,
    false
  );
  assert.equal(validatePuzzleReport('football_golf', { totalPar: 12, holes }, null).ok, false);
  assert.equal(validatePuzzleReport('football_golf', { totalPar: 8, holes: holes.slice(0, 4) }, null).ok, false);
  assert.equal(validatePuzzleReport(
    'football_golf',
    {
      totalPar: 12,
      holes: [...holes, { ...holes[0]!, holeNumber: 6, prompt: 'Sixth hole' }],
    },
    null
  ).ok, false);
});

test('canonicalizes Golf rule signatures and keeps executable changes distinct', () => {
  const equivalentA = {
    label: 'First label',
    playedFor: ['Bayern München', 'Arsenal'],
    nationality: 'Côte d’Ivoire',
    minPlApps: 20,
  };
  const equivalentB = {
    minPlApps: 20,
    nationality: 'côte d’ivoire',
    playedFor: ['Arsenal', 'Bayern München'],
    label: 'Different non-semantic label',
  };
  assert.equal(golfRuleSignature(equivalentA), golfRuleSignature(equivalentB));
  assert.notEqual(
    golfRuleSignature(equivalentA),
    golfRuleSignature({ ...equivalentA, minPlApps: 21 })
  );
  assert.notEqual(
    golfRuleSignature(equivalentA),
    golfRuleSignature({ ...equivalentA, playedFor: ['Chelsea', 'Arsenal'] })
  );
  assert.notEqual(
    golfRuleSignature(equivalentA),
    golfRuleSignature({ ...equivalentA, playedFor: ['Bayern Munchen', 'Arsenal'] })
  );
});

test('summarizes Golf answer names without exposing player ids', () => {
  assert.equal(
    summarizeGolfPlayerNames(['One', 'Two', 'Three']),
    'One, Two, Three'
  );
  assert.equal(
    summarizeGolfPlayerNames(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']),
    'One, Two, Three, Four, Five, Six, and 2 more'
  );
});

test('detects semantic Golf rule changes but ignores label-only edits', () => {
  const original = { label: 'Original', playedFor: ['Arsenal', 'Chelsea'], minPlApps: 10 };
  assert.equal(
    golfRulesSemanticallyEqual(
      original,
      { label: 'New wording', minPlApps: 10, playedFor: ['Chelsea', 'Arsenal'] }
    ),
    true
  );
  assert.equal(golfRulesSemanticallyEqual(original, { ...original, minPlApps: 11 }), false);
});

test('rejects duplicate structured Golf rules across differently worded holes', () => {
  const holes = Array.from({ length: FOOTBALL_GOLF_HOLE_COUNT }, (_, index) => ({
    holeNumber: index + 1,
    prompt: `Hole ${index + 1}`,
    par: 2,
    target: 2,
    answers: [
      { id: `p-${index}-1`, name: 'Player A' },
      { id: `p-${index}-2`, name: 'Player B' },
    ],
    rule: index === 0
      ? { playedFor: ['Arsenal', 'Bayern München'] }
      : index === 1
        ? { label: 'Other wording', playedFor: ['Bayern München', 'Arsenal'] }
        : { minPlApps: index + 1 },
  }));
  const report = validatePuzzleReport('football_golf', { totalPar: 10, holes }, null);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((entry) => /structured Golf rule/.test(entry.message)));
});

test('filters Golf candidate rules against recent and same-course signatures', () => {
  const rule = { playedFor: ['Arsenal', 'Chelsea'] };
  const signature = golfRuleSignature(rule);
  assert.equal(golfRuleCandidateAllowed(rule, new Set(), new Set()), true);
  assert.equal(golfRuleCandidateAllowed(rule, new Set([signature]), new Set()), false);
  assert.equal(golfRuleCandidateAllowed(rule, new Set(), new Set([signature])), false);
});

test('uses the canonical five-hole par sequence and 28-day rule inventory', () => {
  assert.equal(FOOTBALL_GOLF_HOLE_COUNT, 5);
  assert.deepEqual(PAR_SEQUENCE, [2, 3, 3, 4, 4]);
  assert.equal(PAR_SEQUENCE.reduce((sum, par) => sum + par, 0), 16);
  assert.equal(FOOTBALL_GOLF_REQUIRED_RULE_INVENTORY, 145);
});

test('dedupes Golf templates by rule and chooses the deterministic best representative', () => {
  const template = (
    id: string,
    input: Partial<AdminGolfTemplate> = {}
  ): AdminGolfTemplate => {
    const rule = input.rule ?? { playedFor: ['Arsenal', 'Chelsea'] };
    return {
      id,
      prompt: input.prompt ?? 'Prompt',
      rule,
      ruleSignature: golfRuleSignature(rule),
      category: input.category ?? 'Clubs',
      tier: 'standard',
      difficulty: input.difficulty ?? 2,
      validAnswers: input.validAnswers ?? 20,
      sampleAnswers: [],
      usedCount: input.usedCount ?? 0,
      lastUsedDate: null,
    };
  };
  const preferred = template('b', { prompt: 'Preferred', usedCount: 1 });
  const rows = dedupeAdminGolfTemplates([
    template('a', { prompt: 'Overused', usedCount: 3 }),
    template('d', { prompt: 'Too narrow', validAnswers: 6, usedCount: 0 }),
    preferred,
    template('c', {
      rule: { playedFor: ['Liverpool', 'Chelsea'] },
      prompt: 'Different rule',
    }),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.id === preferred.id));
  assert.ok(!rows.some((row) => row.id === 'a'));
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

test('classifies fun Golf prompts and demotes geography filters', () => {
  assert.equal(
    categoryFor(
      { seasonStat: { leagueId: 39, season: 2023, metric: 'goals', minimum: 1 } },
      'Name players who scored in the 2023/24 Premier League season.'
    ),
    'Seasons'
  );
  assert.equal(
    categoryFor({ clubSeason: { club: 'Leicester', season: 2015 } }, 'Name players who appeared for Leicester in 2015/16.'),
    'Club Eras'
  );
  assert.equal(
    categoryFor({ nonEuropean: true, leaguePlayed: 'Ligue 1', uclWinner: true }, 'Name non-European players who have played in Ligue 1.'),
    'Nationality'
  );
  assert.equal(
    isGeographyHeavyGolfRule({ nationality: 'Senegal', leaguePlayed: 'Premier League' }),
    true
  );
  assert.equal(
    isGeographyHeavyGolfRule({
      seasonStat: { leagueId: 39, season: 2023, metric: 'goals', minimum: 1 },
    }),
    false
  );
  assert.equal(
    isDullFilterGolfRule({ minPlYellowCards: 50, position: 'Defender' }),
    true
  );
  assert.equal(
    isDullFilterGolfRule({ playedFor: ['Arsenal', 'Chelsea'] }),
    false
  );
  assert.equal(golfCourseSlotFor('Seasons'), 'moment');
  assert.equal(golfCourseSlotFor('Club Eras'), 'clubEra');
  assert.equal(golfCourseSlotFor('Clubs'), 'journey');
  assert.ok(
    golfPromptPriority('Seasons', {
      seasonStat: { leagueId: 39, season: 2023, metric: 'goals', minimum: 1 },
    }) < golfPromptPriority('Nationality', { nationality: 'Senegal', leaguePlayed: 'Premier League' })
  );
  assert.equal(minNameableForGolfCategory('Seasons', 'Name players who scored.'), 12);
  assert.equal(minNameableForGolfCategory('Transfers', 'Name players who moved.'), 8);
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
  assert.equal(
    golfPromptCopy('Name a Swiss footballer who has played in the Premier League.'),
    'Name Swiss players who have played in the Premier League.'
  );
  assert.equal(
    golfPromptCopy('Name a goalkeeper who has played in La Liga.'),
    'Name goalkeepers who have played in La Liga.'
  );
  assert.equal(
    golfPromptCopy('Name defenders who have played in La Liga and has won the Champions League.'),
    'Name defenders who have played in La Liga and have won the Champions League.'
  );
  assert.equal(
    golfPromptCopy('Name a footballer whose record transfer fee is at least €60 million.'),
    'Name players whose record transfer fee is at least €60 million.'
  );
  assert.equal(
    golfPromptCopy(
      'Name a footballer whose record transfer fee is at least €60 million and has played in the Bundesliga.'
    ),
    'Name players whose record transfer fee is at least €60 million and have played in the Bundesliga.'
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
  const qualityWarnings = golfQualityWarnings('Played for both clubs', 'Clubs', {
    total: 2,
    nameable: 2,
    duplicateNamesRemoved: 1,
  });
  assert.equal(qualityWarnings.length, 1);
  assert.ok(qualityWarnings.every((warning) => !warning.includes('duplicate display-name')));

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
    categoryId: 'pl_goals',
    categoryLabel: 'Premier League Goals',
    title: 'Premier League Goals',
    target: 500,
    valueNoun: 'goals',
    offNoun: 'goals off',
    unit: null,
  };
  const answer = {
    modeId: 'target_man',
    answer: { categoryId: 'pl_goals', target: 500 },
  };
  assert.equal(validatePuzzleReport('target_man', puzzle, answer).ok, true);
  answer.answer.target = 501;
  assert.equal(validatePuzzleReport('target_man', puzzle, answer).ok, false);
});
