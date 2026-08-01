/**
 * Classifies Transfermarkt competition names from the per-season performance scrape
 * (transferdata/tm_seasons.jsonl).
 *
 * That page lists a player's WHOLE club career, which mixes senior football (leagues, domestic cups,
 * super cups, continental competitions and their qualifying rounds) with academy football (U17/U19
 * Bundesliga, Premier League 2, UEFA Youth League, reserve leagues). A career total has to count the
 * first group and drop the second, or a youth-team hat-trick inflates a legend's tally.
 */

/** Academy, youth-cup and reserve-team competitions — real matches, but not senior career goals. */
const YOUTH_OR_RESERVE = [
  /\bu-?(?:1[0-9]|2[0-3])\b/i, // U17-Bundesliga, U19 Süper Lig, Brasileiro U20 - Finals, U21 PL Knockout
  /youth|junior|juniori|juniorska|jugend|nachwuchs|revelação|revelacao/i,
  /\breserves?\b|reserveligaen/i,
  /amateurmeisterschaft/i,
];

/** The English U21 development league, whose name carries no age marker at all. */
const PREMIER_LEAGUE_2 = /^premier league 2$/i;

/**
 * National-team competitions. The performance page we scrape is club-only, so these should never
 * appear — this is a guard so an international goal can't silently land in a CLUB total if
 * Transfermarkt changes that page's contents.
 */
const INTERNATIONAL =
  /world cup|european championship|euro qualif|copa américa|copa america|africa cup|afc asian cup|gold cup|nations league|confederations cup|olympic|friendlies$/i;

/** Club competitions whose names collide with the international patterns above. */
const CLUB_DESPITE_INTERNATIONAL_NAME = /club world cup/i;

export const isYouthOrReserveComp = (comp: string): boolean =>
  PREMIER_LEAGUE_2.test(comp.trim()) || YOUTH_OR_RESERVE.some((re) => re.test(comp));

export const isInternationalComp = (comp: string): boolean =>
  !CLUB_DESPITE_INTERNATIONAL_NAME.test(comp) && INTERNATIONAL.test(comp.trim());

/** True when a scraped row counts towards a senior CLUB career total. */
export const countsForClubCareer = (comp: string): boolean =>
  comp.trim() !== '' && !isYouthOrReserveComp(comp) && !isInternationalComp(comp);
