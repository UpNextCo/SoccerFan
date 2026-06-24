/**
 * Canonicalize player_stats.team_name against the authoritative `teams` registry
 * (API-Football names + crests). Fixes cross-source pollution from the FBref scrape:
 * country-code prefixes ("eng Chelsea"), abbreviations ("Man Utd", "Dortmund", "PSG")
 * and language variants ("Bayern München" vs "Bayern Munich").
 *
 * Strategy per distinct string: strip prefix → curated alias → exact registry match
 * → substring match within the big leagues → else keep the cleaned string.
 * Also stamps player_stats.team_id from the registry (for reliable crests).
 *
 * Pure DB, zero API. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';
const BIG = new Set([39, 140, 135, 78, 61, 2, 3]);

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function stripPrefix(s: string): string {
  return s.replace(/^[a-z]{2,3}\s/, '').trim();
}

/** FBref abbreviations / variants → canonical registry name. */
const ALIASES: Record<string, string> = {
  'manchester utd': 'Manchester United',
  'dep la coruna': 'Deportivo La Coruña',
  'psg': 'Paris Saint Germain',
  'gladbach': 'Borussia Mönchengladbach',
  "m'gladbach": 'Borussia Mönchengladbach',
  'dortmund': 'Borussia Dortmund',
  'leverkusen': 'Bayer Leverkusen',
  'stuttgart': 'VfB Stuttgart',
  'koln': '1. FC Köln',
  'nurnberg': '1. FC Nürnberg',
  'kaiserslautern': '1. FC Kaiserslautern',
  'hertha berlin': 'Hertha BSC',
  'schalke 04': 'FC Schalke 04',
  'werder bremen': 'Werder Bremen',
  'bayern munich': 'Bayern München',
  'inter': 'Inter',
  'internazionale': 'Inter',
  'roma': 'AS Roma',
  'psv': 'PSV Eindhoven',
  'st etienne': 'Saint-Étienne',
  'saint etienne': 'Saint-Étienne',
  'betis': 'Real Betis',
  'sporting gijon': 'Sporting Gijón',
  'ath bilbao': 'Athletic Club',
  'athletic club': 'Athletic Club',
};

interface Team {
  id: number;
  name: string;
  norm: string;
  big: boolean;
}

async function main() {
  console.log(`Canonicalize team_name — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const teamRows = (await db.execute(sql`SELECT id, name, name_norm, league_id FROM teams`)) as unknown as Array<{ id: number; name: string; name_norm: string; league_id: number | null }>;
  const byNorm = new Map<string, Team>();
  const bigTeams: Team[] = [];
  for (const t of teamRows) {
    const team: Team = { id: t.id, name: t.name, norm: norm(t.name), big: t.league_id != null && BIG.has(t.league_id) };
    // Prefer big-league teams when a normalized name collides.
    const existing = byNorm.get(team.norm);
    if (!existing || (team.big && !existing.big)) byNorm.set(team.norm, team);
    if (team.big) bigTeams.push(team);
  }

  const aliasNorm = new Map<string, string>();
  for (const [k, v] of Object.entries(ALIASES)) aliasNorm.set(norm(k), v);

  const distinct = (await db.execute(sql`
    SELECT team_name, COUNT(*)::int AS n FROM player_stats WHERE team_name IS NOT NULL GROUP BY team_name
  `)) as unknown as Array<{ team_name: string; n: number }>;

  interface Map1 {
    from: string;
    to: string;
    teamId: number | null;
    method: string;
    n: number;
  }
  const maps: Map1[] = [];
  const unmapped: Array<{ name: string; n: number }> = [];

  for (const row of distinct) {
    const original = row.team_name;
    const cleaned = stripPrefix(original);
    const cn = norm(cleaned);

    // 1) alias → registry
    const aliasTarget = aliasNorm.get(cn);
    let team = aliasTarget ? byNorm.get(norm(aliasTarget)) : undefined;
    let method = aliasTarget ? (team ? 'alias' : '') : '';
    let canonName = aliasTarget && !team ? aliasTarget : team?.name;

    // 2) exact registry match
    if (!canonName) {
      team = byNorm.get(cn);
      if (team) {
        canonName = team.name;
        method = 'exact';
      }
    }

    // 3) substring match within big leagues (registry name contains the cleaned token or vice versa)
    if (!canonName && cn.length >= 4) {
      const cands = bigTeams.filter((t) => t.norm === cn || t.norm.includes(cn) || cn.includes(t.norm));
      cands.sort((a, b) => a.norm.length - b.norm.length); // shortest containing name
      const best = cands.find((t) => t.norm.includes(cn)) ?? cands[0];
      if (best) {
        canonName = best.name;
        team = best;
        method = 'substr';
      }
    }

    if (!canonName) {
      // keep cleaned (at least strip the prefix)
      if (cleaned !== original) {
        maps.push({ from: original, to: cleaned, teamId: null, method: 'prefix-only', n: row.n });
      } else {
        unmapped.push({ name: original, n: row.n });
      }
      continue;
    }

    if (canonName !== original || (team && team.id)) {
      maps.push({ from: original, to: canonName, teamId: team?.id ?? null, method, n: row.n });
    }
  }

  const changed = maps.filter((m) => m.to !== m.from);
  const totalRows = changed.reduce((s, m) => s + m.n, 0);
  console.log(`${changed.length} distinct strings → canonical (${totalRows} rows)`);
  console.log('\nSample mappings:');
  for (const m of changed.sort((a, b) => b.n - a.n).slice(0, 40)) {
    console.log(`  ${String(m.n).padStart(5)}  [${m.method}] ${m.from}  →  ${m.to}${m.teamId ? '' : ' (no team_id)'}`);
  }

  unmapped.sort((a, b) => b.n - a.n);
  const unmappedRows = unmapped.reduce((s, u) => s + u.n, 0);
  console.log(`\n${unmapped.length} strings still unmatched (${unmappedRows} rows). Top:`);
  for (const u of unmapped.slice(0, 30)) console.log(`  ${String(u.n).padStart(5)}  ${u.name}`);

  if (APPLY) {
    // Only rename team_name (it's not part of the player_stats unique key, so this is
    // collision-free). team_id is intentionally NOT stamped here: a player's FBref +
    // API rows for the same season would collide on (player_id, league_id, season,
    // team_id). Crests resolve by club name, so the id isn't needed.
    let applied = 0;
    for (const m of changed) {
      await db.execute(sql`UPDATE player_stats SET team_name = ${m.to} WHERE team_name = ${m.from}`);
      applied += 1;
    }
    console.log(`\nApplied ${applied} renames.`);
  } else {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
