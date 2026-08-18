/** Shared One More win rule: threshold days vs compare ("who has more") days. */

export function oneMorePickIsCorrect(
  pickedValue: number,
  roundValues: number[],
  opts: { compareMode?: boolean | null; minimum: number }
): boolean {
  if (opts.compareMode) {
    if (roundValues.length === 0) return false;
    const best = Math.max(...roundValues);
    const winners = roundValues.filter((value) => value === best).length;
    return winners === 1 && pickedValue === best;
  }
  return pickedValue >= opts.minimum;
}
