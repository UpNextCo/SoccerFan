import { FAMOUS_CLUBS_BY_LEAGUE } from './fame.js';
import type { FamousPlayer } from './shared.js';
import type { PlayerClubIndex } from './plausibility.js';
import { higherLowerMetricFromPrompt } from './higherLowerCatalog.js';
export {
  clubUsedKey,
  hlPairUsedKey,
  metricUsedKey,
  playerUsedKey,
} from './recognitionKeys.js';

/** Clubs fans would recognise on a badge quiz — top-flight household names only. */
export const HOUSEHOLD_BADGE_CLUBS = new Set(Object.values(FAMOUS_CLUBS_BY_LEAGUE).flat());

export function isHouseholdBadgeClub(name: string): boolean {
  return HOUSEHOLD_BADGE_CLUBS.has(name.trim());
}

export function metricFromPrompt(prompt: string): string | null {
  return higherLowerMetricFromPrompt(prompt);
}

/** Names fans would recognise on a TV quiz — stricter than raw prestige tier. */
export function isHouseholdFromStats(
  mvt: number,
  plApps: number,
  uclApps: number,
  prestige: number
): boolean {
  if (mvt >= 5) return true;
  if (plApps >= 50) return true;
  if (uclApps >= 40) return true;
  if (prestige >= 78) return true;
  return false;
}

export function isHouseholdPlayer(p: FamousPlayer): boolean {
  return isHouseholdFromStats(p.mvt, p.plApps, p.uclApps, p.prestige);
}

export function isHouseholdIndexed(index: PlayerClubIndex, playerId: string): boolean {
  const mvt = index.mvtByPlayer.get(playerId) ?? 0;
  const pl = index.plAppsByPlayer.get(playerId) ?? 0;
  const ucl = index.uclAppsByPlayer.get(playerId) ?? 0;
  const prestige = index.prestigeByPlayer.get(playerId) ?? 0;
  return isHouseholdFromStats(mvt, pl, ucl, prestige);
}

/** Badges that are instantly readable even heavily blurred. */
export const INSTANT_BADGE_CLUBS = new Set([
  'Manchester City',
  'Manchester United',
  'Liverpool',
  'Arsenal',
  'Chelsea',
  'Tottenham',
  'Real Madrid',
  'Barcelona',
  'Bayern München',
  'Paris Saint-Germain',
  'Juventus',
  'Inter Milan',
  'AC Milan',
]);
