export const SEARCH_RESULT_LIMIT = 3;

/** Max ranked player results returned per search. */
export function resolveSearchLimit(_query: string): number {
  return SEARCH_RESULT_LIMIT;
}
