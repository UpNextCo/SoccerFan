import { normalizeTeamName } from './teamName.js';

/**
 * Map noisy player_stats team_name variants → one dedupe key. Keeps bingo/tower from
 * treating "Inter", "Inter Milan" and "Internazionale" as different clubs.
 */
const ALIAS_TO_KEY: Record<string, string> = {
  'inter milan': 'inter',
  internazionale: 'inter',
  'internazionale milano': 'inter',
  'fc internazionale milano': 'inter',
  'ac milan': 'milan',
  milan: 'milan',
  'bayern munich': 'bayern munchen',
  'bayern munich fc': 'bayern munchen',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'paris saint germain': 'paris saint germain',
  'paris saint germain fc': 'paris saint germain',
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  'tottenham hotspur': 'tottenham',
  spurs: 'tottenham',
  'manchester utd': 'manchester united',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'manchester city': 'manchester city',
  'man city': 'manchester city',
  'borussia dortmund': 'borussia dortmund',
  dortmund: 'borussia dortmund',
  bvb: 'borussia dortmund',
  'borussia monchengladbach': 'borussia monchengladbach',
  'borussia m gladbach': 'borussia monchengladbach',
  gladbach: 'borussia monchengladbach',
  'bayer leverkusen': 'bayer leverkusen',
  leverkusen: 'bayer leverkusen',
  'rb leipzig': 'rb leipzig',
  leipzig: 'rb leipzig',
  'sporting cp': 'sporting cp',
  'sporting lisbon': 'sporting cp',
  porto: 'porto',
  'fc porto': 'porto',
  barcelona: 'barcelona',
  'fc barcelona': 'barcelona',
  'real madrid': 'real madrid',
  'real madrid cf': 'real madrid',
  juventus: 'juventus',
  'juventus fc': 'juventus',
  inter: 'inter',
  roma: 'roma',
  'as roma': 'roma',
  napoli: 'napoli',
  'ssc napoli': 'napoli',
  'athletic club': 'athletic club',
  'athletic bilbao': 'athletic club',
  'ath bilbao': 'athletic club',
};

/** Preferred display label per canonical key (for tiles + crest lookup). */
const KEY_DISPLAY: Record<string, string> = {
  inter: 'Inter',
  milan: 'AC Milan',
  'bayern munchen': 'Bayern München',
  'atletico madrid': 'Atlético Madrid',
  'paris saint germain': 'Paris Saint Germain',
  tottenham: 'Tottenham',
  'manchester united': 'Manchester United',
  'manchester city': 'Manchester City',
  'borussia dortmund': 'Borussia Dortmund',
  'borussia monchengladbach': 'Borussia Mönchengladbach',
  'bayer leverkusen': 'Bayer Leverkusen',
  'rb leipzig': 'RB Leipzig',
  'sporting cp': 'Sporting CP',
  porto: 'Porto',
  barcelona: 'Barcelona',
  'real madrid': 'Real Madrid',
  juventus: 'Juventus',
  roma: 'Roma',
  napoli: 'Napoli',
  'athletic club': 'Athletic Club',
};

/** Stable dedupe key for a club name. */
export function clubKey(raw: string): string {
  const base = normalizeTeamName(raw);
  if (!base) return '';
  return ALIAS_TO_KEY[base] ?? base;
}

/** One display name + crest lookup string per club. */
export function canonicalClubName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const key = clubKey(trimmed);
  return KEY_DISPLAY[key] ?? trimmed;
}

/** Dedupe a club list after canonicalization. */
export function canonicalClubList(clubs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of clubs) {
    const name = canonicalClubName(raw);
    const key = clubKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Build a `clubKey -> single display string` map from a corpus of raw club names. This is what
 * lets the iOS Football Bingo matcher (plain string-equality on the normalized name) agree with
 * the server's clubKey()-based matcher: every raw spelling that shares a key (e.g. "Augsburg" /
 * "FC Augsburg", "Inter" / "Inter Milan") must render as ONE identical label everywhere in the
 * shipped puzzle. Prefers the curated KEY_DISPLAY label, else the most frequent raw spelling.
 */
export function buildClubDisplayMap(rawNames: string[]): Map<string, string> {
  const freq = new Map<string, Map<string, number>>();
  for (const raw of rawNames) {
    const key = clubKey(raw);
    if (!key) continue;
    const display = KEY_DISPLAY[key] ?? raw.trim();
    const inner = freq.get(key) ?? new Map<string, number>();
    inner.set(display, (inner.get(display) ?? 0) + 1);
    freq.set(key, inner);
  }
  const out = new Map<string, string>();
  for (const [key, inner] of freq) {
    const best =
      KEY_DISPLAY[key] ??
      [...inner.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    out.set(key, best);
  }
  return out;
}

/** Dedupe + canonicalize a club list using a prebuilt one-label-per-key display map. */
export function canonicalClubListWith(clubs: string[], displayMap: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of clubs) {
    const key = clubKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(displayMap.get(key) ?? canonicalClubName(raw));
  }
  return out;
}
