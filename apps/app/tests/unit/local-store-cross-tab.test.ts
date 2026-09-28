/**
 * Cross-tab reconciliation test (review fix — spec-mandated coverage that
 * `startAutoLoad` genuinely reconciles another tab's write, not just a code
 * comment). Drives two independent TinyBase `Store` + `IndexedDbPersister`
 * pairs (simulating "tab A" and "tab B") against the SAME `fake-indexeddb`
 * database, using a fast `autoLoadIntervalSeconds` so the test doesn't sleep a
 * flat 1 second.
 *
 * This deliberately bypasses `persist.ts`'s `getXStore()` singletons — which
 * now throw outside a real browser (see `assertBrowserWithIndexedDb` there,
 * the review's server-side-invocation-guard fix) — and drives
 * `tinybase/persisters/persister-indexed-db` directly, exactly the pattern
 * that guard's own error message points test/non-browser code toward.
 *
 * FLAKE POST-MORTEM (2026-07-28). These tests used to poll a wall clock
 * (100 × 15 ms) for the observing tab to catch up, and one of them
 * intermittently timed out under a full-suite run while passing in isolation.
 * The cause was NOT a too-short budget — it was a real TinyBase behaviour the
 * test was depending on by luck. `save()` is silently skipped while the SAME
 * persister has a load in flight:
 *
 *     const save = async (changes) => { if (status != 1 /* Loading * /) { ... } }
 *
 * — no queue, no retry. Each tab here also polls its OWN autoLoad every 50 ms,
 * so a `setRow` landing inside that window had its autosave dropped and the row
 * NEVER reached IndexedDB, after which no amount of waiting could succeed. A
 * 120-run harness that jittered the write across 0–59 ms reproduced it 4 times,
 * clustered precisely at delays of 49–51 ms — i.e. exactly on the poll
 * boundary. Raising the bound would have papered over a permanent failure.
 *
 * Both halves of the fix are therefore about REMOVING timing dependence, not
 * extending it: {@link writeRow} makes "the write is on disk" a fact the test
 * establishes, and {@link waitForStore} waits on the observing store's own
 * change listener instead of sampling a clock. The one remaining bound is a
 * safety net so a genuine failure reports itself instead of hanging.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { createStore, type Store } from 'tinybase';
import { z } from 'zod';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { PERSONAL_FOODS_TABLE, PRIMARY_ENTITY_CELL } from '../../app/lib/local-store/store';

type Persister = ReturnType<typeof createIndexedDbPersister>;

/** Poll fast — TinyBase's autoLoad interval is configurable per-persister (3rd arg). */
const AUTO_LOAD_INTERVAL_SECONDS = 0.05;

/**
 * TinyBase's `Status.Idle`, spelled as a local constant rather than imported:
 * `Status` is a `const enum`, which doesn't survive this repo's transpile-only
 * test runner. 0 = idle, 1 = loading, 2 = saving.
 */
const STATUS_IDLE = 0;

/**
 * Safety net only — NOT the mechanism. {@link waitForStore} resolves off a store
 * listener the instant reconciliation lands (typically well under 100 ms), so
 * this bound is never reached on a passing run at any machine load; it exists
 * so a genuine reconciliation failure reports itself with a message instead of
 * hanging until the runner's own timeout. Generous on purpose for that reason:
 * a bound that doubles as a latency assertion is exactly what made the old
 * polling version flaky.
 */
const RECONCILE_TIMEOUT_MS = 10_000;

/** Resolves once `persister` reports Idle — no load or save in flight. */
async function waitForIdle(persister: Persister): Promise<void> {
  if (persister.getStatus() === STATUS_IDLE) return;
  await new Promise<void>((resolve) => {
    const listenerId = persister.addStatusListener((_persister, status) => {
      if (status !== STATUS_IDLE) return;
      persister.delListener(listenerId);
      resolve();
    });
  });
}

/**
 * Writes a row from one tab and returns only once it is genuinely in IndexedDB.
 *
 * Both steps are load-bearing (see the flake post-mortem in this file's header):
 *  1. Wait for this tab's OWN persister to be idle first, so the write can't
 *     land while its autoLoad poll is mid-flight — which would make TinyBase
 *     silently skip the resulting autosave. Nothing may be awaited between the
 *     wait and `setRow`: both are synchronous from here, and a macrotask gap
 *     would let the 50 ms interval callback back in.
 *  2. Flush explicitly rather than trusting the autosave transaction listener,
 *     so "the row is on disk" is established by this function instead of being
 *     a race the assertion downstream hopes has already resolved.
 */
async function writeRow(
  { store, persister }: { store: Store; persister: Persister },
  { rowId, name }: { rowId: string; name: string },
): Promise<void> {
  await waitForIdle(persister);
  store.setRow(PERSONAL_FOODS_TABLE, rowId, { [PRIMARY_ENTITY_CELL]: JSON.stringify({ id: rowId, name }) });
  await persister.save();
}

/**
 * Resolves when `check` holds for `store`, driven by the store's OWN change
 * listener — so it returns the moment the observing tab's autoLoad poll merges
 * the other tab's write in, rather than on the next tick of a sampling clock.
 * The timeout is the failure path, never the happy one.
 */
async function waitForStore(store: Store, check: () => boolean, description: string): Promise<void> {
  if (check()) return;
  let listenerId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      listenerId = store.addTablesListener(() => {
        if (check()) resolve();
      });
      timer = setTimeout(
        () => reject(new Error(`cross-tab reconciliation never happened within ${RECONCILE_TIMEOUT_MS}ms: ${description}`)),
        RECONCILE_TIMEOUT_MS,
      );
    });
  } finally {
    if (listenerId !== undefined) store.delListener(listenerId);
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Two tabs sharing one IndexedDB database, both auto-loading and auto-saving exactly as `persist.ts` does. */
interface TwoTabs {
  storeA: Store;
  storeB: Store;
  persisterA: Persister;
  persisterB: Persister;
}

async function openTwoTabs(dbName: string): Promise<TwoTabs> {
  const storeA = createStore();
  const storeB = createStore();
  const persisterA = createIndexedDbPersister(storeA, dbName, AUTO_LOAD_INTERVAL_SECONDS);
  const persisterB = createIndexedDbPersister(storeB, dbName, AUTO_LOAD_INTERVAL_SECONDS);
  // Same startAutoLoad-before-startAutoSave order as `persist.ts`, and both
  // directions on BOTH tabs — the symmetric configuration production actually
  // runs, kept deliberately rather than trimmed to whichever half each test
  // asserts.
  await persisterA.startAutoLoad();
  await persisterA.startAutoSave();
  await persisterB.startAutoLoad();
  await persisterB.startAutoSave();
  return { storeA, storeB, persisterA, persisterB };
}

async function closeTwoTabs({ persisterA, persisterB }: TwoTabs): Promise<void> {
  await persisterA.destroy();
  await persisterB.destroy();
}

/** The serialized entity `primary-store.ts` writes into an entity cell. */
const storedEntitySchema = z.object({ id: z.string(), name: z.string() });
type StoredEntity = z.infer<typeof storedEntitySchema>;

/** The entity a reconciled row should decode back to. */
function readEntity(store: Store, rowId: string): StoredEntity {
  const cell = store.getCell(PERSONAL_FOODS_TABLE, rowId, PRIMARY_ENTITY_CELL);
  assert.ok(cell !== undefined, `expected a serialized entity cell on row "${rowId}"`);
  return storedEntitySchema.parse(JSON.parse(String(cell)));
}

describe('cross-tab reconciliation (fake-indexeddb)', () => {
  it("tab A observes tab B's write once tab A's startAutoLoad poll fires", async () => {
    const tabs = await openTwoTabs('openplate-cross-tab-test-a-observes-b');
    try {
      await writeRow(
        { store: tabs.storeB, persister: tabs.persisterB },
        { rowId: 'food-from-tab-b', name: 'Written by tab B' },
      );

      await waitForStore(
        tabs.storeA,
        () => tabs.storeA.hasRow(PERSONAL_FOODS_TABLE, 'food-from-tab-b'),
        "tab A never picked up tab B's row",
      );

      assert.deepEqual(readEntity(tabs.storeA, 'food-from-tab-b'), {
        id: 'food-from-tab-b',
        name: 'Written by tab B',
      });
    } finally {
      await closeTwoTabs(tabs);
    }
  });

  it('reconciliation is bidirectional: tab B also observes a write made by tab A', async () => {
    const tabs = await openTwoTabs('openplate-cross-tab-test-b-observes-a');
    try {
      await writeRow(
        { store: tabs.storeA, persister: tabs.persisterA },
        { rowId: 'food-from-tab-a', name: 'Written by tab A' },
      );

      await waitForStore(
        tabs.storeB,
        () => tabs.storeB.hasRow(PERSONAL_FOODS_TABLE, 'food-from-tab-a'),
        "tab B never picked up tab A's row",
      );

      assert.deepEqual(readEntity(tabs.storeB, 'food-from-tab-a'), {
        id: 'food-from-tab-a',
        name: 'Written by tab A',
      });
    } finally {
      await closeTwoTabs(tabs);
    }
  });

  it("a later write from tab A overwrites tab B's stale copy of the same row once reconciled (last-write-wins)", async () => {
    const tabs = await openTwoTabs('openplate-cross-tab-test-overwrite');
    try {
      await writeRow(
        { store: tabs.storeA, persister: tabs.persisterA },
        { rowId: 'shared-row', name: 'Original from tab A' },
      );
      await waitForStore(
        tabs.storeB,
        () => tabs.storeB.hasRow(PERSONAL_FOODS_TABLE, 'shared-row'),
        'tab B never picked up the original row',
      );

      await writeRow(
        { store: tabs.storeA, persister: tabs.persisterA },
        { rowId: 'shared-row', name: 'Updated from tab A' },
      );
      await waitForStore(
        tabs.storeB,
        () => {
          const cell = tabs.storeB.getCell(PERSONAL_FOODS_TABLE, 'shared-row', PRIMARY_ENTITY_CELL);
          if (cell === undefined) return false;
          return storedEntitySchema.safeParse(JSON.parse(String(cell))).data?.name === 'Updated from tab A';
        },
        "tab B kept its stale copy of the row instead of taking tab A's later write",
      );

      assert.deepEqual(readEntity(tabs.storeB, 'shared-row'), { id: 'shared-row', name: 'Updated from tab A' });
    } finally {
      await closeTwoTabs(tabs);
    }
  });
});
