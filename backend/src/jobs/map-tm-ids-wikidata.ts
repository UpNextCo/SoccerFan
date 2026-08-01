/**
 * Find Transfermarkt ids for players we have none for, via Wikidata.
 *
 * `transferdata/tm_id_map.json` was built from a squad-snapshot dataset, so it only knows players who
 * were recently registered somewhere: Henry, Shearer, Raúl, Del Piero, Trézéguet and 260-odd other
 * retired players have no Transfermarkt id, which means the season scrape can never reach them. That
 * matters for Career Goals — the per-league totals we hold miss every domestic cup, so the honest
 * all-competition figure only exists on Transfermarkt, and ranking Ronaldo's cup-inclusive total
 * against Henry's league-only one would be worse than the undercount we have now.
 *
 * Wikidata carries the Transfermarkt player id (P2446) alongside a birth date (P569), and a birth date
 * is what makes the match safe: football is full of namesakes, and we have already had to unpick two
 * careers merged under one name. A candidate is accepted only when it is a human whose birth date is
 * the one we hold, so "Ronaldo" cannot quietly resolve to the wrong man.
 *
 * Usage:
 *   npx tsx src/jobs/map-tm-ids-wikidata.ts               # dry run + review CSV
 *   npx tsx src/jobs/map-tm-ids-wikidata.ts --apply
 *   npx tsx src/jobs/map-tm-ids-wikidata.ts --limit=50    # try a slice first
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const APPLY = process.argv.includes('--apply');
const DIR = process.argv.find((a) => !a.startsWith('--') && a.includes('transferdata')) ?? 'transferdata';
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? '0') || 0;
const REVIEW_PATH = process.argv.find((a) => a.startsWith('--review='))?.slice(9) ?? 'tm_id_map_review.csv';

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'BallKnowledge/1.0 (football quiz app; contact via repository) node-fetch';

/** Birth dates per query. One request covers a whole batch, which keeps well inside the rate limit. */
const BATCH = 40;
const PAUSE_MS = 400;

interface Candidate {
  id: string;
  name: string;
  aliases: string[];
  birthDate: string;
}

/** Everyone Wikidata knows with one of these birth dates who has a Transfermarkt id. */
interface WikidataPerson {
  qid: string;
  tmId: string;
  birth: string;
  labels: string[];
}

async function queryBirthDates(dates: string[]): Promise<WikidataPerson[]> {
  const values = dates.map((d) => `"${d}T00:00:00Z"^^xsd:dateTime`).join(' ');
  // Labels are read straight off the entity rather than through SERVICE wikibase:label, which quietly
  // drops rows on a batch this size. One row per language is fine — more spellings to match against.
  const query = `
    SELECT ?item ?label ?tm ?birth WHERE {
      VALUES ?birth { ${values} }
      ?item wdt:P569 ?birth ; wdt:P2446 ?tm ; rdfs:label ?label .
      FILTER(lang(?label) IN ("en","nl","es","pt","fr","de","it","tr"))
    }`;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        results: { bindings: Array<Record<string, { value: string }>> };
      };
      const byQid = new Map<string, WikidataPerson>();
      for (const b of data.results.bindings) {
        const qid = b['item']!.value.split('/').pop()!;
        const person =
          byQid.get(qid) ??
          byQid.set(qid, { qid, tmId: b['tm']!.value, birth: b['birth']!.value.slice(0, 10), labels: [] }).get(qid)!;
        const label = b['label']?.value;
        if (label) person.labels.push(label.trim());
      }
      return [...byQid.values()];
    }
    if (res.status !== 429 && res.status < 500) throw new Error(`SPARQL HTTP ${res.status}`);
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    await new Promise((r) => setTimeout(r, retryAfter ? retryAfter * 1000 : 2000 * attempt));
  }
  throw new Error('SPARQL rate limited after 4 attempts');
}

async function main(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.birth_date::text AS "birthDate", COALESCE(p.aliases, '[]'::jsonb) AS aliases,
      (p.market_value_tier * 10
        + LEAST(COALESCE((SELECT COUNT(*) FROM final_appearances f WHERE f.player_id = p.id), 0), 6) * 4
        + LEAST(COALESCE((SELECT COUNT(*) FROM player_awards a WHERE a.player_id = p.id), 0), 4) * 6) AS fame
    FROM players p
    WHERE p.tm_player_id IS NULL AND p.birth_date IS NOT NULL
      AND (p.market_value_tier >= 3
           OR EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id)
           OR EXISTS (SELECT 1 FROM player_awards a WHERE a.player_id = p.id))
    ORDER BY fame DESC, p.name
  `)) as unknown as Array<Candidate & { fame: number }>;

  const targets = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`Players without a Transfermarkt id: ${rows.length}${LIMIT ? ` (trying ${targets.length})` : ''}`);

  // A TM id already in use must not be handed to a second player.
  const taken = new Set(
    (
      (await db.execute(sql`SELECT tm_player_id FROM players WHERE tm_player_id IS NOT NULL`)) as unknown as Array<{
        tm_player_id: string;
      }>
    ).map((r) => String(r.tm_player_id))
  );

  const found: Array<{ id: string; name: string; birthDate: string; tmId: string; qid: string; via: string }> = [];
  const unmatched: Array<{ name: string; birthDate: string; reason: string }> = [];

  const dates = [...new Set(targets.map((t) => t.birthDate.slice(0, 10)))];
  const peopleByBirth = new Map<string, WikidataPerson[]>();
  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    for (const person of await queryBirthDates(batch)) {
      (peopleByBirth.get(person.birth) ?? peopleByBirth.set(person.birth, []).get(person.birth)!).push(person);
    }
    console.log(`  queried ${Math.min(i + BATCH, dates.length)}/${dates.length} birth dates`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  for (const player of targets) {
    const birth = player.birthDate.slice(0, 10);
    const sameBirth = peopleByBirth.get(birth) ?? [];
    if (sameBirth.length === 0) {
      unmatched.push({ name: player.name, birthDate: birth, reason: 'nobody on Wikidata with that birth date has a TM id' });
      continue;
    }

    const ourNames = [player.name, ...(Array.isArray(player.aliases) ? player.aliases : [])]
      .filter(Boolean)
      .map((n) => normalizeSearchText(n));
    const ourSet = new Set(ourNames);

    // Exact name first; only then the looser token test, so a namesake's shorter label can't win.
    const exact = sameBirth.filter((p) => p.labels.some((l) => ourSet.has(normalizeSearchText(l))));
    const loose = exact.length
      ? exact
      : sameBirth.filter((p) =>
          p.labels.some((l) => {
            const theirs = normalizeSearchText(l).split(' ').filter(Boolean);
            if (theirs.length < 2) return false;
            return ourNames.some((ours) => {
              const mine = ours.split(' ').filter(Boolean);
              return theirs.every((t) => mine.includes(t)) || mine.every((t) => theirs.includes(t));
            });
          })
        );

    const usable = loose.filter((p) => !taken.has(p.tmId));
    const distinct = new Set(usable.map((p) => p.tmId));
    if (distinct.size === 1) {
      const hit = usable[0]!;
      taken.add(hit.tmId);
      found.push({
        id: player.id,
        name: player.name,
        birthDate: birth,
        tmId: hit.tmId,
        qid: hit.qid,
        via: exact.length ? 'name' : 'name~',
      });
    } else {
      unmatched.push({
        name: player.name,
        birthDate: birth,
        reason:
          distinct.size > 1
            ? `${distinct.size} people share the name and birth date`
            : 'birth date found, but no name match',
      });
    }
  }

  const csv = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  writeFileSync(
    REVIEW_PATH,
    [
      'outcome,player,birth_date,tm_player_id,wikidata,matched_on',
      ...found.map((f) => ['matched', csv(f.name), f.birthDate, f.tmId, f.qid, f.via].join(',')),
      ...unmatched.map((u) => ['unmatched', csv(u.name), u.birthDate, '', '', csv(u.reason)].join(',')),
    ].join('\n') + '\n'
  );

  console.log(`\nMatched   : ${found.length}`);
  console.log(`Unmatched : ${unmatched.length}`);
  const reasons = new Map<string, number>();
  for (const u of unmatched) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);
  for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n} ${reason}`);
  console.log(`Review CSV: ${REVIEW_PATH}`);
  console.log('\nFirst matches:');
  for (const f of found.slice(0, 12)) console.log(`  ${f.name.padEnd(26)} ${f.birthDate}  tm=${f.tmId}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these ids.');
    return;
  }

  for (let i = 0; i < found.length; i += 200) {
    const batch = found.slice(i, i + 200);
    await db.transaction(async (tx) => {
      for (const f of batch) {
        await tx.execute(sql`UPDATE players SET tm_player_id = ${f.tmId} WHERE id = ${f.id} AND tm_player_id IS NULL`);
      }
    });
  }
  console.log(`\nWrote ${found.length} Transfermarkt ids.`);

  // The scraper reads its targets from this map, so newly mapped players have to land in it. The slug
  // is cosmetic — Transfermarkt resolves the URL from the numeric id — so a placeholder is enough.
  const mapPath = join(DIR, 'tm_id_map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Array<{ ourId: string; tmId: string; code: string; name: string }>;
  const known = new Set(map.map((m) => m.ourId));
  let added = 0;
  for (const f of found) {
    if (known.has(f.id)) continue;
    map.push({ ourId: f.id, tmId: f.tmId, code: 'x', name: f.name });
    added += 1;
  }
  writeFileSync(mapPath, JSON.stringify(map));
  console.log(`Added ${added} entries to ${mapPath} — re-run tm-targets, then the season scrape.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
