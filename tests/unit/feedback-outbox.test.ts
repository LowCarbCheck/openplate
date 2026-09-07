/**
 * The durable queue for a reported bad estimate
 * (`app/lib/local-store/feedback-outbox`), driven against a REAL in-memory
 * TinyBase store, an injected poster and an injected clock. No IndexedDB, no
 * network, no canvas.
 *
 * The three properties the spec names, each asserted here rather than
 * described:
 *
 *  - an EVICTED photograph still sends a report, flagged as having no image;
 *  - a RETRIED report is one report, not two;
 *  - the CONSENT record travels with the report.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOutboxStore, FEEDBACK_OUTBOX_TABLE } from '../../app/lib/local-store/store';
import {
  drainFeedbackOutbox,
  enqueueFeedbackReport,
  readFeedbackRecords,
  writeFeedbackRecord,
} from '../../app/lib/local-store/feedback-outbox';
import { recordFeedbackConsent, FEEDBACK_CONSENT_WORDING_VERSION } from '../../app/lib/feedback/feedback-consent';
import { buildFeedbackMeasurements, type FeedbackWireBody } from '../../app/lib/feedback/feedback-report';
import { MAX_FLUSH_ATTEMPTS } from '../../app/lib/local-store/outbox-machine';

const NOW = Date.parse('2026-09-07T12:00:00Z');

const ENTRY = {
  name: 'Linsensuppe',
  quantityGrams: 250,
  loggedAt: NOW,
  source: 'ai' as const,
  aiEstimated: true,
  macros: { carbs: 21.7, fiber: 6.1, sugars: 2, polyols: null, protein: 12, fat: 4, kcal: 190 },
};

/** Queues one report with the photo export stubbed, so the test decides whether an image exists. */
async function queueReport({
  store,
  photo,
  nowMs = NOW,
}: {
  store: ReturnType<typeof createOutboxStore>;
  photo: Blob | null;
  nowMs?: number;
}) {
  return enqueueFeedbackReport({
    store,
    nowMs,
    userId: 1,
    logId: 'log-1',
    logBatchId: 'batch-1',
    measurements: buildFeedbackMeasurements(ENTRY),
    consent: recordFeedbackConsent({ nowMs }),
    exportPhoto: async () => photo,
  });
}

/** A poster that records what it was given and answers a fixed status. */
function recordingPoster(status: number) {
  const bodies: FeedbackWireBody[] = [];
  const post = async (body: FeedbackWireBody) => {
    bodies.push(body);
    return { status };
  };
  return { bodies, post };
}

describe('an evicted photograph does not block a report', () => {
  it('queues the figures alone, flagged as having no image', async () => {
    const store = createOutboxStore();
    // `exportPhotoForFeedback` answers null for an image the cache has already
    // evicted; this is that answer.
    const record = await queueReport({ store, photo: null });

    assert.equal(record.image, null);
    assert.equal(record.measurements.name, 'Linsensuppe');
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 1);
  });

  it('sends it, and the wire body says the image is unavailable by carrying null', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });
    const { bodies, post } = recordingPoster(201);

    const result = await drainFeedbackOutbox({ store, post, now: () => NOW });

    assert.equal(result.sent, 1);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]?.image, null, 'no image is null on the wire, never an omitted key');
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 0);
  });

  it('carries the photograph when the cache still had one', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: new Blob([Buffer.alloc(64, 3)], { type: 'image/jpeg' }) });
    const { bodies, post } = recordingPoster(201);

    await drainFeedbackOutbox({ store, post, now: () => NOW });

    assert.equal(bodies[0]?.image?.contentType, 'image/jpeg');
    assert.equal(Buffer.from(bodies[0]?.image?.data ?? '', 'base64').byteLength, 64);
  });
});

describe('a retried report is one report', () => {
  it('reuses the same idempotency key across every attempt', async () => {
    const store = createOutboxStore();
    const record = await queueReport({ store, photo: null });

    // Three failures, then a success. The row is retried, so time has to move
    // past each backoff window.
    const { bodies, post } = recordingPoster(503);
    let clock = NOW;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await drainFeedbackOutbox({ store, post, now: () => clock });
      clock += 60 * 60 * 1000;
    }
    const success = recordingPoster(201);
    const result = await drainFeedbackOutbox({ store, post: success.post, now: () => clock });

    assert.equal(bodies.length, 3, 'each retry is an attempt');
    for (const body of [...bodies, ...success.bodies]) {
      assert.equal(body.idempotencyKey, record.idempotencyKey);
    }
    assert.equal(result.sent, 1);
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 0, 'one report, one row, removed once');
  });

  it('never writes a second row for the same key', async () => {
    const store = createOutboxStore();
    const record = await queueReport({ store, photo: null });

    // What a retry looks like at the STORE level: the same record written
    // again. The key is the row id, so this can only ever overwrite.
    writeFeedbackRecord(store, { ...record, attempts: 1, status: 'failed' });
    writeFeedbackRecord(store, { ...record, attempts: 2, status: 'failed' });

    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 1);
    assert.equal(readFeedbackRecords(store)[0]?.attempts, 2);
  });

  it('treats the server 200 for a report it already holds as a success, not a failure', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });
    // 200 is the duplicate answer; 201 is a report stored now. A client that
    // read 200 as a failure would retry for ever against a server whose answer
    // can never change.
    const result = await drainFeedbackOutbox({ store, post: recordingPoster(200).post, now: () => NOW });

    assert.equal(result.sent, 1);
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 0);
  });
});

describe('the consent record travels with the report', () => {
  it('puts the agreed instant and the wording version on the wire', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });
    const { bodies, post } = recordingPoster(201);

    await drainFeedbackOutbox({ store, post, now: () => NOW });

    assert.deepEqual(bodies[0]?.consent, {
      agreedAt: new Date(NOW).toISOString(),
      wordingVersion: FEEDBACK_CONSENT_WORDING_VERSION,
    });
  });

  it('survives the round trip through the durable store', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });

    const [stored] = readFeedbackRecords(store);
    assert.equal(stored?.consent.wordingVersion, FEEDBACK_CONSENT_WORDING_VERSION);
    assert.equal(stored?.consent.agreedAt, new Date(NOW).toISOString());
  });

  it('drops a queued row whose consent record did not survive, rather than sending it', async () => {
    const store = createOutboxStore();
    const record = await queueReport({ store, photo: null });
    // A row written by an older build, or edited by hand. Sending it would put
    // an unverifiable claim of agreement beside a stored photograph.
    store.setRow(FEEDBACK_OUTBOX_TABLE, record.idempotencyKey, {
      record: JSON.stringify({ ...record, consent: { agreedAt: '', wordingVersion: '' } }),
    });

    assert.deepEqual(readFeedbackRecords(store), []);
  });
});

describe('the drain', () => {
  it('keeps a report the server refuses, and stops retrying it', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });

    // 404 is an instance whose operator never switched the feature on. Kept,
    // never dropped: they may switch it on tomorrow.
    const result = await drainFeedbackOutbox({ store, post: recordingPoster(404).post, now: () => NOW });

    assert.equal(result.blocked, 1);
    assert.equal(readFeedbackRecords(store)[0]?.status, 'blocked');

    const after = recordingPoster(201);
    await drainFeedbackOutbox({ store, post: after.post, now: () => NOW + 86_400_000 });
    assert.equal(after.bodies.length, 0, 'a blocked row is not retried automatically');
  });

  it('retries a 429 rather than blocking it', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });

    await drainFeedbackOutbox({ store, post: recordingPoster(429).post, now: () => NOW });

    assert.equal(readFeedbackRecords(store)[0]?.status, 'failed', 'a daily limit resets at midnight');
  });

  it('treats a thrown fetch as transient', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });

    await drainFeedbackOutbox({
      store,
      now: () => NOW,
      post: async () => {
        throw new Error('the network dropped');
      },
    });

    const [record] = readFeedbackRecords(store);
    assert.equal(record?.status, 'failed');
    assert.ok((record?.nextAttemptAt ?? 0) > NOW, 'it is backed off, not attempted in a loop');
  });

  it('does not park one report behind another that cannot be sent', async () => {
    const store = createOutboxStore();
    const first = await queueReport({ store, photo: null, nowMs: NOW });
    const second = await queueReport({ store, photo: null, nowMs: NOW + 1 });

    const attempted: string[] = [];
    await drainFeedbackOutbox({
      store,
      now: () => NOW + 2,
      post: async (body) => {
        attempted.push(body.idempotencyKey);
        return { status: body.idempotencyKey === first.idempotencyKey ? 503 : 201 };
      },
    });

    assert.deepEqual(attempted, [first.idempotencyKey, second.idempotencyKey]);
    assert.equal(readFeedbackRecords(store).length, 1, 'the sendable one went, the other is still queued');
  });

  it('parks a report after the retry budget is spent, and never drops it', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });

    let clock = NOW;
    for (let attempt = 0; attempt < MAX_FLUSH_ATTEMPTS; attempt += 1) {
      await drainFeedbackOutbox({ store, post: recordingPoster(503).post, now: () => clock });
      clock += 60 * 60 * 1000;
    }

    assert.equal(readFeedbackRecords(store)[0]?.status, 'blocked');
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 1, 'kept, so the person has not lost the report');
  });

  it('attempts nothing when nobody is signed in', async () => {
    const store = createOutboxStore();
    await queueReport({ store, photo: null });
    // No poster is injected and no sync vault is open in a unit test, so the
    // default poster resolves to null and the drain is a no-op.
    const result = await drainFeedbackOutbox({ store, now: () => NOW });

    assert.deepEqual(result, { sent: 0, blocked: 0, remaining: 0 });
    assert.equal(store.getRowCount(FEEDBACK_OUTBOX_TABLE), 1, 'the report waits for a session, it is not lost');
  });
});
