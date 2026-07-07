/**
 * Last Man Standing stub generator — ships 10 placeholder MCQ questions until a real bank exists.
 * Correct answers are stored in answerJson; client resolves via the same deterministic hash.
 *
 * Dry run: DATABASE_URL=... npx tsx src/services/lastManStandingGenerator.ts [date]
 */
import 'dotenv/config';

const QUESTION_COUNT = 10;
const OPTION_LABELS = ['Option A', 'Option B', 'Option C', 'Option D'];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export interface LastManStandingOption {
  id: string;
  label: string;
}

export interface LastManStandingQuestion {
  id: string;
  prompt: string;
  options: LastManStandingOption[];
}

export interface LastManStandingPuzzle {
  modeId: 'last_man_standing';
  puzzleId: string;
  date: string;
  title: string;
  questions: LastManStandingQuestion[];
}

export interface LastManStandingAnswer {
  correctOptionIds: string[];
}

function correctOptionId(date: string, questionId: string, options: LastManStandingOption[]): string {
  const h = hashStr(`${date}-lms-${questionId}`);
  return options[h % options.length]!.id;
}

export function generateLastManStandingPuzzle(date: string): {
  puzzle: LastManStandingPuzzle;
  answer: LastManStandingAnswer;
} {
  const questions: LastManStandingQuestion[] = [];
  const correctOptionIds: string[] = [];

  for (let i = 0; i < QUESTION_COUNT; i += 1) {
    const questionId = `${date}-lms-q${i + 1}`;
    const options = OPTION_LABELS.map((label, idx) => ({
      id: `${questionId}-opt-${idx}`,
      label,
    }));
    const correctId = correctOptionId(date, questionId, options);
    correctOptionIds.push(correctId);
    questions.push({
      id: questionId,
      prompt: `Question ${i + 1} — placeholder (real questions coming soon)`,
      options,
    });
  }

  return {
    puzzle: {
      modeId: 'last_man_standing',
      puzzleId: `${date}-last_man_standing`,
      date,
      title: 'Last Man Standing',
      questions,
    },
    answer: { correctOptionIds },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const { puzzle, answer } = generateLastManStandingPuzzle(date);
  console.log(JSON.stringify({ puzzle, answer }, null, 2));
}
