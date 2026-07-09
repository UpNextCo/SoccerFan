import { sql, type SQL } from 'drizzle-orm';
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
  // "England U19", "France U17 W", "Nigeria Olympic"
  const base = n
    .replace(/\s+U\d{1,2}(\s+W)?$/i, '')
    .replace(/\s+(Olympics?|Olympic)$/i, '')
    .trim();
  if (base !== n && (nations.has(base) || nations.has(canonicalNationality(base)))) return true;
  return false;
}

/** Reserve / youth club sides — not useful for career-path puzzles. */
export function isYouthOrReserveSide(name: string): boolean {
  return (
    /\s+U\d{1,2}(\s+W)?$/i.test(name) ||
    /\s+(II| B)$/i.test(name) ||
    / Castilla$/i.test(name) ||
    /\s+Amateurs$/i.test(name)
  );
}

/**
 * SQL predicate for `player_career pc`: keep real clubs only.
 * Drops national / youth-national sides (Belgium, Belgium U21, …) while keeping
 * club sides that share a country name but have a domestic league_id (e.g. Monaco).
 */
export function clubCareerOnlySql(alias = 'pc'): SQL {
  const a = sql.raw(alias);
  return sql`(
    NOT (
      (
        EXISTS (
          SELECT 1 FROM players _nat
          WHERE _nat.nationality <> '' AND _nat.nationality = ${a}.team_name
        )
        OR EXISTS (
          SELECT 1 FROM players _nat
          WHERE _nat.nationality <> ''
            AND _nat.nationality = regexp_replace(${a}.team_name, '\\s+U\\d{1,2}(\\s+W)?$', '', 'i')
        )
        OR ${a}.team_name ~* '\\s+(Olympics?|Olympic)$'
      )
      AND NOT EXISTS (
        SELECT 1 FROM teams _t WHERE _t.id = ${a}.team_id AND _t.league_id IS NOT NULL
      )
    )
  )`;
}
