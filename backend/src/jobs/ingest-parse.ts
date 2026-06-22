export function toInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toPositiveInt(value: unknown): number | null {
  const parsed = toInt(value, -1);
  return parsed > 0 ? parsed : null;
}

export function parseSeasons(values: unknown[] | undefined): number[] {
  return (values ?? [])
    .map((value) => toInt(value, NaN))
    .filter((value) => Number.isFinite(value) && value >= 1900)
    .sort((a, b) => a - b);
}

export function toTeamId(value: unknown): number {
  return toPositiveInt(value) ?? 0;
}
