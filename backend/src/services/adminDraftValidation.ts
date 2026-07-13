import { z } from 'zod';
import {
  type AdminPuzzleValidationIssue,
  type AdminPuzzleValidationReport,
  validatePuzzleReport,
} from './adminPuzzleValidation.js';
import {
  isBingoSolvable,
  type FootballBingoPuzzle,
} from './footballBingoGenerator.js';
import {
  verifyOneMoreCandidateValues,
  type OneMoreCandidateValueInput,
} from './oneMoreGenerator.js';
import {
  clubChainLink,
  recomputeClubChainShortestPath,
} from './clubChainGenerator.js';
import {
  resolveAdminGolfAnswer,
  resolveAdminPlayer,
} from './adminEntitySearch.js';
import {
  recomputeBattleScore,
  type BattlePuzzleJson,
} from './battleGenerator.js';

const uuid = z.string().uuid();
const issue = (
  issues: AdminPuzzleValidationIssue[],
  path: string,
  message: string,
  severity: AdminPuzzleValidationIssue['severity'] = 'error'
) => issues.push({ severity, path, message });

const oneMoreShape = z.object({
  metricId: z.string().min(1),
  minimum: z.number().int().nonnegative(),
  rounds: z.array(z.object({
    options: z.tuple([
      z.object({ id: z.string(), value: z.number().optional() }).passthrough(),
      z.object({ id: z.string(), value: z.number().optional() }).passthrough(),
    ]),
  }).passthrough()).length(10),
}).passthrough();
const oneMoreAnswerShape = z.object({
  valuesByRound: z.array(z.record(z.number())).length(10),
}).passthrough();
const clubChainShape = z.object({
  start: z.object({ id: uuid }).passthrough(),
  target: z.object({ id: uuid }).passthrough(),
  shortestPathLength: z.number().int().positive(),
}).passthrough();
const clubChainAnswerShape = z.object({
  shortestPathPlayerIds: z.array(uuid).min(2),
}).passthrough();
const golfShape = z.object({
  holes: z.array(z.object({
    answers: z.array(z.object({ id: z.string().optional() }).passthrough()),
  }).passthrough()),
}).passthrough();
const draftShape = z.object({
  optimalLineup: z.array(z.object({ playerId: z.string().optional() }).passthrough()),
}).passthrough();

async function validateBingo(
  puzzleJson: unknown,
  issues: AdminPuzzleValidationIssue[]
): Promise<void> {
  const result = isBingoSolvable(puzzleJson as FootballBingoPuzzle);
  result.perCategory.forEach((category, index) => {
    if (category.matchers === 0) {
      issue(issues, `puzzleJson.categories.${index}`, `${category.title} has no matching player in the shipped pool.`);
    } else if (category.matchers < 3) {
      issue(issues, `puzzleJson.categories.${index}`, `${category.title} has only ${category.matchers} matching player(s).`, 'warning');
    }
  });
  if (!result.ok) issue(issues, 'puzzleJson', 'Bingo board is not solvable by the shipped player pool.');
  else if (!result.fair) issue(issues, 'puzzleJson.players', 'Bingo is solvable but at least one category has a thin player pool.', 'warning');
}

async function validateOneMore(
  puzzleJson: unknown,
  answerJson: unknown,
  issues: AdminPuzzleValidationIssue[]
): Promise<void> {
  const puzzle = oneMoreShape.safeParse(puzzleJson);
  const answer = oneMoreAnswerShape.safeParse(answerJson);
  if (!puzzle.success || !answer.success) return;
  const pairs: Array<[OneMoreCandidateValueInput, OneMoreCandidateValueInput]> = [];
  for (let index = 0; index < puzzle.data.rounds.length; index += 1) {
    const round = puzzle.data.rounds[index]!;
    if (!round.options.every((option) => uuid.safeParse(option.id).success)) {
      issue(issues, `puzzleJson.rounds.${index}.options`, 'One More player ids must be UUIDs for database verification.');
      continue;
    }
    const values = answer.data.valuesByRound[index]!;
    pairs.push(round.options.map((option) => ({
      playerId: option.id,
      expectedValue: values[option.id] ?? option.value,
    })) as [OneMoreCandidateValueInput, OneMoreCandidateValueInput]);
  }
  if (pairs.length !== puzzle.data.rounds.length) return;
  try {
    const verified = await verifyOneMoreCandidateValues(
      puzzle.data.metricId,
      puzzle.data.minimum,
      pairs
    );
    verified.forEach((round, index) => {
      round.errors.forEach((message) => issue(issues, `puzzleJson.rounds.${index}`, message));
    });
  } catch (error) {
    issue(issues, 'puzzleJson.metricId', error instanceof Error ? error.message : String(error));
  }
}

async function validateClubChain(
  puzzleJson: unknown,
  answerJson: unknown,
  issues: AdminPuzzleValidationIssue[]
): Promise<void> {
  const puzzle = clubChainShape.safeParse(puzzleJson);
  const answer = clubChainAnswerShape.safeParse(answerJson);
  if (!puzzle.success || !answer.success) return;
  const path = answer.data.shortestPathPlayerIds;
  for (let index = 0; index < path.length - 1; index += 1) {
    const link = await clubChainLink(path[index]!, path[index + 1]!);
    if (!link) issue(issues, `answerJson.shortestPathPlayerIds.${index + 1}`, 'Adjacent players are not verified club teammates.');
  }
  const recomputed = await recomputeClubChainShortestPath(puzzle.data.start.id, puzzle.data.target.id);
  if (!recomputed) {
    issue(issues, 'puzzleJson', 'No path was found in the Club Chain generator graph.');
  } else if (recomputed.shortestPathLength !== puzzle.data.shortestPathLength) {
    issue(
      issues,
      'puzzleJson.shortestPathLength',
      `Stored shortest path is ${puzzle.data.shortestPathLength}; database graph shortest path is ${recomputed.shortestPathLength}.`
    );
  }
}

async function validateReferencedPlayers(
  modeId: string,
  puzzleJson: unknown,
  issues: AdminPuzzleValidationIssue[]
): Promise<void> {
  const references: Array<{ id: string; path: string; resolve: (id: string) => Promise<unknown> }> = [];
  if (modeId === 'football_golf') {
    const puzzle = golfShape.safeParse(puzzleJson);
    if (!puzzle.success) return;
    puzzle.data.holes.forEach((hole, holeIndex) => hole.answers.forEach((answer, answerIndex) => {
      if (answer.id) references.push({
        id: answer.id,
        path: `puzzleJson.holes.${holeIndex}.answers.${answerIndex}.id`,
        resolve: resolveAdminGolfAnswer,
      });
    }));
  } else if (modeId === 'draft_master') {
    const puzzle = draftShape.safeParse(puzzleJson);
    if (!puzzle.success) return;
    puzzle.data.optimalLineup.forEach((pick, index) => {
      if (pick.playerId) references.push({
        id: pick.playerId,
        path: `puzzleJson.optimalLineup.${index}.playerId`,
        resolve: resolveAdminPlayer,
      });
    });
  }
  await Promise.all(references.map(async (reference) => {
    if (!uuid.safeParse(reference.id).success) {
      issue(issues, reference.path, 'Referenced player id must be a UUID.');
      return;
    }
    if (!(await reference.resolve(reference.id))) issue(issues, reference.path, 'Referenced player does not exist.');
  }));

  if (modeId === 'draft_master') {
    const puzzle = draftShape.safeParse(puzzleJson);
    const playerIds = puzzle.success
      ? puzzle.data.optimalLineup.map((pick) => pick.playerId)
      : [];
    if (puzzle.success && playerIds.length > 0 && playerIds.every((playerId): playerId is string => Boolean(playerId))) {
      const raw = puzzleJson as BattlePuzzleJson;
      const normalized: BattlePuzzleJson = {
        ...raw,
        constraints: raw.constraints.map((constraint) => {
          const constraintType = String(constraint.type);
          return {
            ...constraint,
            type: constraintType === 'natLeague'
              ? 'nat_league'
              : constraintType === 'natClub' ? 'nat_club' : constraint.type,
          };
        }),
      };
      const score = await recomputeBattleScore(
        normalized,
        normalized.optimalLineup.map((pick, index) => ({
          slotId: pick.slotId,
          constraintId: pick.constraintId,
          playerId: playerIds[index]!,
        }))
      );
      if (score.score !== 1100) {
        issue(issues, 'puzzleJson.optimalLineup', 'Stored optimal lineup does not reproduce a perfect score against current database facts.');
      }
    }
  }
}

/**
 * Full admin validation. It is read-only: no daily_puzzles write or generator mutation occurs.
 */
export async function validateAdminPuzzleDraft(
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown
): Promise<AdminPuzzleValidationReport> {
  const report = validatePuzzleReport(modeId, puzzleJson, answerJson);
  const issues = [...report.issues];
  if (!report.ok) return { ok: false, issues };

  if (modeId === 'football_bingo') await validateBingo(puzzleJson, issues);
  else if (modeId === 'one_more') await validateOneMore(puzzleJson, answerJson, issues);
  else if (modeId === 'club_chain') await validateClubChain(puzzleJson, answerJson, issues);
  else await validateReferencedPlayers(modeId, puzzleJson, issues);

  return { ok: !issues.some((entry) => entry.severity === 'error'), issues };
}
