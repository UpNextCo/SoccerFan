/**
 * Weekly pyramid league — division ladder, zone math, London week helpers.
 */

export const COHORT_SIZE = 20;

export const WEEKLY_DIVISIONS = [
  'sunday_league',
  'non_league',
  'league_two',
  'league_one',
  'championship',
  'premier_league',
  'champions_league',
] as const;

export type WeeklyDivision = (typeof WEEKLY_DIVISIONS)[number];

export const DIVISION_LABELS: Record<WeeklyDivision, string> = {
  sunday_league: 'Sunday League',
  non_league: 'Non-League',
  league_two: 'League Two',
  league_one: 'League One',
  championship: 'Championship',
  premier_league: 'Premier League',
  champions_league: 'Champions League',
};

export function isWeeklyDivision(value: string): value is WeeklyDivision {
  return (WEEKLY_DIVISIONS as readonly string[]).includes(value);
}

export function divisionLabel(division: string): string {
  return isWeeklyDivision(division) ? DIVISION_LABELS[division] : division;
}

export function divisionIndex(division: WeeklyDivision): number {
  return WEEKLY_DIVISIONS.indexOf(division);
}

export function promoteDivision(division: WeeklyDivision): WeeklyDivision {
  const i = divisionIndex(division);
  if (i < 0 || i >= WEEKLY_DIVISIONS.length - 1) return division;
  return WEEKLY_DIVISIONS[i + 1]!;
}

export function relegateDivision(division: WeeklyDivision): WeeklyDivision {
  const i = divisionIndex(division);
  if (i <= 0) return division;
  return WEEKLY_DIVISIONS[i - 1]!;
}

export interface LeagueZones {
  /** Inclusive max rank that promotes (0 if none). */
  promoteMaxRank: number;
  /** Inclusive min rank that relegates (0 if none). */
  relegateMinRank: number;
  isChampionsLeague: boolean;
  isSundayLeague: boolean;
  tableSize: number;
}

/**
 * Promotion / relegation band sizes for a table of N players.
 * Full table (20) → top 5 promote / bottom 5 relegate. Smaller tables keep 5/5
 * until a mid-band would disappear, then shrink both sides equally.
 */
export function zoneCounts(tableSize: number): { promote: number; relegate: number } {
  const n = Math.max(0, Math.floor(tableSize));
  if (n <= 0) return { promote: 0, relegate: 0 };

  let promote = 5;
  let relegate = 5;
  const maxMove = Math.max(0, Math.floor((n - 1) / 2));
  promote = Math.min(promote, maxMove);
  relegate = Math.min(relegate, maxMove);
  if (promote + relegate >= n) {
    const overflow = promote + relegate - (n - 1);
    const cutPromo = Math.ceil(overflow / 2);
    promote = Math.max(0, promote - cutPromo);
    relegate = Math.max(0, relegate - (overflow - cutPromo));
  }
  return { promote, relegate };
}

export function zonesForTable(division: WeeklyDivision, tableSize: number): LeagueZones {
  const { promote, relegate } = zoneCounts(tableSize);
  const isChampionsLeague = division === 'champions_league';
  const isSundayLeague = division === 'sunday_league';
  const promoteMaxRank = isChampionsLeague || promote <= 0 ? 0 : promote;
  const relegateMinRank =
    isSundayLeague || relegate <= 0 || tableSize <= 0 ? 0 : tableSize - relegate + 1;
  return {
    promoteMaxRank,
    relegateMinRank,
    isChampionsLeague,
    isSundayLeague,
    tableSize,
  };
}

export type MembershipOutcome = 'promoted' | 'stayed' | 'relegated' | 'champion';

export function outcomeForRank(
  division: WeeklyDivision,
  rank: number,
  tableSize: number
): { outcome: MembershipOutcome; nextDivision: WeeklyDivision } {
  const zones = zonesForTable(division, tableSize);
  if (division === 'champions_league' && rank === 1) {
    return { outcome: 'champion', nextDivision: division };
  }
  if (zones.promoteMaxRank > 0 && rank <= zones.promoteMaxRank) {
    return { outcome: 'promoted', nextDivision: promoteDivision(division) };
  }
  if (zones.relegateMinRank > 0 && rank >= zones.relegateMinRank) {
    return { outcome: 'relegated', nextDivision: relegateDivision(division) };
  }
  return { outcome: 'stayed', nextDivision: division };
}

/** Tie-break: higher XP, then earlier weekly_xp_reached_at, then user_id ASC. */
export function compareWeeklyMembership(
  a: { weeklyXp: number; weeklyXpReachedAt: Date | null; userId: string },
  b: { weeklyXp: number; weeklyXpReachedAt: Date | null; userId: string }
): number {
  if (b.weeklyXp !== a.weeklyXp) return b.weeklyXp - a.weeklyXp;
  const aAt = a.weeklyXpReachedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bAt = b.weeklyXpReachedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aAt !== bAt) return aAt - bAt;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** Even group sizes ≤ maxSize covering `count` players (e.g. 61 → [21,20,20]). */
export function packGroupSizes(count: number, maxSize = COHORT_SIZE): number[] {
  if (count <= 0) return [];
  if (count <= maxSize) return [count];
  const groups = Math.ceil(count / maxSize);
  const base = Math.floor(count / groups);
  const rem = count % groups;
  const sizes: number[] = [];
  for (let i = 0; i < groups; i += 1) {
    sizes.push(base + (i < rem ? 1 : 0));
  }
  return sizes;
}

/**
 * Monday (YYYY-MM-DD) of the Europe/London week containing `instant`.
 * Week = Mon 00:00 → Sun 23:59:59.999 London.
 */
export function londonWeekStart(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const dow = weekdayMap[weekday] ?? 1;
  // Build a UTC noon anchor for the London calendar date, then shift to Monday.
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const shiftDays = 1 - dow; // Mon→0, Sun→-6
  const monday = new Date(utcNoon + shiftDays * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export function londonWeekEnd(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD calendar date in Europe/London for `instant`. */
export function londonDateString(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

export function formatStatusLine(input: {
  division: WeeklyDivision;
  rank: number;
  xp: number;
  standings: Array<{ rank: number; xp: number; userId: string }>;
  viewerUserId: string;
}): string | null {
  const { division, rank, xp, standings } = input;
  const zones = zonesForTable(division, standings.length);
  if (standings.length === 0 || rank <= 0) return null;

  if (division === 'champions_league') {
    if (rank === 1) return '1st in the Champions League';
    if (zones.relegateMinRank > 0 && rank >= zones.relegateMinRank) {
      return "You're in the relegation zone";
    }
    if (zones.relegateMinRank > 0) {
      const edge = standings.find((s) => s.rank === zones.relegateMinRank);
      if (edge && xp >= edge.xp) {
        const clear = xp - edge.xp;
        if (clear > 0) return `${clear.toLocaleString('en-GB')} XP clear of relegation`;
      }
    }
    return `${ordinal(rank)} in the Champions League`;
  }

  if (zones.promoteMaxRank > 0 && rank <= zones.promoteMaxRank) {
    return "You're in the promotion zone";
  }
  if (zones.relegateMinRank > 0 && rank >= zones.relegateMinRank) {
    return "You're in the relegation zone";
  }
  if (zones.promoteMaxRank > 0) {
    const promoEdge = standings.find((s) => s.rank === zones.promoteMaxRank);
    if (promoEdge && xp < promoEdge.xp) {
      const need = promoEdge.xp - xp + 1;
      if (need > 0) return `${need.toLocaleString('en-GB')} XP from promotion`;
    }
  }
  if (zones.relegateMinRank > 0) {
    const relegEdge = standings.find((s) => s.rank === zones.relegateMinRank);
    if (relegEdge && xp >= relegEdge.xp) {
      const clear = xp - relegEdge.xp;
      if (clear > 0) return `${clear.toLocaleString('en-GB')} XP clear of relegation`;
    }
  }
  return null;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
