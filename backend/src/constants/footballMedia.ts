/** API-Football public CDN — logo/image requests do not count toward API quota. */
export const TEAM_LOGO_CDN = 'https://media.api-sports.io/football/teams';
export const LEAGUE_LOGO_CDN = 'https://media.api-sports.io/football/leagues';
export const PLAYER_PHOTO_CDN = 'https://media.api-sports.io/football/players';

export function teamLogoUrl(teamId: number): string {
  return `${TEAM_LOGO_CDN}/${teamId}.png`;
}

/** Player headshot from the public CDN (quota-free). Null when we have no API-Football id. */
export function playerHeadshotUrl(apiFootballId: number | null | undefined): string | null {
  return apiFootballId ? `${PLAYER_PHOTO_CDN}/${apiFootballId}.png` : null;
}

/**
 * Final headshot for a player: a manually-set override (e.g. a Wikipedia Commons photo for a
 * legend) wins; otherwise the API-Football CDN photo.
 */
export function resolveHeadshot(
  photoUrl: string | null | undefined,
  apiFootballId: number | null | undefined
): string | null {
  if (photoUrl && photoUrl.trim().length > 0) return photoUrl.trim();
  return playerHeadshotUrl(apiFootballId);
}

/**
 * Build a stable, resizable image URL from a Wikimedia Commons reference. Accepts a File: page URL,
 * a direct upload.wikimedia.org URL, a Special:FilePath URL, or a bare "File.jpg" name.
 * Uses Special:FilePath, which 302-redirects to a `width`-px thumbnail (AsyncImage follows it).
 */
export function commonsPhotoUrl(input: string, width = 400): string {
  let file = input.trim().split(/[?#]/)[0] ?? input.trim();
  if (/special:filepath/i.test(file)) {
    file = file.replace(/.*special:filepath\//i, '');
  } else if (/file:/i.test(file)) {
    file = file.replace(/.*file:/i, '');
  } else if (file.includes('/')) {
    file = file.substring(file.lastIndexOf('/') + 1);
  }
  file = decodeURIComponent(file).replace(/\s+/g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function leagueLogoUrl(leagueId: number): string {
  return `${LEAGUE_LOGO_CDN}/${leagueId}.png`;
}

/** Leagues we sync team crests for (top 5 + common trivia leagues). */
export const BADGE_LEAGUES = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
  { id: 40, name: 'Championship' },
  { id: 88, name: 'Eredivisie' },
  { id: 94, name: 'Primeira Liga' },
  { id: 179, name: 'Scottish Premiership' },
  { id: 203, name: 'Super Lig' },
  { id: 253, name: 'MLS' },
  { id: 262, name: 'Liga MX' },
  { id: 71, name: 'Brasileirao' },
  { id: 307, name: 'Pro League' },
] as const;

export const LEAGUE_ID_BY_NAME: Record<string, number> = Object.fromEntries(
  BADGE_LEAGUES.flatMap((league) => {
    const key = league.name.toLowerCase();
    const aliases: Record<string, number> = { [key]: league.id };
    if (key === 'primeira liga') aliases['liga portugal'] = league.id;
    if (key === 'super lig') aliases['süper lig'] = league.id;
    if (key === 'pro league') {
      aliases['saudi pro league'] = league.id;
      aliases['saudi professional league'] = league.id;
    }
    if (key === 'mls') aliases['major league soccer'] = league.id;
    if (key === 'brasileirao') aliases['serie a brazil'] = league.id;
    return Object.entries(aliases);
  })
);
