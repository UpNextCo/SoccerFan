import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSpells, reconcileStints, type SeasonContext } from './careerSeasonReconciler.js';

/** Nothing known outside the club: no other club, no unattributed appearances. */
const NOTHING_ELSE: SeasonContext = {
  departedDuring: () => false,
  unknownDuring: () => false,
};

function context(options: { elsewhere?: number[]; unknown?: number[] }): SeasonContext {
  const elsewhere = options.elsewhere ?? [];
  const unknown = options.unknown ?? [];
  return {
    departedDuring: (from, to) => elsewhere.some((s) => s >= from && s <= to),
    unknownDuring: (from, to) => unknown.some((s) => s >= from && s <= to),
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const ONGOING_FROM = 2025;

test('leaves a spell untouched when there is no appearance evidence', () => {
  assert.equal(reconcileStints([{ from: 1990, to: 1995 }], [], NOTHING_ELSE, ONGOING_FROM), null);
});

test('moves a start earlier to the first season played (Owen at Liverpool)', () => {
  // Stored 2002-2003; he actually played there from 1996.
  const out = reconcileStints([{ from: 2002, to: 2003 }], range(1996, 2003), NOTHING_ELSE, ONGOING_FROM);
  assert.equal(formatSpells(out!), '1996-2003');
});

test('pulls an end back to the last season played (Gerrard at Liverpool)', () => {
  // Stored 2005-2017; he arrived in 1998 and left in 2015, and 2010-2013 appearances carry no club.
  const out = reconcileStints(
    [{ from: 2005, to: 2017 }],
    [...range(1998, 2009), 2014],
    context({ unknown: range(2010, 2013) }),
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '1998-2014');
});

test('does NOT split a gap that only reflects missing data', () => {
  // Same Gerrard shape: a four-season hole with no sighting at any other club is not a transfer.
  const out = reconcileStints(
    [{ from: 1998, to: 2014 }],
    [...range(1998, 2009), 2014],
    NOTHING_ELSE,
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '1998-2014');
});

test('splits a merged spell when the player was demonstrably elsewhere (Cristiano at United)', () => {
  // One stored row spans both spells, which would invent teammates for every year between.
  const out = reconcileStints(
    [{ from: 2003, to: 2021 }],
    [...range(2003, 2008), 2021, 2022],
    context({ elsewhere: range(2009, 2020) }),
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '2003-2008 + 2021-2022');
});

test('keeps separate stored stints separate', () => {
  const out = reconcileStints(
    [
      { from: 2010, to: 2011 },
      { from: 2016, to: 2021 },
    ],
    [2010, 2011, ...range(2016, 2021)],
    context({ elsewhere: range(2012, 2015) }),
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '2010-2011 + 2016-2021');
});

test('leaves an ongoing spell end alone, since current-season stats lag', () => {
  const out = reconcileStints([{ from: 2017, to: 2026 }], range(2017, 2024), NOTHING_ELSE, ONGOING_FROM);
  assert.equal(formatSpells(out!), '2017-2026');
});

test('keeps a stored end when unattributed appearances sit in the tail', () => {
  const out = reconcileStints(
    [{ from: 2015, to: 2020 }],
    range(2015, 2017),
    context({ unknown: [2019] }),
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '2015-2020');
});

test('widens an end when the player kept playing past the stored date', () => {
  const out = reconcileStints([{ from: 2015, to: 2016 }], range(2015, 2018), NOTHING_ELSE, ONGOING_FROM);
  assert.equal(formatSpells(out!), '2015-2018');
});

test('discards a start from before the player was born (Morata at Milan from 1926)', () => {
  // The transfer feed dates unknown moves 1926-01-01; born 1992, so anything before 2007 is broken.
  const out = reconcileStints([{ from: 1926, to: 2025 }], [2025], NOTHING_ELSE, ONGOING_FROM, 1992 + 15);
  assert.equal(formatSpells(out!), '2025-2025');
});

test('still trusts a real start that predates our stats coverage', () => {
  // Born 1965, joined in 1985, but player_stats only begins in 1992 — the stored start must survive.
  const out = reconcileStints([{ from: 1985, to: 1995 }], range(1992, 1995), NOTHING_ELSE, ONGOING_FROM, 1965 + 15);
  assert.equal(formatSpells(out!), '1985-1995');
});

test('keeps a stint that has no appearances of its own', () => {
  // Evidence lands on the later stint only; the earlier one must survive as stored.
  const out = reconcileStints(
    [
      { from: 1998, to: 1999 },
      { from: 2005, to: 2008 },
    ],
    range(2005, 2008),
    NOTHING_ELSE,
    ONGOING_FROM
  );
  assert.equal(formatSpells(out!), '1998-1999 + 2005-2008');
});
