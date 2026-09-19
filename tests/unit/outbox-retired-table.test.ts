/**
 * The retired LOG OUTBOX table on a browser that still holds one, against the
 * REAL outbox store singleton over `fake-indexeddb`.
 *
 * ── Why the real singleton and not a store built in the test ─────────────
 *
 * The behaviour under test is WHERE the drop runs: inside `getOutboxStore()`'s
 * load, before any caller can read the store, and through the autosave that
 * takes it off the disk. A store built here and handed to a drop function
 * would prove the function and none of the wiring, and the wiring is the part
 * that can quietly go missing. So the database is seeded the way an old build
 * left it, through a plain TinyBase persister, and then opened the way the app
 * opens it.
 *
 * The same singleton is what the sign-out dialog counts reports from
 * (`countQueuedFeedbackReports`), so the second claim rides along: the report
 * queued beside the retired rows survives the drop and is counted.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { createStore } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { getOutboxStore, readPersistedTableRowCounts } from '../../app/lib/local-store/persist';
import { FEEDBACK_OUTBOX_TABLE, OUTBOX_DB_NAME, RETIRED_LOG_OUTBOX_TABLE } from '../../app/lib/local-store/store';
import { countQueuedFeedbackReports, enqueueFeedbackReport } from '../../app/lib/local-store/feedback-outbox';
import { recordFeedbackConsent } from '../../app/lib/feedback/feedback-consent';
import { buildFeedbackMeasurements } from '../../app/lib/feedback/feedback-report';

const NOW = Date.parse('2026-09-19T08:00:00Z');

/** How long the autosave may take to put the drop on disk. A safety net, not a latency claim. */
const DISK_TIMEOUT_MS = 5_000;
const DISK_POLL_MS = 20;

/** One row as a pre-M117/03 build wrote it: a JSON record in a `record` cell, keyed by its client id. */
const OLD_LOG_INTENT = {
  clientId: 'client-before-m117',
  intent: 'manual',
  dayKey: '2026-02-03',
  sequence: 1,
  createdAt: 1_770_000_000_000,
  status: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  lastError: '',
  payload: { _intent: 'manual', name: 'Porridge', quantityGrams: '200' },
  display: { name: 'Porridge', quantityGrams: 200, mealType: 'breakfast', aiEstimated: false, curatedSource: null },
};

/** The on-disk row counts of the outbox database, which must exist by the time this is asked. */
async function countsOnDisk(): Promise<Record<string, number>> {
  const probe = await readPersistedTableRowCounts(OUTBOX_DB_NAME);
  assert.equal(probe.kind, 'present', 'the outbox database must be on disk');
  return probe.kind === 'present' ? probe.counts : {};
}

before(async () => {
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open, so every interval
  // it schedules is unref'd, as the sync integration suite does.
  const scheduleInterval = globalThis.setInterval;
  function unrefdSetInterval<TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): NodeJS.Timeout {
    return scheduleInterval(callback, delay, ...args).unref();
  }
  // SAFETY: the DOM overload answers a `number`; in node the handle carries `unref`.
  globalThis.setInterval = unrefdSetInterval as typeof globalThis.setInterval;

  // THE DATABASE AN OLD BROWSER HOLDS: one retired log intent, and one report
  // queued beside it by a current build. Written through a persister of its
  // own, so the singleton under test is still closed when the test opens it.
  const seed = createStore();
  seed.setRow(RETIRED_LOG_OUTBOX_TABLE, OLD_LOG_INTENT.clientId, { record: JSON.stringify(OLD_LOG_INTENT) });
  await enqueueFeedbackReport({
    store: seed,
    nowMs: NOW,
    userId: 1,
    logId: 'log-1',
    logBatchId: null,
    measurements: buildFeedbackMeasurements({
      name: 'Linsensuppe',
      quantityGrams: 250,
      loggedAt: NOW,
      source: 'ai',
      aiEstimated: true,
      macros: { carbs: 21.7, fiber: 6.1, sugars: 2, polyols: null, protein: 12, fat: 4, kcal: 190 },
    }),
    consent: recordFeedbackConsent({ nowMs: NOW }),
    exportPhoto: async () => null,
  });
  const persister = createIndexedDbPersister(seed, OUTBOX_DB_NAME);
  await persister.save();
  await persister.destroy();
});

describe('the outbox store on a browser that still holds the retired log outbox', () => {
  it('drops the retired rows on load, from memory and from disk, and keeps the queued report', async () => {
    // NON-VACUITY: the old rows really are on disk before the store opens.
    const seeded = await countsOnDisk();
    assert.equal(seeded[RETIRED_LOG_OUTBOX_TABLE], 1, 'fixture: the retired row is on disk');
    assert.equal(seeded[FEEDBACK_OUTBOX_TABLE], 1, 'fixture: the report is on disk');

    const store = await getOutboxStore();

    assert.equal(store.hasTable(RETIRED_LOG_OUTBOX_TABLE), false, 'no reader ever sees the retired table');
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 1, 'the report beside it is untouched');
    assert.equal(await countQueuedFeedbackReports(), 1, 'and it is what the sign-out dialog counts');

    // ON DISK TOO, through the ordinary autosave. A drop that only reached
    // memory would come back on the next load, and on the next autoLoad poll.
    let onDisk = await countsOnDisk();
    for (
      let waited = 0;
      waited < DISK_TIMEOUT_MS && (onDisk[RETIRED_LOG_OUTBOX_TABLE] ?? 0) > 0;
      waited += DISK_POLL_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, DISK_POLL_MS));
      onDisk = await countsOnDisk();
    }
    assert.equal(onDisk[RETIRED_LOG_OUTBOX_TABLE] ?? 0, 0, 'the retired rows are gone from disk');
    assert.equal(onDisk[FEEDBACK_OUTBOX_TABLE], 1, 'the report is still on disk');
  });
});
