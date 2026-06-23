import { normalizeSearchText } from './playerSearch.js';

export function normalizeTeamName(value: string): string {
  return normalizeSearchText(value)
    .replace(/\bfc\b/g, '')
    .replace(/\bcf\b/g, '')
    .replace(/\bsc\b/g, '')
    .replace(/\bac\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
