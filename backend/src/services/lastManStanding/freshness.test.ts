import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLMSGenerationMetadata,
  collectLMSHistoryUsedKeys,
  extractLMSUsedKeys,
  groupLMSBankRowsBySignature,
  includeLMSUsedKeyForWindow,
  lmsContentSignature,
  lmsSignatureUsedKey,
  summarizeLMSBankInventory,
} from './freshness.js';
import type {
  LMSQuestionAnswer,
  LMSQuestionPublic,
  LastManStandingAnswer,
  LastManStandingPuzzle,
} from './types.js';

function careerCard(
  id: string,
  labels: string[],
  correctIndex: number,
  path = ['Ajax', 'Juventus', 'Inter Milan']
): { question: LMSQuestionPublic; answer: LMSQuestionAnswer } {
  const options = labels.map((label, index) => ({ id: `${id}-player-${index}`, label }));
  return {
    question: {
      id,
      type: 'career_path',
      slot: 3,
      prompt: ' Who is this PLAYER? ',
      subPrompt: 'Club career path',
      options,
      presentation: {
        layout: 'stack',
        careerClubs: path.map((name, index) => ({
          name,
          logoUrl: `https://cdn.example/${index}?cache=changed`,
        })),
      },
    },
    answer: {
      questionId: id,
      correctOptionId: options[correctIndex]!.id,
    },
  };
}

test('semantic signature ignores remapped IDs, slot and option order', () => {
  const first = careerCard('2026-01-01-lms-q3', ['Zlatan Ibrahimović', 'Kaká', 'Pirlo', 'Nedvěd'], 0);
  const second = careerCard('bank-arbitrary', ['Pirlo', 'Zlatan Ibrahimovic', 'Nedved', 'Kaka'], 1);
  second.question.slot = 10;
  second.question.signature = true;

  assert.equal(
    lmsContentSignature(first.question, first.answer),
    lmsContentSignature(second.question, second.answer)
  );
});

test('semantic signature changes for a different option pair or career path', () => {
  const base = careerCard('q1', ['Player A', 'Player B', 'Player C', 'Player D'], 0);
  const changedPair = careerCard('q2', ['Player A', 'Player X', 'Player C', 'Player D'], 0);
  const changedPath = careerCard(
    'q3',
    ['Player A', 'Player B', 'Player C', 'Player D'],
    0,
    ['Ajax', 'Barcelona', 'Inter Milan']
  );

  const signature = lmsContentSignature(base.question, base.answer);
  assert.notEqual(signature, lmsContentSignature(changedPair.question, changedPair.answer));
  assert.notEqual(signature, lmsContentSignature(changedPath.question, changedPath.answer));
});

test('semantic signature ignores media URL, blur and layout enrichment', () => {
  const first = careerCard('q1', ['A', 'B', 'C', 'D'], 0);
  const second = careerCard('q2', ['A', 'B', 'C', 'D'], 0);
  first.question.presentation = {
    ...first.question.presentation,
    layout: 'stack',
    imageUrl: 'https://cdn.example/old.png?token=one',
    imageBlur: 12,
  };
  second.question.presentation = {
    ...second.question.presentation,
    layout: 'grid',
    imageUrl: 'https://other.example/new.webp',
    imageBlur: 80,
  };
  assert.equal(
    lmsContentSignature(first.question, first.answer),
    lmsContentSignature(second.question, second.answer)
  );
});

test('exact signatures use the long window while broad resource keys use the short window', () => {
  assert.equal(includeLMSUsedKeyForWindow('lms:signature:lms2_abc', false), true);
  assert.equal(includeLMSUsedKeyForWindow('club:arsenal', false), false);
  assert.equal(includeLMSUsedKeyForWindow('club:arsenal', true), true);
  assert.equal(includeLMSUsedKeyForWindow('player:abc', true), true);
});

test('history collection retains old exact signatures but drops old broad keys', () => {
  const makeRow = (date: string, suffix: string) => {
    const id = `${date}-lms-q1`;
    const question: LMSQuestionPublic = {
      id,
      type: 'higher_lower',
      slot: 1,
      prompt: 'More Premier League goals?',
      options: [
        { id: `${id}-player-${suffix}-a`, label: `Player ${suffix} A` },
        { id: `${id}-player-${suffix}-b`, label: `Player ${suffix} B` },
      ],
    };
    const questionAnswer: LMSQuestionAnswer = {
      questionId: id,
      correctOptionId: question.options[0]!.id,
    };
    return {
      date,
      puzzleJson: {
        modeId: 'last_man_standing',
        puzzleId: `${date}-last_man_standing`,
        date,
        title: 'Last Man Standing',
        version: 10,
        questions: [question],
      } satisfies LastManStandingPuzzle,
      answerJson: { questions: [questionAnswer] } satisfies LastManStandingAnswer,
      signature: lmsContentSignature(question, questionAnswer)!,
    };
  };
  const old = makeRow('2026-01-01', 'old');
  const recent = makeRow('2026-01-10', 'new');
  const used = collectLMSHistoryUsedKeys([old, recent], '2026-01-08');

  assert.ok(used.has(lmsSignatureUsedKey(old.signature)));
  assert.ok(used.has(lmsSignatureUsedKey(recent.signature)));
  assert.equal(used.has('hlpair:pl_goals:player-old-a:player-old-b'), false);
  assert.equal(used.has('hlpair:pl_goals:player-new-a:player-new-b'), true);
});

test('history extraction adds an exact signature and preserves useful pair keys', () => {
  const question: LMSQuestionPublic = {
    id: '2026-01-01-lms-q1',
    type: 'higher_lower',
    slot: 1,
    prompt: 'More Premier League goals?',
    options: [
      { id: '2026-01-01-lms-q1-player-a', label: 'Player A' },
      { id: '2026-01-01-lms-q1-player-b', label: 'Player B' },
    ],
  };
  const questionAnswer: LMSQuestionAnswer = {
    questionId: question.id,
    correctOptionId: question.options[0]!.id,
  };
  const puzzle = {
    modeId: 'last_man_standing',
    puzzleId: 'puzzle',
    date: '2026-01-01',
    title: 'Last Man Standing',
    version: 10,
    questions: [question],
  } satisfies LastManStandingPuzzle;
  const answer = { questions: [questionAnswer] } satisfies LastManStandingAnswer;

  const signature = lmsContentSignature(question, questionAnswer)!;
  const keys = extractLMSUsedKeys(puzzle, answer);
  assert.ok(keys.includes(lmsSignatureUsedKey(signature)));
  assert.ok(keys.includes('hlpair:pl_goals:player-a:player-b'));
});

test('bank backfill grouping selects one active keeper per semantic signature', () => {
  const card = careerCard('bank-a', ['A', 'B', 'C', 'D'], 0);
  const remapped = careerCard('bank-b', ['D', 'C', 'A', 'B'], 2);
  const groups = groupLMSBankRowsBySignature([
    {
      id: 'older-rejected',
      status: 'rejected',
      usedCount: 9,
      createdAt: '2026-01-01',
      question: card.question,
      answer: card.answer,
    },
    {
      id: 'active-keeper',
      status: 'active',
      usedCount: 1,
      createdAt: '2026-02-01',
      question: remapped.question,
      answer: remapped.answer,
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.keeperId, 'active-keeper');
  assert.deepEqual(groups[0]!.duplicateIds, ['older-rejected']);
});

test('bank inventory counts distinct current non-null signatures only', () => {
  const card = careerCard('bank-a', ['A', 'B', 'C', 'D'], 0);
  const signature = lmsContentSignature(card.question, card.answer)!;
  const inventory = summarizeLMSBankInventory([
    {
      type: 'career_path',
      status: 'active',
      contentSignature: signature,
      question: card.question,
      answer: card.answer,
    },
    {
      type: 'career_path',
      status: 'active',
      contentSignature: signature,
      question: card.question,
      answer: card.answer,
    },
    {
      type: 'career_path',
      status: 'active',
      contentSignature: null,
      question: card.question,
      answer: card.answer,
    },
  ]);
  assert.equal(inventory.activeDistinctByType.career_path, 1);
  assert.equal(inventory.knownSignatures.size, 1);
});

test('generation metadata carries deduplicated bank IDs without updating usage', () => {
  assert.deepEqual(createLMSGenerationMetadata(['row-a', 'row-b', 'row-a']), {
    acceptedBankRowIds: ['row-a', 'row-b'],
  });
});
