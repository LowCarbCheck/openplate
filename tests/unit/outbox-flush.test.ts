/**
 * Integration-ish unit tests for the outbox flush loop (`app/lib/local-store/
 * outbox`) driven against a REAL in-memory TinyBase store (no IndexedDB
 * persister) with a fake poster. Covers strict-order replay, exactly-once
 * idempotency (records keyed by clientId), the stop-on-first-failure rule, and
 * the auth-stop path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from 'tinybase';
import { createOutboxStore } from '../../app/lib/local-store/store';
import { flushOutbox, readOutboxRecords, writeOutboxRecord } from '../../app/lib/local-store/outbox';
import type { FlushResponse, OutboxRecord } from '../../app/lib/local-store/types';

const nowMs = () => 1_000;

/** A ready-to-flush record; override any field per test. */
function record(clientId: string, sequence: number, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    clientId,
    intent: 'log',
    dayKey: '2026-07-14',
    sequence,
    createdAt: 0,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: '',
    payload: { _intent: 'log', name: clientId, quantityGrams: '50' },
    display: {
      name: clientId,
      quantityGrams: 50,
      mealType: null,
      macros: { carbs: null, fiber: null, sugars: null, polyols: null, protein: null, fat: null, kcal: null },
      aiEstimated: false,
      curatedSource: null,
    },
    ...overrides,
  };
}

/** A poster that records the clientIds it was asked to POST, in order. */
function trackingPoster(response: FlushResponse) {
  const posted: string[] = [];
  return {
    posted,
    post: async (r: OutboxRecord) => {
      posted.push(r.clientId);
      return response;
    },
  };
}

const SUCCESS: FlushResponse = { ok: true, redirected: true, url: 'https://app.test/diary' };
const AUTH_STOP: FlushResponse = { ok: true, redirected: true, url: 'https://app.test/login' };
const SERVER_ERROR: FlushResponse = { ok: false, redirected: false, url: 'https://app.test/add' };

function seededStore(records: OutboxRecord[]): Store {
  const store = createOutboxStore();
  for (const rec of records) writeOutboxRecord(store, rec);
  return store;
}

describe('flushOutbox', () => {
  it('replays every ready record in strict sequence order and drains the outbox', async () => {
    const store = seededStore([record('c', 3), record('a', 1), record('b', 2)]);
    const poster = trackingPoster(SUCCESS);

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    assert.deepEqual(poster.posted, ['a', 'b', 'c']);
    assert.equal(result.flushed, 3);
    assert.equal(result.remaining, 0);
    assert.equal(result.stopped, false);
    assert.equal(readOutboxRecords(store).length, 0);
  });

  it('replays each clientId exactly once across repeated flushes (idempotent)', async () => {
    const store = seededStore([record('a', 1), record('b', 2)]);
    const first = trackingPoster(SUCCESS);
    await flushOutbox({ store, post: first.post, now: nowMs });

    // Nothing left to replay: a second flush posts nothing.
    const second = trackingPoster(SUCCESS);
    const result = await flushOutbox({ store, post: second.post, now: nowMs });

    assert.deepEqual(first.posted, ['a', 'b']);
    assert.deepEqual(second.posted, []);
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 0);
  });

  it('collapses duplicate clientIds to a single queued record', () => {
    const store = seededStore([
      record('dup', 1),
      record('dup', 2, {
        display: {
          name: 'dup',
          quantityGrams: 99,
          mealType: null,
          macros: { carbs: null, fiber: null, sugars: null, polyols: null, protein: null, fat: null, kcal: null },
          aiEstimated: false,
          curatedSource: null,
        },
      }),
    ]);
    const records = readOutboxRecords(store);
    assert.equal(records.length, 1);
    // The later write (rowId === clientId) wins.
    assert.equal(records[0].display.quantityGrams, 99);
  });

  it('stops on the first transient failure, keeping that record and every one after it', async () => {
    const store = seededStore([record('a', 1), record('b', 2)]);
    const poster = trackingPoster(SERVER_ERROR);

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    // Only the first is attempted; strict order means b never syncs ahead of a.
    assert.deepEqual(poster.posted, ['a']);
    assert.equal(result.flushed, 0);
    assert.equal(result.stopped, true);
    assert.equal(result.remaining, 2);
    const a = readOutboxRecords(store).find((r) => r.clientId === 'a');
    assert.equal(a?.status, 'failed');
    assert.equal(a?.attempts, 1);
  });

  it('stops and surfaces reauth on an auth-stop, leaving the outbox intact', async () => {
    const store = seededStore([record('a', 1), record('b', 2)]);
    const poster = trackingPoster(AUTH_STOP);

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    assert.deepEqual(poster.posted, ['a']);
    assert.equal(result.stopped, true);
    assert.equal(result.surface, 'reauth');
    assert.equal(result.remaining, 2);
    // The record is reverted to pending (a re-login retry will pick it up).
    assert.equal(readOutboxRecords(store).find((r) => r.clientId === 'a')?.status, 'pending');
  });

  it('reports the earliest failed retry time so a caller can schedule the next flush (retry-stall fix)', async () => {
    const store = seededStore([record('a', 1)]);
    const poster = trackingPoster(SERVER_ERROR);

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    const a = readOutboxRecords(store).find((r) => r.clientId === 'a');
    assert.equal(a?.status, 'failed');
    assert.equal(result.nextRetryAt, a?.nextAttemptAt);
    assert.ok(result.nextRetryAt !== null && result.nextRetryAt > nowMs());
  });

  it('reports nextRetryAt as null once the outbox is fully drained', async () => {
    const store = seededStore([record('a', 1)]);
    const poster = trackingPoster(SUCCESS);

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    assert.equal(result.nextRetryAt, null);
  });

  it('reports nextRetryAt as null when the only remaining record is blocked (never auto-retried)', async () => {
    const store = seededStore([record('a', 1)]);
    const poster = trackingPoster({ ok: true, redirected: false, url: 'https://app.test/add' }); // fatal: 2xx, no redirect

    const result = await flushOutbox({ store, post: poster.post, now: nowMs });

    assert.equal(readOutboxRecords(store).find((r) => r.clientId === 'a')?.status, 'blocked');
    assert.equal(result.nextRetryAt, null);
  });
});
