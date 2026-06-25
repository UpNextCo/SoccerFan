/**
 * Fact-check the curated manager_tenures against Wikipedia's "Managerial career"
 * infobox (manageryearsN / managerclubsN fields) — an independent source. Flags:
 *   - CLUB NOT ON WIKI  → a club I listed that Wikipedia doesn't (possible hallucination)
 *   - DATE DIFF         → start year off by >1 from Wikipedia
 * Read-only, no DB writes.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normClub } from '../services/managerRules.js';

// Wikipedia titles where they differ from our stored name.
const TITLE: Record<string, string> = {
  'Sir Alex Ferguson': 'Alex Ferguson',
};

const ALIASES: Record<string, string[]> = {
  'bayern munchen': ['bayern munich', 'fc bayern munich', 'bayern'],
  inter: ['inter milan', 'internazionale', 'fc internazionale milano', 'internazionale milano'],
  'ac milan': ['milan', 'a c milan'],
  'paris saint germain': ['paris saint germain', 'psg'],
  porto: ['fc porto'],
  barcelona: ['fc barcelona'],
  'manchester united': ['manchester united'],
  tottenham: ['tottenham hotspur'],
  'atletico madrid': ['atletico madrid', 'atletico de madrid'],
  'borussia dortmund': ['borussia dortmund'],
  'bayer leverkusen': ['bayer leverkusen', 'bayer 04 leverkusen'],
  'rb leipzig': ['rb leipzig'],
  'athletic club': ['athletic bilbao', 'athletic club'],
  roma: ['as roma', 'roma'],
  hoffenheim: ['1899 hoffenheim', 'tsg 1899 hoffenheim'],
};

const GENERIC = new Set([
  'fc', 'cf', 'afc', 'ac', 'sc', 'ssc', 'cd', 'ud', 'rcd', 'calcio', 'club', 'cp', 'as',
  'ss', 'sv', 'tsg', 'vfb', 'vfl', 'bsc', 'city', 'de', '1899', '04', 'cf', 'b',
]);

function clubTokens(club: string): Set<string> {
  // expand through alias map first, then tokenize, dropping generic football words
  const base = normClub(club);
  let expanded = base;
  // collapse known aliases to a canonical token form for fair comparison
  for (const [canon, al] of Object.entries(ALIASES)) {
    if (base === canon || al.map(normClub).includes(base)) {
      expanded = canon;
      break;
    }
  }
  return new Set(expanded.split(' ').filter((t) => t && !GENERIC.has(t)));
}

/** Two clubs match if their significant-token sets are equal or one ⊆ the other. */
function clubMatch(a: string, b: string): boolean {
  const ta = clubTokens(a);
  const tb = clubTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

function stripWiki(v: string): string {
  return v
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2') // [[A|B]] -> B, [[A]] -> A
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<br\s*\/?>(.*)$/i, '')
    .replace(/[''‘’]/g, '')
    .trim();
}

function parseYears(v: string): { from: number | null; to: number | null } {
  const clean = v.replace(/<ref[\s\S]*?<\/ref>/gi, '').replace(/\{\{[^}]*\}\}/g, '');
  const years = clean.match(/\d{4}/g);
  const from = years && years[0] ? parseInt(years[0], 10) : null;
  let to: number | null = null;
  if (/present|current/i.test(clean)) to = 9999;
  else if (years && years[1]) to = parseInt(years[1], 10);
  else if (years && years[0]) to = parseInt(years[0], 10); // single year
  return { from, to };
}

interface WikiSpell {
  club: string;
  from: number | null;
  to: number | null;
}

async function fetchWithRetry(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BallKnowledge-factcheck/1.0 (manager data QA; contact dev@ballknowledge.app)' },
    });
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1))); // backoff on throttle
    }
  }
  throw new Error('rate-limited after retries');
}

async function fetchManagerCareer(title: string): Promise<WikiSpell[] | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&redirects=1&maxlag=5&titles=${encodeURIComponent(title)}`;
  const data: any = await fetchWithRetry(url);
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page: any = Object.values(pages)[0];
  const text: string | undefined = page?.revisions?.[0]?.slots?.main?.['*'];
  if (!text) return null;

  const spells: WikiSpell[] = [];
  for (let i = 1; i <= 40; i += 1) {
    const yRe = new RegExp(`\\|\\s*manageryears${i}\\s*=\\s*([^\\n]*)`);
    const cRe = new RegExp(`\\|\\s*managerclubs${i}\\s*=\\s*([^\\n]*)`);
    const ym = text.match(yRe);
    const cm = text.match(cRe);
    if (!cm) continue;
    const club = stripWiki(cm[1] ?? '');
    if (!club) continue;
    const { from, to } = ym ? parseYears(ym[1] ?? '') : { from: null, to: null };
    spells.push({ club, from, to });
  }
  return spells;
}

async function main() {
  const rows = (await db.execute(sql`
    SELECT manager, club, season_from AS "from", season_to AS "to"
    FROM manager_tenures ORDER BY manager, season_from
  `)) as unknown as Array<{ manager: string; club: string; from: number; to: number | null }>;

  const byManager = new Map<string, Array<{ club: string; from: number; to: number | null }>>();
  for (const r of rows) (byManager.get(r.manager) ?? byManager.set(r.manager, []).get(r.manager)!).push(r);

  let problems = 0;
  let okCount = 0;

  for (const [manager, spells] of byManager) {
    const title = TITLE[manager] ?? manager;
    let wiki: WikiSpell[] | null = null;
    try {
      wiki = await fetchManagerCareer(title);
    } catch (e) {
      console.log(`\n${manager}: FETCH ERROR (${(e as Error).message})`);
      continue;
    }
    if (!wiki || wiki.length === 0) {
      console.log(`\n${manager}: ⚠️  no Wikipedia infobox career found (title="${title}")`);
      continue;
    }

    const issues: string[] = [];
    for (const s of spells) {
      const matches = wiki.filter((w) => clubMatch(s.club, w.club));
      if (matches.length === 0) {
        issues.push(`  ❌ CLUB NOT ON WIKI: ${s.club} (${s.from}-${s.to ?? 'now'})`);
        problems += 1;
        continue;
      }
      // Closest start-year match.
      const near = matches.some((w) => w.from != null && Math.abs(w.from - s.from) <= 1);
      if (!near) {
        const wikiYears = matches.map((w) => `${w.from ?? '?'}-${w.to === 9999 ? 'now' : w.to ?? '?'}`).join(', ');
        issues.push(`  ⚠️  DATE DIFF: ${s.club} mine=${s.from}-${s.to ?? 'now'} wiki=[${wikiYears}]`);
        problems += 1;
      } else {
        okCount += 1;
      }
    }
    if (issues.length) {
      console.log(`\n${manager}:`);
      for (const i of issues) console.log(i);
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite
  }

  console.log(`\n=== Fact-check summary ===`);
  console.log(`  Tenures OK (club + start year within 1y): ${okCount}`);
  console.log(`  Flagged for review: ${problems}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
