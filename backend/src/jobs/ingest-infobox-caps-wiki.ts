/**
 * Fill player_extra_stats.intl_caps from Wikipedia football biography infoboxes
 * (nationalcapsN / nationalgoalsN). Used for legends outside the England 100+/national
 * list coverage (Bergkamp, Vieira, Maldini, Zidane, …).
 *
 * Takes the largest nationalcaps* value in the career range (30–280) — usually the
 * senior national team total.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-infobox-caps
 *   DATABASE_URL=... INGEST_PLAYER_IDS=uuid,... npm run job:ingest-infobox-caps
 *   DATABASE_URL=... npm run job:ingest-infobox-caps -- --dry
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTL_CAPS_SANITY_MAX, INTL_CAPS_TRUST_MIN } from '../services/statMetrics.js';

/** Ambiguous mononyms / DB names → English Wikipedia title. */
const WIKI_TITLE_OVERRIDE: Record<string, string> = {
  Ronaldo: 'Ronaldo (Brazilian footballer)',
  Raúl: 'Raúl (footballer)',
  Lauren: 'Lauren (footballer)',
  Cafú: 'Cafu',
  'Ole Solskjær': 'Ole Gunnar Solskjær',
  'Zinédine Zidane': 'Zinedine Zidane',
  'Robert Pirès': 'Robert Pirès',
  'David Trézéguet': 'David Trezeguet',
  'Claude Makelele': 'Claude Makélélé',
  'Nemanja Vidic': 'Nemanja Vidić',
  'Dejan Stankovic': 'Dejan Stanković',
  'Danny Murphy': 'Danny Murphy (footballer, born 1977)',
  'Gylfi Sigurdsson': 'Gylfi Sigurðsson',
  'Luís Figo': 'Luís Figo',
};

function asciiFold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function wikiTitleCandidates(name: string): string[] {
  const base = WIKI_TITLE_OVERRIDE[name] ?? name;
  const out = [base, asciiFold(base), `${base} (footballer)`, `${asciiFold(base)} (footballer)`];
  return [...new Set(out.map((t) => t.replace(/ /g, '_')))];
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (data.error) return null;
  return data?.parse?.wikitext ?? null;
}

async function fetchPlayerWikitext(name: string): Promise<string | null> {
  for (const title of wikiTitleCandidates(name)) {
    const wt = await fetchWikitext(title);
    if (wt && /\{\{\s*Infobox football biography/i.test(wt)) return wt;
    await new Promise((r) => setTimeout(r, 200));
  }
  return fetchWikitext(wikiTitleCandidates(name)[0]!);
}

function extractInfoboxCaps(wt: string): { caps: number; goals: number } | null {
  const m = wt.match(/\{\{\s*Infobox football biography[\s\S]*?\n\}\}/i);
  if (!m) return null;
  const box = m[0];
  const caps: number[] = [];
  const goals: number[] = [];
  for (const cm of box.matchAll(/\|\s*nationalcaps\d*\s*=\s*([^\n|]+)/gi)) {
    const n = parseInt(cm[1]!.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) caps.push(n);
  }
  for (const gm of box.matchAll(/\|\s*nationalgoals\d*\s*=\s*([^\n|]+)/gi)) {
    const n = parseInt(gm[1]!.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n >= 0) goals.push(n);
  }
  const trusted = caps.filter((c) => c >= INTL_CAPS_TRUST_MIN && c <= INTL_CAPS_SANITY_MAX);
  if (trusted.length === 0) return null;
  const bestCaps = Math.max(...trusted);
  // Pair goals with the same index as best caps when possible; else max goals in range.
  const bestIdx = caps.indexOf(bestCaps);
  const bestGoals = bestIdx >= 0 && goals[bestIdx] != null ? goals[bestIdx]! : Math.max(0, ...goals);
  return { caps: bestCaps, goals: bestGoals };
}

async function loadTargets(): Promise<Array<{ id: string; name: string }>> {
  const onlyIds = (process.env.INGEST_PLAYER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (onlyIds.length > 0) {
    return (await db.execute(sql`
      SELECT id, name FROM players WHERE id IN (${sql.join(
        onlyIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
    `)) as unknown as Array<{ id: string; name: string }>;
  }

  // Default: famous-ish players with 0 intl caps.
  return (await db.execute(sql`
    SELECT p.id, p.name
    FROM players p
    LEFT JOIN player_extra_stats e ON e.player_id = p.id
    WHERE p.market_value_tier >= ${Number(process.env.INGEST_FAME_MIN ?? 3)}
      AND COALESCE(e.intl_caps, 0) = 0
    ORDER BY p.market_value_tier DESC, p.name
    LIMIT ${Number(process.env.INGEST_LIMIT ?? 80)}
  `)) as unknown as Array<{ id: string; name: string }>;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const targets = await loadTargets();
  console.log(`Infobox caps targets: ${targets.length}`);

  let written = 0;
  let empty = 0;
  for (const t of targets) {
    const wt = await fetchPlayerWikitext(t.name);
    await new Promise((r) => setTimeout(r, 650));
    if (!wt) {
      console.log(`  ${t.name}: no page`);
      empty += 1;
      continue;
    }
    const stats = extractInfoboxCaps(wt);
    if (!stats) {
      console.log(`  ${t.name}: no trusted caps in infobox`);
      empty += 1;
      continue;
    }
    console.log(`  ${t.name}: ${stats.caps} caps · ${stats.goals} goals`);
    if (dry) continue;
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, intl_goals, intl_caps)
      VALUES (${t.id}::uuid, ${stats.goals}, ${stats.caps})
      ON CONFLICT (player_id) DO UPDATE SET
        intl_goals = GREATEST(player_extra_stats.intl_goals, EXCLUDED.intl_goals),
        intl_caps = GREATEST(player_extra_stats.intl_caps, EXCLUDED.intl_caps),
        updated_at = now()
    `);
    written += 1;
  }
  console.log(`\nWrote ${written}; empty/untrusted ${empty}${dry ? ' (dry)' : ''}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
