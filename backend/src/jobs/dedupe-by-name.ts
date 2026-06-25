/**
 * Merge same-name duplicate player records that the DOB pass can't reach.
 *
 * PASS 1 — name + nationality clusters (the trusted bulk pass): an API-Football row
 *   (2010+, has DOB) and an FBref pre-2010 row (no DOB) for the SAME player. Exact
 *   name+nationality is NOT enough on its own (many different "José García"s), so a dup
 *   is merged only with same-person evidence: empty stub, shared club, or same DOB.
 *
 * PASS 2 — "Unknown" absorber: a record with nationality "Unknown" whose data is a
 *   national-team-only stub (e.g. a finals/World-Cup import fragment) folded into a
 *   same-name, specific-nationality record when there's STRONG evidence — a shared real
 *   club, a matching DOB, or a multi-word alias in common (e.g. "José Antonio Reyes").
 *   These never cluster in pass 1 because the nationality differs.
 *
 * On merge we repoint every child table AND the jsonb `validIds` of closed-set
 * tower_prompts, so nothing is left dangling.
 *
 * Pure DB, zero API. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

const CHILD: Array<{ table: string; keys: string[] }> = [
  { table: 'player_stats', keys: ['league_id', 'season', 'team_id'] },
  { table: 'player_transfers', keys: ['transfer_date', 'from_team_id', 'to_team_id'] },
  { table: 'player_honours', keys: ['competition', 'season', 'placement'] },
  { table: 'player_career', keys: ['team_id', 'season_from'] },
  // These cascade on player delete — repoint so finals/awards data moves to the canon.
  { table: 'final_appearances', keys: ['competition', 'season', 'team'] },
  { table: 'player_awards', keys: ['award', 'year', 'placement'] },
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface Member {
  id: string;
  name: string;
  nat: string;
  externalId: string | null;
  dob: string | null;
  apps: number;
  statRows: number;
  clubsAll: Set<string>;   // every team_name (incl. national teams) — pass-1 parity
  clubsReal: Set<string>;  // club team_names only (league_id != 1) — pass-2 evidence
  ntNations: Set<string>;  // national-team team_names (league_id = 1)
  aliases: string[];
  aliasKeys: Set<string>;  // normalised multi-word aliases (strong identity signal)
  searchText: string;
  mv: number | null;
  pv: number | null;
  rf: number | null;
}

/** Distinctive identity keys: full names of >=3 tokens (e.g. "josé antonio reyes").
 *  Two-word names ("carlos martínez") are too common to be safe merge evidence. */
function multiWordAliases(aliases: string[], name: string): Set<string> {
  const keys = new Set<string>();
  for (const a of [...aliases, name]) {
    const n = norm(a);
    if (n.split(' ').length >= 3) keys.add(n);
  }
  return keys;
}

async function repoint(table: string, keys: string[], dup: string, canon: string): Promise<void> {
  const cond = keys.map((k) => sql`c.${sql.raw(k)} IS NOT DISTINCT FROM c2.${sql.raw(k)}`);
  await db.execute(sql`
    UPDATE ${sql.raw(table)} c SET player_id = ${canon}
    WHERE c.player_id = ${dup}
      AND NOT EXISTS (
        SELECT 1 FROM ${sql.raw(table)} c2
        WHERE c2.player_id = ${canon} AND ${sql.join(cond, sql` AND `)}
      )
  `);
}

/** Replace a merged player's id inside closed-set tower_prompts `rule.validIds`. */
async function repointValidIds(dup: string, canon: string): Promise<void> {
  await db.execute(sql`
    UPDATE tower_prompts
    SET rule = jsonb_set(
      rule, '{validIds}',
      (SELECT to_jsonb(array(
        SELECT DISTINCT CASE WHEN v = ${dup} THEN ${canon} ELSE v END
        FROM jsonb_array_elements_text(rule->'validIds') AS v
      )))
    )
    WHERE rule ? 'validIds' AND rule->'validIds' @> ${JSON.stringify([dup])}::jsonb
  `);
}

async function applyMerge(dup: Member, canon: Member): Promise<void> {
  for (const { table, keys } of CHILD) await repoint(table, keys, dup.id, canon.id);
  await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${canon.id} WHERE answer_player_id = ${dup.id}`);
  await repointValidIds(dup.id, canon.id);
  await db.execute(sql`DELETE FROM players WHERE id = ${dup.id}`);
}

/** Fold a dup's fields into the canon in-memory so later passes see the enriched record. */
function absorbInto(canon: Member, dup: Member): void {
  for (const a of dup.aliases) if (!canon.aliases.includes(a)) canon.aliases.push(a);
  if (!canon.aliases.includes(dup.name)) canon.aliases.push(dup.name);
  for (const k of multiWordAliases(dup.aliases, dup.name)) canon.aliasKeys.add(k);
  for (const c of dup.clubsAll) canon.clubsAll.add(c);
  for (const c of dup.clubsReal) canon.clubsReal.add(c);
  for (const n of dup.ntNations) canon.ntNations.add(n);
  canon.searchText = `${canon.searchText} ${dup.searchText}`;
  canon.apps += dup.apps;
  canon.statRows += dup.statRows;
  canon.externalId = canon.externalId ?? dup.externalId;
  canon.dob = canon.dob ?? dup.dob;
  canon.mv = canon.mv ?? dup.mv;
  canon.pv = Math.max(canon.pv ?? 0, dup.pv ?? 0) || canon.pv || dup.pv;
  canon.rf = Math.max(canon.rf ?? 0, dup.rf ?? 0) || canon.rf || dup.rf;
}

async function persistCanon(canon: Member): Promise<void> {
  const dedupSearch = [...new Set(canon.searchText.split(/\s+/).filter(Boolean))].join(' ');
  const aliasSet = [...new Set([...canon.aliases, canon.name])];
  await db.execute(sql`
    UPDATE players SET external_id = ${canon.externalId}, birth_date = ${canon.dob},
      aliases = ${JSON.stringify(aliasSet)}::jsonb, search_text = ${dedupSearch},
      market_value_eur = ${canon.mv}, peak_market_value_eur = ${canon.pv}, record_fee_eur = ${canon.rf}
    WHERE id = ${canon.id}
  `);
}

function pickCanon(members: Member[]): Member {
  return [...members].sort((a, b) => {
    const ext = Number(Boolean(b.externalId)) - Number(Boolean(a.externalId));
    if (ext !== 0) return ext;
    if (b.apps !== a.apps) return b.apps - a.apps;
    return b.statRows - a.statRows;
  })[0]!;
}

async function main() {
  console.log(`Dedupe by name (+ Unknown absorber) — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  // Collapse internal double-spaces in stored names so "Clarence  Seedorf" matches
  // "Clarence Seedorf" (both for display and dedup grouping).
  if (APPLY) {
    await db.execute(sql`
      UPDATE players SET name = regexp_replace(trim(name), '\\s+', ' ', 'g')
      WHERE name <> regexp_replace(trim(name), '\\s+', ' ', 'g')
    `);
  }

  // Name-only groups (whitespace-collapsed); we sub-group by nationality inside pass 1.
  const groups = (await db.execute(sql`
    SELECT lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS ln, array_agg(id) AS ids
    FROM players
    GROUP BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
    HAVING COUNT(*) > 1
  `)) as unknown as Array<{ ln: string; ids: string[] }>;

  const allIds = groups.flatMap((g) => g.ids);
  if (allIds.length === 0) { console.log('No duplicate names.'); process.exit(0); }
  const idList = sql.join(allIds.map((id) => sql`${id}`), sql`, `);

  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality AS nat, p.external_id AS external_id, p.birth_date::text AS dob,
           p.aliases, p.search_text AS search_text,
           p.market_value_eur AS mv, p.peak_market_value_eur AS pv, p.record_fee_eur AS rf,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps,
           COALESCE((SELECT COUNT(*) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS stat_rows,
           COALESCE((SELECT array_agg(DISTINCT team_name) FROM player_stats s WHERE s.player_id = p.id AND team_name IS NOT NULL), ARRAY[]::text[]) AS clubs_all,
           COALESCE((SELECT array_agg(DISTINCT team_name) FROM player_stats s WHERE s.player_id = p.id AND team_name IS NOT NULL AND s.league_id <> 1), ARRAY[]::text[]) AS clubs_real,
           COALESCE((SELECT array_agg(DISTINCT team_name) FROM player_stats s WHERE s.player_id = p.id AND team_name IS NOT NULL AND s.league_id = 1), ARRAY[]::text[]) AS nt_nations
    FROM players p WHERE p.id IN (${idList})
  `)) as unknown as Array<{
    id: string; name: string; nat: string; external_id: string | null; dob: string | null;
    aliases: string[]; search_text: string; mv: number | null; pv: number | null; rf: number | null;
    apps: number; stat_rows: number; clubs_all: string[]; clubs_real: string[]; nt_nations: string[];
  }>;

  const byId = new Map<string, Member>(
    rows.map((r) => [r.id, {
      id: r.id, name: r.name, nat: r.nat, externalId: r.external_id, dob: r.dob, apps: r.apps, statRows: r.stat_rows,
      clubsAll: new Set((r.clubs_all ?? []).map(norm)),
      clubsReal: new Set((r.clubs_real ?? []).map(norm)),
      ntNations: new Set((r.nt_nations ?? []).map(norm)),
      aliases: Array.isArray(r.aliases) ? r.aliases : [],
      aliasKeys: multiWordAliases(Array.isArray(r.aliases) ? r.aliases : [], r.name),
      searchText: r.search_text, mv: r.mv, pv: r.pv, rf: r.rf,
    }])
  );

  const deleted = new Set<string>();
  const changedCanons = new Set<string>();
  let p1 = 0, p2 = 0, kept = 0;
  const p1ex: string[] = [];
  const p2ex: string[] = [];

  const isUnknown = (m: Member) => { const n = norm(m.nat); return n === 'unknown' || n === ''; };

  // ---- PASS 1: name + nationality, evidence = stub | shared club | same DOB ----
  for (const g of groups) {
    const members = g.ids.map((id) => byId.get(id)!).filter(Boolean);
    const byNat = new Map<string, Member[]>();
    for (const m of members) {
      const key = norm(m.nat);
      (byNat.get(key) ?? byNat.set(key, []).get(key)!).push(m);
    }
    for (const [, sub] of byNat) {
      if (sub.length < 2) continue;
      const canon = pickCanon(sub);
      const dups = sub.filter((m) => m.id !== canon.id);
      const sharesClub = (d: Member) => [...d.clubsAll].some((c) => canon.clubsAll.has(c));
      const sameDob = (d: Member) => Boolean(d.dob && canon.dob && d.dob === canon.dob);
      const safe = dups.filter((d) => d.statRows === 0 || sharesClub(d) || sameDob(d));
      kept += dups.length - safe.length;
      if (safe.length === 0) continue;
      if (p1ex.length < 12) p1ex.push(`${canon.name} (${canon.nat}) ⇐ ${safe.length}`);
      for (const d of safe) {
        if (APPLY) await applyMerge(d, canon);
        absorbInto(canon, d);
        deleted.add(d.id);
        p1 += 1;
      }
      changedCanons.add(canon.id);
    }
  }

  // ---- PASS 2: fold "Unknown"-nationality stubs into a same-name specific-nat record ----
  for (const g of groups) {
    const live = g.ids.map((id) => byId.get(id)!).filter((m) => m && !deleted.has(m.id));
    const unknowns = live.filter(isUnknown);
    const specifics = live.filter((m) => !isUnknown(m));
    if (unknowns.length === 0 || specifics.length === 0) continue;

    for (const u of unknowns) {
      const sharesRealClub = (c: Member) => [...u.clubsReal].some((x) => c.clubsReal.has(x));
      const sameDob = (c: Member) => Boolean(u.dob && c.dob && u.dob === c.dob);
      const aliasOverlap = (c: Member) => [...u.aliasKeys].some((k) => c.aliasKeys.has(k));
      const qualifies = (c: Member) => sharesRealClub(c) || sameDob(c) || aliasOverlap(c);
      const liveSpecifics = specifics.filter((c) => !deleted.has(c.id));
      const strong = liveSpecifics.filter(qualifies);

      let canon: Member | undefined;
      if (strong.length === 1) {
        canon = strong[0];
      } else if (strong.length === 0 && u.clubsReal.size === 0 && liveSpecifics.length === 1) {
        // Empty / national-team-only Unknown stub with a single same-name real record
        // (e.g. the stray "Clarence Seedorf" stub) → safe to fold in.
        canon = liveSpecifics[0];
      } else {
        if (liveSpecifics.length > 1) kept += 1; // ambiguous → leave
        continue;
      }
      if (!canon) continue;
      if (p2ex.length < 12) p2ex.push(`${canon.name} (${canon.nat}) ⇐ Unknown stub [${u.ntNations.size ? [...u.ntNations].join(',') : 'no-club'}]`);
      if (APPLY) await applyMerge(u, canon);
      absorbInto(canon, u);
      deleted.add(u.id);
      changedCanons.add(canon.id);
      p2 += 1;
    }
  }

  if (APPLY) {
    for (const id of changedCanons) {
      const c = byId.get(id);
      if (c && !deleted.has(id)) await persistCanon(c);
    }
  }

  console.log(`Pass 1 (name+nationality): ${APPLY ? 'merged' : 'would merge'} ${p1}`);
  console.log(`Pass 2 (Unknown absorber): ${APPLY ? 'merged' : 'would merge'} ${p2}`);
  console.log(`Different-person rows kept apart: ${kept}\n`);
  console.log('Pass 1 samples:'); for (const e of p1ex) console.log(`  ${e}`);
  console.log('Pass 2 samples:'); for (const e of p2ex) console.log(`  ${e}`);
  if (!APPLY) console.log('\n(DRY RUN — re-run with "apply" to write.)');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
