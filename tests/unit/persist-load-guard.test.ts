/**
 * Regression tests for TWO confirmed data-loss incidents in `persist.ts`:
 *
 * 1. The anti-clobber load-verification invariant (`shouldRefuseAutosave`,
 *    `loadAndVerifyOrThrow`) — the primary store's `t` IndexedDB object store
 *    (every table: personalFoods, foodLogs, weightEntries, profileGoals)
 *    emptied to nothing while `v` (store-level values) survived untouched,
 *    because `startAutoLoad()` resolving WITHOUT having actually populated
 *    the in-memory store was followed immediately and unconditionally by
 *    autosave. Driven against a REAL `fake-indexeddb`-backed database (seeded
 *    with rows via a real TinyBase persister save) plus a "broken load"
 *    persister double whose `startAutoLoad` resolves without touching the
 *    store — the exact failure shape from the incident, proven refused
 *    rather than silently saved over.
 * 2. Lock-scoped saves (`runLockedSave`, `startLockedAutoSave`) — an earlier
 *    fix for concurrent-tab clobbering elected exactly ONE open tab as "the
 *    writer" via a Web Lock held for that tab's entire lifetime, so every
 *    OTHER open tab's own local writes never reached IndexedDB at all (only
 *    the elected tab ever called the persister's save). The tests below
 *    drive this with injected lock requesters, since neither a real
 *    `navigator.locks` nor two real browser tabs are available under
 *    `node:test`, and prove: (a) a "losing" tab's write still reaches
 *    IndexedDB once the lock-holder's save completes, (b) two tabs' actual
 *    disk writes never overlap, and (c) the empty-store anti-clobber
 *    invariant from mechanism 1 is untouched by this change.
 *
 * `initPersistedStore`/`getXStore()` themselves are NOT exercised here — they
 * require `window` (`assertBrowserWithIndexedDb`), which `fake-indexeddb`
 * does not polyfill (same constraint documented in
 * `local-store-cross-tab.test.ts`). Every function tested below is the
 * browser-independent core those singletons call internally; the
 * "composed exactly like initPersistedStore" test proves the wiring between
 * them without needing the browser guard itself.
 *
 * A THIRD incident (durability round) is covered at the bottom of this file:
 * autosave was driven entirely by a transaction-finish listener with no flush
 * on the page actually being hidden/closed, so a write that reached the
 * in-memory store — right after the success toast — could still be lost if
 * the tab closed before the async `persister.save()` chain it kicked off
 * finished. `installFlushOnHide`'s tests drive this with an injected
 * `FlushOnHideDeps` double, since neither a real `pagehide`/`visibilitychange`
 * nor a real tab teardown is available under `node:test`.
 *
 * A FOURTH window (mechanism 5 in `persist.ts`) is covered after that: a local
 * write that finishes while THIS persister's own `startAutoLoad` poll has a
 * load in flight was both (a) unsaveable — TinyBase silently discards
 * `save()` while the same persister is loading — and (b) erased from the
 * in-memory store by that poll's full-content `setContent` replace. The tests
 * for it come in two flavours deliberately: injected-`LoadGate` tests for the
 * deferral logic, and REAL `createIndexedDbPersister` tests that drive an
 * actual in-flight load, because the whole defect is a property of TinyBase's
 * own status handling and a double could be made to agree with either
 * behaviour.
 *
 * A FIFTH, separate incident (mechanism 4 in `persist.ts`, `shouldPrimePersistedDb`
 * / `primeFreshDatabaseIfNeeded`) is covered right before that: a device that
 * had never saved a given store looped a `NotFoundError` on every
 * `startAutoLoad` poll forever, because `createIndexedDbPersister`'s
 * versionless load-open only finds the `"t"`/`"v"` object stores its own
 * version-2 save upgrade creates. The fix's pure predicate is unit-tested
 * directly; the priming save's actual effect (the object stores existing
 * before any load runs) is proven against a REAL `fake-indexeddb`-backed
 * persister, the same way mechanism 5 above is.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { createStore, type Store } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import type { FlushOnHideDeps, LoadGate, RecordedTransaction } from '../../app/lib/local-store/persist';
import {
  clobberedByLoad,
  createPersisterLoadGate,
  installFlushOnHide,
  isStoreEmpty,
  loadAndVerifyOrThrow,
  primeFreshDatabaseIfNeeded,
  readPersistedTableRowCounts,
  reapplyRecordedTransactions,
  runLockedSave,
  shouldPrimePersistedDb,
  shouldRefuseAutosave,
  startLockedAutoSave,
  storeRowCounts,
  totalRowCount,
} from '../../app/lib/local-store/persist';
import { PERSONAL_FOODS_TABLE, PRIMARY_ENTITY_CELL, WEIGHT_ENTRIES_TABLE } from '../../app/lib/local-store/store';

/** A minimal serialized "row" the way `primary-store.ts` writes an entity cell. */
function entityRow(id: string, name: string) {
  return { [PRIMARY_ENTITY_CELL]: JSON.stringify({ id, name }) };
}

/** A lock requester that hands the lock over the moment it is asked for. */
const grantImmediately = (_lockName: string, run: () => Promise<void>): void => {
  void run();
};

/** ~1.5s bound: generous for a fake-timer-free `node:test` run, but never unbounded. */
const MAX_POLL_ATTEMPTS = 100;
const POLL_STEP_MS = 15;

/** Polls `check` until it returns true or the bound is hit — never an unbounded wait. */
async function waitUntil(check: () => boolean, description = 'condition never became true'): Promise<void> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
  }
  throw new Error(`waitUntil: ${description} within the poll bound`);
}

/** The async counterpart of {@link waitUntil}, for conditions that have to read IndexedDB. */
async function waitUntilAsync(check: () => Promise<boolean>, description: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
  }
  throw new Error(`waitUntilAsync: ${description} within the poll bound`);
}

/** Lets already-queued microtasks and one timer turn run — enough for a save to have been issued if it was going to be. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
}

/**
 * A more faithful `navigator.locks.request` double than "granted" or "never
 * granted": chains every `run` callback onto a shared promise so that AT MOST
 * ONE `run` executes at a time, and any request that arrives while another is
 * "holding" the lock is queued and granted its turn as soon as the holder's
 * `run` settles — exactly the real Web Locks API's request/release semantics.
 * This is what proves the fix: under the OLD `becomeAutoSaveWriter` design, a
 * queued tab's `run` callback (which called the persister's autosave once,
 * then held the lock forever) was never reached by a second tab, because the
 * first tab's callback never resolved. Under the new per-save design, each
 * `run` resolves promptly, so a queued request always eventually executes.
 */
function createQueuedLockRequester(): (lockName: string, run: () => Promise<void>) => void {
  let chain: Promise<void> = Promise.resolve();
  return (_lockName, run) => {
    chain = chain.then(() => run().catch(() => {}));
  };
}

/** Seeds a real, persisted IndexedDB database with one food row via a real TinyBase persister save. */
async function seedPersistedDatabase(dbName: string): Promise<void> {
  const seedStore = createStore();
  seedStore.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
  const seedPersister = createIndexedDbPersister(seedStore, dbName);
  await seedPersister.save();
  await seedPersister.destroy();
}

describe('shouldRefuseAutosave (pure invariant)', () => {
  it('refuses when the persisted DB had rows but the store is empty after load — the exact incident shape', () => {
    assert.equal(shouldRefuseAutosave({ persistedRowCount: 3, storeIsEmptyAfterLoad: true }), true);
  });

  it('does not refuse when the persisted DB had no rows (a genuinely new device)', () => {
    assert.equal(shouldRefuseAutosave({ persistedRowCount: 0, storeIsEmptyAfterLoad: true }), false);
  });

  it('does not refuse when the store is populated after load (the happy path)', () => {
    assert.equal(shouldRefuseAutosave({ persistedRowCount: 3, storeIsEmptyAfterLoad: false }), false);
  });

  it('does not refuse when both the persisted DB and the store are empty', () => {
    assert.equal(shouldRefuseAutosave({ persistedRowCount: 0, storeIsEmptyAfterLoad: false }), false);
  });
});

describe('isStoreEmpty / storeRowCounts', () => {
  it('an empty store reads as empty with zero counts', () => {
    const store = createStore();
    assert.equal(isStoreEmpty(store), true);
    assert.deepEqual(storeRowCounts(store), {});
  });

  it('a store with any row reads as non-empty, with a per-table count', () => {
    const store = createStore();
    store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
    assert.equal(isStoreEmpty(store), false);
    assert.deepEqual(storeRowCounts(store), { [PERSONAL_FOODS_TABLE]: 1 });
  });
});

describe('readPersistedTableRowCounts (fake-indexeddb)', () => {
  it('resolves null for a database that has never been persisted to', async () => {
    const counts = await readPersistedTableRowCounts('persist-test-never-existed');
    assert.equal(counts, null);
  });

  it('never materializes a database as a side effect of probing a fresh device', async () => {
    const dbName = 'persist-test-probe-does-not-create-db';

    const counts = await readPersistedTableRowCounts(dbName);
    assert.equal(counts, null, 'precondition: this is the fresh-device probe path');

    // `indexedDB.databases()` is the ground truth for "does a database exist
    // on disk at all" — unlike `readPersistedTableRowCounts`'s own return
    // value, which resolves `null` identically whether no database exists OR
    // an empty v1 database exists with no object stores yet (both fail the
    // `objectStoreNames.contains('t')` check the same way). Before the fix,
    // the probe's no-op `onupgradeneeded` let the implicit version-1 upgrade
    // commit, leaving exactly that kind of empty database behind as a pure
    // side effect of a read-only probe.
    const databaseNames = (await indexedDB.databases()).map((info) => info.name);
    assert.ok(
      !databaseNames.includes(dbName),
      `expected no database named "${dbName}" to exist after only probing it, found: ${JSON.stringify(databaseNames)}`,
    );
  });

  it('reads real per-table row counts written by a real TinyBase persister save', async () => {
    const dbName = 'persist-test-real-counts';
    const seedStore = createStore();
    seedStore.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
    seedStore.setRow(WEIGHT_ENTRIES_TABLE, 'weight-1', entityRow('weight-1', '70kg'));
    const seedPersister = createIndexedDbPersister(seedStore, dbName);
    await seedPersister.save();
    await seedPersister.destroy();

    const counts = await readPersistedTableRowCounts(dbName);
    assert.deepEqual(counts, { [PERSONAL_FOODS_TABLE]: 1, [WEIGHT_ENTRIES_TABLE]: 1 });
    assert.equal(totalRowCount(counts), 2);
  });
});

describe('shouldPrimePersistedDb (pure)', () => {
  it('primes when nothing has ever been persisted (null counts)', () => {
    assert.equal(shouldPrimePersistedDb(null), true);
  });

  it('does not prime when the object stores already exist, even with zero rows in every table', () => {
    assert.equal(shouldPrimePersistedDb({}), false);
  });

  it('does not prime when real rows are already on disk', () => {
    assert.equal(shouldPrimePersistedDb({ [PERSONAL_FOODS_TABLE]: 3 }), false);
  });
});

describe('primeFreshDatabaseIfNeeded (fake-indexeddb) — closes the looping NotFoundError incident', () => {
  it('creates the persister object stores for a never-saved database before any load runs', async () => {
    const dbName = 'persist-test-prime-fresh-db';
    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    try {
      assert.equal(await readPersistedTableRowCounts(dbName), null, 'precondition: nothing persisted yet');

      await primeFreshDatabaseIfNeeded(dbName, persister);

      // An empty map (object stores exist, zero rows) — not `null` — is exactly
      // proof the version-2 upgrade ran: `readPersistedTableRowCounts` only
      // returns `null` when the "t" object store itself is missing.
      assert.deepEqual(
        await readPersistedTableRowCounts(dbName),
        {},
        'the priming save must create the object stores even though the store being saved is empty',
      );
    } finally {
      await persister.destroy();
    }
  });

  it("never clobbers rows that were already on disk — an empty in-memory store's priming save cannot fire once real data exists", async () => {
    const dbName = 'persist-test-prime-never-runs-against-real-data';
    await seedPersistedDatabase(dbName);

    const emptyStore = createStore();
    const persister = createIndexedDbPersister(emptyStore, dbName);
    try {
      await primeFreshDatabaseIfNeeded(dbName, persister);

      const counts = await readPersistedTableRowCounts(dbName);
      assert.deepEqual(
        counts,
        { [PERSONAL_FOODS_TABLE]: 1 },
        'the seeded row must survive untouched — priming must have been skipped, not run against an empty store',
      );
    } finally {
      await persister.destroy();
    }
  });

  it('composed exactly like initPersistedStore: priming before the first load prevents even the "benign" first-load NotFoundError', async () => {
    const dbName = 'persist-test-prime-before-first-load';
    const store = createStore();
    const ignoredErrors: unknown[] = [];
    const persister = createIndexedDbPersister(store, dbName, 0.05, (error) => {
      ignoredErrors.push(error);
    });
    try {
      // The exact sequential composition `initPersistedStore` runs: prime
      // FIRST, then load-and-verify. Without priming, THIS FIRST-EVER
      // `startAutoLoad()` is exactly the call that used to hit the
      // versionless-load-open NotFoundError this file's module doc calls
      // "benign" — benign because it self-heals after the first save, which
      // priming now performs up front instead of waiting for one.
      await primeFreshDatabaseIfNeeded(dbName, persister);
      await loadAndVerifyOrThrow(store, dbName, persister);

      assert.deepEqual(ignoredErrors, [], 'priming before the first load must prevent the NotFoundError entirely');
      assert.equal(isStoreEmpty(store), true, 'a genuinely new device still has nothing to load');
    } finally {
      await persister.destroy();
    }
  });
});

describe('loadAndVerifyOrThrow — the flagship anti-clobber test', () => {
  it('throws when the persisted DB holds data but a broken load never populates the store, and leaves the store untouched', async () => {
    const dbName = 'persist-test-broken-load-refuses';
    await seedPersistedDatabase(dbName);

    // Simulate the exact incident: a persister whose `startAutoLoad()`
    // resolves successfully without ever populating the in-memory store (a
    // swallowed error, a partial/empty read, a race with another tab — all
    // look identical from here: the promise resolves, the store stays empty).
    const freshStore = createStore();
    const brokenPersister = {
      startAutoLoad: async () => {
        // Deliberately does NOT touch freshStore.
      },
    };

    await assert.rejects(
      () => loadAndVerifyOrThrow(freshStore, dbName, brokenPersister),
      /persisted IndexedDB has 1 row\(s\) but the in-memory store is empty/,
    );

    // The store must be untouched — still empty, never overwritten.
    assert.equal(isStoreEmpty(freshStore), true);
  });

  it('composed exactly like initPersistedStore: a refused load never reaches the destructive locked-autosave step', async () => {
    const dbName = 'persist-test-composition-skips-autosave';
    await seedPersistedDatabase(dbName);

    const freshStore = createStore();
    let saveCalls = 0;
    const brokenPersister = {
      startAutoLoad: async () => {
        // Deliberately does NOT touch freshStore.
      },
      save: async () => {
        saveCalls += 1;
      },
    };

    // The exact sequential composition `initPersistedStore` runs:
    // load-and-verify FIRST, `startLockedAutoSave` wiring SECOND. A throw
    // from the first step must short-circuit the `await` chain before the
    // second is ever reached — so the destructive save can never even be
    // wired up, let alone triggered.
    async function simulateInitPersistedStore(): Promise<void> {
      await loadAndVerifyOrThrow(freshStore, dbName, brokenPersister);
      startLockedAutoSave(freshStore, dbName, brokenPersister, { hasLocks: false });
    }

    await assert.rejects(() => simulateInitPersistedStore());
    assert.equal(saveCalls, 0, 'the locked-autosave save() must never be reached, let alone triggered');
  });

  it('does not throw when a real load genuinely reconciles the persisted data (happy path)', async () => {
    const dbName = 'persist-test-real-load-succeeds';
    await seedPersistedDatabase(dbName);

    const freshStore = createStore();
    const realPersister = createIndexedDbPersister(freshStore, dbName);
    try {
      await assert.doesNotReject(() => loadAndVerifyOrThrow(freshStore, dbName, realPersister));
      assert.equal(isStoreEmpty(freshStore), false);
      assert.equal(
        freshStore.getCell(PERSONAL_FOODS_TABLE, 'food-1', PRIMARY_ENTITY_CELL),
        JSON.stringify({ id: 'food-1', name: 'Acerola' }),
      );
    } finally {
      await realPersister.destroy();
    }
  });

  it('does not throw for a genuinely new device (nothing persisted, nothing in memory)', async () => {
    const dbName = 'persist-test-genuinely-new-device';
    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    try {
      await assert.doesNotReject(() => loadAndVerifyOrThrow(store, dbName, persister));
      assert.equal(isStoreEmpty(store), true);
    } finally {
      await persister.destroy();
    }
  });
});

describe('runLockedSave (injected lock requester — no real browser/tabs)', () => {
  it('saves immediately when the Web Locks API is unavailable (fallback)', async () => {
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    await runLockedSave('writer-test-fallback', persister, { hasLocks: false });

    assert.equal(saveCalls, 1);
  });

  it('saves once this "tab" wins the lock immediately', async () => {
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };
    await runLockedSave('writer-test-granted', persister, { hasLocks: true, requestLock: grantImmediately });

    assert.equal(saveCalls, 1);
  });

  it(
    "a second tab's save still runs once the first tab's save completes — the regression this fix closes " +
      '(the OLD design held the lock for the winning tab\'s entire lifetime, so a queued tab\'s save never ran at all)',
    async () => {
      const saveCallsByTab = { A: 0, B: 0 };
      const persisterA = {
        save: async () => {
          saveCallsByTab.A += 1;
        },
      };
      const persisterB = {
        save: async () => {
          saveCallsByTab.B += 1;
        },
      };
      const requestLock = createQueuedLockRequester();

      // Tab A's request is issued first — under the old design this is the
      // tab that would win the lock forever. Tab B's request is issued
      // immediately after, while A's is (conceptually) still "held".
      await Promise.all([
        runLockedSave('writer-test-fairness', persisterA, { hasLocks: true, requestLock }),
        runLockedSave('writer-test-fairness', persisterB, { hasLocks: true, requestLock }),
      ]);

      assert.equal(saveCallsByTab.A, 1, "tab A's save must still run");
      assert.equal(
        saveCallsByTab.B,
        1,
        "tab B's save must not be silently dropped just because tab A's lock request was issued first",
      );
    },
  );

  it('never runs two saves concurrently — the lock still serializes the actual disk write', async () => {
    let concurrentInFlight = 0;
    let maxConcurrentObserved = 0;
    const persister = {
      save: async () => {
        concurrentInFlight += 1;
        maxConcurrentObserved = Math.max(maxConcurrentObserved, concurrentInFlight);
        // A short async gap widens the window in which an unsynchronized
        // implementation would let a second save start before this one ends.
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentInFlight -= 1;
      },
    };
    const requestLock = createQueuedLockRequester();

    await Promise.all([
      runLockedSave('writer-test-concurrency', persister, { hasLocks: true, requestLock }),
      runLockedSave('writer-test-concurrency', persister, { hasLocks: true, requestLock }),
      runLockedSave('writer-test-concurrency', persister, { hasLocks: true, requestLock }),
    ]);

    assert.equal(maxConcurrentObserved, 1, 'two concurrent runLockedSave calls must never overlap their actual save()');
  });
});

describe('startLockedAutoSave (store-wiring — real Store, injected lock requester)', () => {
  it("persists this tab's own local write once its transaction finishes", async () => {
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const stop = startLockedAutoSave(store, 'writer-test-local-write', persister, { hasLocks: false });
    try {
      store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
      await waitUntil(() => saveCalls >= 1);
      assert.equal(saveCalls, 1);
    } finally {
      stop();
    }
  });

  it('stops persisting once unsubscribed', async () => {
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const stop = startLockedAutoSave(store, 'writer-test-unsubscribe', persister, { hasLocks: false });
    store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
    await waitUntil(() => saveCalls >= 1);

    stop();
    store.setRow(PERSONAL_FOODS_TABLE, 'food-2', entityRow('food-2', 'Broccoli'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(saveCalls, 1, 'no further save should fire once stopped');
  });

  it(
    "tab B's own write still persists even though tab A's lock request was issued first — the exact blocker this " +
      'fix closes (previously ONLY the lock-winning tab ever called the persister\'s autosave; every other open tab' +
      " kept its own writes purely in memory, where the tab's own next `startAutoLoad` poll silently discarded them)",
    async () => {
      const storeA = createStore();
      const storeB = createStore();
      const saveCallsByTab = { A: 0, B: 0 };
      const persisterA = {
        save: async () => {
          saveCallsByTab.A += 1;
        },
      };
      const persisterB = {
        save: async () => {
          saveCallsByTab.B += 1;
        },
      };
      const requestLock = createQueuedLockRequester();

      const stopA = startLockedAutoSave(storeA, 'writer-test-two-tabs', persisterA, { hasLocks: true, requestLock });
      const stopB = startLockedAutoSave(storeB, 'writer-test-two-tabs', persisterB, { hasLocks: true, requestLock });
      try {
        // Tab A writes first — under the old design this is the tab that
        // would be elected the permanent writer.
        storeA.setRow(PERSONAL_FOODS_TABLE, 'food-a', entityRow('food-a', 'From tab A'));
        // Tab B writes independently, moments later.
        storeB.setRow(PERSONAL_FOODS_TABLE, 'food-b', entityRow('food-b', 'From tab B'));

        await waitUntil(() => saveCallsByTab.A >= 1 && saveCallsByTab.B >= 1);

        assert.ok(saveCallsByTab.A >= 1, "tab A's write must be persisted");
        assert.ok(saveCallsByTab.B >= 1, "tab B's write must be persisted — this is the confirmed regression");
      } finally {
        stopA();
        stopB();
      }
    },
  );

  it('coalesces a synchronous burst of local writes into at most two save calls (not one per write)', async () => {
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
        // A real async gap so the burst below genuinely lands while the
        // first save is still in flight, exercising the coalescing path.
        await new Promise((resolve) => setTimeout(resolve, 15));
      },
    };

    const stop = startLockedAutoSave(store, 'writer-test-coalesce', persister, { hasLocks: false });
    try {
      // All fired synchronously, before the first save's `await` yields
      // control back — the fire-and-forget triggers must coalesce.
      store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
      store.setRow(PERSONAL_FOODS_TABLE, 'food-2', entityRow('food-2', 'Broccoli'));
      store.setRow(PERSONAL_FOODS_TABLE, 'food-3', entityRow('food-3', 'Chicken'));

      await waitUntil(() => saveCalls >= 1);
      // Give the coalesced follow-up save (if any) time to run too.
      await new Promise((resolve) => setTimeout(resolve, 40));

      assert.ok(saveCalls <= 2, `expected at most 2 save() calls for a synchronous 3-write burst, got ${saveCalls}`);
    } finally {
      stop();
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// Mechanism 3: flush-on-hide (durability round)
////////////////////////////////////////////////////////////////////////////////

/** A fake `FlushOnHideDeps` that captures the registered listeners so a test can fire them directly. */
function createFakeFlushOnHideDeps(initialHidden = false): FlushOnHideDeps & {
  firePageHide: () => void;
  fireVisibilityChange: () => void;
  setHidden: (hidden: boolean) => void;
  pageHideListenerCount: () => number;
  visibilityChangeListenerCount: () => number;
} {
  let hidden = initialHidden;
  const pageHideListeners = new Set<() => void>();
  const visibilityChangeListeners = new Set<() => void>();

  return {
    addPageHideListener: (listener) => pageHideListeners.add(listener),
    removePageHideListener: (listener) => pageHideListeners.delete(listener),
    addVisibilityChangeListener: (listener) => visibilityChangeListeners.add(listener),
    removeVisibilityChangeListener: (listener) => visibilityChangeListeners.delete(listener),
    isHidden: () => hidden,
    setHidden: (next) => {
      hidden = next;
    },
    firePageHide: () => {
      for (const listener of pageHideListeners) listener();
    },
    fireVisibilityChange: () => {
      for (const listener of visibilityChangeListeners) listener();
    },
    pageHideListenerCount: () => pageHideListeners.size,
    visibilityChangeListenerCount: () => visibilityChangeListeners.size,
  };
}

describe('installFlushOnHide (injected DOM deps — no real browser)', () => {
  it('triggers the save on pagehide', () => {
    const deps = createFakeFlushOnHideDeps();
    let triggerCalls = 0;
    const stop = installFlushOnHide(async () => {
      triggerCalls += 1;
    }, { deps });

    deps.firePageHide();

    assert.equal(triggerCalls, 1);
    stop();
  });

  it('triggers the save on visibilitychange when the page has become hidden', () => {
    const deps = createFakeFlushOnHideDeps();
    let triggerCalls = 0;
    const stop = installFlushOnHide(async () => {
      triggerCalls += 1;
    }, { deps });

    deps.setHidden(true);
    deps.fireVisibilityChange();

    assert.equal(triggerCalls, 1);
    stop();
  });

  it('does NOT trigger the save on visibilitychange when the page is becoming VISIBLE again', () => {
    const deps = createFakeFlushOnHideDeps(true);
    let triggerCalls = 0;
    const stop = installFlushOnHide(async () => {
      triggerCalls += 1;
    }, { deps });

    // The page transitions back to visible — `visibilitychange` still fires,
    // but this is a returning-to-foreground event, not a hide, so it must not
    // trigger a redundant flush.
    deps.setHidden(false);
    deps.fireVisibilityChange();

    assert.equal(triggerCalls, 0);
    stop();
  });

  it('stops firing once unsubscribed', () => {
    const deps = createFakeFlushOnHideDeps();
    let triggerCalls = 0;
    const stop = installFlushOnHide(async () => {
      triggerCalls += 1;
    }, { deps });

    stop();
    assert.equal(deps.pageHideListenerCount(), 0, 'pagehide listener must be removed');
    assert.equal(deps.visibilityChangeListenerCount(), 0, 'visibilitychange listener must be removed');

    deps.firePageHide();
    deps.fireVisibilityChange();
    assert.equal(triggerCalls, 0, 'no flush after unsubscribe');
  });

  it('no-ops outside a browser (deps: null) and returns a harmless unsubscribe', () => {
    let triggerCalls = 0;
    const stop = installFlushOnHide(async () => {
      triggerCalls += 1;
    }, { deps: null });

    assert.doesNotThrow(() => stop());
    assert.equal(triggerCalls, 0);
  });
});

describe('startLockedAutoSave composes installFlushOnHide (durability round)', () => {
  it('flushes the store on pagehide even with no local write yet', async () => {
    const deps = createFakeFlushOnHideDeps();
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const stop = startLockedAutoSave(store, 'writer-test-flush-on-hide', persister, {
      hasLocks: false,
      flushOnHideDeps: deps,
    });
    try {
      deps.firePageHide();
      await waitUntil(() => saveCalls >= 1);
      assert.equal(saveCalls, 1);
    } finally {
      stop();
    }
  });

  it("unsubscribing stops both the transaction listener AND the flush-on-hide listeners", async () => {
    const deps = createFakeFlushOnHideDeps();
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const stop = startLockedAutoSave(store, 'writer-test-flush-on-hide-unsub', persister, {
      hasLocks: false,
      flushOnHideDeps: deps,
    });
    stop();

    assert.equal(deps.pageHideListenerCount(), 0);
    deps.firePageHide();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(saveCalls, 0, 'no save should fire once stopped');
  });
});

////////////////////////////////////////////////////////////////////////////////
// Mechanism 5: a local write that lands during an autoLoad poll
////////////////////////////////////////////////////////////////////////////////

/** A `LoadGate` a test drives by hand, since a real load is a few unobservable milliseconds long. */
function createFakeLoadGate(initiallyLoading: boolean): LoadGate & {
  setLoading: (isLoading: boolean) => void;
  listenerCount: () => number;
} {
  let loading = initiallyLoading;
  const listeners = new Set<(isLoading: boolean) => void>();

  return {
    isLoading: () => loading,
    onLoadStateChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLoading: (isLoading) => {
      loading = isLoading;
      for (const listener of listeners) listener(isLoading);
    },
    listenerCount: () => listeners.size,
  };
}

/** A recorded transaction shaped exactly like `store.getTransactionLog()`'s changed halves. */
function recordedCellChange(rowId: string, oldName: string | undefined, newName: string | undefined): RecordedTransaction {
  return {
    changedCells: {
      [PERSONAL_FOODS_TABLE]: {
        [rowId]: {
          [PRIMARY_ENTITY_CELL]: [
            oldName === undefined ? undefined : JSON.stringify({ id: rowId, name: oldName }),
            newName === undefined ? undefined : JSON.stringify({ id: rowId, name: newName }),
          ],
        },
      },
    },
    changedValues: {},
  };
}

describe('clobberedByLoad (pure — separates the load\'s own replace from the writes it erased)', () => {
  it('drops the last recorded transaction, which is always the load\'s own full-content replace', () => {
    const userWrite = recordedCellChange('food-2', undefined, 'Broccoli');
    const loadReplace = recordedCellChange('food-2', 'Broccoli', undefined);

    assert.deepEqual(clobberedByLoad([userWrite, loadReplace]), [userWrite]);
  });

  it('returns nothing when the replace was the only transaction (no local write raced it)', () => {
    assert.deepEqual(clobberedByLoad([recordedCellChange('food-1', undefined, 'Acerola')]), []);
  });

  it('returns nothing for an empty window', () => {
    assert.deepEqual(clobberedByLoad([]), []);
  });

  it('keeps every local write when several raced one load, in the order they happened', () => {
    const first = recordedCellChange('food-2', undefined, 'Broccoli');
    const second = recordedCellChange('food-3', undefined, 'Chicken');
    const loadReplace = recordedCellChange('food-2', 'Broccoli', undefined);

    assert.deepEqual(clobberedByLoad([first, second, loadReplace]), [first, second]);
  });
});

describe('reapplyRecordedTransactions (real Store)', () => {
  it('puts back a row the load erased', () => {
    const store = createStore();
    reapplyRecordedTransactions(store, [recordedCellChange('food-2', undefined, 'Broccoli')]);

    assert.equal(
      store.getCell(PERSONAL_FOODS_TABLE, 'food-2', PRIMARY_ENTITY_CELL),
      JSON.stringify({ id: 'food-2', name: 'Broccoli' }),
    );
  });

  it('re-applies a DELETION rather than skipping it — a food the user deleted must not come back', () => {
    const store = createStore();
    store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));

    reapplyRecordedTransactions(store, [recordedCellChange('food-1', 'Acerola', undefined)]);

    assert.equal(store.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), false);
  });

  it('applies entries in order, so the last write to a cell wins', () => {
    const store = createStore();
    reapplyRecordedTransactions(store, [
      recordedCellChange('food-1', undefined, 'First'),
      recordedCellChange('food-1', 'First', 'Second'),
    ]);

    assert.equal(
      store.getCell(PERSONAL_FOODS_TABLE, 'food-1', PRIMARY_ENTITY_CELL),
      JSON.stringify({ id: 'food-1', name: 'Second' }),
    );
  });

  it('restores store-level VALUES as well as cells', () => {
    const store = createStore();
    reapplyRecordedTransactions(store, [
      { changedCells: {}, changedValues: { schemaVersion: [undefined, 3] } },
      { changedCells: {}, changedValues: { staleFlag: ['yes', undefined] } },
    ]);

    assert.equal(store.getValue('schemaVersion'), 3);
    assert.equal(store.hasValue('staleFlag'), false);
  });

  it('is a no-op when the recorded values are already in the store (so it is free after a load that clobbered nothing)', () => {
    const store = createStore();
    store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));

    let transactionsThatChangedSomething = 0;
    store.addDidFinishTransactionListener((changedStore) => {
      const [cellsTouched, valuesTouched] = changedStore.getTransactionLog();
      if (cellsTouched || valuesTouched) transactionsThatChangedSomething += 1;
    });

    reapplyRecordedTransactions(store, [recordedCellChange('food-1', undefined, 'Acerola')]);

    assert.equal(transactionsThatChangedSomething, 0);
  });
});

describe('runLockedSave defers a save that TinyBase would silently discard', () => {
  it('does not issue the save while a load is in flight, and issues it as soon as the load finishes', async () => {
    const gate = createFakeLoadGate(true);
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const saving = runLockedSave('load-wait-defer', persister, { hasLocks: false, loadGate: gate });
    await settle();
    assert.equal(saveCalls, 0, 'a save issued into a loading persister is discarded by TinyBase — it must be held back');

    gate.setLoading(false);
    await saving;

    assert.equal(saveCalls, 1, 'the held-back save must actually run once the load is done');
    assert.equal(gate.listenerCount(), 0, 'the status listener must be removed — this runs on every single save');
  });

  it('saves straight away when nothing is loading (the overwhelmingly common path)', async () => {
    const gate = createFakeLoadGate(false);
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    await runLockedSave('load-wait-idle', persister, { hasLocks: false, loadGate: gate });

    assert.equal(saveCalls, 1);
    assert.equal(gate.listenerCount(), 0, 'no listener should even be registered on the fast path');
  });

  it('gives up on a load that never finishes and saves anyway, rather than leaving autosave wedged forever', async () => {
    const gate = createFakeLoadGate(true);
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    // The bound is the documented safety net, not a normal path — a real load
    // is a single IndexedDB read. Injected short here so the test doesn't sit
    // out the production bound.
    await runLockedSave('load-wait-timeout', persister, { hasLocks: false, loadGate: gate, loadWaitTimeoutMs: 20 });

    assert.equal(saveCalls, 1, 'the save must still be attempted once the bound expires');
    assert.equal(gate.listenerCount(), 0, 'the status listener must be removed on the timeout path too');
  });

  it('is inert for a persister that cannot report its status (a {save}-only double)', async () => {
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    assert.equal(createPersisterLoadGate(persister), null);
    await runLockedSave('load-wait-no-gate', persister, { hasLocks: false });

    assert.equal(saveCalls, 1);
  });

  it('a pagehide flush issued during a load is deferred, not silently dropped — the last-write-before-teardown case', async () => {
    const deps = createFakeFlushOnHideDeps();
    const gate = createFakeLoadGate(true);
    const store = createStore();
    let saveCalls = 0;
    const persister = {
      save: async () => {
        saveCalls += 1;
      },
    };

    const stop = startLockedAutoSave(store, 'flush-during-load', persister, {
      hasLocks: false,
      flushOnHideDeps: deps,
      loadGate: gate,
    });
    try {
      deps.firePageHide();
      await settle();
      assert.equal(saveCalls, 0, 'the flush must not be thrown into a loading persister, where TinyBase discards it');

      gate.setLoading(false);
      await waitUntil(() => saveCalls >= 1, 'the deferred pagehide flush never ran');
    } finally {
      stop();
    }
  });
});

describe('mechanism 5 against REAL TinyBase (fake-indexeddb) — the defect itself, not a double\'s opinion of it', () => {
  it('a save issued while the same persister is loading is no longer silently discarded', async () => {
    const dbName = 'persist-test-save-during-load-not-discarded';
    const store = createStore();
    store.setRow(PERSONAL_FOODS_TABLE, 'food-1', entityRow('food-1', 'Acerola'));
    const persister = createIndexedDbPersister(store, dbName);
    try {
      await persister.save();

      // `load()` flips the persister to Loading synchronously and only clears
      // it once its IndexedDB read resolves — a deterministic stand-in for the
      // ~few-ms window a real `startAutoLoad` poll opens once a second.
      const loadInFlight = persister.load();
      const savesBeforeAttempt = persister.getStats().saves;

      await runLockedSave(dbName, persister, { hasLocks: false });

      assert.ok(
        persister.getStats().saves > savesBeforeAttempt,
        'TinyBase increments its save count only for saves it actually performs — an unchanged count means this ' +
          'save was silently discarded because a load was in flight',
      );
      await loadInFlight;
    } finally {
      await persister.destroy();
    }
  });

  it('a write issued while a load is in flight survives the load and reaches IndexedDB', async () => {
    const dbName = 'persist-test-write-during-load-reaches-disk';
    await seedPersistedDatabase(dbName);

    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    const stop = startLockedAutoSave(store, dbName, persister, { hasLocks: false });
    try {
      await persister.load();
      assert.equal(store.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), true, 'precondition: the seeded row loaded');

      // THE DEFECT, reproduced deterministically. Nothing may be awaited
      // between these two lines: the write has to land while the load is still
      // in flight, which is when TinyBase both discards the resulting save AND
      // (a beat later) erases the write from the store via its full-content
      // replace.
      const loadInFlight = persister.load();
      store.setRow(PERSONAL_FOODS_TABLE, 'food-2', entityRow('food-2', 'Broccoli'));
      await loadInFlight;

      assert.equal(
        store.hasRow(PERSONAL_FOODS_TABLE, 'food-2'),
        true,
        "the write made during the load must survive the load's full-content replace of the store",
      );

      await waitUntilAsync(
        async () => totalRowCount(await readPersistedTableRowCounts(dbName)) === 2,
        'the write made during the load never reached IndexedDB',
      );

      // Read it back through a completely independent store/persister pair, so
      // the assertion is about what is genuinely on disk rather than about the
      // in-memory store that was just repaired.
      const reader = createStore();
      const readerPersister = createIndexedDbPersister(reader, dbName);
      try {
        await readerPersister.load();
        assert.equal(reader.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), true, 'the pre-existing row must still be on disk');
        assert.equal(
          reader.getCell(PERSONAL_FOODS_TABLE, 'food-2', PRIMARY_ENTITY_CELL),
          JSON.stringify({ id: 'food-2', name: 'Broccoli' }),
          'the row written during the load must be on disk, with its contents intact',
        );
      } finally {
        await readerPersister.destroy();
      }
    } finally {
      stop();
      await persister.destroy();
    }
  });

  it('a DELETION issued while a load is in flight is not undone by the load', async () => {
    const dbName = 'persist-test-delete-during-load';
    await seedPersistedDatabase(dbName);

    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    const stop = startLockedAutoSave(store, dbName, persister, { hasLocks: false });
    try {
      await persister.load();
      assert.equal(store.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), true, 'precondition: the seeded row loaded');

      const loadInFlight = persister.load();
      store.delRow(PERSONAL_FOODS_TABLE, 'food-1');
      await loadInFlight;

      assert.equal(
        store.hasRow(PERSONAL_FOODS_TABLE, 'food-1'),
        false,
        'the load re-read the row from disk; the delete that raced it must still win, or deleted foods reappear',
      );

      await waitUntilAsync(
        async () => totalRowCount(await readPersistedTableRowCounts(dbName)) === 0,
        'the deletion made during the load never reached IndexedDB',
      );
    } finally {
      stop();
      await persister.destroy();
    }
  });

  it('a load that clobbers nothing restores nothing and leaves the store alone', async () => {
    const dbName = 'persist-test-quiet-load-changes-nothing';
    await seedPersistedDatabase(dbName);

    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    const stop = startLockedAutoSave(store, dbName, persister, { hasLocks: false });
    try {
      await persister.load();
      const contentAfterFirstLoad = JSON.stringify(store.getTables());

      await persister.load();
      await settle();

      assert.equal(JSON.stringify(store.getTables()), contentAfterFirstLoad);
      assert.deepEqual(storeRowCounts(store), { [PERSONAL_FOODS_TABLE]: 1 });
    } finally {
      stop();
      await persister.destroy();
    }
  });

  it('createPersisterLoadGate reports a real persister\'s load status', async () => {
    const dbName = 'persist-test-real-load-gate';
    const store: Store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    try {
      const gate = createPersisterLoadGate(persister);
      assert.notEqual(gate, null, 'a real IndexedDbPersister must expose enough status API to build a gate');
      assert.equal(gate?.isLoading(), false);

      const loadInFlight = persister.load();
      assert.equal(gate?.isLoading(), true, 'load() flips the persister to Loading synchronously');

      await loadInFlight;
      assert.equal(gate?.isLoading(), false);
    } finally {
      await persister.destroy();
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// Mechanism 6: a local write overtaken by a load BEFORE its save runs
////////////////////////////////////////////////////////////////////////////////

describe('mechanism 6 against REAL TinyBase (fake-indexeddb) — openplate#1, the silently vanishing log', () => {
  it('a write made with NO load in flight survives a load that starts before its save gets the lock', async () => {
    const dbName = 'persist-test-write-overtaken-by-load';
    await seedPersistedDatabase(dbName);

    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    // Holds the FIRST save's lock callback without ever granting it, which is
    // the whole defect in one line: acquiring the cross-tab Web Lock is a task
    // hop, and in the app that hop lasts as long as the post-add navigation
    // keeps the main thread busy. Everything below happens inside it.
    let heldLockCallback: (() => Promise<void>) | null = null;
    const stop = startLockedAutoSave(store, dbName, persister, {
      hasLocks: true,
      requestLock: (_lockName, run) => {
        if (heldLockCallback === null) heldLockCallback = run;
      },
    });
    try {
      await persister.load();
      assert.equal(store.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), true, 'precondition: the seeded row loaded');

      // The write lands with NOTHING loading — so mechanism 5 records nothing
      // about it — and its save is immediately parked on the lock.
      store.setRow(PERSONAL_FOODS_TABLE, 'food-2', entityRow('food-2', 'Broccoli'));
      assert.notEqual(heldLockCallback, null, 'the finished write must have requested a save');

      // The once-a-second autoLoad poll now fires inside that hop and replaces
      // the whole store content with what is on disk — which does not yet
      // include the write.
      await persister.load();
      assert.equal(
        store.hasRow(PERSONAL_FOODS_TABLE, 'food-2'),
        true,
        'the write must be put back the moment the load that erased it ends — this is the assertion that failed ' +
          'before mechanism 6, and it is exactly what the user saw: a success toast over an entry that was gone',
      );

      // Only now does the save get its turn. Before the fix it faithfully
      // persisted a store that no longer held the write, which is why a reload
      // did not bring the entry back either.
      await heldLockCallback!();

      const reader = createStore();
      const readerPersister = createIndexedDbPersister(reader, dbName);
      try {
        await readerPersister.load();
        assert.equal(reader.hasRow(PERSONAL_FOODS_TABLE, 'food-1'), true, 'the pre-existing row must still be on disk');
        assert.equal(
          reader.getCell(PERSONAL_FOODS_TABLE, 'food-2', PRIMARY_ENTITY_CELL),
          JSON.stringify({ id: 'food-2', name: 'Broccoli' }),
          'the overtaken write must have reached disk, with its contents intact',
        );
      } finally {
        await readerPersister.destroy();
      }
    } finally {
      stop();
      await persister.destroy();
    }
  });

  it('stops re-applying a write once a save has provably carried it to disk, so another tab\'s later delete sticks', async () => {
    const dbName = 'persist-test-pending-cleared-after-save';
    await seedPersistedDatabase(dbName);

    const store = createStore();
    const persister = createIndexedDbPersister(store, dbName);
    const stop = startLockedAutoSave(store, dbName, persister, { hasLocks: false });
    try {
      await persister.load();
      store.setRow(PERSONAL_FOODS_TABLE, 'food-2', entityRow('food-2', 'Broccoli'));
      await waitUntilAsync(
        async () => totalRowCount(await readPersistedTableRowCounts(dbName)) === 2,
        'the write never reached IndexedDB',
      );
      await settle();

      // Another tab deletes it and persists that. Our pending log must no
      // longer hold the original write, or the next poll would resurrect it.
      const otherTab = createStore();
      const otherPersister = createIndexedDbPersister(otherTab, dbName);
      try {
        await otherPersister.load();
        otherTab.delRow(PERSONAL_FOODS_TABLE, 'food-2');
        await otherPersister.save();
      } finally {
        await otherPersister.destroy();
      }

      await persister.load();
      assert.equal(
        store.hasRow(PERSONAL_FOODS_TABLE, 'food-2'),
        false,
        "a write that is provably on disk must stop being re-applied — otherwise another tab's delete is undone",
      );
    } finally {
      stop();
      await persister.destroy();
    }
  });
});
