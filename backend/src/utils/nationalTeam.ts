import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { canonicalNationality } from './nationality.js';

let NATION_SET: Set<string> | null = null;

export async function nationSet(): Promise<Set<string>> {
  if (NATION_SET) return NATION_SET;
  const rows = (await db.execute(sql`
    SELECT DISTINCT nationality FROM players WHERE nationality IS NOT NULL AND nationality <> ''
  `)) as unknown as Array<{ nationality: string }>;
  const s = new Set<string>();
  for (const r of rows) {
    s.add(r.nationality.trim());
    s.add(canonicalNationality(r.nationality));
  }
  NATION_SET = s;
  return s;
}

/** National or national-youth side (API-Football career rows). */
export function isNationalTeam(name: string, nations: Set<string>): boolean {
  const n = name.trim();
  if (nations.has(n) || nations.has(canonicalNationality(n))) return true;
  const base = n.replace(/\s+(U\d{1,2}|Olympics?|Olympic)$/i, '').trim();
  if (base !== n && (nations.has(base) || nations.has(canonicalNationality(base)))) return true;
  return false;
}

/** Reserve / youth club sides — not useful for career-path puzzles. */
export function isYouthOrReserveSide(name: string): boolean {
  return (
    /\s+U\d{1,2}$/i.test(name) ||
    /\s+(II| B)$/i.test(name) ||
    / Castilla$/i.test(name) ||
    /\s+Amateurs$/i.test(name)
  );
}
