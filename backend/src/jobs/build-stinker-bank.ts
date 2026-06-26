/**
 * Build the Blind Rank "stinker bank": recognisable flop / cult-bad players per theme.
 *
 * Claude NOMINATES culturally-known stinkers (the bit only an LLM can do); we then resolve
 * every name against our own DB and DISCARD anything we don't hold — so a hallucinated or
 * unknown name can never reach the game. The vetted result is cached to a JSON file the
 * generator reads at runtime. Re-run occasionally to refresh; the daily flow never calls the LLM.
 *
 *   npm run job:build-stinker-bank
 */
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { nominateStinkers } from '../services/llmCuration.js';

const THEME_DESC: Record<string, { title: string; desc: string }> = {
  premier_league_legends: { title: 'Premier League (long-serving players)', desc: 'players with 150+ Premier League appearances' },
  champions_league_legends: { title: 'Champions League regulars', desc: 'players with 40+ Champions League appearances' },
  current_superstars: { title: 'Current high-value stars', desc: 'recent/modern players valued highly at their peak' },
  football_icons: { title: 'Famous long-career players', desc: 'big-name players with long top-level careers' },
  premier_league_strikers: { title: 'Premier League strikers', desc: 'forwards with 100+ Premier League appearances' },
  premier_league_midfielders: { title: 'Premier League midfielders', desc: 'midfielders with 150+ Premier League appearances' },
  premier_league_defenders: { title: 'Premier League defenders', desc: 'defenders with 150+ Premier League appearances' },
  world_cup_heroes: { title: 'World Cup squad players', desc: 'players who featured at a World Cup finals' },
};

/** Accent/punctuation-insensitive name key for matching Claude's names to our DB. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main(): Promise<void> {
  const players = (await db.execute(sql`
    SELECT id, name, COALESCE(market_value_tier, 0)::int AS mvt
    FROM players WHERE name IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; mvt: number }>;

  // Map normalised name -> the most prominent player with that name (best fame signal),
  // so an ambiguous name resolves to the recognisable one.
  const byNorm = new Map<string, { id: string; name: string; mvt: number }>();
  for (const p of players) {
    const k = norm(p.name);
    const existing = byNorm.get(k);
    if (!existing || p.mvt > existing.mvt) byNorm.set(k, { id: p.id, name: p.name, mvt: p.mvt });
  }

  const bank: Record<string, Array<{ id: string; name: string }>> = {};
  for (const [themeId, info] of Object.entries(THEME_DESC)) {
    const names = await nominateStinkers(info.title, info.desc);
    if (!names) {
      console.warn(`${themeId}: no nominations (LLM unavailable) — leaving empty`);
      bank[themeId] = [];
      continue;
    }
    const seen = new Set<string>();
    const resolved: Array<{ id: string; name: string }> = [];
    for (const n of names) {
      const hit = byNorm.get(norm(n));
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); resolved.push({ id: hit.id, name: hit.name }); }
    }
    bank[themeId] = resolved;
    console.log(`${themeId}: ${names.length} nominated → ${resolved.length} resolved in DB`);
    console.log('   ' + resolved.map((r) => r.name).join(', '));
  }

  const out = path.join(process.cwd(), 'src/data/stinker-bank.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bank, null, 2) + '\n');
  console.log(`\nWrote ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
