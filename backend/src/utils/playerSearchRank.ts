import { normalizeSearchText } from './playerSearch.js';

/** Fewer results for short queries; more as the user types. */
export function resolveSearchLimit(query: string): number {
  const len = normalizeSearchText(query).length;
  if (len <= 2) return 4;
  if (len <= 4) return 6;
  if (len <= 6) return 8;
  return 10;
}
