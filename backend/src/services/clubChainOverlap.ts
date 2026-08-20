/**
 * Club Chain teammate overlap.
 *
 * `player_career` stores inclusive season-start years (2015 = 2015/16). API-Football and the
 * transfer feed often store a calendar leave year as `season_to` instead — Joe Cole left Coventry
 * in May 2016 (end of 2015/16) but is stored as 2015–2016, which the year-range check reads as
 * "also played 2016/17". That invents teammates with whoever arrived the following season
 * (Yakubu, Feb 2017).
 *
 * Transfer dates, when we have them, are the occupancy truth. Career years still fill clubs the
 * feed never recorded an arrival for (academy spells, missing rows).
 */

export interface DatedClubSpell {
  clubId: number;
  clubName: string;
  startYear: number;
  endYear: number;
  startDate?: string;
  endDate?: string;
}

export interface TransferMove {
  date: string;
  fromTeamId: number;
  toTeamId: number;
}

export interface DateRange {
  start: string;
  end: string;
}

/** Season-start year → approx first/last day (Aug 1 … 30 Jun of the following calendar year). */
export function seasonRangeDates(from: number, to: number): DateRange {
  return { start: `${from}-08-01`, end: `${to + 1}-06-30` };
}

export function spellDates(spell: DatedClubSpell): DateRange {
  if (spell.startDate && spell.endDate) return { start: spell.startDate, end: spell.endDate };
  return seasonRangeDates(spell.startYear, spell.endYear);
}

/** Strict overlap: the leave/join day itself does not count as playing together. */
export function datesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function spellsOverlap(a: DatedClubSpell, b: DatedClubSpell): boolean {
  return a.clubId === b.clubId && datesOverlap(spellDates(a), spellDates(b));
}

function seasonYearFromDate(iso: string, role: 'join' | 'leave'): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return year;
  if (role === 'leave') return month >= 8 ? year : year - 1;
  return month >= 6 ? year : year - 1;
}

function nextDeparture(moves: TransferMove[], teamId: number, after: string): TransferMove | undefined {
  return moves.find((move) => move.date > after && move.fromTeamId === teamId);
}

/**
 * Clip each career spell to transfer occupancy at that club when the feed has an arrival that
 * overlaps the stored years. Multi-stint careers become one spell per real stay, so a merged
 * 2003–2021 row does not invent teammates for the years in between.
 */
export function refineCareerSpells(spells: DatedClubSpell[], moves: TransferMove[]): DatedClubSpell[] {
  const sorted = [...moves]
    .filter((move) => move.date && (move.fromTeamId > 0 || move.toTeamId > 0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.toTeamId - b.toTeamId);

  const out: DatedClubSpell[] = [];
  for (const spell of spells) {
    const career = seasonRangeDates(spell.startYear, spell.endYear);
    const arrivals = sorted.filter((move) => move.toTeamId === spell.clubId);
    const stays: DateRange[] = [];
    for (const arrival of arrivals) {
      const leave = nextDeparture(sorted, spell.clubId, arrival.date);
      const stay: DateRange = {
        start: arrival.date,
        end: leave?.date ?? career.end,
      };
      if (stay.start >= stay.end) continue;
      if (datesOverlap(stay, career)) stays.push(stay);
    }

    if (stays.length === 0) {
      out.push({ ...spell, startDate: career.start, endDate: career.end });
      continue;
    }

    stays.sort((a, b) => a.start.localeCompare(b.start));
    const merged: DateRange[] = [];
    for (const stay of stays) {
      const last = merged[merged.length - 1];
      if (last && stay.start <= last.end) {
        if (stay.end > last.end) last.end = stay.end;
        continue;
      }
      merged.push({ ...stay });
    }

    for (const stay of merged) {
      out.push({
        ...spell,
        startDate: stay.start,
        endDate: stay.end,
        startYear: seasonYearFromDate(stay.start, 'join'),
        endYear: Math.max(seasonYearFromDate(stay.end, 'leave'), seasonYearFromDate(stay.start, 'join')),
      });
    }
  }
  return out;
}

/** Inclusive season-start years of a date overlap, for the "Shared X, 2013–2015" confirmation. */
export function overlapSeasonYears(a: DatedClubSpell, b: DatedClubSpell): { start: number; end: number } {
  const span = {
    start: a.startDate && b.startDate ? (a.startDate > b.startDate ? a.startDate : b.startDate) : '',
    end: a.endDate && b.endDate ? (a.endDate < b.endDate ? a.endDate : b.endDate) : '',
  };
  if (span.start && span.end) {
    return {
      start: seasonYearFromDate(span.start, 'join'),
      end: Math.max(seasonYearFromDate(span.end, 'leave'), seasonYearFromDate(span.start, 'join')),
    };
  }
  return {
    start: Math.max(a.startYear, b.startYear),
    end: Math.min(a.endYear, b.endYear),
  };
}
