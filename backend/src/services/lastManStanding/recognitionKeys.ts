export function metricUsedKey(metricId: string): string {
  return `metric:${metricId}`;
}

export function playerUsedKey(playerId: string): string {
  return `player:${playerId}`;
}

export function clubUsedKey(club: string): string {
  return `club:${club.trim()}`;
}

export function hlPairUsedKey(idA: string, idB: string, metricId: string): string {
  const [a, b] = [idA, idB].sort();
  return `hlpair:${metricId}:${a}:${b}`;
}
