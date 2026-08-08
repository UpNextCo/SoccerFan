/**
 * Import major-final lineups + scorers from WIKIPEDIA (all eras) into final_appearances.
 *
 * FBref only carries per-match lineups from ~2014, but Wikipedia has every Champions
 * League / World Cup / Euro final with a structured `{{Infobox football match}}`
 * (team1/team2 + scores), `goals1`/`goals2` scorer lists, and two lineup tables
 * (starters, subs, captain, sub on/off). We parse that wikitext, match players to our
 * DB by name, and store started/minutes/goals/won.
 *
 * Plain HTTP to the Wikipedia API — no Cloudflare, no rate limits, no scraper.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:import-finals-wiki              # all finals
 *   DATABASE_URL=... npm run job:import-finals-wiki -- --probe "2009 UEFA Champions League final"
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

interface FinalDef {
  comp: string;
  season: number; // season-start year (CL 2008/09 -> 2008; WC/Euro -> tournament year)
  title: string;
}

function finalDefs(): FinalDef[] {
  const out: FinalDef[] = [];
  for (let played = 1993; played <= 2026; played += 1) {
    out.push({ comp: 'Champions League', season: played - 1, title: `${played} UEFA Champions League final` });
  }
  for (const y of [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026]) {
    out.push({ comp: 'World Cup', season: y, title: `${y} FIFA World Cup final` });
  }
  for (const y of [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024]) {
    out.push({ comp: 'Euro', season: y, title: `UEFA Euro ${y} final` });
  }
  // Europa League (single-match-final era from 1998). Pre-2010 it was the UEFA Cup.
  for (let played = 1998; played <= 2026; played += 1) {
    const title = played <= 2009 ? `${played} UEFA Cup Final` : `${played} UEFA Europa League final`;
    out.push({ comp: 'Europa League', season: played - 1, title });
  }
  return out;
}

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.parse?.wikitext ?? null;
}

/** [[Target|Display]] -> Display; [[Target]] -> Target; strip templates/refs/flag. */
function cleanName(raw: string): string {
  let v = raw;
  const link = v.match(/\[\[([^\]]+)\]\]/);
  if (link) {
    const inner = link[1]!;
    v = inner.includes('|') ? inner.split('|').pop()! : inner;
  }
  return v
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/'''/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(wt: string, name: string): string | null {
  const m = wt.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n]*)`));
  return m ? m[1]!.trim() : null;
}

interface Infobox {
  team1: string;
  team2: string;
  score1: number;
  score2: number;
  pen1: number | null;
  pen2: number | null;
  detailsWinner: string | null; // team name from "X won A–B on penalties"
}

function parseInfobox(wt: string): Infobox | null {
  const i = wt.indexOf('{{Infobox football match');
  if (i < 0) return null;
  const block = wt.slice(i, i + 1800);
  const team1 = cleanName(field(block, 'team1') ?? '');
  const team2 = cleanName(field(block, 'team2') ?? '');
  const score1 = parseInt(field(block, 'team1score') ?? '', 10);
  const score2 = parseInt(field(block, 'team2score') ?? '', 10);
  if (!team1 || !team2 || Number.isNaN(score1) || Number.isNaN(score2)) return null;
  // Club finals: "|penaltyscore = 3–2". International finals: it's prose in |details=.
  let pen1: number | null = null;
  let pen2: number | null = null;
  const pen = field(block, 'penaltyscore');
  if (pen) {
    const pm = pen.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (pm) {
      pen1 = parseInt(pm[1]!, 10);
      pen2 = parseInt(pm[2]!, 10);
    }
  }
  let detailsWinner: string | null = null;
  const details = field(block, 'details') ?? '';
  const dm = details.match(/([A-Za-z][A-Za-z .'’-]+?)\s+won\s+\d+\s*[–-]\s*\d+\s+on\s+[^.]*penalt/i);
  if (dm) detailsWinner = dm[1]!.trim();
  return { team1, team2, score1, score2, pen1, pen2, detailsWinner };
}

/** scorer display-name -> goals (excludes own goals). */
function parseGoals(wt: string, fieldName: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = wt.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\|\\s*${fieldName}\\s*=`).test(l));
  if (start < 0) return map;
  // content = rest of the start line, then following lines until the next "|field ="
  const block: string[] = [lines[start]!.replace(new RegExp(`^\\|\\s*${fieldName}\\s*=`), '')];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\|/.test(lines[i]!)) break; // next infobox field
    block.push(lines[i]!);
  }
  for (const line of block) {
    if (!line.includes('{{goal') && !line.includes('{{Goal')) continue;
    if (/o\.g\./i.test(line)) continue; // own goal — don't credit as a scored goal
    const name = cleanName(line);
    if (!name) continue;
    // count only NUMERIC minute args (skip markers like "pen." / "o.g.")
    let goals = 0;
    for (const g of line.matchAll(/\{\{goal\|([^}]*)\}\}/gi)) {
      goals += g[1]!.split('|').filter((x) => /\d/.test(x)).length;
    }
    if (goals === 0) goals = 1;
    map.set(name, (map.get(name) ?? 0) + goals);
  }
  return map;
}

interface LineupPlayer {
  name: string;
  started: boolean;
}

/** Parse the two lineup tables. Returns [team1Players, team2Players]. */
function parseLineups(wt: string): [LineupPlayer[], LineupPlayer[]] {
  // Identify lineup tables by their player-row count (>=7 "POS ||'''NUM'''||[[..]]"
  // rows). This works for both club finals (flagicon per row, "Substitutes:") and
  // national-team finals (no flagicon, "Substitutions:").
  // A lineup row = starts with "|", has a bold shirt number, and a player wikilink.
  // (Position cell may be plain "GK" or a template like {{abbr|RB|Right-back}}.)
  const ROW = /^\|.*'''\d+'''.*\[\[/;
  const ROWG = /^\|.*'''\d+'''.*\[\[/gm;
  const tables: string[] = [];
  const re = /\{\|[^]*?\n\|\}/g; // non-greedy table blocks (inner lineup tables)
  for (const m of wt.matchAll(re)) {
    const rowCount = (m[0].match(ROWG) || []).length;
    if (rowCount >= 7) tables.push(m[0]);
    if (tables.length >= 2) break;
  }
  const parseTable = (tbl: string): LineupPlayer[] => {
    const players: LineupPlayer[] = [];
    let started = true;
    for (const line of tbl.split('\n')) {
      if (/Substitut/i.test(line)) {
        started = false;
        continue;
      }
      if (!ROW.test(line) || !line.includes('[[')) continue;
      const name = cleanName(line);
      if (!name) continue;
      // a sub who actually came on has {{subon|..}}; unused subs are skipped
      if (!started && !/\{\{subon/i.test(line)) continue;
      players.push({ name, started });
    }
    return players;
  };
  return [tables[0] ? parseTable(tables[0]) : [], tables[1] ? parseTable(tables[1]) : []];
}

interface Row {
  competition: string;
  season: number;
  team: string;
  won: boolean;
  player: string;
  started: boolean;
  goals: number;
}

function buildRows(def: FinalDef, wt: string): Row[] {
  const info = parseInfobox(wt);
  if (!info) return [];
  const [l1, l2] = parseLineups(wt);
  if (l1.length === 0 && l2.length === 0) return [];
  const g1 = parseGoals(wt, 'goals1');
  const g2 = parseGoals(wt, 'goals2');

  // winner: regulation/ET score → penaltyscore field → "X won A–B on penalties" prose
  let winner: 1 | 2 | 0 = 0;
  if (info.score1 > info.score2) winner = 1;
  else if (info.score2 > info.score1) winner = 2;
  else if (info.pen1 != null && info.pen2 != null) winner = info.pen1 > info.pen2 ? 1 : 2;
  else if (info.detailsWinner) {
    const w = normalizeSearchText(info.detailsWinner);
    if (normalizeSearchText(info.team1).includes(w) || w.includes(normalizeSearchText(info.team1))) winner = 1;
    else if (normalizeSearchText(info.team2).includes(w) || w.includes(normalizeSearchText(info.team2))) winner = 2;
  }

  const rows: Row[] = [];
  const emit = (team: string, players: LineupPlayer[], goals: Map<string, number>, won: boolean) => {
    // Scorer lists use short names ("Eto'o"); lineups use full names ("Samuel Eto'o").
    // Attribute each scorer to the lineup player whose name ends with the scorer name.
    const goalByPlayer = new Map<string, number>();
    for (const [scorer, n] of goals) {
      const sn = normalizeSearchText(scorer);
      const match =
        players.find((p) => normalizeSearchText(p.name) === sn) ??
        players.find((p) => normalizeSearchText(p.name).endsWith(` ${sn}`)) ??
        players.find((p) => normalizeSearchText(p.name).endsWith(sn));
      if (match) goalByPlayer.set(match.name, (goalByPlayer.get(match.name) ?? 0) + n);
    }
    for (const p of players) {
      rows.push({
        competition: def.comp,
        season: def.season,
        team,
        won,
        player: p.name,
        started: p.started,
        goals: goalByPlayer.get(p.name) ?? 0,
      });
    }
  };
  emit(info.team1, l1, g1, winner === 1);
  emit(info.team2, l2, g2, winner === 2);
  return rows;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const probeIdx = process.argv.indexOf('--probe');
  if (probeIdx >= 0) {
    const title = process.argv[probeIdx + 1]!;
    const wt = await fetchWikitext(title);
    if (!wt) {
      console.log(`No wikitext for "${title}"`);
      process.exit(1);
    }
    const info = parseInfobox(wt);
    const [l1, l2] = parseLineups(wt);
    console.log(`Infobox:`, info);
    console.log(`goals1:`, parseGoals(wt, 'goals1'));
    console.log(`goals2:`, parseGoals(wt, 'goals2'));
    console.log(`${info?.team1} XI (${l1.filter((p) => p.started).length} st / ${l1.length} total):`, l1.map((p) => `${p.name}${p.started ? '' : '*'}`).join(', '));
    console.log(`${info?.team2} XI (${l2.filter((p) => p.started).length} st / ${l2.length} total):`, l2.map((p) => `${p.name}${p.started ? '' : '*'}`).join(', '));
    process.exit(0);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS final_appearances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL, competition text NOT NULL, season integer NOT NULL,
      team text NOT NULL, started boolean NOT NULL DEFAULT false,
      minutes integer NOT NULL DEFAULT 0, goals integer NOT NULL DEFAULT 0,
      won boolean NOT NULL DEFAULT false,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS final_appearances_unique ON final_appearances (competition, season, player_name, team)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS final_appearances_player_idx ON final_appearances (player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS final_appearances_comp_idx ON final_appearances (competition, season)`);

  const defs = finalDefs();
  const allRows: Row[] = [];
  let okFinals = 0;
  const missing: string[] = [];
  for (const def of defs) {
    const wt = await fetchWikitext(def.title);
    await new Promise((r) => setTimeout(r, 150));
    if (!wt) {
      missing.push(def.title);
      continue;
    }
    const rows = buildRows(def, wt);
    if (rows.length === 0) {
      missing.push(`${def.title} (parse empty)`);
      continue;
    }
    allRows.push(...rows);
    okFinals += 1;
    console.log(`  ${def.comp} ${def.season}: ${rows.length} players`);
  }
  console.log(`\nParsed ${okFinals}/${defs.length} finals, ${allRows.length} appearances.`);
  if (missing.length) console.log(`Missing/empty: ${missing.join(' | ')}`);

  // match players by normalized name (+aliases), tie-break by career apps. For World
  // Cup / Euro finals the team IS the player's country, so we disambiguate same-surname
  // collisions (e.g. "Ronaldo" Brazil 2002 = Ronaldo Nazário, NOT Cristiano Ronaldo) by
  // preferring a candidate whose nationality matches the team.
  const players = (await db.execute(sql`
    SELECT p.id, p.name, p.aliases, p.nationality,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps
    FROM players p
  `)) as unknown as Array<{ id: string; name: string; aliases: string[]; nationality: string; apps: number }>;
  type Cand = { id: string; apps: number; nat: string };
  const byName = new Map<string, Cand[]>();
  const add = (k: string, c: Cand) => {
    if (!k) return;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(c);
  };
  for (const p of players) {
    const c: Cand = { id: p.id, apps: p.apps, nat: normalizeSearchText(p.nationality ?? '') };
    add(normalizeSearchText(p.name), c);
    for (const a of Array.isArray(p.aliases) ? p.aliases : []) add(normalizeSearchText(a), c);
  }
  const INTL = new Set(['World Cup', 'Euro']);
  const matchPlayer = (name: string, country?: string): string | null => {
    const c = byName.get(normalizeSearchText(name));
    if (!c || c.length === 0) return null;
    if (country) {
      const cn = normalizeSearchText(country);
      const natMatch = c.filter((x) => x.nat === cn);
      if (natMatch.length) return natMatch.slice().sort((a, b) => b.apps - a.apps)[0]!.id;
    }
    return c.slice().sort((a, b) => b.apps - a.apps)[0]!.id;
  };

  let matched = 0;
  const values = allRows.map((r) => {
    const country = INTL.has(r.competition) ? r.team : undefined;
    const playerId = matchPlayer(r.player, country);
    if (playerId) matched += 1;
    return { ...r, playerId, minutes: r.started ? 90 : 1 };
  });
  console.log(`Matched ${matched}/${allRows.length} appearances to players.`);

  // fresh rebuild for these competitions
  await db.execute(sql`DELETE FROM final_appearances WHERE competition IN ('Champions League','World Cup','Euro','Europa League')`);
  for (const batch of chunk(values, 300)) {
    const tuples = batch.map(
      (v) =>
        sql`(${v.playerId ? sql`${v.playerId}::uuid` : sql`NULL`}, ${v.player}, ${v.competition}, ${v.season}, ${v.team}, ${v.started}, ${v.minutes}, ${v.goals}, ${v.won})`
    );
    await db.execute(sql`
      INSERT INTO final_appearances (player_id, player_name, competition, season, team, started, minutes, goals, won)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (competition, season, player_name, team) DO UPDATE SET
        player_id = EXCLUDED.player_id, started = EXCLUDED.started,
        minutes = EXCLUDED.minutes, goals = EXCLUDED.goals, won = EXCLUDED.won
    `);
  }

  const cov = (await db.execute(sql`
    SELECT competition, COUNT(DISTINCT season)::int AS finals, COUNT(*)::int AS apps,
           COUNT(*) FILTER (WHERE player_id IS NOT NULL)::int AS matched, SUM(goals)::int AS goals
    FROM final_appearances GROUP BY competition ORDER BY competition
  `)) as unknown as Array<Record<string, unknown>>;
  console.table(cov);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
