import { z } from 'zod';

export type ValidationSeverity = 'error' | 'warning';
export interface AdminPuzzleValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
}
export interface AdminPuzzleValidationReport {
  ok: boolean;
  issues: AdminPuzzleValidationIssue[];
}

const text = z.string().trim().min(1);
const id = text;
const playerRef = z.object({ id, name: text }).passthrough();
const issue = (
  issues: AdminPuzzleValidationIssue[],
  path: string,
  message: string,
  severity: ValidationSeverity = 'error'
) => issues.push({ severity, path, message });
const unique = (values: string[]) => new Set(values).size === values.length;

const lmsTypes = ['higher_lower', 'career_path', 'odd_one_out', 'which_club', 'image_badge'] as const;
const lmsOption = z.object({ id, label: text }).passthrough();
const lmsQuestion = z.object({
  id,
  type: z.enum(lmsTypes),
  slot: z.number().int().min(1).max(10),
  prompt: text,
  options: z.array(lmsOption),
}).passthrough();
const lmsPuzzle = z.object({ questions: z.array(lmsQuestion).length(10) }).passthrough();
const lmsAnswer = z.object({
  questions: z.array(z.object({ questionId: id, correctOptionId: id }).passthrough()).length(10),
}).passthrough();

const golfAnswer = z.object({
  id: id.optional(),
  name: text,
  aliases: z.array(text).optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'ultraRare']).optional(),
}).passthrough();
const golfHole = z.object({
  holeNumber: z.number().int().positive(),
  prompt: text,
  par: z.number().int().min(1).max(5),
  target: z.number().int().min(1).max(10).optional(),
  answers: z.array(golfAnswer).min(1),
}).passthrough();
const golfPuzzle = z.object({
  totalPar: z.number().int().positive().optional(),
  holes: z.array(golfHole).min(9),
}).passthrough();

const bingoCategory = z.object({
  id,
  title: text,
  type: z.enum([
    'nationality',
    'playedForClub',
    'nationClub',
    'clubCombo',
    'wonCompetition',
    'award',
    'statThreshold',
  ]),
  matchingRule: text,
}).passthrough();
const bingoPlayer = z.object({
  id,
  name: text,
  nationality: z.string(),
  position: z.string(),
  clubs: z.array(z.string()),
  leagues: z.array(z.string()),
  trophies: z.array(z.string()),
  awards: z.array(z.string()),
  stats: z.record(z.number()),
}).passthrough();
const bingoPuzzle = z.object({
  categories: z.array(bingoCategory).length(16),
  players: z.array(bingoPlayer).min(16),
}).passthrough();

const oneMoreOption = z.object({ id, name: text, value: z.number().nonnegative().optional() }).passthrough();
const oneMorePuzzle = z.object({
  metricId: id,
  minimum: z.number().int().nonnegative(),
  valueNoun: text,
  title: text,
  rounds: z.array(z.object({ options: z.array(oneMoreOption).length(2) }).passthrough()).length(10),
}).passthrough();
const oneMoreAnswer = z.object({
  valuesByRound: z.array(z.record(z.number().nonnegative())).length(10),
}).passthrough();

const constraintTypes = ['club', 'league', 'nationality', 'nat_league', 'nat_club', 'natLeague', 'natClub'] as const;
const draftConstraint = z.object({ id, type: z.enum(constraintTypes), label: text }).passthrough();
const draftSlot = z.object({ id, position: text }).passthrough();
const draftPick = z.object({
  slotId: id,
  position: text,
  constraintId: id,
  constraintLabel: text,
  playerName: text,
  playerId: id.optional(),
  statValue: z.number().positive(),
}).passthrough();
const draftPuzzle = z.object({
  category: z.object({ id, title: text }).passthrough(),
  formationId: id,
  slots: z.array(draftSlot).min(1),
  constraints: z.array(draftConstraint).min(1),
  optimalScore: z.number().positive(),
  optimalLineup: z.array(draftPick).min(1),
}).passthrough();

const clubChainPuzzle = z.object({
  start: playerRef,
  target: playerRef,
  shortestPathLength: z.number().int().positive(),
  maxMoves: z.number().int().positive(),
}).passthrough();
const clubChainAnswer = z.object({
  shortestPathPlayerIds: z.array(id).min(2),
  shortestPathLength: z.number().int().positive(),
}).passthrough();

const targetManPuzzle = z.object({
  categoryId: id,
  categoryLabel: text,
  title: text,
  target: z.number().positive(),
  valueNoun: text,
  offNoun: text,
  unit: z.string().nullable(),
}).passthrough();
const targetManAnswerFields = z.object({
  categoryId: id,
  target: z.number().positive(),
}).passthrough();
const targetManAnswer = z.union([
  targetManAnswerFields,
  z.object({
    modeId: z.literal('target_man').optional(),
    answer: targetManAnswerFields,
  }).passthrough(),
]);

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  root: string,
  issues: AdminPuzzleValidationIssue[]
): T | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const error of parsed.error.errors) {
    issue(issues, [root, ...error.path].filter(Boolean).join('.'), error.message);
  }
  return null;
}

function validateLms(puzzleJson: unknown, answerJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(lmsPuzzle, puzzleJson, 'puzzleJson', issues);
  const answer = parse(lmsAnswer, answerJson, 'answerJson', issues);
  if (!puzzle || !answer) return;
  if (!unique(puzzle.questions.map((q) => q.id))) issue(issues, 'puzzleJson.questions', 'Question ids must be unique.');
  if (!unique(puzzle.questions.map((q) => String(q.slot)))) issue(issues, 'puzzleJson.questions', 'Question slots must be unique.');
  const slots = puzzle.questions.map((q) => q.slot).sort((a, b) => a - b);
  if (slots.join(',') !== '1,2,3,4,5,6,7,8,9,10') issue(issues, 'puzzleJson.questions', 'Questions must cover slots 1–10.');
  puzzle.questions.forEach((question, index) => {
    const count = question.type === 'higher_lower' ? 2 : 4;
    if (question.options.length !== count) issue(issues, `puzzleJson.questions.${index}.options`, `${question.type} requires exactly ${count} options.`);
    if (!unique(question.options.map((option) => option.id))) issue(issues, `puzzleJson.questions.${index}.options`, 'Option ids must be unique.');
    const answerEntry = answer.questions[index];
    if (!answerEntry || answerEntry.questionId !== question.id) {
      issue(issues, `answerJson.questions.${index}.questionId`, 'Answers must be complete and aligned with puzzle question order.');
    } else if (!question.options.some((option) => option.id === answerEntry.correctOptionId)) {
      issue(issues, `answerJson.questions.${index}.correctOptionId`, 'Correct option must belong to this question.');
    }
  });
}

function validateGolf(puzzleJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(golfPuzzle, puzzleJson, 'puzzleJson', issues);
  if (!puzzle) return;
  const numbers = puzzle.holes.map((hole) => hole.holeNumber);
  if (!unique(numbers.map(String))) issue(issues, 'puzzleJson.holes', 'Hole numbers must be unique.');
  const expected = Array.from({ length: puzzle.holes.length }, (_, index) => index + 1);
  if ([...numbers].sort((a, b) => a - b).join(',') !== expected.join(',')) issue(issues, 'puzzleJson.holes', 'Hole numbers must be consecutive from 1.');
  puzzle.holes.forEach((hole, index) => {
    const target = hole.target ?? hole.par;
    if (target > 5) issue(issues, `puzzleJson.holes.${index}.target`, 'Target must be a sensible golf score (1–5).');
    if (hole.answers.length < Math.max(hole.par, target)) issue(issues, `puzzleJson.holes.${index}.answers`, 'Not enough answers to satisfy par/target.');
    const answerKeys = hole.answers.map((answer) => answer.id ?? answer.name.trim().toLowerCase());
    if (!unique(answerKeys)) issue(issues, `puzzleJson.holes.${index}.answers`, 'Answers must be unique within a hole.');
  });
  const totalPar = puzzle.holes.reduce((sum, hole) => sum + hole.par, 0);
  if (puzzle.totalPar !== undefined && puzzle.totalPar !== totalPar) issue(issues, 'puzzleJson.totalPar', `totalPar must equal ${totalPar}.`);
}

function validateBingo(puzzleJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(bingoPuzzle, puzzleJson, 'puzzleJson', issues);
  if (!puzzle) return;
  if (!unique(puzzle.categories.map((category) => category.id))) issue(issues, 'puzzleJson.categories', 'Category ids must be unique.');
  if (!unique(puzzle.categories.map((category) => category.matchingRule))) issue(issues, 'puzzleJson.categories', 'Category matching rules must be unique.');
  if (!unique(puzzle.players.map((player) => player.id))) issue(issues, 'puzzleJson.players', 'Player ids must be unique.');
}

function validateOneMore(puzzleJson: unknown, answerJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(oneMorePuzzle, puzzleJson, 'puzzleJson', issues);
  const answer = parse(oneMoreAnswer, answerJson, 'answerJson', issues);
  if (!puzzle || !answer) return;
  puzzle.rounds.forEach((round, index) => {
    if (round.options[0]!.id === round.options[1]!.id) issue(issues, `puzzleJson.rounds.${index}.options`, 'Round options must be different players.');
    const values = answer.valuesByRound[index]!;
    const optionIds = round.options.map((option) => option.id);
    if (!unique(optionIds) || Object.keys(values).length !== 2 || !optionIds.every((optionId) => optionId in values)) {
      issue(issues, `answerJson.valuesByRound.${index}`, 'Answer values must contain exactly the two round option ids.');
      return;
    }
    round.options.forEach((option) => {
      if (option.value !== undefined && option.value !== values[option.id]) issue(issues, `puzzleJson.rounds.${index}.options`, 'Visible and answer values must agree.');
    });
    if (optionIds.filter((optionId) => values[optionId]! >= puzzle.minimum).length !== 1) {
      issue(issues, `puzzleJson.rounds.${index}`, 'Each round must have exactly one option on each side of the threshold.');
    }
  });
}

function validateDraft(puzzleJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(draftPuzzle, puzzleJson, 'puzzleJson', issues);
  if (!puzzle) return;
  const count = puzzle.slots.length;
  if (puzzle.constraints.length !== count || puzzle.optimalLineup.length !== count) {
    issue(issues, 'puzzleJson', 'Slots, constraints, and optimal lineup must have equal lengths.');
  }
  if (!unique(puzzle.slots.map((slot) => slot.id))) issue(issues, 'puzzleJson.slots', 'Slot ids must be unique.');
  if (!unique(puzzle.constraints.map((constraint) => constraint.id))) issue(issues, 'puzzleJson.constraints', 'Constraint ids must be unique.');
  const slotById = new Map(puzzle.slots.map((slot) => [slot.id, slot]));
  const constraintIds = new Set(puzzle.constraints.map((constraint) => constraint.id));
  if (!unique(puzzle.optimalLineup.map((pick) => pick.slotId))) issue(issues, 'puzzleJson.optimalLineup', 'Each slot may appear only once.');
  if (!unique(puzzle.optimalLineup.map((pick) => pick.constraintId))) issue(issues, 'puzzleJson.optimalLineup', 'Each constraint may appear only once.');
  const playerKeys = puzzle.optimalLineup.map((pick) => pick.playerId ?? pick.playerName.trim().toLowerCase());
  if (!unique(playerKeys)) issue(issues, 'puzzleJson.optimalLineup', 'Optimal lineup players must be unique.');
  puzzle.optimalLineup.forEach((pick, index) => {
    if (!slotById.has(pick.slotId)) issue(issues, `puzzleJson.optimalLineup.${index}.slotId`, 'Lineup references an unknown slot.');
    else if (slotById.get(pick.slotId)!.position !== pick.position) issue(issues, `puzzleJson.optimalLineup.${index}.position`, 'Lineup position must match its slot.');
    if (!constraintIds.has(pick.constraintId)) issue(issues, `puzzleJson.optimalLineup.${index}.constraintId`, 'Lineup references an unknown constraint.');
  });
  const score = puzzle.optimalLineup.reduce((sum, pick) => sum + pick.statValue, 0);
  if (Math.abs(score - puzzle.optimalScore) > 0.001) issue(issues, 'puzzleJson.optimalScore', `Optimal score must equal lineup total ${score}.`);
}

function validateClubChain(puzzleJson: unknown, answerJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(clubChainPuzzle, puzzleJson, 'puzzleJson', issues);
  const answer = parse(clubChainAnswer, answerJson, 'answerJson', issues);
  if (!puzzle || !answer) return;
  if (puzzle.start.id === puzzle.target.id) issue(issues, 'puzzleJson.target.id', 'Start and target must be different players.');
  const expectedLength = answer.shortestPathPlayerIds.length - 1;
  if (answer.shortestPathPlayerIds[0] !== puzzle.start.id) issue(issues, 'answerJson.shortestPathPlayerIds.0', 'Path must start at the puzzle start player.');
  if (answer.shortestPathPlayerIds.at(-1) !== puzzle.target.id) issue(issues, 'answerJson.shortestPathPlayerIds', 'Path must end at the puzzle target player.');
  if (puzzle.shortestPathLength !== expectedLength || answer.shortestPathLength !== expectedLength) issue(issues, 'answerJson.shortestPathLength', 'Puzzle and answer path lengths must equal path edge count.');
  if (puzzle.maxMoves < puzzle.shortestPathLength) issue(issues, 'puzzleJson.maxMoves', 'maxMoves cannot be shorter than the shortest path.');
}

function validateTargetMan(puzzleJson: unknown, answerJson: unknown, issues: AdminPuzzleValidationIssue[]) {
  const puzzle = parse(targetManPuzzle, puzzleJson, 'puzzleJson', issues);
  const rawAnswer = parse(targetManAnswer, answerJson, 'answerJson', issues);
  if (!puzzle || !rawAnswer) return;
  const nested = z.object({ answer: targetManAnswerFields }).safeParse(rawAnswer);
  const flat = targetManAnswerFields.safeParse(rawAnswer);
  const answer = nested.success ? nested.data.answer : flat.success ? flat.data : null;
  if (!answer) return;
  if (answer.categoryId !== puzzle.categoryId) issue(issues, 'answerJson.categoryId', 'Answer category must match puzzle category.');
  if (answer.target !== puzzle.target) issue(issues, 'answerJson.target', 'Answer target must match puzzle target.');
  if (puzzle.title !== puzzle.categoryLabel) issue(issues, 'puzzleJson.title', 'Title and categoryLabel must stay synchronized.');
}

export function validatePuzzleReport(modeId: string, puzzleJson: unknown, answerJson: unknown): AdminPuzzleValidationReport {
  const issues: AdminPuzzleValidationIssue[] = [];
  switch (modeId) {
    case 'last_man_standing': validateLms(puzzleJson, answerJson, issues); break;
    case 'football_golf': validateGolf(puzzleJson, issues); break;
    case 'football_bingo': validateBingo(puzzleJson, issues); break;
    case 'one_more': validateOneMore(puzzleJson, answerJson, issues); break;
    case 'draft_master': validateDraft(puzzleJson, issues); break;
    case 'club_chain': validateClubChain(puzzleJson, answerJson, issues); break;
    case 'target_man': validateTargetMan(puzzleJson, answerJson, issues); break;
    default: issue(issues, 'modeId', `Unknown mode ${modeId}.`);
  }
  return { ok: !issues.some((entry) => entry.severity === 'error'), issues };
}

export function validatePuzzlePayload(
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown
): { ok: boolean; error?: string } {
  const report = validatePuzzleReport(modeId, puzzleJson, answerJson);
  const errors = report.issues.filter((entry) => entry.severity === 'error');
  return report.ok
    ? { ok: true }
    : { ok: false, error: errors.map((entry) => `${entry.path}: ${entry.message}`).join('; ') };
}
