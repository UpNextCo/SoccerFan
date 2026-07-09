/**
 * Ingest INTERNATIONAL career stats (goals + caps) from Wikipedia's canonical list pages into
 * player_extra_stats — our player_stats has almost no national-team rows, so without this the
 * "international goals" content (Bingo tile, future categories) can never fire.
 *
 * Sources (both parsed with the same row shape: rank | player | nation | … numbers):
 *   - "List of men's footballers with 50 or more international goals"   → goals + caps
 *   - "List of men's footballers with 100 or more international caps"   → caps (goals absent)
 *
 * Values MERGE by max: a player on both lists keeps the larger caps/goals figure, and existing
 * intl_caps from earlier ingests are never lowered.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-intl-stats            # parse + write
 *   DATABASE_URL=... npm run job:ingest-intl-stats -- --dry   # parse + report only
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const GOALS_PAGE = "List of men's footballers with 50 or more international goals";
const CAPS_PAGE = "List of men's footballers with 100 or more international caps";

/** FIFA codes from {{fb|EGY}} nation cells → canonical nationality (matches players.nationality). */
const FIFA_CODE: Record<string, string> = {
  ALG: 'Algeria', ARG: 'Argentina', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium',
  BRA: 'Brazil', CMR: 'Cameroon', CHI: 'Chile', COL: 'Colombia', CRO: 'Croatia',
  CIV: 'Ivory Coast', CZE: 'Czech Republic', DEN: 'Denmark', ECU: 'Ecuador', EGY: 'Egypt',
  ENG: 'England', FRA: 'France', GER: 'Germany', GHA: 'Ghana', GRE: 'Greece',
  IRN: 'Iran', ITA: 'Italy', JPN: 'Japan', KSA: 'Saudi Arabia', KOR: 'South Korea',
  MEX: 'Mexico', MAR: 'Morocco', NED: 'Netherlands', NGA: 'Nigeria', NOR: 'Norway',
  PAR: 'Paraguay', POL: 'Poland', POR: 'Portugal', ROU: 'Romania', RUS: 'Russia',
  SCO: 'Scotland', SEN: 'Senegal', SRB: 'Serbia', RSA: 'South Africa', ESP: 'Spain',
  SWE: 'Sweden', SUI: 'Switzerland', TUN: 'Tunisia', TUR: 'Turkey', UKR: 'Ukraine',
  URU: 'Uruguay', USA: 'United States', WAL: 'Wales',
};

function nationFrom(cell: string): string | null {
  const m = cell.match(/\{\{\s*fb[a-z-]*\s*\|\s*([A-Za-z]{3})/i);
  if (!m) return null;
  return FIFA_CODE[m[1]!.toUpperCase()] ?? null;
}

function nationalityMatches(dbNat: string | null | undefined, wikiNat: string): boolean {
  if (!dbNat || !wikiNat) return false;
  const a = dbNat.toLowerCase();
  const b = wikiNat.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { parse?: { wikitext?: string } };
  return data?.parse?.wikitext ?? null;
}

function cleanCell(raw: string): string {
  return raw
    .replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{#expr:[^}]*\}\}/g, '')
    .trim();
}

/** Player display name from a cell: [[link|label]], [[link]], or {{sort name|First|Last}}. */
function playerFrom(cell: string): string {
  const sn = cell.match(/\{\{\s*sort ?name\s*\|([^|}]+)\|([^|}]+)/i);
  if (sn) return `${sn[1]!.trim()} ${sn[2]!.trim()}`;
  const link = cell.match(/\[\[([^\]]+)\]\]/);
  if (!link) return '';
  const inner = link[1]!;
  return (inner.includes('|') ? inner.split('|').pop()! : inner).replace(/\([^)]*\)/g, '').trim();
}

interface IntlRow {
  player: string;
  nation: string | null;
  goals: number | null;
  caps: number | null;
}

/**
 * Both list pages are one big sortable table: rank | player | nation | confederation | numbers…
 * The goals page has goals then caps as the first two numeric cells after the confederation;
 * the caps page has caps only. Numeric cells may themselves be wikilinks
 * ("[[List of international goals scored by…|145]]") or header-styled ("! 231").
 */
function parseList(wt: string, kind: 'goals' | 'caps'): IntlRow[] {
  const tables = [...wt.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map((m) => m[0]);
  const table = tables.sort((a, b) => b.length - a.length)[0];
  if (!table) return [];

  const out: IntlRow[] = [];
  for (const row of table.split(/\n[|!]-/)) {
    // Split the row into cells (both | and ! cell markers appear in these tables).
    const cells = row
      .split(/\n\s*[|!]|\|\||!!/)
      .map(cleanCell)
      .filter((c) => c.length > 0);
    if (cells.length < 4) continue;

    // Find the player cell: the first cell containing a wikilink to a person (skip the rank cell).
    let playerIdx = -1;
    let player = '';
    for (let i = 0; i < Math.min(cells.length, 4); i += 1) {
      const name = playerFrom(cells[i]!);
      // Nation cells are {{fb|POR}} templates — playerFrom won't match those.
      if (name && !/\{\{\s*fb[b]?\s*\|/i.test(cells[i]!)) {
        playerIdx = i;
        player = name;
        break;
      }
    }
    if (!player) continue;

    let nation: string | null = null;
    for (let i = playerIdx + 1; i < Math.min(cells.length, playerIdx + 4); i += 1) {
      nation = nationFrom(cells[i]!);
      if (nation) break;
    }

    // Numbers after the nation/confederation cells: first numeric = goals (goals page) or caps
    // (caps page); on the goals page the second numeric is caps.
    const nums: number[] = [];
    for (let i = playerIdx + 1; i < cells.length && nums.length < 2; i += 1) {
      const c = cells[i]!;
      if (/\{\{\s*fb[b]?\s*\|/i.test(c) || /\[\[(UEFA|CONMEBOL|CONCACAF|CAF|AFC|OFC)\]\]/.test(c)) continue;
      // Cell may be a plain number, a piped link with numeric label, or contain a date — take a
      // standalone integer ≤ 400 (caps/goals range) and reject 4-digit years.
      const label = playerFrom(c);
      const source = /^\d+$/.test(label) ? label : c.replace(/\[\[[^\]]*\]\]/g, (m) => playerFrom(m));
      const nm = source.match(/(?<!\d)(\d{1,3})(?!\d)/);
      if (nm) nums.push(parseInt(nm[1]!, 10));
      else if (nums.length > 0) break; // numbers ended (career span / dates follow)
    }
    if (nums.length === 0) continue;

    if (kind === 'goals') out.push({ player, nation, goals: nums[0]!, caps: nums[1] ?? null });
    else out.push({ player, nation, goals: null, caps: nums[0]! });
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');

  const [goalsWt, capsWt] = await Promise.all([fetchWikitext(GOALS_PAGE), fetchWikitext(CAPS_PAGE)]);
  if (!goalsWt || !capsWt) {
    console.error(`Failed to fetch: goals=${!!goalsWt} caps=${!!capsWt}`);
    process.exit(1);
  }
  const goalRows = parseList(goalsWt, 'goals');
  const capRows = parseList(capsWt, 'caps');
  console.log(`Parsed: ${goalRows.length} rows from 50+ goals list, ${capRows.length} rows from 100+ caps list`);

  // Merge by normalized name, keeping max values (and the nation tag from whichever row had it).
  const merged = new Map<string, { player: string; nation: string | null; goals: number; caps: number }>();
  for (const r of [...goalRows, ...capRows]) {
    const k = normalizeSearchText(r.player);
    const e = merged.get(k) ?? { player: r.player, nation: r.nation, goals: 0, caps: 0 };
    e.goals = Math.max(e.goals, r.goals ?? 0);
    e.caps = Math.max(e.caps, r.caps ?? 0);
    if (!e.nation && r.nation) e.nation = r.nation;
    merged.set(k, e);
  }

  // Match to players (name or alias; tie-break by nation then career apps / birth year).
  const players = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, p.birth_date::text AS birth_date, p.aliases,
           COALESCE(SUM(s.appearances),0)::int AS apps
    FROM players p LEFT JOIN player_stats s ON s.player_id = p.id GROUP BY p.id
  `)) as unknown as Array<{ id: string; name: string; nationality: string | null; birth_date: string | null; aliases: string[]; apps: number }>;
  const byName = new Map<string, Array<{ id: string; apps: number; nationality: string | null; birthYear: number | null }>>();
  const add = (k: string, id: string, apps: number, nationality: string | null, birthYear: number | null) => {
    if (!k) return;
    const arr = byName.get(k);
    const row = { id, apps, nationality, birthYear };
    if (arr) arr.push(row);
    else byName.set(k, [row]);
  };
  for (const p of players) {
    const birthYear = p.birth_date ? parseInt(p.birth_date.slice(0, 4), 10) : null;
    add(normalizeSearchText(p.name), p.id, p.apps, p.nationality, birthYear);
    for (const a of Array.isArray(p.aliases) ? p.aliases : []) {
      add(normalizeSearchText(a), p.id, p.apps, p.nationality, birthYear);
    }
  }

  let matched = 0;
  let unmatched = 0;
  const updates: Array<{ id: string; goals: number; caps: number; player: string }> = [];
  for (const e of merged.values()) {
    const cands = byName.get(normalizeSearchText(e.player));
    if (!cands || cands.length === 0) {
      unmatched += 1;
      continue;
    }
    let pool = cands;
    if (e.nation) {
      const natFiltered = cands.filter((c) => nationalityMatches(c.nationality, e.nation!));
      if (natFiltered.length > 0) pool = natFiltered;
    }
    const pick = pool.slice().sort((a, b) => {
      if (e.caps >= 100) {
        const ay = a.birthYear ?? 9999;
        const by = b.birthYear ?? 9999;
        if (ay !== by) return ay - by;
      }
      return b.apps - a.apps;
    })[0]!;
    matched += 1;
    updates.push({ id: pick.id, goals: e.goals, caps: e.caps, player: e.player });
  }
  console.log(`Matched ${matched} players (${unmatched} not in DB — mostly pre-1990s internationals)`);

  const top = [...updates].sort((a, b) => b.goals - a.goals).slice(0, 10);
  for (const t of top) console.log(`  ${t.player}: ${t.goals} goals · ${t.caps} caps`);

  if (dry) {
    console.log('\n--dry: no writes.');
    process.exit(0);
  }

  await db.execute(sql`ALTER TABLE player_extra_stats ADD COLUMN IF NOT EXISTS intl_goals integer NOT NULL DEFAULT 0`);

  // Only trust career-scale caps (≥30). Tiny figures are almost always parse/match noise
  // (or World Cup scraps) and must not overwrite a clean 0 via GREATEST.
  const CAPS_TRUST_MIN = 30;
  let written = 0;
  let skippedTinyCaps = 0;
  for (const u of updates) {
    const caps = u.caps >= CAPS_TRUST_MIN ? u.caps : 0;
    if (u.caps > 0 && u.caps < CAPS_TRUST_MIN) skippedTinyCaps += 1;
    if (caps === 0 && u.goals === 0) continue;
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, intl_goals, intl_caps)
      VALUES (${u.id}::uuid, ${u.goals}, ${caps})
      ON CONFLICT (player_id) DO UPDATE SET
        intl_goals = GREATEST(player_extra_stats.intl_goals, EXCLUDED.intl_goals),
        intl_caps = CASE
          WHEN EXCLUDED.intl_caps >= ${CAPS_TRUST_MIN}
            THEN GREATEST(player_extra_stats.intl_caps, EXCLUDED.intl_caps)
          ELSE player_extra_stats.intl_caps
        END,
        updated_at = now()
    `);
    written += 1;
  }
  if (skippedTinyCaps > 0) {
    console.log(`Skipped ${skippedTinyCaps} rows with tiny caps (<${CAPS_TRUST_MIN}) — not trusted as career totals`);
  }
  console.log(`\nWrote ${written} player rows into player_extra_stats (intl_goals + intl_caps, merged by max).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
