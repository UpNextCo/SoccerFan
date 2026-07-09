/**
 * Ingest club/international honours from Wikipedia player article ==Honours== sections
 * into player_honours. Used when API-Football `/trophies` returns empty for legends
 * (Giggs, Scholes, Henry, …).
 *
 * Parses bullet lines under club/country headings:
 *   *[[Premier League]]: [[1992–93 …|1992–93]], [[1993–94 …|1993–94]], …
 * Writes one row per (competition, season, Winner).
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-honours-wiki
 *   DATABASE_URL=... npm run job:ingest-honours-wiki -- --dry
 *   DATABASE_URL=... INGEST_PLAYER_IDS=uuid npm run job:ingest-honours-wiki
 *   DATABASE_URL=... INGEST_FAMOUS_THIN=1 npm run job:ingest-honours-wiki
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerHonours } from '../db/schema.js';

const THIN_MAX = Number(process.env.INGEST_THIN_HONOURS_MAX ?? 8);
const FAME_MIN = Number(process.env.INGEST_FAME_MIN ?? 4);

/** Map wiki competition titles → API-Football-ish names Bingo already understands. */
const COMP_CANON: Array<{ name: string; aliases: RegExp }> = [
  // Treat First Division as Premier League so pre-92 English titles still match Bingo's PL tile.
  { name: 'Premier League', aliases: /^(Premier League|Football League First Division|First Division)$/i },
  { name: 'FA Cup', aliases: /^FA Cup$/i },
  { name: 'League Cup', aliases: /^(EFL Cup|Football League Cup|League Cup|Carabao Cup)$/i },
  { name: 'Community Shield', aliases: /^(FA )?Community Shield|FA Charity Shield$/i },
  { name: 'UEFA Champions League', aliases: /^(UEFA )?Champions League|European Cup$/i },
  { name: 'UEFA Europa League', aliases: /^(UEFA )?(Europa League|Cup Winners'? Cup|UEFA Cup)$/i },
  { name: 'UEFA Super Cup', aliases: /^(UEFA )?Super Cup|European Super Cup$/i },
  { name: 'FIFA Club World Cup', aliases: /^(FIFA )?Club World Cup$/i },
  { name: 'Intercontinental Cup', aliases: /^Intercontinental Cup/i },
  { name: 'La Liga', aliases: /^(La Liga|Primera Divisi[oó]n)$/i },
  { name: 'Copa del Rey', aliases: /^Copa del Rey$/i },
  { name: 'Supercopa de España', aliases: /^Supercopa de Espa[nñ]a$/i },
  { name: 'Serie A', aliases: /^Serie A$/i },
  { name: 'Coppa Italia', aliases: /^Coppa Italia$/i },
  { name: 'Supercoppa Italiana', aliases: /^Supercoppa Italiana$/i },
  { name: 'Bundesliga', aliases: /^Bundesliga$/i },
  { name: 'DFB-Pokal', aliases: /^DFB-Pokal$/i },
  { name: 'Ligue 1', aliases: /^(Ligue 1|Division 1)$/i },
  { name: 'Coupe de France', aliases: /^Coupe de France$/i },
  { name: 'Trophée des Champions', aliases: /^Troph[eé]e des Champions$/i },
  { name: 'Eredivisie', aliases: /^Eredivisie$/i },
  { name: 'KNVB Cup', aliases: /^(KNVB Cup|KNVB Beker)$/i },
  { name: 'Primeira Liga', aliases: /^(Primeira Liga|Primeira Divisão)$/i },
  { name: 'Taça de Portugal', aliases: /^Ta[cç]a de Portugal$/i },
  { name: 'FIFA World Cup', aliases: /^(FIFA )?World Cup$/i },
  { name: 'UEFA European Championship', aliases: /^(UEFA )?European Championship|UEFA Euro/i },
  { name: 'Copa América', aliases: /^Copa Am[eé]rica$/i },
  { name: 'Confederations Cup', aliases: /^(FIFA )?Confederations Cup$/i },
];

/** Ambiguous mononyms / DB display names → English Wikipedia article title. */
const WIKI_TITLE_OVERRIDE: Record<string, string> = {
  Ronaldo: 'Ronaldo (Brazilian footballer)',
  Raúl: 'Raúl (footballer)',
  Lauren: 'Lauren (footballer)',
  'Danny Murphy': 'Danny Murphy (footballer, born 1977)',
  Cafú: 'Cafu',
  'Ole Solskjær': 'Ole Gunnar Solskjær',
  'Zinédine Zidane': 'Zinedine Zidane',
  'Robert Pirès': 'Robert Pirès',
  'David Trézéguet': 'David Trezeguet',
  'Claude Makelele': 'Claude Makélélé',
  'Nemanja Vidic': 'Nemanja Vidić',
  'Dejan Stankovic': 'Dejan Stanković',
  'Frédéric Kanouté': 'Frédéric Kanouté',
  'Mikaël Silvestre': 'Mikaël Silvestre',
  'Luís Figo': 'Luís Figo',
  'Gylfi Sigurdsson': 'Gylfi Sigurðsson',
};

function canonicalComp(raw: string): string | null {
  const cleaned = raw.replace(/\[\[|\]\]/g, '').split('|').pop()!.trim();
  for (const c of COMP_CANON) {
    if (c.aliases.test(cleaned)) return c.name;
  }
  return null;
}

/**
 * Season labels like 1992–93, 1998–99, 1999–2000, 2008.
 * Prefer 4-digit end year first — `\d{2}|\d{4}` would turn 1999–2000 into 1999-20.
 * Normalize to API-Football style `YYYY/YYYY` so wiki + API rows don't double-count.
 */
function seasonFrom(label: string): string | null {
  const t = label.replace(/\[\[|\]\]/g, '').split('|').pop()!.trim();
  const m = t.match(/(\d{4})[–-](\d{4}|\d{2})/);
  if (m) {
    const y1 = parseInt(m[1]!, 10);
    let y2 = m[2]!;
    if (y2.length === 2) {
      const century = Math.floor(y1 / 100) * 100;
      let full = century + parseInt(y2, 10);
      if (full < y1) full += 100; // 1999–00 → 2000
      y2 = String(full);
    }
    return `${y1}/${y2}`;
  }
  const y = t.match(/\b((?:19|20)\d{2})\b/);
  return y ? y[1]! : null;
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (data.error) return null;
  return data?.parse?.wikitext ?? null;
}

function extractHonoursSection(wt: string): string {
  const start = wt.search(/==+\s*Honours\s*==+/i);
  if (start < 0) return '';
  const rest = wt.slice(start);
  // Stop at next same-or-higher level heading after Honours (usually ==Something==).
  const m = rest.match(/^==+\s*Honours\s*==+([\s\S]*?)(?=\n==[^=])/i);
  return m ? m[1]! : rest.slice(0, 8000);
}

interface HonourRow {
  competition: string;
  season: string;
}

function parseHonours(section: string): HonourRow[] {
  const out: HonourRow[] = [];
  // Skip Individual subsections.
  const clubPart = section.split(/==+\s*Individual\s*==+/i)[0] ?? section;

  for (const line of clubPart.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('*')) continue;
    // *[[Premier League]]: seasons…  OR  * Premier League: …
    const m = trimmed.match(/^\*\s*(?:\[\[([^\]]+)\]\]|([^:[]+))\s*:\s*(.+)$/);
    if (!m) continue;
    const rawComp = (m[1] ?? m[2] ?? '').trim();
    const comp = canonicalComp(rawComp);
    if (!comp) continue;

    const seasonsPart = m[3]!;
    // Collect [[link|label]] labels and bare season tokens.
    const labels: string[] = [];
    for (const lm of seasonsPart.matchAll(/\[\[([^\]]+)\]\]/g)) {
      labels.push(lm[1]!);
    }
    // Also bare 1992–93 style after stripping links/refs.
    const bare = seasonsPart
      .replace(/\[\[([^\]]+)\]\]/g, '')
      .replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '');
    for (const bm of bare.matchAll(/\b(\d{4}[–-]\d{2}|\d{4})\b/g)) {
      labels.push(bm[1]!);
    }

    const seen = new Set<string>();
    for (const lab of labels) {
      const season = seasonFrom(lab);
      if (!season || seen.has(season)) continue;
      seen.add(season);
      out.push({ competition: comp, season });
    }
  }
  return out;
}

function asciiFold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Prefer English Wikipedia title from player name (works for most famous players). */
function wikiTitleCandidates(name: string): string[] {
  const override = WIKI_TITLE_OVERRIDE[name];
  const base = override ?? name;
  const out: string[] = [base];
  const folded = asciiFold(base);
  if (folded !== base) out.push(folded);
  // Common disambiguators when the bare name is a dab page / wrong person.
  out.push(`${base} (footballer)`);
  out.push(`${folded} (footballer)`);
  return [...new Set(out.map((t) => t.replace(/ /g, '_')))];
}

async function fetchPlayerWikitext(name: string): Promise<string | null> {
  for (const title of wikiTitleCandidates(name)) {
    const wt = await fetchWikitext(title);
    if (wt && /==+\s*Honours\s*==+/i.test(wt)) return wt;
    await new Promise((r) => setTimeout(r, 250));
  }
  // Last resort: first candidate even without Honours (caller handles empty).
  return fetchWikitext(wikiTitleCandidates(name)[0]!);
}

async function loadTargets(): Promise<Array<{ id: string; name: string }>> {
  const onlyIds = (process.env.INGEST_PLAYER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (onlyIds.length > 0) {
    const rows = (await db.execute(sql`
      SELECT id, name FROM players WHERE id IN (${sql.join(
        onlyIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
    `)) as unknown as Array<{ id: string; name: string }>;
    return rows;
  }

  if (process.env.INGEST_FAMOUS_THIN === '1') {
    const rows = (await db.execute(sql`
      SELECT p.id, p.name
      FROM players p
      LEFT JOIN player_honours h ON h.player_id = p.id
      WHERE p.market_value_tier >= ${FAME_MIN}
      GROUP BY p.id, p.name
      HAVING COUNT(h.id) < ${THIN_MAX}
      ORDER BY p.name
    `)) as unknown as Array<{ id: string; name: string }>;
    return rows;
  }

  // Default: famous players with zero/thin cabinets that look like API-empty legends
  // (have CL-ish fame but < thin max). Same as FAMOUS_THIN.
  const rows = (await db.execute(sql`
    SELECT p.id, p.name
    FROM players p
    LEFT JOIN player_honours h ON h.player_id = p.id
    WHERE p.market_value_tier >= ${FAME_MIN}
    GROUP BY p.id, p.name
    HAVING COUNT(h.id) < ${THIN_MAX}
    ORDER BY p.name
    LIMIT ${Number(process.env.INGEST_LIMIT ?? 50)}
  `)) as unknown as Array<{ id: string; name: string }>;
  return rows;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const targets = await loadTargets();
  console.log(`Wiki honours targets: ${targets.length}`);

  let written = 0;
  let playersOk = 0;
  let playersEmpty = 0;

  for (const t of targets) {
    const wt = await fetchPlayerWikitext(t.name);
    await new Promise((r) => setTimeout(r, 700));
    if (!wt) {
      console.log(`  ${t.name}: NO WIKI PAGE`);
      playersEmpty += 1;
      continue;
    }
    const section = extractHonoursSection(wt);
    const rows = parseHonours(section);
    if (rows.length === 0) {
      console.log(`  ${t.name}: page found but 0 parsed honours`);
      playersEmpty += 1;
      continue;
    }
    playersOk += 1;
    const pl = rows.filter((r) => r.competition === 'Premier League').length;
    console.log(`  ${t.name}: ${rows.length} honours (${pl} PL)`);

    if (dry) continue;

    for (const h of rows) {
      await db
        .insert(playerHonours)
        .values({
          playerId: t.id,
          competition: h.competition,
          country: null,
          season: h.season,
          placement: 'Winner',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            playerHonours.playerId,
            playerHonours.competition,
            playerHonours.season,
            playerHonours.placement,
          ],
          set: { updatedAt: new Date() },
        });
      written += 1;
    }
  }

  console.log(
    `\nDone: ${playersOk} players with honours, ${playersEmpty} empty/missing, ${written} rows upserted${dry ? ' (dry)' : ''}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
