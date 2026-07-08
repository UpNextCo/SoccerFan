/**
 * Last Man Standing daily composer — 10 fast TV-quiz MCQs from typed builders.
 *
 * Dry run: DATABASE_URL=... npx tsx src/services/lastManStandingGenerator.ts [date]
 */
import 'dotenv/config';
import { composeLastManStandingPuzzle } from './lastManStanding/composer.js';

export type {
  LastManStandingAnswer,
  LastManStandingPuzzle,
  LMSQuestionPublic,
  LMSQuestionType,
} from './lastManStanding/types.js';

export async function generateLastManStandingPuzzle(date: string) {
  const composed = await composeLastManStandingPuzzle(date);
  if (!composed) {
    throw new Error('Could not compose Last Man Standing puzzle');
  }
  return composed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateLastManStandingPuzzle(date)
    .then((r) => {
      const { puzzle } = r;
      console.log(`\n=== LAST MAN STANDING ${date} (v${puzzle.version}) ===\n`);
      const metrics = new Set<string>();
      for (const q of puzzle.questions) {
        const sig = q.signature ? ' ★' : '';
        console.log(`Q${q.slot}${sig} [${q.type}] ${q.prompt}`);
        if (q.subPrompt) console.log(`     ${q.subPrompt}`);
        console.log(`     → ${q.options.map((o) => o.label).join(' · ')}`);
        if (q.type === 'image_badge') console.log(`     blur ${q.presentation?.imageBlur ?? '?'}`);
        if (q.type === 'higher_lower') {
          const m = q.prompt.includes('Premier') ? 'pl' : q.prompt.includes('Champions League goals') ? 'cl_goals'
            : q.prompt.includes('Champions League appearances') ? 'cl_apps'
            : q.prompt.includes('international') ? 'intl_caps' : q.prompt.includes('value') ? 'peak' : '?';
          metrics.add(m);
        }
      }
      console.log(`\nH/L metrics used: ${[...metrics].join(', ') || 'none'}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
