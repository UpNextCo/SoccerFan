/** Minimum prestige for names that appear as MCQ options / clue lines (household-ish). */
export const MIN_NAME_PRESTIGE = 62;

/** Big clubs used for which-club wrong answers and league-themed odd-one-out. */
export const FAMOUS_CLUBS_BY_LEAGUE: Record<number, readonly string[]> = {
  39: [
    'Manchester United', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
    'Newcastle United', 'West Ham United', 'Everton', 'Leicester City', 'Aston Villa', 'Fulham',
  ],
  140: [
    'Real Madrid', 'Barcelona', 'Atlético Madrid', 'Sevilla', 'Valencia', 'Villarreal', 'Real Sociedad',
  ],
  135: [
    'Juventus', 'Inter Milan', 'AC Milan', 'Napoli', 'Roma', 'Lazio', 'Fiorentina',
  ],
  78: [
    'Bayern München', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen', 'VfB Stuttgart',
  ],
  61: [
    'Paris Saint-Germain', 'Olympique Marseille', 'Olympique Lyonnais', 'AS Monaco', 'Lille',
  ],
};

export const LEAGUE_LABELS: Record<number, string> = {
  39: 'Premier League',
  140: 'La Liga',
  135: 'Serie A',
  78: 'Bundesliga',
  61: 'Ligue 1',
};

/** Clubs that work well for “three legends played here” shared-club odd-one-out. */
export const SHARED_CLUB_CANDIDATES = [
  'Manchester United', 'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
  'Real Madrid', 'Barcelona', 'Bayern München', 'Juventus', 'Inter Milan', 'AC Milan',
  'Paris Saint-Germain', 'Borussia Dortmund', 'Napoli', 'Roma', 'Atlético Madrid',
] as const;

export function prestigeOf(
  index: { prestigeByPlayer: Map<string, number> } | undefined,
  playerId: string
): number {
  return index?.prestigeByPlayer.get(playerId) ?? 0;
}

export function isFamousEnough(
  index: { prestigeByPlayer: Map<string, number> } | undefined,
  playerId: string,
  min = MIN_NAME_PRESTIGE
): boolean {
  return prestigeOf(index, playerId) >= min;
}

export function famousClubsInLeague(leagueId: number, exclude?: string): string[] {
  return (FAMOUS_CLUBS_BY_LEAGUE[leagueId] ?? []).filter((c) => c !== exclude);
}
