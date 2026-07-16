export type SemanticGolfRule = Record<string, unknown>

function exactSet(values: unknown[]): unknown[] {
  return [...new Set(values)].sort((first, second) => String(first).localeCompare(String(second)))
}

export function canonicalRuleKey(rule: SemanticGolfRule | undefined): string | null {
  if (!rule) return null
  const entries = Object.entries(rule)
    .filter(([key, value]) => key !== 'label' && value !== undefined)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => {
      if (key === 'nationality' && typeof value === 'string') {
        return [key, value.toLowerCase()]
      }
      if (key === 'validIds' && Array.isArray(value)) {
        return [key, exactSet(value.map((item) => typeof item === 'string' ? item.toLowerCase() : item))]
      }
      if (key === 'playedFor' && Array.isArray(value)) {
        return [key, exactSet(value)]
      }
      return [key, value]
    })
  return JSON.stringify(Object.fromEntries(entries))
}

export function golfRulesSemanticallyEqual(
  first: SemanticGolfRule | undefined,
  second: SemanticGolfRule | undefined
): boolean {
  return canonicalRuleKey(first) === canonicalRuleKey(second)
}
