/**
 * Unit tests for the pure outbox flush state machine (`app/lib/local-store/
 * outbox-machine`) — response classification, backoff, ordering, and the
 * outcome fold. No browser, no TinyBase, no `fetch`: every case is plain data
 * in / plain data out.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFlushOutcome,
  BASE_BACKOFF_MS,
  classifyFlushFailure,
  classifyFlushResponse,
  computeBackoffMs,
  MAX_BACKOFF_MS,
  MAX_FLUSH_ATTEMPTS,
  selectFlushableRecords,
} from '../../app/lib/local-store/outbox-machine';
import type { OutboxRecord } from '../../app/lib/local-store/types';

/** A pending outbox record with sensible defaults; override any field per test. */
function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    clientId: overrides.clientId ?? 'c1',
    intent: 'log',
    dayKey: '2026-07-14',
    sequence: 1,
    createdAt: 0,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: '',
    payload: {},
    display: {
      name: 'Egg',
      quantityGrams: 50,
      mealType: null,
      macros: {
        carbs: null,
        fiber: null,
        sugars: null,
        polyols: null,
        protein: null,
        fat: null,
        kcal: null,
      },
      aiEstimated: false,
      curatedSource: null,
    },
    ...overrides,
  };
}

describe('classifyFlushResponse', () => {
  it('treats a followed redirect to the diary as success', () => {
    assert.equal(classifyFlushResponse({ ok: true, redirected: true, url: 'https://app.test/diary' }), 'success');
  });

  it('treats a followed redirect to /login as an auth stop', () => {
    assert.equal(
      classifyFlushResponse({ ok: true, redirected: true, url: 'https://app.test/login?redirectTo=/add' }),
      'authStop',
    );
  });

  it('treats a 2xx that did not redirect as fatal (validation re-render)', () => {
    assert.equal(classifyFlushResponse({ ok: true, redirected: false, url: 'https://app.test/add' }), 'fatal');
  });

  it('treats a non-ok status as a transient retry', () => {
    assert.equal(classifyFlushResponse({ ok: false, redirected: false, url: 'https://app.test/add' }), 'retry');
  });
});

describe('classifyFlushFailure', () => {
  it('classifies a thrown fetch as retry', () => {
    assert.equal(classifyFlushFailure(), 'retry');
  });
});

describe('computeBackoffMs', () => {
  it('starts at the base delay for the first attempt', () => {
    assert.equal(computeBackoffMs(1), BASE_BACKOFF_MS);
  });

  it('doubles with each attempt', () => {
    assert.equal(computeBackoffMs(2), BASE_BACKOFF_MS * 2);
    assert.equal(computeBackoffMs(3), BASE_BACKOFF_MS * 4);
  });

  it('caps at the maximum backoff', () => {
    assert.equal(computeBackoffMs(50), MAX_BACKOFF_MS);
  });
});

describe('selectFlushableRecords', () => {
  it('orders ready records by ascending sequence', () => {
    const ordered = selectFlushableRecords(
      [
        record({ clientId: 'b', sequence: 3 }),
        record({ clientId: 'a', sequence: 1 }),
        record({ clientId: 'c', sequence: 2 }),
      ],
      1_000,
    );
    assert.deepEqual(
      ordered.map((r) => r.clientId),
      ['a', 'c', 'b'],
    );
  });

  it('excludes blocked records', () => {
    const ordered = selectFlushableRecords([record({ clientId: 'x', status: 'blocked' })], 1_000);
    assert.equal(ordered.length, 0);
  });

  it('excludes records whose backoff window has not elapsed', () => {
    const ordered = selectFlushableRecords(
      [
        record({ clientId: 'due', nextAttemptAt: 500 }),
        record({ clientId: 'notyet', sequence: 2, nextAttemptAt: 5_000 }),
      ],
      1_000,
    );
    assert.deepEqual(
      ordered.map((r) => r.clientId),
      ['due'],
    );
  });

  it('selects nothing when an earlier-sequence record is parked in backoff, even though a later one is ready (cross-invocation FIFO)', () => {
    const ordered = selectFlushableRecords(
      [
        record({ clientId: 'earlier-parked', sequence: 1, status: 'failed', nextAttemptAt: 5_000 }),
        record({ clientId: 'later-ready', sequence: 2, status: 'pending', nextAttemptAt: 0 }),
      ],
      1_000,
    );
    assert.deepEqual(ordered, []);
  });

  it('selects only the leading ready prefix, stopping at the first unready record regardless of what comes after', () => {
    const ordered = selectFlushableRecords(
      [
        record({ clientId: 'a', sequence: 1, nextAttemptAt: 0 }),
        record({ clientId: 'b', sequence: 2, nextAttemptAt: 0 }),
        record({ clientId: 'c', sequence: 3, status: 'failed', nextAttemptAt: 5_000 }),
        record({ clientId: 'd', sequence: 4, nextAttemptAt: 0 }),
      ],
      1_000,
    );
    assert.deepEqual(
      ordered.map((r) => r.clientId),
      ['a', 'b'],
    );
  });

  it('a blocked record does not occupy a sequence slot — later ready records still select normally', () => {
    const ordered = selectFlushableRecords(
      [
        record({ clientId: 'blocked', sequence: 1, status: 'blocked', nextAttemptAt: 0 }),
        record({ clientId: 'ready', sequence: 2, nextAttemptAt: 0 }),
      ],
      1_000,
    );
    assert.deepEqual(
      ordered.map((r) => r.clientId),
      ['ready'],
    );
  });
});

describe('applyFlushOutcome', () => {
  it('removes the record on success and does not stop the loop', () => {
    const transition = applyFlushOutcome({ record: record(), outcome: 'success', nowMs: 1_000 });
    assert.equal(transition.remove, true);
    assert.equal(transition.stop, false);
    assert.equal(transition.surface, 'none');
  });

  it('keeps the record pending and stops with a reauth surface on auth stop', () => {
    const transition = applyFlushOutcome({ record: record({ status: 'syncing' }), outcome: 'authStop', nowMs: 1_000 });
    assert.equal(transition.remove, false);
    assert.equal(transition.stop, true);
    assert.equal(transition.surface, 'reauth');
    assert.equal(transition.record?.status, 'pending');
  });

  it('backs off and stops the loop on a transient retry', () => {
    const transition = applyFlushOutcome({ record: record({ attempts: 1 }), outcome: 'retry', nowMs: 1_000 });
    assert.equal(transition.remove, false);
    assert.equal(transition.stop, true);
    assert.equal(transition.surface, 'none');
    assert.equal(transition.record?.status, 'failed');
    assert.equal(transition.record?.attempts, 2);
    assert.equal(transition.record?.nextAttemptAt, 1_000 + computeBackoffMs(2));
  });

  it('blocks the record once retries are exhausted', () => {
    const transition = applyFlushOutcome({
      record: record({ attempts: MAX_FLUSH_ATTEMPTS - 1 }),
      outcome: 'retry',
      nowMs: 1_000,
    });
    assert.equal(transition.record?.status, 'blocked');
    assert.equal(transition.stop, true);
    assert.equal(transition.surface, 'blocked');
  });

  it('blocks the record (never drops it) on a fatal rejection', () => {
    const transition = applyFlushOutcome({ record: record(), outcome: 'fatal', nowMs: 1_000 });
    assert.equal(transition.remove, false);
    assert.equal(transition.record?.status, 'blocked');
    assert.equal(transition.stop, true);
    assert.equal(transition.surface, 'blocked');
  });
});
