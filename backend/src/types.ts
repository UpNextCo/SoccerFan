export interface UserProfile {
  id: string;
  displayName: string;
  xp: number;
  level: number;
  streak: number;
  todayXp: number;
  avatarUrl?: string;
}

export interface AuthAppleRequest {
  identityToken: string;
  displayName?: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface GameModeMeta {
  id: string;
  title: string;
  subtitle: string;
  playerCount: number;
  isAvailable: boolean;
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
  category: string;
  categoryLabel: string;
  target: number;
  title: string;
}

export interface BlindRankPuzzlePublic {
  modeId: 'blind_rank';
  puzzleId: string;
  date: string;
  category: string;
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

export interface GuessFeedbackField {
  field: string;
  value: string | number | null;
  status: 'correct' | 'partial' | 'wrong';
  hint?: 'higher' | 'lower';
}

export interface DailyBundle {
  date: string;
  alreadyPlayed: boolean;
  completedModeIds: string[];
  games: Array<{
    modeId: string;
    title: string;
    puzzle: DailyPuzzlePublic;
  }>;
}

export interface DailyCompleteRequest {
  modeId: string;
  date: string;
  score: number;
  guesses: number;
  won: boolean;
  shareGrid: string;
}

export interface DailyCompleteResponse {
  xpEarned: number;
  newXp: number;
  newLevel: number;
  streak: number;
  todayXp: number;
}

export interface PlayerSearchResult {
  id: string;
  name: string;
  club: string;
  league: string;
  nationality: string;
  position: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}
