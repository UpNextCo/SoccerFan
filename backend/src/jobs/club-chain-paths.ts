import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubChainLink } from '../services/clubChainGenerator.js';

const START = '57f6330c-63e1-48ae-a1f9-8ef19bfb0c8d';
const TARGET = '2788f6a4-cbc4-466b-9075-28b92bfd8fa8';

function fmt(link: NonNullable<Awaited<ReturnType<typeof clubChainLink>>>) {
  return `${link.clubName} (${link.overlapStart}–${link.overlapEnd})`;
}

async function main() {
  const rows = (await db.execute(sql`
    SELECT id, name FROM players
    WHERE market_value_tier >= 3 AND external_id IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string }>;
  const names = new Map(rows.map((r) => [r.id, r.name]));

  const direct = await clubChainLink(START, TARGET);
  console.log('Direct link:', direct ? fmt(direct) : 'none');

  const fromStart = new Map<string, string>();
  for (const p of rows) {
    if (p.id === START) continue;
    const link = await clubChainLink(START, p.id);
    if (link) fromStart.set(p.id, fmt(link));
  }

  const toTarget = new Map<string, string>();
  for (const p of rows) {
    if (p.id === TARGET) continue;
    const link = await clubChainLink(p.id, TARGET);
    if (link) toTarget.set(p.id, fmt(link));
  }

  console.log(`Neighbors from Boateng: ${fromStart.size}`);
  console.log(`Neighbors to Alvarez: ${toTarget.size}`);

  const oneMid: Array<{ mid: string; l1: string; l2: string }> = [];
  for (const [mid, l1] of fromStart) {
    const l2 = toTarget.get(mid);
    if (l2) oneMid.push({ mid, l1, l2 });
  }
  console.log(`\n2-link paths (Boateng -> X -> Alvarez): ${oneMid.length}`);
  for (const p of oneMid.slice(0, 20)) {
    console.log(`- ${names.get(p.mid)} | ${p.l1} -> ${p.l2}`);
  }

  const threeLink: Array<{ m1: string; m2: string; l1: string; l2: string; l3: string }> = [];
  for (const [m1, l1] of fromStart) {
    for (const [m2, l3] of toTarget) {
      if (m1 === m2) continue;
      const mid = await clubChainLink(m1, m2);
      if (mid) threeLink.push({ m1, m2, l1, l2: fmt(mid), l3 });
    }
  }
  console.log(`\n3-link paths: ${threeLink.length}`);
  for (const p of threeLink.slice(0, 20)) {
    console.log(`- ${names.get(p.m1)} -> ${names.get(p.m2)} -> Alvarez`);
    console.log(`  ${p.l1}`);
    console.log(`  ${p.l2}`);
    console.log(`  ${p.l3}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
