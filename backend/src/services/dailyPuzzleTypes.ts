export type TargetManStatCategory =
  | 'goals'
  | 'assists'
  | 'appearances'
  | 'yellowCards'
  | 'redCards'
  | 'cleanSheets'
  | 'minutesPlayed'
  | 'saves'
  | 'foulsCommitted'
  | 'tacklesWon';

export type BlindRankStatCategory =
  | 'premier_league_goals'
  | 'premier_league_assists'
  | 'premier_league_appearances';

export interface FactPackPlayer {
  playerId: string;
  name: string;
  club: string;
  league: string;
  nationality: string;
  position: string;
  statValue: number;
}

export interface DailyFactPack {
  date: string;
  playerCount: number;
  plTopScorers: FactPackPlayer[];
  plTopAssists: FactPackPlayer[];
  plTopAppearances: FactPackPlayer[];
}

export interface GuessWhoPuzzlePublic {
  modeId: 'guess_who';
  puzzleId: string;
  date: string;
  maxGuesses: number;
  maxScore: number;
}

export interface TargetManPuzzlePublic {
  modeId: 'target_man';
  puzzleId: string;
  date: string;
  league: string;
  leagueId: number;
  category: TargetManStatCategory;
  categoryLabel: string;
  target: number;
  title: string;
}

export interface BlindRankPuzzlePublic {
  modeId: 'blind_rank';
  puzzleId: string;
  date: string;
  category: BlindRankStatCategory;
  categoryTitle: string;
  rankHint: string;
  presentationOrder: Array<{
    id: string;
    name: string;
    club: string;
    league: string;
    nationality: string;
    position: string;
  }>;
}

export type DailyPuzzlePublic =
  | GuessWhoPuzzlePublic
  | TargetManPuzzlePublic
  | BlindRankPuzzlePublic;

export interface BlindRankPuzzleAnswer {
  correctRanking: string[];
  statValues: Record<string, number>;
}

export interface TargetManPuzzleAnswer {
  leagueId: number;
  category: TargetManStatCategory;
  target: number;
}

export type DailyPuzzleAnswer =
  | { modeId: 'guess_who'; answerPlayerId: string }
  | { modeId: 'target_man'; answer: TargetManPuzzleAnswer }
  | { modeId: 'blind_rank'; answer: BlindRankPuzzleAnswer };

export interface GeneratedDailyPuzzle {
  modeId: string;
  puzzleJson: DailyPuzzlePublic;
  answerPlayerId: string | null;
  answerJson: DailyPuzzleAnswer | null;
}
