/**
 * Pure rules for reconciling a player's stored club spells against the seasons they actually made
 * appearances in. Extracted from the job so it can be tested without a database.
 *
 * `player_career` (API-Football) supplies the spells; `player_stats` supplies the appearances. The
 * spells are frequently wrong in three ways, all of which Club Chain reads as fact:
 *   - starts too late  (Gerrard at Liverpool from 2005; he arrived in 1998)
 *   - ends too late    (Gerrard at Liverpool until 2017; he left in 2015)
 *   - stints merged    (Cristiano at United 2003–2021, one row covering two separate spells)
 *   - starts impossibly early (Morata at Milan from 1926, from a placeholder transfer date)
 */

/** An inclusive season range, e.g. { from: 1998, to: 2014 } is 1998/99 through 2014/15. */
export interface Stint {
  from: number;
  to: number;
}

/** What the player was doing OUTSIDE the club being reconciled. */
export interface SeasonContext {
  /** Did they appear for a different identified club anywhere in this inclusive window? */
  departedDuring: (from: number, to: number) => boolean;
  /** Did they appear in this window with no identifiable club? */
  unknownDuring: (from: number, to: number) => boolean;
}

/** A gap at least this wide can split one stored spell into separate stints. */
export const SPLIT_GAP_SEASONS = 3;

/**
 * Split a sorted season list into runs, breaking only at a wide gap the player provably spent at
 * another club. Appearances often carry no club name at all (Gerrard 2010–2013), so a wide gap on its
 * own is missing data rather than a transfer — treating it as one would cut a continuous career in
 * half and lose every teammate from those years.
 */
function runsOf(seasons: number[], context: SeasonContext): Stint[] {
  const runs: Stint[] = [];
  for (const season of seasons) {
    const last = runs[runs.length - 1];
    const departed =
      last && season - last.to >= SPLIT_GAP_SEASONS && context.departedDuring(last.to + 1, season - 1);
    if (last && !departed) last.to = season;
    else runs.push({ from: season, to: season });
  }
  return runs;
}

/** Index of the stint a season belongs to: the one containing it, else the nearest. */
function stintFor(stints: Stint[], season: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < stints.length; i += 1) {
    const s = stints[i]!;
    const distance = season < s.from ? s.from - season : season > s.to ? season - s.to : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * The spells a (player, club) should have. Returns null when there is no appearance evidence to
 * reconcile against — an unevidenced spell is left exactly as stored, since our stats do not reach
 * every era or competition.
 *
 * A start only ever moves EARLIER, keeping the stored value when it predates our coverage. An end
 * moves to the last season we can see, in either direction, EXCEPT where the spell runs to the present
 * (current-season stats lag) or unattributed appearances sit in the tail.
 *
 * @param ongoingFrom Seasons at or after this count as "still there", so their end is left alone.
 * @param earliestPlausibleStart A stored start before this is a broken value rather than history (the
 *   transfer feed dates unknown moves 1926-01-01, which gave Morata a Milan spell from 1926), so it is
 *   discarded in favour of the appearance evidence. Callers that can't judge plausibility omit it.
 */
export function reconcileStints(
  stints: Stint[],
  seasons: number[],
  context: SeasonContext,
  ongoingFrom: number,
  earliestPlausibleStart = -Infinity
): Stint[] | null {
  if (stints.length === 0 || seasons.length === 0) return null;

  const perStint = stints.map<number[]>(() => []);
  for (const season of [...seasons].sort((a, b) => a - b)) perStint[stintFor(stints, season)]!.push(season);

  const out: Stint[] = [];
  for (let i = 0; i < stints.length; i += 1) {
    const stint = stints[i]!;
    const mine = perStint[i]!;
    // No appearances landed on this stint — keep exactly what was stored.
    if (mine.length === 0) {
      out.push({ ...stint });
      continue;
    }
    const runs = runsOf(mine, context);
    for (let r = 0; r < runs.length; r += 1) {
      const run = runs[r]!;
      // A start we believe can only move EARLIER (our stats don't reach every era); one that predates
      // the player existing is thrown away and rebuilt from the appearances.
      const storedStartIsReal = stint.from >= earliestPlausibleStart;
      const from = r === 0 && storedStartIsReal ? Math.min(stint.from, run.from) : run.from;
      const keepStoredEnd =
        stint.to > run.to && (stint.to >= ongoingFrom || context.unknownDuring(run.to + 1, stint.to));
      const to = r === runs.length - 1 && keepStoredEnd ? stint.to : run.to;
      out.push({ from, to: Math.max(to, from) });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

export function sameSpells(a: Stint[], b: Stint[]): boolean {
  return a.length === b.length && a.every((s, i) => s.from === b[i]!.from && s.to === b[i]!.to);
}

export function formatSpells(spells: Stint[]): string {
  return spells.map((s) => `${s.from}-${s.to}`).join(' + ');
}
