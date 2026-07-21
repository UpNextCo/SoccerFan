/**
 * Fill player_extra_stats.intl_caps from Wikipedia football biography infoboxes
 * (nationalcapsN / nationalgoalsN). Used for legends outside the England 100+/national
 * list coverage (Bergkamp, Vieira, Maldini, Zidane, …).
 *
 * Takes senior nationalteam* caps (skips U21/youth/olympic), accepting 1–280.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-infobox-caps
 *   DATABASE_URL=... INGEST_PLAYER_IDS=uuid,... npm run job:ingest-infobox-caps
 *   DATABASE_URL=... npm run job:ingest-infobox-caps -- --dry
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTL_CAPS_DISPLAY_MIN, INTL_CAPS_SANITY_MAX } from '../services/statMetrics.js';

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
  let bestCaps = 0;
  let bestGoals = 0;
  for (let i = 1; i <= 8; i += 1) {
    const teamM = wt.match(new RegExp(`\\|\\s*nationalteam${i}\\s*=\\s*([^\\n]+)`, 'i'));
    const capsM = wt.match(new RegExp(`\\|\\s*nationalcaps${i}\\s*=\\s*([^\\n]+)`, 'i'));
    const goalsM = wt.match(new RegExp(`\\|\\s*nationalgoals${i}\\s*=\\s*([^\\n]+)`, 'i'));
    if (!teamM || !capsM) continue;
    const team = teamM[1]!;
    if (!/national (football|soccer) team/i.test(team)) continue;
    if (/under[- ]?\d|u-?\d{1,2}|olympic|youth|amateur|b team|universiade/i.test(team)) continue;
    const caps = parseInt(capsM[1]!.replace(/[^\d]/g, ''), 10);
    const goals = goalsM ? parseInt(goalsM[1]!.replace(/[^\d]/g, ''), 10) : 0;
    if (
      Number.isFinite(caps) &&
      caps >= INTL_CAPS_DISPLAY_MIN &&
      caps <= INTL_CAPS_SANITY_MAX &&
      caps > bestCaps
    ) {
      bestCaps = caps;
      bestGoals = Number.isFinite(goals) && goals <= 150 ? goals : 0;
    }
  }
  return bestCaps > 0 ? { caps: bestCaps, goals: bestGoals } : null;
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
