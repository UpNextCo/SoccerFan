/**
 * Seed curated manager → club tenures for marquee managers. Powers "played under X"
 * relationship prompts. Seasons are season-start years (2008 = 2008/09); `to: null`
 * means ongoing. We deliberately curate only famous managers (the only ones that make
 * fun prompts) — this beats scraping on quality and has zero anti-bot fragility.
 *
 * Pure DB, idempotent. Usage: DATABASE_URL=... npm run job:seed-managers
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normClub, playersUnderAll, unmatchedTenureClubs } from '../services/managerRules.js';

interface Spell {
  club: string;
  from: number;
  to: number | null;
}
interface Manager {
  name: string;
  spells: Spell[];
}

const MANAGERS: Manager[] = [
  {
    name: 'Pep Guardiola',
    spells: [
      { club: 'Barcelona', from: 2008, to: 2011 },
      { club: 'Bayern München', from: 2013, to: 2015 },
      { club: 'Manchester City', from: 2016, to: null },
    ],
  },
  {
    name: 'José Mourinho',
    spells: [
      { club: 'Porto', from: 2002, to: 2003 },
      { club: 'Chelsea', from: 2004, to: 2006 },
      { club: 'Inter', from: 2008, to: 2009 },
      { club: 'Real Madrid', from: 2010, to: 2012 },
      { club: 'Chelsea', from: 2013, to: 2015 },
      { club: 'Manchester United', from: 2016, to: 2018 },
      { club: 'Tottenham', from: 2019, to: 2020 },
      { club: 'Roma', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Carlo Ancelotti',
    spells: [
      { club: 'Juventus', from: 1999, to: 2000 },
      { club: 'AC Milan', from: 2001, to: 2008 },
      { club: 'Chelsea', from: 2009, to: 2010 },
      { club: 'Paris Saint Germain', from: 2011, to: 2012 },
      { club: 'Real Madrid', from: 2013, to: 2014 },
      { club: 'Bayern München', from: 2016, to: 2017 },
      { club: 'Napoli', from: 2018, to: 2019 },
      { club: 'Everton', from: 2019, to: 2020 },
      { club: 'Real Madrid', from: 2021, to: 2024 },
    ],
  },
  { name: 'Sir Alex Ferguson', spells: [{ club: 'Manchester United', from: 1986, to: 2012 }] },
  { name: 'Arsène Wenger', spells: [{ club: 'Arsenal', from: 1996, to: 2017 }] },
  {
    name: 'Jürgen Klopp',
    spells: [
      { club: 'Borussia Dortmund', from: 2008, to: 2014 },
      { club: 'Liverpool', from: 2015, to: 2023 },
    ],
  },
  {
    name: 'Zinedine Zidane',
    spells: [
      { club: 'Real Madrid', from: 2015, to: 2017 },
      { club: 'Real Madrid', from: 2019, to: 2020 },
    ],
  },
  {
    name: 'Antonio Conte',
    spells: [
      { club: 'Juventus', from: 2011, to: 2013 },
      { club: 'Chelsea', from: 2016, to: 2017 },
      { club: 'Inter', from: 2019, to: 2020 },
      { club: 'Tottenham', from: 2021, to: 2022 },
      { club: 'Napoli', from: 2024, to: null },
    ],
  },
  { name: 'Diego Simeone', spells: [{ club: 'Atletico Madrid', from: 2011, to: null }] },
  {
    name: 'Massimiliano Allegri',
    spells: [
      { club: 'AC Milan', from: 2010, to: 2013 },
      { club: 'Juventus', from: 2014, to: 2018 },
      { club: 'Juventus', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Rafael Benítez',
    spells: [
      { club: 'Valencia', from: 2001, to: 2003 },
      { club: 'Liverpool', from: 2004, to: 2009 },
      { club: 'Inter', from: 2010, to: 2010 },
      { club: 'Chelsea', from: 2012, to: 2012 },
      { club: 'Napoli', from: 2013, to: 2014 },
      { club: 'Real Madrid', from: 2015, to: 2015 },
      { club: 'Newcastle', from: 2016, to: 2018 },
    ],
  },
  {
    name: 'Louis van Gaal',
    spells: [
      { club: 'Barcelona', from: 1997, to: 1999 },
      { club: 'Bayern München', from: 2009, to: 2010 },
      { club: 'Manchester United', from: 2014, to: 2015 },
    ],
  },
  {
    name: 'Luis Enrique',
    spells: [
      { club: 'Barcelona', from: 2014, to: 2016 },
      { club: 'Paris Saint Germain', from: 2023, to: null },
    ],
  },
  {
    name: 'Mauricio Pochettino',
    spells: [
      { club: 'Tottenham', from: 2014, to: 2019 },
      { club: 'Paris Saint Germain', from: 2020, to: 2021 },
      { club: 'Chelsea', from: 2023, to: 2023 },
    ],
  },
  {
    name: 'Thomas Tuchel',
    spells: [
      { club: 'Borussia Dortmund', from: 2015, to: 2016 },
      { club: 'Paris Saint Germain', from: 2018, to: 2019 },
      { club: 'Chelsea', from: 2020, to: 2022 },
      { club: 'Bayern München', from: 2023, to: 2024 },
    ],
  },
  { name: 'Frank Rijkaard', spells: [{ club: 'Barcelona', from: 2003, to: 2007 }] },
  { name: 'Vicente del Bosque', spells: [{ club: 'Real Madrid', from: 1999, to: 2002 }] },
  {
    name: 'Roberto Mancini',
    spells: [
      { club: 'Inter', from: 2004, to: 2007 },
      { club: 'Manchester City', from: 2009, to: 2012 },
      { club: 'Inter', from: 2014, to: 2015 },
    ],
  },
  {
    name: 'Manuel Pellegrini',
    spells: [
      { club: 'Real Madrid', from: 2009, to: 2009 },
      { club: 'Manchester City', from: 2013, to: 2015 },
      { club: 'West Ham', from: 2018, to: 2019 },
    ],
  },
  {
    name: 'Unai Emery',
    spells: [
      { club: 'Valencia', from: 2008, to: 2011 },
      { club: 'Sevilla', from: 2013, to: 2015 },
      { club: 'Paris Saint Germain', from: 2016, to: 2017 },
      { club: 'Arsenal', from: 2018, to: 2019 },
      { club: 'Villarreal', from: 2020, to: 2021 },
      { club: 'Aston Villa', from: 2023, to: null },
    ],
  },
  { name: 'Xabi Alonso', spells: [{ club: 'Bayer Leverkusen', from: 2022, to: 2024 }] },
  { name: 'Xavi', spells: [{ club: 'Barcelona', from: 2021, to: 2023 }] },
  { name: 'Mikel Arteta', spells: [{ club: 'Arsenal', from: 2019, to: null }] },
  {
    name: 'Erik ten Hag',
    spells: [
      { club: 'Ajax', from: 2017, to: 2021 },
      { club: 'Manchester United', from: 2022, to: 2024 },
    ],
  },
  {
    name: 'Hansi Flick',
    spells: [
      { club: 'Bayern München', from: 2019, to: 2020 },
      { club: 'Barcelona', from: 2024, to: null },
    ],
  },
  {
    name: 'Julian Nagelsmann',
    spells: [
      { club: 'Hoffenheim', from: 2015, to: 2018 },
      { club: 'RB Leipzig', from: 2019, to: 2020 },
      { club: 'Bayern München', from: 2021, to: 2022 },
    ],
  },
  {
    name: 'Maurizio Sarri',
    spells: [
      { club: 'Napoli', from: 2015, to: 2017 },
      { club: 'Chelsea', from: 2018, to: 2018 },
      { club: 'Juventus', from: 2019, to: 2019 },
      { club: 'Lazio', from: 2021, to: 2023 },
    ],
  },
  {
    name: 'Claudio Ranieri',
    spells: [
      { club: 'Chelsea', from: 2000, to: 2003 },
      { club: 'Leicester', from: 2015, to: 2016 },
    ],
  },
  {
    name: 'Marcelo Bielsa',
    spells: [
      { club: 'Athletic Club', from: 2011, to: 2012 },
      { club: 'Leeds', from: 2018, to: 2021 },
    ],
  },
  {
    name: 'Jupp Heynckes',
    spells: [
      { club: 'Bayern München', from: 2011, to: 2012 },
      { club: 'Bayern München', from: 2017, to: 2017 },
    ],
  },
  {
    name: 'Ottmar Hitzfeld',
    spells: [
      { club: 'Borussia Dortmund', from: 1991, to: 1997 },
      { club: 'Bayern München', from: 1998, to: 2003 },
      { club: 'Bayern München', from: 2007, to: 2007 },
    ],
  },
  {
    name: 'Fabio Capello',
    spells: [
      { club: 'Real Madrid', from: 1996, to: 1996 },
      { club: 'Roma', from: 1999, to: 2003 },
      { club: 'Juventus', from: 2004, to: 2005 },
      { club: 'Real Madrid', from: 2006, to: 2006 },
    ],
  },
];

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS manager_tenures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      manager text NOT NULL,
      manager_norm text NOT NULL,
      club text NOT NULL,
      club_norm text NOT NULL,
      season_from integer NOT NULL,
      season_to integer,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS manager_tenures_unique ON manager_tenures (manager_norm, club_norm, season_from)`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS manager_tenures_manager_idx ON manager_tenures (manager_norm)`
  );

  // Fully curated → clean rebuild each run so edits (renamed clubs, fixed dates) don't
  // leave stale rows behind.
  await db.execute(sql`DELETE FROM manager_tenures`);

  let rows = 0;
  for (const m of MANAGERS) {
    const managerNorm = normClub(m.name);
    for (const sp of m.spells) {
      await db.execute(sql`
        INSERT INTO manager_tenures (manager, manager_norm, club, club_norm, season_from, season_to)
        VALUES (${m.name}, ${managerNorm}, ${sp.club}, ${normClub(sp.club)}, ${sp.from}, ${sp.to})
        ON CONFLICT (manager_norm, club_norm, season_from) DO UPDATE SET season_to = EXCLUDED.season_to
      `);
      rows += 1;
    }
  }
  console.log(`Seeded ${MANAGERS.length} managers · ${rows} tenures.`);

  // --- QA: which curated clubs didn't match any stored team_name? ---
  const unmatched = await unmatchedTenureClubs();
  if (unmatched.length) {
    console.log(`\n⚠️  Unmatched clubs (need alias): ${unmatched.join(', ')}`);
  } else {
    console.log('\nAll curated clubs matched stored team names.');
  }

  // --- Verify end-to-end with marquee crossovers ---
  const checks: Array<[string, string[]]> = [
    ['Mourinho + Guardiola', ['jose mourinho', 'pep guardiola']],
    ['Ancelotti + Guardiola', ['carlo ancelotti', 'pep guardiola']],
    ['Ferguson + Mourinho', ['sir alex ferguson', 'jose mourinho']],
    ['Klopp + Guardiola', ['jurgen klopp', 'pep guardiola']],
  ];
  for (const [label, norms] of checks) {
    const ids = await playersUnderAll(norms);
    let sample: string[] = [];
    if (ids.size) {
      const rows2 = (await db.execute(sql`
        SELECT name FROM players WHERE id IN (${sql.join([...ids].map((i) => sql`${i}::uuid`), sql`, `)})
        ORDER BY name LIMIT 12
      `)) as unknown as Array<{ name: string }>;
      sample = rows2.map((r) => r.name);
    }
    console.log(`\n${label}: ${ids.size} players`);
    if (sample.length) console.log(`  e.g. ${sample.join(', ')}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
