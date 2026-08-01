/**
 * Work out which club a season's stat row belongs to, for rows that arrived without one.
 *
 * The Transfermarkt gap-fill (`job:import-tm-seasons`) reads a page that lists a player's seasons by
 * competition but never names the club, so ~4,900 rows hold real appearances with an empty team_name.
 * That is invisible to anything asking "who played for Leicester?" — Draft XI and Blind Rank resolve a
 * club constraint against `player_stats.team_name` — which is why Harry Kane's 13 Championship games
 * on loan at Leicester don't count as having played for them.
 *
 * The club history itself is known: `transferdata/transfers.csv` has every move with a date. Turning
 * that into candidate spells and intersecting with the row's season usually leaves one club, and where
 * it doesn't, the league settles it: a club plays in exactly one domestic division per season, so any
 * candidate we can see in a DIFFERENT division that season is not the answer. Kane's 2012/13
 * Championship row has three candidates (Tottenham, Norwich, Leicester); the first two are both in our
 * Premier League rows for that season, leaving Leicester.
 *
 * Spells are deliberately generous at both ends — a candidate that is too wide only costs us an
 * ambiguous row we then skip, whereas one that is too narrow silently loses the correct club.
 */

/** A club the player was contracted to, over an inclusive range of season start-years. */
export interface Spell {
  club: string;
  /** Source club id, kept so the caller can check the club's country against the row's league. */
  clubId?: string;
  fromSeason: number;
  toSeason: number;
}

/** One transfer as it appears in transfers.csv, already narrowed to what we use. */
export interface Transfer {
  date: string; // ISO yyyy-mm-dd
  toClub: string;
  toClubId?: string;
}

/** A stat row that needs a club, identified by the competition and season it was played in. */
export interface UnattributedRow {
  leagueId: number;
  season: number;
}

export interface AttributionEvidence {
  /** Clubs this player already has a named row for in this season, in any competition. */
  clubsPlayedForBySeason: (season: number) => Set<string>;
  /** Clubs we know played in this league in this season, from rows that do name a club. */
  clubsInLeagueSeason: (leagueId: number, season: number) => Set<string>;
  /** Domestic league ids, i.e. those where a club can appear in only one per season. */
  isDomestic: (leagueId: number) => boolean;
  /** Canonical comparison key for a club name (spelling varies between sources). */
  key: (club: string) => string;
}

export type Attribution =
  | { kind: 'resolved'; club: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'no-candidates' };

/**
 * Season start-year for a date, treating July as the turn of the year: an August 2013 move belongs to
 * 2013/14, a February 2013 move to 2012/13.
 */
export function seasonOf(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 7 ? year : year - 1;
}

/** Placeholders Transfermarkt uses in the club column when there is no club. */
const NOT_A_CLUB = /^(without club|unknown|retired|career break|ban|suspended|---)$/i;

/** Reserve, youth and women's sides — a senior league row is never theirs. */
const NOT_SENIOR = /(\bU\d{1,2}\b|\bII\b|\bB\b$|yth\.?$|youth|jgd|jeugd|academy|reserves?|women|ladies)/i;

export function isSeniorClub(club: string): boolean {
  const name = club.trim();
  if (!name || NOT_A_CLUB.test(name)) return false;
  return !NOT_SENIOR.test(name);
}

/**
 * Turn a player's moves into the spells they imply. Each transfer starts a spell at the club moved to,
 * which runs until the next move; the final spell is left open, capped by the caller's latest season.
 */
export function buildSpells(transfers: Transfer[], latestSeason: number): Spell[] {
  const sorted = [...transfers].sort((a, b) => a.date.localeCompare(b.date));
  const spells: Spell[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const move = sorted[i]!;
    if (!isSeniorClub(move.toClub)) continue;
    const next = sorted[i + 1];
    spells.push({
      club: move.toClub.trim(),
      ...(move.toClubId ? { clubId: move.toClubId } : {}),
      fromSeason: seasonOf(move.date),
      toSeason: next ? seasonOf(next.date) : latestSeason,
    });
  }
  return spells;
}

/** Merge a club's repeat spells so a returning player is one candidate, not several. */
function candidatesFor(spells: Spell[], season: number): string[] {
  const seen = new Map<string, string>();
  for (const s of spells) {
    if (season >= s.fromSeason && season <= s.toSeason) seen.set(s.club.toLowerCase(), s.club);
  }
  return [...seen.values()];
}

export function attributeRow(
  row: UnattributedRow,
  spells: Spell[],
  evidence: AttributionEvidence
): Attribution {
  const all = candidatesFor(spells, row.season);
  if (all.length === 0) return { kind: 'no-candidates' };
  if (all.length === 1) return { kind: 'resolved', club: all[0]! };

  // A club we can see in this very league and season is the answer, whatever else overlaps.
  const inThisLeague = evidence.clubsInLeagueSeason(row.leagueId, row.season);
  const confirmed = all.filter((c) => inThisLeague.has(evidence.key(c)));
  if (confirmed.length === 1) return { kind: 'resolved', club: confirmed[0]! };

  let candidates = confirmed.length > 1 ? confirmed : all;

  if (confirmed.length === 0) {
    if (evidence.isDomestic(row.leagueId)) {
      // Rule out clubs that were demonstrably in a different division that season. Only valid for a
      // domestic row: a club plays its own league AND Europe in the same season, so "seen elsewhere"
      // proves nothing about a European row.
      const elsewhere = candidates.filter((c) => {
        const k = evidence.key(c);
        for (const leagueId of LEAGUES_TO_CHECK) {
          if (leagueId === row.leagueId || !evidence.isDomestic(leagueId)) continue;
          if (evidence.clubsInLeagueSeason(leagueId, row.season).has(k)) return true;
        }
        return false;
      });
      const remaining = candidates.filter((c) => !elsewhere.includes(c));
      if (remaining.length > 0) candidates = remaining;
    } else {
      // A European row belongs to whichever club the player actually turned out for that season, which
      // his league row already names — the club that qualified is the one he played the tie for.
      const played = evidence.clubsPlayedForBySeason(row.season);
      const known = candidates.filter((c) => played.has(evidence.key(c)));
      if (known.length > 0) candidates = known;
    }
  }

  if (candidates.length === 1) return { kind: 'resolved', club: candidates[0]! };
  return { kind: 'ambiguous', candidates };
}

/** Domestic divisions we hold stats for; used to rule a candidate out by league. */
export const LEAGUES_TO_CHECK = [39, 40, 140, 135, 78, 61, 88, 94, 203, 307, 179, 253];
