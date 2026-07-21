/**
 * Ingest international caps into player_extra_stats.intl_caps (merge by max, never lower).
 *
 * Phase 1 — Per-nation Wikipedia list pages (tables + Serbia-style bullet lists).
 * Phase 2 — Wikipedia player-infobox backfill for anyone still missing trusted caps
 *            (covers players absent from nation lists, e.g. Luka Milivojević).
 *
 * Wikipedia senior totals are written at any size ≥1 (real careers include 5–29 caps).
 * Transfermarkt still gates at INTL_CAPS_TRUST_MIN separately.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-national-caps
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --dry
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --nations=England,Serbia
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --skip-infobox
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --infobox-only
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { INTL_CAPS_DISPLAY_MIN, INTL_CAPS_SANITY_MAX } from '../services/statMetrics.js';

/** Nation-list table parsers stay ≥20 to avoid mistaking minutes/years for caps. */
const NATION_LIST_CAPS_MIN = 20;
/** Infobox senior nationalteam rows — accept full career totals of any size. */
const INFOBOX_CAPS_MIN = INTL_CAPS_DISPLAY_MIN;

const UA = 'BallKnowledgeCapsBot/1.0 (contact@upnextapp.co)';

/** Nations + Wikipedia list pages that expose caps (and usually goals) per player. */
const NATION_PAGES: Array<{ nation: string; page: string }> = [
  { nation: 'England', page: 'List of England international footballers' },
  { nation: 'Italy', page: 'List of Italy international footballers' },
  { nation: 'Germany', page: 'List of Germany international footballers' },
  { nation: 'Spain', page: "List of Spain men's international footballers" },
  { nation: 'France', page: 'List of France international footballers' },
  { nation: 'Portugal', page: 'List of Portugal international footballers' },
  { nation: 'Netherlands', page: 'List of Netherlands international footballers' },
  { nation: 'Belgium', page: 'List of Belgium international footballers' },
  { nation: 'Argentina', page: 'List of Argentina international footballers' },
  { nation: 'Brazil', page: 'List of Brazil international footballers' },
  { nation: 'Uruguay', page: 'List of Uruguay international footballers' },
  { nation: 'Croatia', page: 'List of Croatia international footballers' },
  { nation: 'Serbia', page: 'List of Serbia international footballers' },
  { nation: 'Sweden', page: 'List of Sweden international footballers' },
  { nation: 'Switzerland', page: 'List of Switzerland international footballers' },
  { nation: 'Denmark', page: 'List of Denmark international footballers' },
  { nation: 'Greece', page: 'List of Greece international footballers' },
  { nation: 'Czech Republic', page: 'List of Czech Republic international footballers' },
  { nation: 'Romania', page: 'List of Romania international footballers' },
  { nation: 'Mexico', page: 'List of Mexico international footballers' },
  { nation: 'Russia', page: 'List of Russia international footballers' },
  { nation: 'Turkey', page: 'List of Turkey international footballers' },
  { nation: 'Poland', page: 'List of Poland international footballers' },
  { nation: 'Norway', page: 'List of Norway international footballers' },
  { nation: 'Austria', page: 'List of Austria international footballers' },
  { nation: 'Wales', page: 'List of Wales international footballers' },
  { nation: 'Scotland', page: 'List of Scotland international footballers' },
  { nation: 'Ireland', page: 'List of Republic of Ireland international footballers' },
  { nation: 'USA', page: "List of United States men's international soccer players" },
  { nation: 'Japan', page: 'List of Japan international footballers' },
  { nation: 'Ukraine', page: 'List of Ukraine international footballers' },
  { nation: 'Hungary', page: 'List of Hungary international footballers' },
  { nation: 'Slovakia', page: 'List of Slovakia international footballers' },
  { nation: 'Bulgaria', page: 'List of Bulgaria international footballers' },
  { nation: 'Colombia', page: 'List of Colombia international footballers' },
  { nation: 'Chile', page: 'List of Chile national football team players' },
  { nation: 'Paraguay', page: 'List of Paraguay national football team players' },
  { nation: 'Australia', page: 'List of Australia international soccer players' },
  { nation: 'Nigeria', page: 'List of Nigeria national football team players' },
  { nation: 'Ghana', page: 'List of Ghana national football team players' },
  { nation: 'Cameroon', page: 'List of Cameroon national football team players' },
  { nation: 'Ivory Coast', page: "List of Ivory Coast international footballers" },
  { nation: 'Senegal', page: 'List of Senegal national football team players' },
  { nation: 'Morocco', page: 'List of Morocco national football team players' },
  { nation: 'Egypt', page: 'List of Egypt national football team players' },
  { nation: 'South Korea', page: 'List of South Korea national football team players' },
  { nation: 'Costa Rica', page: 'List of Costa Rica international footballers' },
];

async function wikiFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    console.warn(`  wiki fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await wikiFetch(url);
  if (!res?.ok) return null;
  const data = (await res.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (data.error) {
    console.warn(`  wiki error for ${title}: ${data.error.info}`);
    return null;
  }
  const wt = data?.parse?.wikitext ?? null;
  if (wt && wt.length < 2000 && /\{\{\s*list of lists/i.test(wt)) {
    console.warn(`  skipping stub/disambiguation: ${title}`);
    return null;
  }
  return wt;
}

interface CapRow {
  player: string;
  caps: number;
  goals: number;
}

function pipeNums(text: string): number[] {
  const nums: number[] = [];
  for (const m of text.matchAll(/\|\s*(\d{1,3})\s*(?=\||$)/g)) {
    nums.push(parseInt(m[1]!, 10));
  }
  return nums;
}

function plausibleCaps(n: number): boolean {
  return n >= NATION_LIST_CAPS_MIN && n <= INTL_CAPS_SANITY_MAX;
}

function parseCapsCell(raw: string): number | null {
  // Infoboxes sometimes put multiple fields on one line (`caps = 3 |nationalgoals3 = 0`).
  // Only read the first cell; never concatenate digits across pipes.
  const cell = (raw.split('|')[0] ?? raw).trim();
  const nts = cell.match(/\{\{\s*nts\s*\|\s*(\d+)\s*\}\}/i);
  if (nts) {
    const n = parseInt(nts[1]!, 10);
    return Number.isFinite(n) ? n : null;
  }
  const m = cell.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRow(row: string): CapRow | null {
  if (!/\[\[/.test(row) && !/\{\{\s*sort\s*name/i.test(row)) return null;

  let player = '';
  let playerAt = -1;
  for (const m of row.matchAll(
    /\{\{\s*sort ?name\s*\|([^|}]+)\|([^|}]+)[^}]*\}\}|\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/gi
  )) {
    const name =
      m[1] && m[2]
        ? `${m[1].trim()} ${m[2].trim()}`
        : (m[4] ?? m[3] ?? '').replace(/\([^)]*\)/g, '').replace(/<[^>]+>/g, '').trim();
    if (
      !name ||
      /^(Goalkeeper|Defender|Midfielder|Forward|Full back|GK|DF|MF|FW)$/i.test(name) ||
      /^(UEFA|FIFA|World Cup|Euro|File:)/i.test(name)
    ) {
      continue;
    }
    player = name;
    playerAt = m.index ?? 0;
    break;
  }
  if (!player || playerAt < 0) return null;

  const after = row.slice(playerAt);

  const nts = [...row.matchAll(/\{\{\s*nts\s*\|\s*(\d+)\s*\}\}/gi)].map((m) => parseInt(m[1]!, 10));
  if (nts.length >= 3) {
    const goals = nts[2]! <= 150 ? nts[2]! : 0;
    if (nts[0]! <= 40 && plausibleCaps(nts[1]!)) return { player, caps: nts[1]!, goals };
    if (plausibleCaps(nts[1]!) && nts[1]! < nts[0]!) return { player, caps: nts[1]!, goals };
  } else if (nts.length === 2 && plausibleCaps(nts[0]!)) {
    return { player, caps: nts[0]!, goals: nts[1]! <= 150 ? nts[1]! : 0 };
  }

  // Year-span rows:
  //   USA/Spain field players: … caps · goals · 2000–2014  → use last 2 nums BEFORE years
  //   Spain rank tables: … 2009–2013 · caps · goals     → use nums AFTER years
  //   USA keeper tables: … mins(270) · … · 2016–2017    → last-2-before often tiny → skip
  const span = after.match(/\d{4}\s*[–-]\s*(?:\d{4}|present)?/i);
  if (span && span.index != null) {
    const beforeYears = pipeNums(after.slice(0, span.index));
    if (beforeYears.length >= 2) {
      const caps = beforeYears[beforeYears.length - 2]!;
      const goals = beforeYears[beforeYears.length - 1]!;
      if (plausibleCaps(caps) && goals <= 150) return { player, caps, goals };
    } else if (beforeYears.length === 1 && plausibleCaps(beforeYears[0]!)) {
      return { player, caps: beforeYears[0]!, goals: 0 };
    }
    const afterYears = pipeNums(after.slice(span.index + span[0].length));
    if (afterYears.length >= 1 && plausibleCaps(afterYears[0]!)) {
      return {
        player,
        caps: afterYears[0]!,
        goals: afterYears[1] != null && afterYears[1] <= 150 ? afterYears[1]! : 0,
      };
    }
  }

  const aligned = [...after.matchAll(/align\s*=\s*"?right"?\s*\|\s*(\d{1,3})/gi)].map((m) =>
    parseInt(m[1]!, 10)
  );
  if (aligned.length >= 1 && plausibleCaps(aligned[0]!)) {
    return {
      player,
      caps: aligned[0]!,
      goals: aligned[1] != null && aligned[1] <= 150 ? aligned[1]! : 0,
    };
  }

  const cleaned = after
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/data-sort-value\s*=\s*"[^"]*"/gi, ' ')
    .replace(/<ref[\s\S]*?(\/>|<\/ref>)/gi, ' ');
  const nums = pipeNums(cleaned);
  const i = nums.findIndex(plausibleCaps);
  if (i < 0) return null;
  return {
    player,
    caps: nums[i]!,
    goals: nums[i + 1] != null && nums[i + 1]! <= 150 ? nums[i + 1]! : 0,
  };
}

/** Serbia / Yugoslavia style: * [[Player]] (1995/2001) 38/2 */
function parseBulletRows(wt: string): CapRow[] {
  const out: CapRow[] = [];
  for (const line of wt.split('\n')) {
    if (!/^\*/.test(line) || !/\[\[/.test(line)) continue;
    const link = line.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
    if (!link) continue;
    const player = (link[2] ?? link[1]!).replace(/\([^)]*\)/g, '').trim();
    if (!player) continue;
    const m = line.match(/\)\s*(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (!m) continue;
    const caps = parseInt(m[1]!, 10);
    const goals = parseInt(m[2]!, 10);
    if (!plausibleCaps(caps)) continue;
    out.push({ player, caps, goals: goals <= 150 ? goals : 0 });
  }
  return out;
}

function parseNationRows(wt: string): CapRow[] {
  const out: CapRow[] = [];
  const seen = new Map<string, CapRow>();
  const add = (parsed: CapRow) => {
    const k = normalizeSearchText(parsed.player);
    const prev = seen.get(k);
    if (!prev || parsed.caps > prev.caps) seen.set(k, parsed);
  };
  for (const row of wt.split(/\n\|-/)) {
    const parsed = parseRow(row);
    if (parsed) add(parsed);
  }
  for (const parsed of parseBulletRows(wt)) add(parsed);
  return [...seen.values()];
}

function nationalityMatches(dbNat: string | null | undefined, wikiNat: string): boolean {
  if (!dbNat || !wikiNat) return false;
  const a = normalizeSearchText(dbNat);
  const b = normalizeSearchText(wikiNat);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aliases: Record<string, string[]> = {
    usa: ['united states', 'united states of america', 'us'],
    'united states': ['usa', 'us'],
    'ivory coast': ["cote d'ivoire", 'cote divoire'],
    "cote d'ivoire": ['ivory coast'],
    'czech republic': ['czechia'],
    czechia: ['czech republic'],
    'south korea': ['korea republic', 'korea'],
    ireland: ['republic of ireland'],
    'republic of ireland': ['ireland'],
  };
  return (aliases[a] ?? []).some((x) => x === b || b.includes(x))
    || (aliases[b] ?? []).some((x) => x === a || a.includes(x));
}

async function upsertCaps(
  updates: Array<{ id: string; caps: number; goals: number }>,
  dry: boolean
): Promise<{ written: number; improved: number; skippedTiny: number }> {
  let written = 0;
  let improved = 0;
  let skippedTiny = 0;
  for (const u of updates) {
    const caps =
      u.caps >= INFOBOX_CAPS_MIN && u.caps <= INTL_CAPS_SANITY_MAX ? u.caps : 0;
    if (u.caps > 0 && caps === 0) skippedTiny += 1;
    if (caps === 0 && u.goals === 0) continue;
    if (dry) {
      written += 1;
      continue;
    }
    const before = (await db.execute(sql`
      SELECT COALESCE(intl_caps, 0)::int AS caps FROM player_extra_stats WHERE player_id = ${u.id}::uuid
    `)) as unknown as Array<{ caps: number }>;
    const prev = before[0]?.caps ?? 0;
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, intl_goals, intl_caps)
      VALUES (${u.id}::uuid, ${u.goals}, ${caps})
      ON CONFLICT (player_id) DO UPDATE SET
        intl_goals = GREATEST(player_extra_stats.intl_goals, EXCLUDED.intl_goals),
        intl_caps = CASE
          WHEN EXCLUDED.intl_caps >= ${INFOBOX_CAPS_MIN}
            AND EXCLUDED.intl_caps <= ${INTL_CAPS_SANITY_MAX}
            THEN GREATEST(player_extra_stats.intl_caps, EXCLUDED.intl_caps)
          ELSE player_extra_stats.intl_caps
        END,
        updated_at = now()
    `);
    written += 1;
    if (caps > prev) improved += 1;
  }
  return { written, improved, skippedTiny };
}

/** Senior national-team caps from a player article infobox (skips U21 / youth). */
function seniorCapsFromInfobox(wt: string): { caps: number; goals: number } | null {
  let bestCaps = 0;
  let bestGoals = 0;
  for (let i = 1; i <= 8; i += 1) {
    const teamM = wt.match(new RegExp(`\\|\\s*nationalteam${i}\\s*=\\s*([^\\n]+)`, 'i'));
    const capsM = wt.match(new RegExp(`\\|\\s*nationalcaps${i}\\s*=\\s*([^\\n]+)`, 'i'));
    const goalsM = wt.match(new RegExp(`\\|\\s*nationalgoals${i}\\s*=\\s*([^\\n]+)`, 'i'));
    if (!teamM || !capsM) continue;
    const team = teamM[1]!;
    if (!/national (football|soccer) team/i.test(team)) continue;
    if (
      /under[- ]?\d|u-?\d{1,2}|olympic|youth|amateur|b team|universiade|\|\s*[^|\]]*?\bB\s*\]|national football team\|\s*[^|\]]*?\bB\b/i.test(
        team
      )
    ) {
      continue;
    }
    const caps = parseCapsCell(capsM[1]!);
    if (caps == null) continue;
    const goals = goalsM ? parseCapsCell(goalsM[1]!) ?? 0 : 0;
    if (caps > bestCaps && caps <= INTL_CAPS_SANITY_MAX) {
      bestCaps = caps;
      bestGoals = goals <= 150 ? goals : 0;
    }
  }
  return bestCaps > 0 ? { caps: bestCaps, goals: bestGoals } : null;
}

function titleMatchesPlayer(playerName: string, title: string): boolean {
  const p = normalizeSearchText(playerName);
  const t = normalizeSearchText(title.replace(/\(.*?\)/g, '').trim());
  if (!p || !t || /^list of |^category:|disambiguation|given name|surname|name\)$/i.test(title)) {
    return false;
  }
  if (/given name|surname|^category:/i.test(t)) return false;
  const pParts = p.split(' ').filter(Boolean);
  const tParts = t.split(' ').filter(Boolean);
  // Mononyms ("Ricardo", "Pepe") must be an exact title match — search often drifts to legends.
  if (pParts.length === 1) return t === p;
  if (t === p) return true;
  // Full name as a contiguous prefix ("X Y (footballer…)" after paren strip → "x y").
  if (t.startsWith(p + ' ') || t.startsWith(p)) return t === p || t.startsWith(p + ' ');
  // Same token count, order-flexible (e.g. "Park Ji-sung" ↔ rare reorderings). Blocks
  // "Luís Morte" → "Luís Boa Morte" (extra middle token).
  if (tParts.length !== pParts.length) return false;
  return pParts.every((tok) => tok.length >= 2 && tParts.includes(tok));
}

function infoboxNationMatches(wt: string, nationality: string): boolean {
  for (let i = 1; i <= 8; i += 1) {
    const teamM = wt.match(new RegExp(`\\|\\s*nationalteam${i}\\s*=\\s*([^\\n]+)`, 'i'));
    if (!teamM) continue;
    const team = teamM[1]!;
    if (/under[- ]?\d|u-?\d{1,2}|olympic|youth/i.test(team)) continue;
    // [[Serbia national football team]] / {{fb|SRB}} etc.
    const link = team.match(/\[\[([^\]|#]+)/);
    const label = link?.[1] ?? team;
    const nationGuess = label
      .replace(/men'?s\s+/i, '')
      .replace(/\s+national (football|soccer) team.*/i, '')
      .replace(/\s+national team.*/i, '')
      .trim();
    if (nationGuess && nationalityMatches(nationality, nationGuess)) return true;
  }
  return false;
}

/** Ambiguous / diacritic / mononym DB names → English Wikipedia title. */
const WIKI_TITLE_OVERRIDE: Record<string, string> = {
  'Luka Milivojevic': 'Luka Milivojević',
  Rodri: 'Rodri (footballer, born 1996)',
  Nacho: 'Nacho (footballer, born 1990)',
  Memphis: 'Memphis Depay',
  'Miguel Monteiro': 'Miguel (footballer)',
  'Dario Simic': 'Dario Šimić',
  'Pierre Højbjerg': 'Pierre-Emile Højbjerg',
  'Ferdi Kadioglu': 'Ferdi Kadıoğlu',
  'Barış Yılmaz': 'Barış Alper Yılmaz',
  'Simão Sabrosa': 'Simão Sabrosa',
  Ricardo: 'Ricardo (footballer, born 1976)',
  Éder: 'Éder (footballer, born 1986)',
};

async function wikiSearchTitle(name: string, nationality: string | null): Promise<string | null> {
  if (WIKI_TITLE_OVERRIDE[name]) return WIKI_TITLE_OVERRIDE[name]!;
  const q =
    nationality && nationality !== 'Unknown'
      ? `${name} ${nationality} footballer`
      : `${name} footballer`;
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=8&format=json`;
  const res = await wikiFetch(url);
  if (!res?.ok) return null;
  const data = (await res.json()) as { query?: { search?: Array<{ title: string }> } };
  const hits = data.query?.search ?? [];
  return hits.find((h) => titleMatchesPlayer(name, h.title))?.title ?? null;
}

async function infoboxBackfill(dry: boolean): Promise<void> {
  console.log('\n=== Phase 2: Wikipedia infobox backfill for remaining gaps ===');
  const gaps = (await db.execute(sql`
    WITH career AS (
      SELECT player_id,
        COALESCE(SUM(appearances) FILTER (WHERE league_id IN (39,140,135,78,61,2,3)), 0)::int AS big5,
        COALESCE(SUM(appearances) FILTER (WHERE league_id IN (1,4)), 0)::int AS tourn
      FROM player_stats
      GROUP BY player_id
    )
    SELECT p.id, p.name, p.nationality, COALESCE(e.intl_caps, 0)::int AS caps,
           COALESCE(c.big5, 0)::int AS big5, COALESCE(c.tourn, 0)::int AS tourn
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    LEFT JOIN career c ON c.player_id = p.id
    WHERE COALESCE(e.intl_caps, 0) < ${INFOBOX_CAPS_MIN}
      AND (COALESCE(c.tourn, 0) >= 1 OR COALESCE(c.big5, 0) >= 50)
      AND p.nationality IS NOT NULL AND p.nationality <> '' AND p.nationality <> 'Unknown'
      AND length(trim(p.name)) >= 6
      AND p.name !~ '^[A-Za-zÀ-ÿ]{1,8}$'
    ORDER BY COALESCE(c.tourn, 0) DESC, COALESCE(c.big5, 0) DESC
    LIMIT 1500
  `)) as unknown as Array<{
    id: string;
    name: string;
    nationality: string;
    caps: number;
    big5: number;
    tourn: number;
  }>;

  console.log(`Candidates still missing senior caps: ${gaps.length}`);
  let looked = 0;
  let found = 0;
  let written = 0;

  for (const g of gaps) {
    looked += 1;
    if (looked % 50 === 0) console.log(`  …progress ${looked}/${gaps.length} (found ${found})`);
    const title = await wikiSearchTitle(g.name, g.nationality);
    await new Promise((r) => setTimeout(r, 300));
    if (!title || !titleMatchesPlayer(g.name, title)) continue;
    const wt = await fetchWikitext(title);
    await new Promise((r) => setTimeout(r, 300));
    if (!wt || !/\{\{\s*infobox football biography/i.test(wt)) continue;
    if (!infoboxNationMatches(wt, g.nationality)) continue;
    const hit = seniorCapsFromInfobox(wt);
    if (!hit || hit.caps < INFOBOX_CAPS_MIN) continue;
    found += 1;
    // Write as we go so a mid-run hang doesn't lose progress.
    const result = await upsertCaps([{ id: g.id, caps: hit.caps, goals: hit.goals }], dry);
    written += result.written;
    if (found <= 40 || /milivojevi/i.test(g.name) || found % 25 === 0) {
      console.log(`  ${g.name}: ${hit.caps} caps (via [[${title}]])`);
    }
  }

  console.log(
    dry
      ? `Infobox dry-run would write ${written} rows (found ${found}/${looked})`
      : `Infobox wrote ${written} rows (found ${found}/${looked})`
  );
}

async function main() {
  const dry = process.argv.includes('--dry');
  const skipInfobox = process.argv.includes('--skip-infobox');
  const infoboxOnly = process.argv.includes('--infobox-only');
  const nationsArg = process.argv.find((a) => a.startsWith('--nations='));
  const want = nationsArg
    ? new Set(
        nationsArg
          .slice('--nations='.length)
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    : null;

  if (!infoboxOnly) {
    console.log('=== Phase 1: national list pages ===');
    const pages = NATION_PAGES.filter((p) => !want || want.has(p.nation.toLowerCase()));
    const merged = new Map<string, { player: string; nation: string; caps: number; goals: number }>();

    for (const { nation, page } of pages) {
      console.log(`Fetching ${page} (${nation})...`);
      const wt = await fetchWikitext(page);
      if (!wt) {
        console.warn(`  failed to fetch ${page}`);
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      const rows = parseNationRows(wt);
      console.log(`  parsed ${rows.length} rows`);
      if (rows.length > 0) {
        const sample = [...rows].sort((a, b) => b.caps - a.caps).slice(0, 3);
        for (const s of sample) console.log(`    ${s.player}: ${s.caps} caps`);
      }
      for (const r of rows) {
        const k = `${normalizeSearchText(r.player)}|${nation.toLowerCase()}`;
        const e = merged.get(k) ?? { player: r.player, nation, caps: 0, goals: 0 };
        e.caps = Math.max(e.caps, r.caps);
        e.goals = Math.max(e.goals, r.goals);
        merged.set(k, e);
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    console.log(`\nMerged ${merged.size} unique player+nation rows`);

    const players = (await db.execute(sql`
      SELECT p.id, p.name, p.nationality, p.birth_date::text AS birth_date, p.aliases,
             COALESCE(SUM(s.appearances),0)::int AS apps
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id GROUP BY p.id
    `)) as unknown as Array<{
      id: string;
      name: string;
      nationality: string | null;
      birth_date: string | null;
      aliases: string[];
      apps: number;
    }>;

    const byName = new Map<
      string,
      Array<{ id: string; apps: number; nationality: string | null }>
    >();
    const add = (k: string, id: string, apps: number, nationality: string | null) => {
      if (!k) return;
      const arr = byName.get(k) ?? [];
      arr.push({ id, apps, nationality });
      byName.set(k, arr);
    };
    for (const p of players) {
      add(normalizeSearchText(p.name), p.id, p.apps, p.nationality);
      for (const a of Array.isArray(p.aliases) ? p.aliases : []) {
        add(normalizeSearchText(a), p.id, p.apps, p.nationality);
      }
    }

    let matched = 0;
    let unmatched = 0;
    const updates: Array<{ id: string; caps: number; goals: number; player: string; nation: string }> = [];
    for (const e of merged.values()) {
      const cands = byName.get(normalizeSearchText(e.player));
      if (!cands?.length) {
        unmatched += 1;
        continue;
      }
      const pool = cands.filter((c) => nationalityMatches(c.nationality, e.nation));
      if (!pool.length) {
        unmatched += 1;
        continue;
      }
      const pick = pool.slice().sort((a, b) => b.apps - a.apps)[0]!;
      matched += 1;
      updates.push({ id: pick.id, caps: e.caps, goals: e.goals, player: e.player, nation: e.nation });
    }
    console.log(`Matched ${matched} (${unmatched} unmatched / wrong-nationality skipped)`);

    for (const name of ['Luka Milivojević', 'Luka Milivojevic', 'Giorgio Chiellini', 'Zlatan Ibrahimović']) {
      const u = updates.find((x) => normalizeSearchText(x.player) === normalizeSearchText(name));
      console.log(`  check ${name}: ${u ? `${u.caps} caps (${u.nation})` : 'NOT IN LIST PHASE'}`);
    }

    const result = await upsertCaps(updates, dry);
    console.log(
      dry
        ? `Phase 1 dry-run would write ${result.written} trusted rows (skipped tiny ${result.skippedTiny})`
        : `Phase 1 wrote ${result.written} rows (${result.improved} newly filled or increased; skipped tiny ${result.skippedTiny})`
    );
  }

  if (!skipInfobox) {
    await infoboxBackfill(dry);
  }

  if (!dry) {
    const gap = await db.execute(sql`
      WITH intl_apps AS (
        SELECT player_id FROM player_stats WHERE league_id IN (1, 4)
        GROUP BY player_id HAVING SUM(appearances) >= 10
      )
      SELECT
        COUNT(*)::int AS cohort,
        COUNT(*) FILTER (WHERE COALESCE(e.intl_caps,0) = 0)::int AS still_zero,
        COUNT(*) FILTER (WHERE COALESCE(e.intl_caps,0) BETWEEN 1 AND 280)::int AS ok
      FROM intl_apps a
      LEFT JOIN player_extra_stats e ON e.player_id = a.player_id
    `);
    console.log('\nGap among 10+ WC/Euro apps:', [...gap][0]);

    const mili = await db.execute(sql`
      SELECT p.name, e.intl_caps FROM players p
      JOIN player_extra_stats e ON e.player_id = p.id
      WHERE p.name ILIKE '%Milivojevi%'
    `);
    console.log('Milivojević check:', [...mili]);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
