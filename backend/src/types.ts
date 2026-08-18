import type { TowerRule } from './services/towerRuleSchema.js';

export interface UserProfile {
  id: string;
  displayName: string;
  xp: number;
  level: number;
  levelXpStart: number;
  nextLevelXp: number;
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
    target: number;
    prompt: string;
    category: string;
    answers: Array<{ id: string; name: string; aliases: string[]; rarity: string }>;
    hints: string[];
    /** Present on newly generated holes; legacy persisted holes may omit it. */
    rule?: TowerRule;
    templateId?: string;
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
  /** Present on newly generated rows; omitted by legacy persisted puzzles. */
  metricId?: string;
  title: string;
  valueNoun: string;
  minimum: number;
  compareMode?: boolean;
  rounds: OneMoreRoundPublic[];
}

export interface LastManStandingOptionPublic {
  id: string;
  label: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
  nationality?: string;
}

export interface LastManStandingCareerClubPublic {
  name: string;
  logoUrl?: string;
  note?: 'loan';
  missing?: boolean;
}

export interface LastManStandingCluePlayerPublic {
  id?: string;
  name: string;
  headshotUrl?: string;
  nationality?: string;
  position?: string;
}

export interface LastManStandingPresentationPublic {
  layout?: 'two_up' | 'grid' | 'stack' | 'image_header';
  imageUrl?: string;
  imageBlur?: number;
  careerClubs?: LastManStandingCareerClubPublic[];
  careerPathVersion?: 2;
  cluePlayers?: LastManStandingCluePlayerPublic[];
}

export interface LastManStandingQuestionPublic {
  id: string;
  type: 'higher_lower' | 'career_path' | 'odd_one_out' | 'which_club' | 'image_badge' | 'custom_image' | 'custom_question' | 'missing_club' | 'custom_text';
  slot: number;
  signature?: boolean;
  prompt: string;
  subPrompt?: string;
  options: LastManStandingOptionPublic[];
  presentation?: LastManStandingPresentationPublic;
}

export interface LastManStandingPuzzlePublic {
  modeId: 'last_man_standing';
  puzzleId: string;
  date: string;
  title: string;
  version?: number;
  questions: LastManStandingQuestionPublic[];
}

export type DailyPuzzlePublic =
  | GuessWhoPuzzlePublic
  | TargetManPuzzlePublic
  | BlindRankPuzzlePublic
  | FootballBingoPuzzlePublic
  | FootballGolfPuzzlePublic
  | OneMorePuzzlePublic
  | LastManStandingPuzzlePublic;

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
  completionXpByMode: Record<string, number>;
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
  /** Draft XI only — perfect XI revealed after completion (stripped from the live puzzle). */
  optimalLineup?: Array<{
    slotId: string;
    position: string;
    constraintId: string;
    constraintLabel: string;
    playerName: string;
    statValue: number;
  }>;
  optimalScore?: number;
}

export interface PlayerSearchResult {
  id: string;
  name: string;
  club: string;
  league: string;
  nationality: string;
  position: string;
  /** Transfer-budget price in EUR (peak market value, with a tier-based fallback). */
  priceEur: number;
  /** API-Football headshot URL (quota-free CDN); absent when we have no API-Football id. */
  headshotUrl?: string;
  teamId?: number;
  teamLogoUrl?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}
