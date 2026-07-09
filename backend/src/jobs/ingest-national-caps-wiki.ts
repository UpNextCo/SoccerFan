/**
 * Ingest international caps from national-team "List of X international footballers"
 * Wikipedia pages — fills the 30–99 band that the global 100+ caps list misses
 * (John Terry 78, etc.).
 *
 * England-style tables: player wikilink, position, then plain |caps| and |goals| cells.
 * Values MERGE by max into player_extra_stats.intl_caps (never lowered). Only ≥30 trusted.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-national-caps
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --dry
 *   DATABASE_URL=... npm run job:ingest-national-caps -- --nations=England,Italy
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { INTL_CAPS_TRUST_MIN } from '../services/statMetrics.js';

/** Nations whose wiki list uses England-like |caps| / |goals| plain cells. */
const NATION_PAGES: Array<{ nation: string; page: string }> = [
  { nation: 'England', page: 'List of England international footballers' },
  { nation: 'Italy', page: 'List of Italy international footballers' },
  // Add more as parsers are validated for their table shapes.
];

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (data.error) {
    console.warn(`  wiki error for ${title}: ${data.error.info}`);
    return null;
  }
  return data?.parse?.wikitext ?? null;
}

function playerFrom(cell: string): string {
  const sn = cell.match(/\{\{\s*sort ?name\s*\|([^|}]+)\|([^|}]+)/i);
  if (sn) return `${sn[1]!.trim()} ${sn[2]!.trim()}`;
  const link = cell.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
  if (!link) return '';
  const name = (link[2] ?? link[1]!).replace(/\([^)]*\)/g, '').trim();
  return name;
}

interface CapRow {
  player: string;
  caps: number;
  goals: number;
}

/**
 * England / Italy style: each |- row has a player [[link]], then later two plain
 * `|N` cells for caps and goals (position cells use data-sort-value and are skipped).
 */
function parseEnglandStyle(wt: string): CapRow[] {
  const out: CapRow[] = [];
  for (const row of wt.split(/\n\|-/)) {
    const lines = row.split('\n').map((l) => l.trim());
    let player = '';
    for (const l of lines) {
      const name = playerFrom(l);
      if (name && !/^(Goalkeeper|Defender|Midfielder|Forward|Full back)/i.test(name)) {
        player = name;
        break;
      }
    }
    if (!player) continue;

    const plain: number[] = [];
    for (const l of lines) {
      const m = l.match(/^\|(\d{1,3})$/);
      if (m) plain.push(parseInt(m[1]!, 10));
    }
    if (plain.length < 2) continue;
    const caps = plain[0]!;
    const goals = plain[1]!;
    if (caps < 1 || caps > 280) continue;
    out.push({ player, caps, goals });
  }
  return out;
}

function nationalityMatches(dbNat: string | null | undefined, wikiNat: string): boolean {
  if (!dbNat || !wikiNat) return false;
  const a = dbNat.toLowerCase();
  const b = wikiNat.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}

async function main() {
  const dry = process.argv.includes('--dry');
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
  const pages = NATION_PAGES.filter((p) => !want || want.has(p.nation.toLowerCase()));

  const merged = new Map<string, { player: string; nation: string; caps: number; goals: number }>();

  for (const { nation, page } of pages) {
    console.log(`Fetching ${page}...`);
    const wt = await fetchWikitext(page);
    if (!wt) {
      console.warn(`  failed to fetch ${page}`);
      continue;
    }
    const rows = parseEnglandStyle(wt);
    console.log(`  parsed ${rows.length} rows`);
    for (const r of rows) {
      const k = `${normalizeSearchText(r.player)}|${nation.toLowerCase()}`;
      const e = merged.get(k) ?? { player: r.player, nation, caps: 0, goals: 0 };
      e.caps = Math.max(e.caps, r.caps);
      e.goals = Math.max(e.goals, r.goals);
      merged.set(k, e);
    }
    // Be polite to MediaWiki.
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`Merged ${merged.size} unique player+nation rows`);

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
    Array<{ id: string; apps: number; nationality: string | null; birthYear: number | null }>
  >();
  const add = (
    k: string,
    id: string,
    apps: number,
    nationality: string | null,
    birthYear: number | null
  ) => {
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
  const updates: Array<{ id: string; caps: number; goals: number; player: string; nation: string }> = [];
  for (const e of merged.values()) {
    const cands = byName.get(normalizeSearchText(e.player));
    if (!cands || cands.length === 0) {
      unmatched += 1;
      continue;
    }
    const natFiltered = cands.filter((c) => nationalityMatches(c.nationality, e.nation));
    const pool = natFiltered.length > 0 ? natFiltered : cands;
    const pick = pool.slice().sort((a, b) => b.apps - a.apps)[0]!;
    matched += 1;
    updates.push({ id: pick.id, caps: e.caps, goals: e.goals, player: e.player, nation: e.nation });
  }
  console.log(`Matched ${matched} (${unmatched} not in DB)`);

  const band = updates.filter((u) => u.caps >= INTL_CAPS_TRUST_MIN && u.caps < 100);
  console.log(`In 30–99 band: ${band.length}`);
  for (const t of [...updates]
    .filter((u) => /Terry|Lampard|Beckham|Kane|Rooney|Gerrard|Cole/i.test(u.player))
    .sort((a, b) => b.caps - a.caps)
    .slice(0, 15)) {
    console.log(`  ${t.player} (${t.nation}): ${t.caps} caps · ${t.goals} goals`);
  }

  if (dry) {
    console.log('\n--dry: no writes.');
    process.exit(0);
  }

  let written = 0;
  let skippedTiny = 0;
  for (const u of updates) {
    const caps = u.caps >= INTL_CAPS_TRUST_MIN ? u.caps : 0;
    if (u.caps > 0 && u.caps < INTL_CAPS_TRUST_MIN) skippedTiny += 1;
    if (caps === 0 && u.goals === 0) continue;
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, intl_goals, intl_caps)
      VALUES (${u.id}::uuid, ${u.goals}, ${caps})
      ON CONFLICT (player_id) DO UPDATE SET
        intl_goals = GREATEST(player_extra_stats.intl_goals, EXCLUDED.intl_goals),
        intl_caps = CASE
          WHEN EXCLUDED.intl_caps >= ${INTL_CAPS_TRUST_MIN}
            THEN GREATEST(player_extra_stats.intl_caps, EXCLUDED.intl_caps)
          ELSE player_extra_stats.intl_caps
        END,
        updated_at = now()
    `);
    written += 1;
  }
  if (skippedTiny > 0) {
    console.log(`Skipped ${skippedTiny} rows with tiny caps (<${INTL_CAPS_TRUST_MIN})`);
  }
  console.log(`Wrote ${written} player rows into player_extra_stats.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
