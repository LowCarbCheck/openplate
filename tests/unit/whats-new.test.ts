/**
 * The release notes the app ships with itself, and the one question the card
 * and the page both ask: has this device been told about this build yet.
 *
 * WHY EVERY BRANCH IS PAIRED WITH A CONTROL. Three of the four outcomes render
 * nothing, so an assertion that a device is told nothing passes against a
 * decision that never tells anybody anything. Each quiet case here therefore
 * names the one input that has to change to make the card appear, and asserts
 * that it does.
 *
 * The browser tier drives the same rules through the real pages; this file is
 * where the arithmetic is pinned.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  WHATS_NEW_STORAGE_KEY,
  compareVersions,
  countLeads,
  decideWhatsNew,
  entriesFromCatalog,
  isKnownVersion,
  parseVersionTriple,
  readWhatsNewSeen,
  writeWhatsNewSeen,
  type ReleaseEntry,
  type ReleasesCatalog,
  type WhatsNewStorage,
} from '#app/lib/whats-new';

////////////////////////////////////////////////////////////////////////////////
// Fixtures
////////////////////////////////////////////////////////////////////////////////

/** When the bundle under test was built. Every "established" device onboarded before this. */
const BUILT_AT = '2026-09-20T09:00:00.000Z';

/** A device that was already logging food before this build existed. */
const ESTABLISHED_AT = Date.parse('2026-06-01T12:00:00.000Z');

/** A device that finished onboarding after this build shipped, so it has missed nothing. */
const BRAND_NEW_AT = Date.parse('2026-09-21T12:00:00.000Z');

/**
 * Three releases in the shape the `releases` namespace ships, deliberately NOT
 * in version order in the file, so the ordering below is a real claim.
 */
const CATALOG: ReleasesCatalog = {
  v0_34_0: {
    date: '2026-09-05',
    changed: { '01': 'Changed in 0.34.0.' },
  },
  v0_35_0: {
    date: '2026-09-20',
    added: { '01': 'Added first.', '02': 'Added second.' },
    fixed: { '01': 'Fixed in 0.35.0.' },
  },
  v0_33_2: {
    date: '2026-08-28',
    fixed: { '01': 'Fixed in 0.33.2.' },
  },
};

const ENTRIES = entriesFromCatalog(CATALOG);

/** A storage that remembers, the way a working browser does. */
function fakeStorage(initial: string | null = null): WhatsNewStorage {
  let value = initial;
  return {
    getItem: (key) => (key === WHATS_NEW_STORAGE_KEY ? value : null),
    setItem: (key, next) => {
      if (key === WHATS_NEW_STORAGE_KEY) value = next;
    },
  };
}

/** A storage that refuses, the way a private-mode or full browser does. */
const REFUSING_STORAGE: WhatsNewStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

/** The versions a decision would show, in the order it would show them. */
function shownVersions(unseen: readonly ReleaseEntry[]): string[] {
  return unseen.map((entry) => entry.version);
}

////////////////////////////////////////////////////////////////////////////////
// Versions
////////////////////////////////////////////////////////////////////////////////

describe('parseVersionTriple', () => {
  test('reads a plain x.y.z', () => {
    assert.deepEqual(parseVersionTriple('0.35.1'), [0, 35, 1]);
    assert.deepEqual(parseVersionTriple('12.0.7'), [12, 0, 7]);
  });

  test('refuses the unstamped build, a prerelease and anything else', () => {
    assert.equal(parseVersionTriple('0.0.0-unstamped'), null);
    assert.equal(parseVersionTriple('0.36.0-rc.1'), null);
    assert.equal(parseVersionTriple('v0.35.0'), null);
    assert.equal(parseVersionTriple('0.35'), null);
    assert.equal(parseVersionTriple(''), null);
    // CONTROL: the same string without the tail is read, so the refusals above
    // are about the tail rather than about the parser never matching anything.
    assert.deepEqual(parseVersionTriple('0.36.0'), [0, 36, 0]);
  });
});

describe('isKnownVersion', () => {
  test('null and junk are not versions, a plain triple is', () => {
    assert.equal(isKnownVersion(null), false);
    assert.equal(isKnownVersion('banana'), false);
    assert.equal(isKnownVersion('0.35.0'), true);
  });
});

describe('compareVersions', () => {
  test('orders by number, not by string', () => {
    // The string comparison every hand-rolled version check gets wrong.
    assert.ok(compareVersions('0.9.0', '0.10.0') < 0);
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  });

  test('orders major over minor over patch', () => {
    assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
    assert.ok(compareVersions('0.35.0', '0.35.1') < 0);
    assert.equal(compareVersions('0.35.1', '0.35.1'), 0);
  });

  test('an unreadable version sorts below everything, on either side', () => {
    assert.ok(compareVersions('nonsense', '0.0.0') < 0);
    assert.ok(compareVersions('0.0.0', 'nonsense') > 0);
    assert.equal(compareVersions('nonsense', 'other nonsense'), 0);
  });
});

////////////////////////////////////////////////////////////////////////////////
// The catalog
////////////////////////////////////////////////////////////////////////////////

describe('entriesFromCatalog', () => {
  test('orders the releases newest first, whatever order the file is in', () => {
    assert.deepEqual(shownVersions(ENTRIES), ['0.35.0', '0.34.0', '0.33.2']);
  });

  test('carries the catalog key and the date through', () => {
    assert.equal(ENTRIES[0]?.versionKey, 'v0_35_0');
    assert.equal(ENTRIES[0]?.date, '2026-09-20');
  });

  test('keeps the groups in added, changed, fixed order and drops the absent ones', () => {
    assert.deepEqual(
      ENTRIES[0]?.groups.map((group) => group.group),
      ['added', 'fixed'],
    );
    // CONTROL: a release with only one group carries only that one, so the
    // order above is a real ordering rather than the full list every time.
    assert.deepEqual(
      ENTRIES[1]?.groups.map((group) => group.group),
      ['changed'],
    );
  });

  test('renders every lead as a full i18n key path, in reading order', () => {
    assert.deepEqual(ENTRIES[0]?.groups[0]?.keys, ['v0_35_0.added.01', 'v0_35_0.added.02']);
    assert.deepEqual(ENTRIES[0]?.groups[1]?.keys, ['v0_35_0.fixed.01']);
  });

  test('orders ten leads by number, not by string', () => {
    const [entry] = entriesFromCatalog({
      v1_0_0: { date: '2026-01-01', added: { '10': 'Tenth.', '02': 'Second.', '01': 'First.' } },
    });
    assert.deepEqual(entry?.groups[0]?.keys, ['v1_0_0.added.01', 'v1_0_0.added.02', 'v1_0_0.added.10']);
  });

  test('ignores a key that is not a version, and keeps the ones that are', () => {
    const entries = entriesFromCatalog({
      notAVersion: { date: '2026-01-01', added: { '01': 'Ignored.' } },
      v0_1_0: { date: '2026-01-02', added: { '01': 'Kept.' } },
    });
    // CONTROL: one entry, not zero, so "ignored" is about the bad key rather
    // than about the whole catalog being refused.
    assert.deepEqual(shownVersions(entries), ['0.1.0']);
  });

  test('drops a group that is present but empty', () => {
    const [entry] = entriesFromCatalog({ v1_0_0: { date: '2026-01-01', added: {}, fixed: { '01': 'One.' } } });
    assert.deepEqual(
      entry?.groups.map((group) => group.group),
      ['fixed'],
    );
  });
});

describe('countLeads', () => {
  test('counts every lead of every entry', () => {
    assert.equal(countLeads(ENTRIES), 5);
    assert.equal(countLeads([]), 0);
    assert.equal(countLeads(ENTRIES.slice(0, 1)), 3);
  });
});

////////////////////////////////////////////////////////////////////////////////
// Storage
////////////////////////////////////////////////////////////////////////////////

describe('the acknowledgement on the device', () => {
  test('a fresh device has acknowledged nothing', () => {
    assert.equal(readWhatsNewSeen(fakeStorage()), null);
  });

  test('reads back the version that was written', () => {
    const storage = fakeStorage();
    writeWhatsNewSeen(storage, '0.35.0');
    assert.equal(readWhatsNewSeen(storage), '0.35.0');
  });

  test('CONTROL: another device is unaffected by this one acknowledging a build', () => {
    const deviceA = fakeStorage();
    const deviceB = fakeStorage();
    writeWhatsNewSeen(deviceA, '0.35.0');
    assert.equal(readWhatsNewSeen(deviceA), '0.35.0');
    assert.equal(readWhatsNewSeen(deviceB), null);
  });

  test('a refusing storage reads as nothing acknowledged, and writing to it does not throw', () => {
    assert.equal(readWhatsNewSeen(REFUSING_STORAGE), null);
    assert.doesNotThrow(() => writeWhatsNewSeen(REFUSING_STORAGE, '0.35.0'));
  });
});

////////////////////////////////////////////////////////////////////////////////
// The decision
////////////////////////////////////////////////////////////////////////////////

describe('decideWhatsNew: a build with no readable version', () => {
  test('says nothing and records nothing', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.0.0-unstamped',
        seen: null,
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'none' },
    );
  });

  test('CONTROL: the same device on a stamped build is shown that build', () => {
    const decision = decideWhatsNew({
      current: '0.35.0',
      seen: null,
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.equal(decision.kind, 'show');
  });
});

describe('decideWhatsNew: a device that has acknowledged a version', () => {
  test('this exact build is up to date', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: '0.35.0',
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'none' },
    );
  });

  test('a ROLLBACK stays quiet, and never records the older version', () => {
    // `none` and not `stamp`: the caller writes only on `stamp`, so answering
    // `none` here is what stops 0.36.0's notes being announced a second time
    // when the instance rolls forward again.
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: '0.36.0',
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'none' },
    );
  });

  test('an older acknowledgement is shown every release in between, newest first', () => {
    const decision = decideWhatsNew({
      current: '0.35.0',
      seen: '0.33.2',
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.equal(decision.kind, 'show');
    // 0.33.2 exclusive, 0.35.0 inclusive: the release it already read is not
    // repeated, and the one it is running is included.
    assert.deepEqual(decision.kind === 'show' ? shownVersions(decision.unseen) : [], ['0.35.0', '0.34.0']);
  });

  test('CONTROL: acknowledging one release later drops that release from the list', () => {
    const decision = decideWhatsNew({
      current: '0.35.0',
      seen: '0.34.0',
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.deepEqual(decision.kind === 'show' ? shownVersions(decision.unseen) : [], ['0.35.0']);
  });

  test('a release NEWER than this build is never shown, even when the catalog carries it', () => {
    const decision = decideWhatsNew({
      current: '0.34.0',
      seen: '0.33.2',
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.deepEqual(decision.kind === 'show' ? shownVersions(decision.unseen) : [], ['0.34.0']);
  });

  test('an older acknowledgement with nothing written in between is recorded silently', () => {
    // A patch release whose notes were not worth a catalog entry: the device is
    // brought up to date without being shown an empty card.
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.1',
        seen: '0.35.0',
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });
});

describe('decideWhatsNew: a device that has acknowledged nothing', () => {
  test('a device that was in use before this build is shown this build, and only this build', () => {
    const decision = decideWhatsNew({
      current: '0.35.0',
      seen: null,
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.equal(decision.kind, 'show');
    // ONLY this one. There is no acknowledgement to measure from, so "every
    // release since" has no answer, and guessing would dump three releases on
    // somebody who has read them all.
    assert.deepEqual(decision.kind === 'show' ? shownVersions(decision.unseen) : [], ['0.35.0']);
  });

  test('a device that onboarded after this build was made is recorded silently', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: null,
        onboardedAt: BRAND_NEW_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });

  test('a device with no profile row at all is recorded silently', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: null,
        onboardedAt: null,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });

  test('an unreadable build time reads as a new device rather than an old one', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: null,
        onboardedAt: ESTABLISHED_AT,
        builtAt: 'not a date',
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });

  test('a junk acknowledgement is treated as none at all, and the device decides on its age', () => {
    const established = decideWhatsNew({
      current: '0.35.0',
      seen: 'banana',
      onboardedAt: ESTABLISHED_AT,
      builtAt: BUILT_AT,
      entries: ENTRIES,
    });
    assert.equal(established.kind, 'show');
    assert.deepEqual(established.kind === 'show' ? shownVersions(established.unseen) : [], ['0.35.0']);

    // CONTROL: the same junk value on a new device is still silent, so the
    // branch above turns on the device's age and not on the junk.
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: 'banana',
        onboardedAt: BRAND_NEW_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });

  test('an established device on a build the catalog says nothing about is recorded silently', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.1',
        seen: null,
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: ENTRIES,
      }),
      { kind: 'stamp' },
    );
  });

  test('CONTROL: an empty catalog shows nothing to anybody', () => {
    assert.deepEqual(
      decideWhatsNew({
        current: '0.35.0',
        seen: '0.33.2',
        onboardedAt: ESTABLISHED_AT,
        builtAt: BUILT_AT,
        entries: [],
      }),
      { kind: 'stamp' },
    );
  });
});
