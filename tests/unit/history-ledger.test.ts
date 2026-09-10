/**
 * Unit tests for `#app/lib/history-ledger`, the sessionStorage note of what
 * pathname sits at each history index.
 *
 * The module is pure over an INJECTED storage, so these run in plain Node with
 * a twelve-line fake and no DOM, no jsdom and no browser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_LEDGER,
  HISTORY_LEDGER_KEY,
  findEarlier,
  readLedger,
  recordLocation,
  writeLedger,
  type HistoryLedger,
  type LedgerStorage,
} from '../../app/lib/history-ledger';

/** The two methods the module uses, backed by a Map. */
function fakeStorage(seed?: string): LedgerStorage {
  const items = new Map<string, string>();
  if (seed !== undefined) items.set(HISTORY_LEDGER_KEY, seed);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** Build a ledger by walking a stack from index 0 up. */
function ledgerOf(...pathnames: string[]): HistoryLedger {
  return pathnames.reduce<HistoryLedger>(
    (ledger, pathname, idx) => recordLocation({ ledger, idx, pathname }),
    EMPTY_LEDGER,
  );
}

describe('recordLocation', () => {
  it('records one pathname at its index', () => {
    assert.deepEqual(recordLocation({ ledger: EMPTY_LEDGER, idx: 0, pathname: '/diary' }).entries, ['/diary']);
  });

  it('records a run of indices in order', () => {
    assert.deepEqual(ledgerOf('/diary', '/settings', '/settings/ai').entries, ['/diary', '/settings', '/settings/ai']);
  });

  it('TRUNCATES the future when a push rewrites it', () => {
    // Stand on /settings/ai (idx 2), go back twice to idx 0, then push a new
    // screen at idx 1. The browser has already dropped what used to be at 1
    // and 2; a note that still claimed them would send a later pop into an
    // entry that no longer exists.
    const before = ledgerOf('/diary', '/settings', '/settings/ai');
    const after = recordLocation({ ledger: before, idx: 1, pathname: '/diary/entry/abc' });
    assert.deepEqual(after.entries, ['/diary', '/diary/entry/abc']);
  });

  it('overwrites in place when the same index is recorded twice', () => {
    const once = ledgerOf('/diary', '/settings');
    const twice = recordLocation({ ledger: once, idx: 1, pathname: '/trends' });
    assert.deepEqual(twice.entries, ['/diary', '/trends']);
  });

  it('fills a hole rather than shifting, when a session is restored mid-stack', () => {
    const restored = recordLocation({ ledger: EMPTY_LEDGER, idx: 3, pathname: '/diary' });
    assert.deepEqual(restored.entries, [null, null, null, '/diary']);
  });

  it('does not mutate the ledger it was given', () => {
    const before = ledgerOf('/diary');
    recordLocation({ ledger: before, idx: 1, pathname: '/settings' });
    assert.deepEqual(before.entries, ['/diary']);
  });
});

describe('findEarlier', () => {
  it('answers the step count to a screen that is behind us', () => {
    const ledger = ledgerOf('/diary', '/settings', '/settings/ai');
    assert.equal(findEarlier({ ledger, idx: 2, pathname: '/diary' }), 2);
    assert.equal(findEarlier({ ledger, idx: 2, pathname: '/settings' }), 1);
  });

  it('answers the NEAREST match, not the furthest', () => {
    // Popping to the furthest copy would throw away screens the person can
    // still reach.
    const ledger = ledgerOf('/diary', '/settings', '/diary', '/settings/ai');
    assert.equal(findEarlier({ ledger, idx: 3, pathname: '/diary' }), 1);
  });

  it('answers null when the pathname is nowhere behind us', () => {
    const ledger = ledgerOf('/diary', '/settings');
    assert.equal(findEarlier({ ledger, idx: 1, pathname: '/trends' }), null);
  });

  it('never answers 0: the entry we are standing on is not behind us', () => {
    const ledger = ledgerOf('/diary', '/settings');
    assert.equal(findEarlier({ ledger, idx: 1, pathname: '/settings' }), null);
  });

  it('answers null at the bottom of the stack', () => {
    assert.equal(findEarlier({ ledger: ledgerOf('/diary'), idx: 0, pathname: '/diary' }), null);
  });

  it('never matches a hole', () => {
    const ledger = recordLocation({ ledger: EMPTY_LEDGER, idx: 2, pathname: '/settings' });
    assert.equal(findEarlier({ ledger, idx: 2, pathname: '/diary' }), null);
  });

  it('is not fooled by a stored index above the note it can see', () => {
    // A reload can leave `history.state.idx` ahead of a note that was cleared.
    const ledger = ledgerOf('/diary');
    assert.equal(findEarlier({ ledger, idx: 6, pathname: '/diary' }), 6);
    assert.equal(findEarlier({ ledger, idx: 6, pathname: '/settings' }), null);
  });
});

describe('readLedger and writeLedger', () => {
  it('round-trips through the injected storage', () => {
    const storage = fakeStorage();
    writeLedger(storage, ledgerOf('/diary', '/settings'));
    assert.deepEqual(readLedger(storage).entries, ['/diary', '/settings']);
  });

  it('reads an absent note as empty', () => {
    assert.deepEqual(readLedger(fakeStorage()).entries, []);
  });

  it('degrades a corrupt note to empty rather than throwing', () => {
    // A hint that cannot be read must mean "I do not know", which makes every
    // navigation a replace. Anything else would throw inside a click handler.
    assert.deepEqual(readLedger(fakeStorage('not json at all')).entries, []);
    assert.deepEqual(readLedger(fakeStorage('{"entries":["/diary"]}')).entries, []);
    assert.deepEqual(readLedger(fakeStorage('["/diary", 7]')).entries, []);
  });

  it('keeps a hole through the round trip', () => {
    const storage = fakeStorage();
    writeLedger(storage, recordLocation({ ledger: EMPTY_LEDGER, idx: 1, pathname: '/diary' }));
    assert.deepEqual(readLedger(storage).entries, [null, '/diary']);
  });
});
