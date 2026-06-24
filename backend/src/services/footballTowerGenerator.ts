/**
 * Football Tower generator. Builds a 40-floor "name a player/club/country matching
 * the rule" climb from real data. Each floor ships a machine-readable rule; answers
 * are validated server-side (towerRules) against the same data, so the client can
 * never disagree with the server.
 *
 * Solvability: every template is checked with countValidPlayers at generation; any
 * the data can't support is dropped (and logged), so a floor always has answers.
 *
 * Dry run: DATABASE_URL=... npm run job:gen-tower [date]
 */
import 'dotenv/config';
import { countValidPlayers, type TowerRule } from './towerRules.js';

type AnswerType = 'player' | 'club' | 'country';
type Difficulty = 'easy' | 'medium' | 'hard' | 'elite';

interface Template {
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
  minFloor: number;
}

export interface TowerFloor {
  floor: number;
  difficulty: Difficulty;
  prompt: string;
  answerType: AnswerType;
  rule: TowerRule;
}

export interface FootballTowerPuzzle {
  modeId: 'football_tower';
  puzzleId: string;
  date: string;
  title: string;
  floors: TowerFloor[];
}

const TEMPLATES: Template[] = [
  // Easy
  { prompt: 'Name a Premier League club.', answerType: 'club', rule: {}, minFloor: 1 },
  { prompt: 'Name a football nation.', answerType: 'country', rule: {}, minFloor: 1 },
  { prompt: 'Name a player who has played in the Premier League.', answerType: 'player', rule: { leaguePlayed: 'Premier League' }, minFloor: 1 },
  { prompt: 'Name a player from England.', answerType: 'player', rule: { nationality: 'England' }, minFloor: 1 },
  { prompt: 'Name a Champions League winner.', answerType: 'player', rule: { uclWinner: true }, minFloor: 1 },
  { prompt: 'Name a Premier League goalkeeper.', answerType: 'player', rule: { position: 'Goalkeeper', leaguePlayed: 'Premier League' }, minFloor: 1 },
  // Medium
  { prompt: 'Name a Brazilian who has played in the Premier League.', answerType: 'player', rule: { nationality: 'Brazil', leaguePlayed: 'Premier League' }, minFloor: 6 },
  { prompt: 'Name a player with 100+ Premier League appearances.', answerType: 'player', rule: { minPlApps: 100 }, minFloor: 6 },
  { prompt: 'Name a player who has played for Chelsea.', answerType: 'player', rule: { playedFor: ['Chelsea'] }, minFloor: 6 },
  { prompt: 'Name a player who has scored in the Champions League.', answerType: 'player', rule: { minUclGoals: 1 }, minFloor: 6 },
  { prompt: 'Name a Spanish player who has played in La Liga.', answerType: 'player', rule: { nationality: 'Spain', leaguePlayed: 'La Liga' }, minFloor: 6 },
  { prompt: 'Name a player who has played for Liverpool.', answerType: 'player', rule: { playedFor: ['Liverpool'] }, minFloor: 6 },
  // Hard
  { prompt: 'Name a French player with 5+ Champions League goals.', answerType: 'player', rule: { nationality: 'France', minUclGoals: 5 }, minFloor: 16 },
  { prompt: 'Name a player with 40+ Premier League assists.', answerType: 'player', rule: { minPlAssists: 40 }, minFloor: 16 },
  { prompt: 'Name a goalkeeper with 100+ Premier League appearances.', answerType: 'player', rule: { position: 'Goalkeeper', minPlApps: 100 }, minFloor: 16 },
  { prompt: 'Name a player who has played for both Arsenal and Chelsea.', answerType: 'player', rule: { playedFor: ['Arsenal', 'Chelsea'] }, minFloor: 16 },
  { prompt: 'Name an Italian who has played in the Premier League.', answerType: 'player', rule: { nationality: 'Italy', leaguePlayed: 'Premier League' }, minFloor: 16 },
  { prompt: 'Name a player with 200+ Premier League appearances.', answerType: 'player', rule: { minPlApps: 200 }, minFloor: 16 },
  // Elite
  { prompt: 'Name a Dutch player with 100+ Premier League appearances.', answerType: 'player', rule: { nationality: 'Netherlands', minPlApps: 100 }, minFloor: 31 },
  { prompt: 'Name a player with 10+ Champions League goals who played for Bayern Munich.', answerType: 'player', rule: { playedFor: ['Bayern München'], minUclGoals: 10 }, minFloor: 31 },
  { prompt: 'Name a defender with 200+ Premier League appearances.', answerType: 'player', rule: { position: 'Defender', minPlApps: 200 }, minFloor: 31 },
  { prompt: 'Name a player who has played for both Manchester United and Chelsea.', answerType: 'player', rule: { playedFor: ['Manchester United', 'Chelsea'] }, minFloor: 31 },
  { prompt: 'Name a non-European player with 20+ Champions League appearances.', answerType: 'player', rule: { nonEuropean: true, minUclApps: 20 }, minFloor: 31 },
  { prompt: 'Name a French player with 10+ Champions League goals.', answerType: 'player', rule: { nationality: 'France', minUclGoals: 10 }, minFloor: 31 },
];

function difficultyForFloor(floor: number): Difficulty {
  if (floor <= 5) return 'easy';
  if (floor <= 15) return 'medium';
  if (floor <= 30) return 'hard';
  return 'elite';
}
function minFloorForDifficulty(d: Difficulty): number {
  return d === 'easy' ? 1 : d === 'medium' ? 6 : d === 'hard' ? 16 : 31;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Minimum valid answers a template must have to be usable. */
const MIN_VALID = 3;

export async function generateFootballTowerPuzzle(date: string): Promise<{ puzzle: FootballTowerPuzzle; report: Array<{ prompt: string; valid: number }> }> {
  // Solvability: count valid answers per player-rule template (club/country always ok).
  const report: Array<{ prompt: string; valid: number }> = [];
  const usable: Template[] = [];
  for (const t of TEMPLATES) {
    if (t.answerType === 'player') {
      const n = await countValidPlayers(t.rule);
      report.push({ prompt: t.prompt, valid: n });
      if (n >= MIN_VALID) usable.push(t);
    } else {
      report.push({ prompt: t.prompt, valid: -1 }); // closed set, always solvable
      usable.push(t);
    }
  }

  const floors: TowerFloor[] = [];
  for (let floor = 1; floor <= 40; floor += 1) {
    const difficulty = difficultyForFloor(floor);
    const cap = minFloorForDifficulty(difficulty);
    // Prefer templates of THIS difficulty band; widen to anything <= the band only if
    // a band has too few usable templates, so harder floors stay genuinely harder.
    const sameBand = usable.filter((t) => t.minFloor === cap);
    const eligible = sameBand.length >= 2 ? sameBand : usable.filter((t) => t.minFloor <= cap);
    const pool = eligible.length > 0 ? eligible : usable;
    const idx = hashStr(`${date}:tower:${floor}`) % pool.length;
    const t = pool[idx]!;
    floors.push({ floor, difficulty, prompt: t.prompt, answerType: t.answerType, rule: t.rule });
  }

  return {
    puzzle: { modeId: 'football_tower', puzzleId: `${date}-football_tower`, date, title: 'Daily Football Tower', floors },
    report,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateFootballTowerPuzzle(date)
    .then(({ puzzle, report }) => {
      console.log(`\n=== FOOTBALL TOWER ${date} — ${puzzle.floors.length} floors ===\n`);
      console.log('Template solvability (valid answers in DB):');
      for (const r of report.sort((a, b) => a.valid - b.valid)) {
        const flag = r.valid === -1 ? '🔵 closed' : r.valid < MIN_VALID ? '❌ DROPPED' : r.valid < 10 ? '⚠️  thin' : '✅';
        console.log(`  ${flag.padEnd(10)} ${String(r.valid === -1 ? '' : r.valid).padStart(5)}  ${r.prompt}`);
      }
      console.log('\nSample floors:');
      for (const f of [1, 6, 16, 31, 40]) {
        const fl = puzzle.floors[f - 1]!;
        console.log(`  Floor ${f} [${fl.difficulty}] ${fl.prompt}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
