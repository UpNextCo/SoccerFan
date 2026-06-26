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
}

export interface BlindRankPresentationPlayer {
  id: string;
  name: string;
  club: string;
  clubs: string; // e.g. "Barcelona · Chelsea" — main clubs for the card
  league: string;
  nationality: string;
  position: string;
  statValue: number;
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
  category: string;
  themeTitle: string; // e.g. "Premier League Legends"
  categoryTitle: string; // e.g. "Peak Market Value"
  subtitle: string; // e.g. "Rank by Peak Market Value"
  rankHint: string;
  valueNoun: string;
  valuePrefix: string;
  presentationOrder: BlindRankPresentationPlayer[];
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
