/**
 * Import World Cup squads from Wikipedia "YYYY FIFA World Cup squads" articles into a
 * wc_squads table, and top up players.birth_date where missing.
 *
 * Each player is a `{{nat fs g player|no=|pos=|name=[[..]]|other=...captain...|
 * age={{Birth date and age2|df=y|<asof y m d>|<birth y m d>}}|caps=|club=[[..]]}}` template,
 * grouped under `===Country===` headers with a `Coach: [[..]]` line. This gives us:
 *   - captaincy per (country, year)         → "captain of the 2018 winning squad"
 *   - manager per (country, year)           → manager clues / reveals
 *   - squad position + club + shirt number  → real XI generation
 *   - date of birth                         → top up players.birth_date (youngest-X records)
 *
 * Players are matched to ours by normalized name + nationality (the squad's country).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/import-wc-squads.ts [--probe]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { canonicalNationality } from '../utils/nationality.js';

const YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  return ((await res.json()) as any)?.parse?.wikitext ?? null;
}

function linkName(raw: string | undefined): string {
  if (!raw) return '';
  const m = raw.match(/\[\[([^\]]+)\]\]/);
  const inner = m ? (m[1]!.includes('|') ? m[1]!.split('|').pop()! : m[1]!) : raw;
  return inner.replace(/\{\{[^}]*\}\}/g, '').replace(/'''/g, '').replace(/\s+/g, ' ').trim();
}

function toInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function param(tpl: string, key: string): string | undefined {
  const m = tpl.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^|}]+(?:\\[\\[[^\\]]*\\]\\][^|}]*)*)`, 'i'));
  return m ? m[1]!.trim() : undefined;
}

/** Birth date from the age= template: "age2" puts birth in the LAST 3 ints, plain in the first 3. */
function birthDate(tpl: string): string | null {
  const age = tpl.match(/age\s*=\s*(\{\{[^}]*\}\})/i)?.[1];
  if (!age) return null;
  const ints = [...age.matchAll(/\b(\d{1,4})\b/g)].map((m) => parseInt(m[1]!, 10));
  if (ints.length < 3) return null;
  const trip = /age2/i.test(age) ? ints.slice(-3) : ints.slice(0, 3);
  const [y, mo, d] = trip;
  if (!y || y < 1920 || !mo || mo > 12 || !d || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface SquadRow {
  year: number; country: string; name: string; position: string;
  shirt: number | null; club: string | null; caps: number | null;
  isCaptain: boolean; coach: string | null; dob: string | null;
}

function parseSquads(wt: string, year: number): SquadRow[] {
  const out: SquadRow[] = [];
  // Split into country blocks on === headers (squad articles use level-3 country headers).
  const parts = wt.split(/\n===\s*/);
  for (const part of parts) {
    const head = part.match(/^([^=\n]+?)\s*===/);
    if (!head) continue;
    const country = head[1]!.replace(/\[\[|\]\]/g, '').split('|').pop()!.trim();
    if (country.length < 3 || /group|statistics|references|see also/i.test(country)) continue;
    const coach = part.match(/(?:Coach|Manager|Head coach)[^:]*:\s*([^\n]+)/i)?.[1];
    const coachName = coach ? linkName(coach) : null;

    // Player templates vary by year: "{{nat fs player}}" / "{{nat fs g player}}" (most years)
    // and "{{National football squad player}}" (2006, 2014).
    const players = part.matchAll(/\{\{(?:nat fs[^|}]*player|National football squad player)\|(?:[^{}]|\{\{[^}]*\}\})*\}\}/g);
    for (const pm of players) {
      const tpl = pm[0];
      const name = linkName(param(tpl, 'name'));
      if (!name) continue;
      const pos = (param(tpl, 'pos') ?? '').toUpperCase().replace(/[^A-Z]/g, '');
      // Captain is flagged either via `other=...captain` or by appending `([[Captain…|c]])`
      // to the name (2002/2010), so just look for the captain wikilink anywhere in the template.
      const isCaptain = /Captain \(association football\)/i.test(tpl)
        || /other\s*=\s*[^|}]*captain/i.test(tpl)
        || /\|\s*captain\s*=\s*(?:yes|true|1)/i.test(tpl);
      out.push({
        year, country, name, position: pos,
        shirt: toInt(param(tpl, 'no')),
        club: linkName(param(tpl, 'club')) || null,
        caps: toInt(param(tpl, 'caps')),
        isCaptain,
        coach: coachName,
        dob: birthDate(tpl),
      });
    }
  }
  return out;
}

async function main() {
  const probe = process.argv.includes('--probe');
  const all: SquadRow[] = [];
  for (const year of YEARS) {
    const wt = await fetchWikitext(`${year} FIFA World Cup squads`);
    await new Promise((r) => setTimeout(r, 200));
    if (!wt) { console.log(`  ${year}: no wikitext`); continue; }
    const rows = parseSquads(wt, year);
    const caps = rows.filter((r) => r.isCaptain).length;
    const dobs = rows.filter((r) => r.dob).length;
    console.log(`  ${year}: ${rows.length} players · ${caps} captains · ${dobs} with DOB`);
    all.push(...rows);
  }

  if (probe) {
    console.log('\nCaptains:');
    for (const r of all.filter((r) => r.isCaptain).sort((a, b) => a.year - b.year)) {
      console.log(`  ${r.year} ${r.country.padEnd(16)} ${r.name} (coach: ${r.coach ?? '?'})`);
    }
    process.exit(0);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wc_squads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      year integer NOT NULL,
      country text NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE SET NULL,
      player_name text NOT NULL,
      position text NOT NULL DEFAULT '',
      shirt_number integer,
      club text,
      caps integer,
      is_captain boolean NOT NULL DEFAULT false,
      coach text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS wc_squads_unique ON wc_squads (year, country, player_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wc_squads_player_idx ON wc_squads (player_id)`);

  // Match by normalized name + nationality (squad country). Build name+nat → id.
  const players = (await db.execute(sql`SELECT id, name, nationality FROM players`)) as unknown as Array<{ id: string; name: string; nationality: string }>;
  const byNameNat = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of players) {
    const n = normalizeSearchText(p.name);
    byNameNat.set(`${n}|${canonicalNationality(p.nationality)}`, p.id);
    (byName.get(n) ?? byName.set(n, []).get(n)!).push(p.id);
  }
  const matchId = (name: string, country: string): string | null => {
    const n = normalizeSearchText(name);
    const exact = byNameNat.get(`${n}|${canonicalNationality(country)}`);
    if (exact) return exact;
    const list = byName.get(n);
    return list && list.length === 1 ? list[0]! : null;
  };

  await db.execute(sql`TRUNCATE wc_squads`);
  let stored = 0;
  let matched = 0;
  for (let i = 0; i < all.length; i += 300) {
    const batch = all.slice(i, i + 300).map((r) => ({ ...r, pid: matchId(r.name, r.country) }));
    matched += batch.filter((b) => b.pid).length;
    const tuples = batch.map((r) => sql`(${r.year}, ${r.country}, ${r.pid}::uuid, ${r.name}, ${r.position}, ${r.shirt}, ${r.club}, ${r.caps}, ${r.isCaptain}, ${r.coach})`);
    await db.execute(sql`
      INSERT INTO wc_squads (year, country, player_id, player_name, position, shirt_number, club, caps, is_captain, coach)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (year, country, player_name) DO NOTHING
    `);
    stored += batch.length;
  }
  console.log(`\nStored ${stored} squad rows · ${matched} matched to players.`);

  // DOB top-up: fill players.birth_date where missing, from the most recent squad DOB.
  const dobRows = all.filter((r) => r.dob);
  const dobByPlayer = new Map<string, string>();
  for (const r of dobRows) {
    const pid = matchId(r.name, r.country);
    if (pid) dobByPlayer.set(pid, r.dob!);
  }
  const before = ((await db.execute(sql`SELECT COUNT(*)::int AS n FROM players WHERE birth_date IS NULL`)) as any)[0]?.n ?? 0;
  const entries = [...dobByPlayer.entries()];
  for (let i = 0; i < entries.length; i += 300) {
    const batch = entries.slice(i, i + 300);
    const tuples = batch.map(([id, dob]) => sql`(${id}::uuid, ${dob}::date)`);
    await db.execute(sql`
      UPDATE players AS p SET birth_date = v.d
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, d)
      WHERE p.id = v.id AND p.birth_date IS NULL
    `);
  }
  const after = ((await db.execute(sql`SELECT COUNT(*)::int AS n FROM players WHERE birth_date IS NULL`)) as any)[0]?.n ?? 0;
  console.log(`Topped up ${before - after} missing birth dates (${dobByPlayer.size} candidates).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
