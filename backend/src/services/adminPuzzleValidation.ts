import { z } from 'zod';

const lmsOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  headshotUrl: z.string().optional(),
  teamLogoUrl: z.string().optional(),
  nationality: z.string().optional(),
  position: z.string().optional(),
});

const lmsQuestion = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  slot: z.number().int().min(1).max(10),
  signature: z.boolean().optional(),
  prompt: z.string().min(1),
  subPrompt: z.string().optional(),
  options: z.array(lmsOption).min(2),
  presentation: z.unknown().optional(),
});

const lmsPuzzle = z.object({
  modeId: z.literal('last_man_standing').optional(),
  puzzleId: z.string().optional(),
  date: z.string().optional(),
  title: z.string().optional(),
  version: z.number().optional(),
  questions: z.array(lmsQuestion).length(10),
});

const lmsAnswer = z.object({
  questions: z
    .array(
      z.object({
        questionId: z.string().min(1),
        correctOptionId: z.string().min(1),
        reveal: z.string().optional(),
      })
    )
    .length(10),
});

const golfHole = z.object({
  holeNumber: z.number().int(),
  prompt: z.string().min(1),
  par: z.number(),
  target: z.number().optional(),
  hints: z.array(z.string()).optional(),
  answers: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).optional(),
        rarity: z.string().optional(),
      }).passthrough()
    )
    .min(1),
}).passthrough();

const golfPuzzle = z.object({
  holes: z.array(golfHole).min(9),
}).passthrough();

const bingoPuzzle = z.object({
  categories: z.array(z.record(z.unknown())).min(1),
  players: z.array(z.record(z.unknown())).min(1),
}).passthrough();

const oneMorePuzzle = z.object({
  rounds: z.array(
    z.object({
      options: z.array(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          value: z.number().optional(),
        }).passthrough()
      ).min(2),
    }).passthrough()
  ).min(1),
}).passthrough();

const draftPuzzle = z.object({
  category: z.record(z.unknown()).optional(),
  constraints: z.array(z.unknown()).min(1),
  formationId: z.string().optional(),
  optimalScore: z.number().optional(),
  optimalLineup: z.array(z.unknown()).optional(),
}).passthrough();

const clubChainPuzzle = z.object({
  start: z.object({ id: z.string(), name: z.string() }).passthrough(),
  target: z.object({ id: z.string(), name: z.string() }).passthrough(),
  maxMoves: z.number().optional(),
}).passthrough();

const targetManPuzzle = z.object({
  categoryLabel: z.string().optional(),
  target: z.number().optional(),
  unit: z.string().optional(),
  nouns: z.unknown().optional(),
}).passthrough();

export function validatePuzzlePayload(
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown
): { ok: boolean; error?: string } {
  try {
    switch (modeId) {
      case 'last_man_standing': {
        const p = lmsPuzzle.parse(puzzleJson);
        const a = lmsAnswer.parse(answerJson);
        const qIds = new Set(p.questions.map((q) => q.id));
        for (const ans of a.questions) {
          if (!qIds.has(ans.questionId)) {
            return { ok: false, error: `answer for unknown question ${ans.questionId}` };
          }
          const q = p.questions.find((x) => x.id === ans.questionId)!;
          if (!q.options.some((o) => o.id === ans.correctOptionId)) {
            return { ok: false, error: `correctOptionId not in options for ${ans.questionId}` };
          }
        }
        const slots = p.questions.map((q) => q.slot).sort((a, b) => a - b);
        if (slots.join(',') !== '1,2,3,4,5,6,7,8,9,10') {
          return { ok: false, error: 'questions must cover slots 1–10' };
        }
        return { ok: true };
      }
      case 'football_golf':
        golfPuzzle.parse(puzzleJson);
        return { ok: true };
      case 'football_bingo':
        bingoPuzzle.parse(puzzleJson);
        return { ok: true };
      case 'one_more':
        oneMorePuzzle.parse(puzzleJson);
        return { ok: true };
      case 'draft_master':
        draftPuzzle.parse(puzzleJson);
        return { ok: true };
      case 'club_chain':
        clubChainPuzzle.parse(puzzleJson);
        return { ok: true };
      case 'target_man':
        targetManPuzzle.parse(puzzleJson);
        return { ok: true };
      default:
        return { ok: false, error: `unknown mode ${modeId}` };
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
