/**
 * Attach identity to famous FBref / finals stubs that never got a Transfermarkt id.
 *
 * Wikidata is asked by name (association football player + TM id). A hit is accepted when:
 *   • the name is unique among footballers with a TM id, or
 *   • several people share the name, but exactly one overlaps two or more of our career clubs
 *     (this is how "Ronaldo" becomes Ronaldo Nazário — Barça / Inter / Madrid — not Cristiano).
 *
 * Writes tm_player_id, birth_date, age, nationality (if Unknown), and aliases.
 * Then folds Unknown-nationality duplicates into the real same-DOB record
 * (Andy Robertson → Andrew Robertson).
 *
 *   npx tsx src/jobs/map-famous-stub-identities.ts
 *   npx tsx src/jobs/map-famous-stub-identities.ts --apply
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { canonicalNationality } from '../utils/nationality.js';
import { buildPlayerSearchFields, normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'BallKnowledge/1.0 (football quiz app; contact via repository)';
const FAMOUS_TIER = 4;
const PAUSE_MS = 350;

interface Stub {
  id: string;
  name: string;
  aliases: string[];
  nationality: string;
  birthDate: string | null;
  clubs: string[];
}

interface WikiHit {
  qid: string;
  tmId: string;
  birth: string | null;
  citizenship: string | null;
  labels: string[];
  teams: string[];
}

const CHILD: Array<{ table: string; keys: string[] }> = [
  { table: 'player_stats', keys: ['league_id', 'season', 'team_id'] },
  { table: 'player_transfers', keys: ['transfer_date', 'from_team_id', 'to_team_id'] },
  { table: 'player_honours', keys: ['competition', 'season', 'placement'] },
  { table: 'player_career', keys: ['team_id', 'season_from'] },
  { table: 'final_appearances', keys: ['competition', 'season', 'team'] },
  { table: 'player_awards', keys: ['award', 'year', 'placement'] },
];

function clubKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|ac|as|sc|afc|the|ssc|us)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function clubsOverlap(ours: string[], theirs: string[]): number {
  const a = ours.map(clubKey).filter((k) => k.length >= 4);
  const b = theirs.map(clubKey).filter((k) => k.length >= 4);
  let n = 0;
  for (const x of a) {
    if (b.some((y) => x === y || x.includes(y) || y.includes(x))) n += 1;
  }
  return n;
}

function nameKey(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function sparql(query: string): Promise<Array<Record<string, { value: string }>>> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      signal: AbortSignal.timeout(25_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { results: { bindings: Array<Record<string, { value: string }>> } };
      return data.results.bindings;
    }
    console.warn(`  SPARQL HTTP ${res.status} (attempt ${attempt})`);
    if (res.status !== 429 && res.status !== 504 && res.status < 500) {
      throw new Error(`SPARQL HTTP ${res.status}`);
    }
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    await new Promise((r) => setTimeout(r, retryAfter ? retryAfter * 1000 : 2000 * attempt));
  }
  throw new Error('SPARQL rate limited after 4 attempts');
}

function parseHits(rows: Array<Record<string, { value: string }>>): WikiHit[] {
  const byQid = new Map<string, WikiHit>();
  for (const row of rows) {
    const qid = row['item']!.value.split('/').pop()!;
    if (byQid.has(qid)) continue;
    byQid.set(qid, {
      qid,
      tmId: row['tm']!.value,
      birth: row['birth']?.value.slice(0, 10) ?? null,
      citizenship: row['citizenship']?.value ?? null,
      labels: row['label']?.value ? [row['label'].value.trim()] : [],
      teams: [],
    });
  }
  return [...byQid.values()];
}

async function queryOneName(name: string): Promise<WikiHit[]> {
  const escaped = name.replace(/"/g, '\\"');
  const body = `
    ?item wdt:P106 wd:Q937857 ; wdt:P2446 ?tm .
    OPTIONAL { ?item wdt:P569 ?birth }
    OPTIONAL {
      ?item wdt:P27 ?country .
      ?country rdfs:label ?citizenship FILTER(LANG(?citizenship) = "en")
    }
    ?item rdfs:label ?label FILTER(LANG(?label) = "en")
  `;
  const exact = await sparql(`
    SELECT DISTINCT ?item ?tm ?birth ?citizenship ?label WHERE {
      ?item rdfs:label "${escaped}"@en .
      ${body}
    }`);
  if (exact.length > 0) return parseHits(exact);

  const alt = await sparql(`
    SELECT DISTINCT ?item ?tm ?birth ?citizenship ?label WHERE {
      ?item skos:altLabel "${escaped}"@en .
      ${body}
    }`);
  return parseHits(alt);
}

async function fillTeams(hits: WikiHit[]): Promise<void> {
  if (hits.length === 0) return;
  const values = hits.map((h) => `wd:${h.qid}`).join(' ');
  const query = `
    SELECT ?item ?teamLabel WHERE {
      VALUES ?item { ${values} }
      ?item wdt:P54 ?team .
      ?team rdfs:label ?teamLabel FILTER(LANG(?teamLabel) = "en")
    }`;
  const byQid = new Map(hits.map((h) => [h.qid, h]));
  for (const row of await sparql(query)) {
    const qid = row['item']!.value.split('/').pop()!;
    const team = row['teamLabel']?.value?.trim();
    const hit = byQid.get(qid);
    if (hit && team && !hit.teams.includes(team)) hit.teams.push(team);
  }
}

function decide(
  stub: Stub,
  hits: WikiHit[],
  taken: Set<string>
): { hit: WikiHit; via: string } | { reason: string } {
  const usable = hits.filter((h) => !taken.has(h.tmId));
  const byTm = new Map<string, WikiHit>();
  for (const h of usable) byTm.set(h.tmId, h);
  const unique = [...byTm.values()];

  if (unique.length === 0) return { reason: 'no Wikidata footballer with that name and a TM id' };
  if (unique.length === 1) {
    const hit = unique[0]!;
    if (stub.birthDate && hit.birth && stub.birthDate.slice(0, 10) !== hit.birth) {
      return { reason: `Wikidata DOB ${hit.birth} disagrees with stored ${stub.birthDate.slice(0, 10)}` };
    }
    return { hit, via: 'unique-name' };
  }

  const scored = unique
    .map((h) => ({ h, overlap: clubsOverlap(stub.clubs, h.teams) }))
    .filter((s) => s.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap);
  if (scored.length === 1) return { hit: scored[0]!.h, via: `clubs×${scored[0]!.overlap}` };
  if (scored.length > 1 && scored[0]!.overlap > scored[1]!.overlap) {
    return { hit: scored[0]!.h, via: `clubs×${scored[0]!.overlap}` };
  }
  return { reason: `${unique.length} footballers share the name (club overlap did not isolate one)` };
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

async function mergeStubInto(dupId: string, canonId: string): Promise<void> {
  for (const { table, keys } of CHILD) await repoint(table, keys, dupId, canonId);
  await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = ${canonId} WHERE answer_player_id = ${dupId}`);
  await db.execute(sql`UPDATE wc_squads SET player_id = ${canonId} WHERE player_id = ${dupId}`);
  await db.execute(sql`UPDATE wc_memorable SET player_id = ${canonId} WHERE player_id = ${dupId}`);
  await db.execute(sql`
    UPDATE wc_match_events SET player_id = ${canonId}
    WHERE player_id = ${dupId} AND NOT EXISTS (
      SELECT 1 FROM wc_match_events e2
      WHERE e2.player_id = ${canonId} AND e2.year = wc_match_events.year
        AND e2.match_date IS NOT DISTINCT FROM wc_match_events.match_date
        AND e2.type = wc_match_events.type
        AND e2.minute IS NOT DISTINCT FROM wc_match_events.minute
    )
  `);
  await db.execute(sql`
    INSERT INTO player_extra_stats (player_id)
    SELECT ${canonId} WHERE NOT EXISTS (SELECT 1 FROM player_extra_stats WHERE player_id = ${canonId})
  `);
  await db.execute(sql`DELETE FROM player_extra_stats WHERE player_id = ${dupId}`);
  await db.execute(sql`DELETE FROM player_data_reviews WHERE player_id = ${dupId}`);
  await db.execute(sql`
    UPDATE players c SET
      aliases = (
        SELECT to_jsonb(ARRAY(
          SELECT DISTINCT trim(x)
          FROM jsonb_array_elements_text(COALESCE(c.aliases, '[]'::jsonb) || COALESCE(d.aliases, '[]'::jsonb) || to_jsonb(ARRAY[d.name])) AS x
          WHERE trim(x) <> ''
        ))
      ),
      peak_market_value_eur = GREATEST(c.peak_market_value_eur, d.peak_market_value_eur),
      market_value_eur = COALESCE(c.market_value_eur, d.market_value_eur),
      tm_player_id = COALESCE(c.tm_player_id, d.tm_player_id),
      api_football_id = COALESCE(c.api_football_id, d.api_football_id),
      external_id = COALESCE(c.external_id, d.external_id),
      birth_date = COALESCE(c.birth_date, d.birth_date)
    FROM players d
    WHERE c.id = ${canonId} AND d.id = ${dupId}
  `);
  await db.execute(sql`DELETE FROM players WHERE id = ${dupId}`);
}

async function main(): Promise<void> {
  const stubs = (await db.execute(sql`
    SELECT p.id, p.name, COALESCE(p.aliases, '[]'::jsonb) AS aliases, p.nationality,
           p.birth_date::text AS "birthDate",
           COALESCE((
             SELECT array_agg(DISTINCT pc.team_name)
             FROM player_career pc
             WHERE pc.player_id = p.id AND pc.team_id > 0
           ), ARRAY[]::text[]) AS clubs
    FROM players p
    WHERE p.tm_player_id IS NULL AND p.market_value_tier >= ${FAMOUS_TIER}
    ORDER BY p.market_value_tier DESC, p.name
  `)) as unknown as Stub[];

  console.log(`Famous players with no Transfermarkt id: ${stubs.length}`);

  const taken = new Set(
    (
      (await db.execute(sql`SELECT tm_player_id FROM players WHERE tm_player_id IS NOT NULL`)) as unknown as Array<{
        tm_player_id: string;
      }>
    ).map((r) => String(r.tm_player_id))
  );

  const needles = [...new Set(stubs.map((s) => s.name.trim()).filter((n) => n.length >= 3))];
  const hitsByNeedle = new Map<string, WikiHit[]>();
  for (let i = 0; i < needles.length; i += 1) {
    const name = needles[i]!;
    try {
      hitsByNeedle.set(nameKey(name), await queryOneName(name));
    } catch (error) {
      console.warn(`  ! ${name}: ${error instanceof Error ? error.message : error}`);
      hitsByNeedle.set(nameKey(name), []);
    }
    if ((i + 1) % 5 === 0 || i + 1 === needles.length) {
      console.log(`  queried ${i + 1}/${needles.length} names`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const needTeams = new Map<string, WikiHit>();
  for (const stub of stubs) {
    const names = [stub.name, ...(Array.isArray(stub.aliases) ? stub.aliases : [])].map(nameKey);
    const hits: WikiHit[] = [];
    for (const name of names) {
      for (const hit of hitsByNeedle.get(name) ?? []) {
        if (!hits.some((h) => h.qid === hit.qid)) hits.push(hit);
      }
    }
    if (new Set(hits.map((h) => h.tmId)).size > 1) {
      for (const hit of hits) needTeams.set(hit.qid, hit);
    }
  }
  if (needTeams.size > 0) {
    console.log(`  fetching clubs for ${needTeams.size} ambiguous Wikidata people`);
    await fillTeams([...needTeams.values()]);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const matches: Array<{ stub: Stub; hit: WikiHit; via: string }> = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const stub of stubs) {
    const names = [stub.name, ...(Array.isArray(stub.aliases) ? stub.aliases : [])].map(nameKey);
    const hits: WikiHit[] = [];
    for (const name of names) {
      for (const hit of hitsByNeedle.get(name) ?? []) {
        if (!hits.some((h) => h.qid === hit.qid)) hits.push(hit);
      }
    }
    const decision = decide(stub, hits, taken);
    if ('hit' in decision) {
      taken.add(decision.hit.tmId);
      matches.push({ stub, hit: decision.hit, via: decision.via });
    } else {
      rejected.push({ name: stub.name, reason: decision.reason });
    }
  }

  console.log(`\nMatched : ${matches.length}`);
  for (const m of matches) {
    const nat = m.hit.citizenship ? canonicalNationality(m.hit.citizenship) : '—';
    console.log(
      `  ${m.stub.name.padEnd(28)} tm=${m.hit.tmId.padEnd(8)} ${m.hit.birth ?? 'no-dob'}  ${nat.padEnd(16)} ${m.via}`
    );
  }
  console.log(`\nRejected: ${rejected.length}`);
  for (const r of rejected) console.log(`  ${r.name.padEnd(28)} ${r.reason}`);

  const mergePairs = (await db.execute(sql`
    SELECT s.id AS stub_id, s.name AS stub_name, c.id AS canon_id, c.name AS canon_name
    FROM players s
    JOIN players c ON c.id <> s.id
      AND s.birth_date IS NOT NULL AND c.birth_date IS NOT NULL
      AND s.birth_date = c.birth_date
      AND COALESCE(s.nationality, 'Unknown') IN ('Unknown', '')
      AND COALESCE(c.nationality, 'Unknown') NOT IN ('Unknown', '')
      AND s.market_value_tier >= ${FAMOUS_TIER}
      AND (
        lower(split_part(s.name, ' ', array_length(regexp_split_to_array(s.name, ' '), 1)))
          = lower(split_part(c.name, ' ', array_length(regexp_split_to_array(c.name, ' '), 1)))
        OR lower(s.name) = lower(c.name)
      )
    ORDER BY s.name
  `)) as unknown as Array<{ stub_id: string; stub_name: string; canon_id: string; canon_name: string }>;

  console.log(`\nUnknown duplicates to merge: ${mergePairs.length}`);
  for (const p of mergePairs) console.log(`  ${p.canon_name} ⇐ ${p.stub_name}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write identities and merges.');
    return;
  }

  let updated = 0;
  for (const { stub, hit } of matches) {
    const nat = hit.citizenship ? canonicalNationality(hit.citizenship) : stub.nationality;
    const nationality =
      stub.nationality === 'Unknown' || stub.nationality === '' ? nat : stub.nationality;
    const wdName = hit.labels[0] ?? stub.name;
    const keepName =
      stub.nationality === 'Unknown' && wdName.split(/\s+/).length > stub.name.split(/\s+/).length
        ? wdName
        : stub.name;
    const fields = buildPlayerSearchFields(keepName);
    const aliases = [...new Set([...fields.aliases, stub.name, ...stub.aliases, ...hit.labels])];
    await db.execute(sql`
      UPDATE players SET
        tm_player_id = ${hit.tmId},
        birth_date = COALESCE(birth_date, ${hit.birth}::date),
        age = ${hit.birth ? sql`date_part('year', age(${hit.birth}::date))::int` : sql`age`},
        nationality = ${nationality},
        aliases = ${JSON.stringify(aliases)}::jsonb,
        search_text = ${fields.searchText},
        name = ${keepName}
      WHERE id = ${stub.id} AND tm_player_id IS NULL
    `);
    updated += 1;
  }
  console.log(`\nWrote identity on ${updated} players.`);

  let merged = 0;
  for (const pair of mergePairs) {
    await mergeStubInto(pair.stub_id, pair.canon_id);
    merged += 1;
    console.log(`  merged ${pair.stub_name} → ${pair.canon_name}`);
  }
  console.log(`Merged ${merged} Unknown duplicates.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
