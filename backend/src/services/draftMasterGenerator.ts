/**
 * Battle Mode daily puzzle generator (mode id stays `draft_master`).
 *
 * Picks a date-seeded scenario (a famous match-up with a transfer budget) and a formation. The
 * heavy lifting — pricing the player's picks, the power model and the match sim — runs client-side
 * from data already in the bundle (player prices come from search, opponent + budget from here), so
 * there is no per-pick network call. We just ship the scenario, opponent XI and formation id.
 */
import { pickDaily, type Bucket } from './battleScenarios.js';

export interface BattlePuzzleOpponentPlayer {
  name: string;
  bucket: Bucket;
  valueEur: number;
}

export interface BattlePuzzleJson {
  modeId: 'draft_master';
  puzzleId: string;
  date: string;
  scenario: {
    id: string;
    title: string;
    subtitle: string;
    narrative: string;
    competition: string;
    budgetEur: number;
    opponent: { name: string; players: BattlePuzzleOpponentPlayer[] };
  };
  formationId: string;
}

export async function generateDraftMasterPuzzle(date: string): Promise<BattlePuzzleJson | null> {
  const { scenario, formation } = pickDaily(date);
  return {
    modeId: 'draft_master',
    puzzleId: `${date}-draft_master`,
    date,
    scenario: {
      id: scenario.id,
      title: scenario.title,
      subtitle: scenario.subtitle,
      narrative: scenario.narrative,
      competition: scenario.competition,
      budgetEur: scenario.budgetEur,
      opponent: {
        name: scenario.opponent.name,
        players: scenario.opponent.players.map((p) => ({
          name: p.name,
          bucket: p.bucket,
          valueEur: p.valueEur,
        })),
      },
    },
    formationId: formation.id,
  };
}
