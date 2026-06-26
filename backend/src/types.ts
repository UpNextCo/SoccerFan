export interface UserProfile {
  id: string;
  displayName: string;
  xp: number;
  level: number;
  streak: number;
  todayXp: number;
  avatarUrl?: string;
  favoriteTeamId?: number | null;
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
  themeTitle: string;
  categoryTitle: string;
  subtitle: string;
  rankHint: string;
  valueNoun: string;
  valuePrefix: string;
  presentationOrder: Array<{
    id: string;
    name: string;
    club: string;
    clubs: string;
    league: string;
    nationality: string;
    position: string;
    statValue: number;
  }>;
}

export interface FootballBingoPuzzlePublic {
  modeId: 'football_bingo';
  puzzleId: string;
  date: string;
  title: string;
  categories: Array<{
    id: string;
    title: string;
    type: string;
    iconType: string;
    iconValue: string;
    matchingRule: string;
  }>;
  players: Array<{
    id: string;
    name: string;
    nationality: string;
    position: string;
    clubs: string[];
    leagues: string[];
    trophies: string[];
    teammates: string[];
    managers: string[];
    premierLeagueApps: number | null;
    topLeagueGoals: number | null;
    topLeagueApps: number | null;
  }>;
}

export interface FootballGolfPuzzlePublic {
  modeId: 'football_golf';
  puzzleId: string;
  date: string;
  title: string;
  totalPar: number;
  holes: Array<{
    id: string;
    holeNumber: number;
    par: number;
    prompt: string;
    category: string;
    answers: Array<{ id: string; name: string; aliases: string[]; rarity: string }>;
    hints: string[];
  }>;
}

export interface OneMoreOptionPublic {
  id: string;
  name: string;
  clubs: string;
  position: string;
  value: number;
}

export interface OneMoreRoundPublic {
  options: [OneMoreOptionPublic, OneMoreOptionPublic];
}

export interface OneMorePuzzlePublic {
  modeId: 'one_more';
  puzzleId: string;
  date: string;
  title: string;
  valueNoun: string;
  minimum: number;
  rounds: OneMoreRoundPublic[];
}

export type DailyPuzzlePublic =
  | GuessWhoPuzzlePublic
  | TargetManPuzzlePublic
  | BlindRankPuzzlePublic
  | FootballBingoPuzzlePublic
  | FootballGolfPuzzlePublic
  | OneMorePuzzlePublic;

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
  teamId?: number;
  teamLogoUrl?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}
