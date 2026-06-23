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

export interface GuessWhoPlayerSnapshot {
  id: string;
  name: string;
  nationality: string;
  league: string;
  club: string;
  position: string;
  age: number;
  shirtNumber: number | null;
}

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
    puzzle: GuessWhoPuzzlePublic;
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
  teamId?: number;
  teamLogoUrl?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}
