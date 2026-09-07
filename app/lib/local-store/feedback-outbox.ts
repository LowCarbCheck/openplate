/**
 * The durable queue for a reported bad estimate, and the drain that empties it
 * when the device has a connection.
 *
 * A QUEUE, NOT A REQUEST, and that is the requirement rather than a
 * refinement. openplate is offline-first and the person pressing this button
 * is quite likely standing in a supermarket on one bar of signal. A failed
 * upload must not be a lost report, so the report is written to IndexedDB
 * first and posted afterwards, and the row survives a reload, a tab close and
 * a flat battery.
 *
 * ONE ROW PER IDEMPOTENCY KEY, and the key IS the row id. The server dedupes
 * on `(account, idempotencyKey)` and answers `200` for a repeat instead of
 * storing a second report, so a retry from this queue is a no-op there. That
 * is what makes retrying safe enough to do automatically.
 *
 * NO STRICT ORDERING. The log outbox (`outbox.ts`) stops its whole loop at the
 * first failure because a later write must never sync ahead of an earlier one.
 * Reports have no such relationship: one that cannot be sent must not park
 * every other one behind it.
 *
 * The pure decisions live in `#app/lib/feedback/feedback-report`; the photo
 * cache is reached through exactly one function
 * (`#app/lib/feedback/feedback-photo-export`); this module owns the store I/O
 * and the `fetch`.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { getOutboxStore } from './persist';
import { FEEDBACK_OUTBOX_RECORD_CELL, FEEDBACK_OUTBOX_TABLE } from './store';
import { computeBackoffMs, MAX_FLUSH_ATTEMPTS } from './outbox-machine';
import { feedbackConsentRecordSchema, type FeedbackConsentRecord } from '#app/lib/feedback/feedback-consent';
import {
  buildFeedbackWireBody,
  classifyFeedbackFailure,
  classifyFeedbackResponse,
  imageWithinBounds,
  measurementsWithinBound,
  type FeedbackImagePayload,
  type FeedbackMeasurements,
  type FeedbackReportRecord,
  type FeedbackWireBody,
} from '#app/lib/feedback/feedback-report';
import { exportPhotoForFeedback } from '#app/lib/feedback/feedback-photo-export';
import { getSyncVault } from '#app/lib/sync/sync-session';
import { randomUuid } from '#app/lib/uuid';

/** Posts one report and reports the HTTP status back. The impure boundary the drain wraps. */
export type FeedbackPoster = (body: FeedbackWireBody) => Promise<{ status: number }>;

/** The queued-record cell as it comes back off the store: a TinyBase cell, not yet JSON text. */
const recordCellSchema = z.string();

/**
 * The queued report, parsed rather than cast.
 *
 * A ROW THAT DOES NOT PARSE IS DROPPED ON READ, not repaired and not retried.
 * The only ways to get one are a build of this app that wrote a different
 * shape and a hand edit in devtools, and both produce a body the server
 * answers `400` to for ever, from a queue that would keep offering it. A
 * report whose consent record did not survive is the worst of those: sending
 * it would put an unverifiable claim of agreement beside a stored photograph.
 */
const feedbackRecordSchema = z.object({
  idempotencyKey: z.string().min(1),
  logId: z.string(),
  createdAt: z.number(),
  status: z.enum(['pending', 'sending', 'failed', 'blocked']),
  attempts: z.number(),
  nextAttemptAt: z.number(),
  lastError: z.string(),
  measurements: z.object({
    name: z.string(),
    quantityGrams: z.number(),
    loggedAt: z.string(),
    source: z.string(),
    aiEstimated: z.boolean(),
    carbs: z.number().nullable(),
    fiber: z.number().nullable(),
    sugars: z.number().nullable(),
    polyols: z.number().nullable(),
    protein: z.number().nullable(),
    fat: z.number().nullable(),
    kcal: z.number().nullable(),
  }),
  consent: feedbackConsentRecordSchema,
  image: z.object({ contentType: z.string(), data: z.string().min(1) }).nullable(),
});

export function writeFeedbackRecord(store: Store, record: FeedbackReportRecord): void {
  store.setRow(FEEDBACK_OUTBOX_TABLE, record.idempotencyKey, {
    [FEEDBACK_OUTBOX_RECORD_CELL]: JSON.stringify(record),
  });
}

function readFeedbackRecord(store: Store, rowId: string): FeedbackReportRecord | null {
  const raw = recordCellSchema.safeParse(store.getCell(FEEDBACK_OUTBOX_TABLE, rowId, FEEDBACK_OUTBOX_RECORD_CELL));
  if (!raw.success) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.data);
  } catch {
    return null;
  }
  const parsed = feedbackRecordSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export function readFeedbackRecords(store: Store): FeedbackReportRecord[] {
  return store
    .getRowIds(FEEDBACK_OUTBOX_TABLE)
    .map((rowId) => readFeedbackRecord(store, rowId))
    .filter((record): record is FeedbackReportRecord => record !== null)
    .toSorted((a, b) => a.createdAt - b.createdAt);
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/** A `Blob` as the wire wants it: base64 with its type. Browser-only; `arrayBuffer` is the portable read. */
async function blobToImagePayload(blob: Blob): Promise<FeedbackImagePayload | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { contentType: blob.type, data: btoa(binary) };
}

export interface EnqueueFeedbackReportInput {
  userId: number;
  logId: string;
  /** `null` for an entry that never came from a scan. There is then no photograph to ask about. */
  logBatchId: string | null;
  measurements: FeedbackMeasurements;
  consent: FeedbackConsentRecord;
  store?: Store;
  nowMs?: number;
  /** Injected so a test drives the queue without IndexedDB and without a canvas. */
  exportPhoto?: (input: { userId: number; logBatchId: string | null }) => Promise<Blob | null>;
}

/**
 * Queues one report, with this entry's photograph if the cache still holds it.
 *
 * AN EVICTED PHOTOGRAPH DOES NOT BLOCK THE REPORT. `exportPhotoForFeedback`
 * answers `null` for an image that has aged out, for an entry that never had
 * one, and for a cache that will not open, and all three queue the figures
 * alone. The row then carries `image: null`, the server stores
 * `has_image = false`, and a reviewer can tell "there never was one" from "one
 * was stored and later deleted".
 */
export async function enqueueFeedbackReport(input: EnqueueFeedbackReportInput): Promise<FeedbackReportRecord> {
  if (!measurementsWithinBound(input.measurements)) {
    // The server would answer 400 and this queue would retry it for ever.
    // Failing here, at the one moment a person is looking at the screen, is
    // the only place this can be said out loud.
    throw new Error('feedback measurements exceed the accepted size');
  }

  const store = input.store ?? (await getOutboxStore());
  const nowMs = input.nowMs ?? Date.now();
  const exportPhoto = input.exportPhoto ?? exportPhotoForFeedback;

  const blob = await exportPhoto({ userId: input.userId, logBatchId: input.logBatchId });
  const payload = blob === null ? null : await blobToImagePayload(blob);
  const image = payload !== null && imageWithinBounds(payload) ? payload : null;

  const record: FeedbackReportRecord = {
    idempotencyKey: randomUuid(),
    logId: input.logId,
    createdAt: nowMs,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: '',
    measurements: input.measurements,
    consent: input.consent,
    image,
  };
  writeFeedbackRecord(store, record);
  return record;
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

/** Posts through the signed-in session's HTTP client. `null` when nobody is signed in, so nothing is attempted. */
function defaultPoster(): FeedbackPoster | null {
  const vault = getSyncVault();
  if (vault === null) return null;
  return (body) => vault.http.submitFeedback(body);
}

export interface DrainFeedbackOutboxResult {
  sent: number;
  /** Rows the server will never accept as they stand. Kept, never dropped. */
  blocked: number;
  remaining: number;
}

/**
 * Empties the queue, one report at a time, skipping any row whose backoff has
 * not elapsed.
 *
 * EVERY ROW IS ATTEMPTED. A failure parks that row and the loop moves on,
 * because one unsendable report must not hold up the others.
 */
export async function drainFeedbackOutbox(
  options: { store?: Store; post?: FeedbackPoster; now?: () => number } = {},
): Promise<DrainFeedbackOutboxResult> {
  // NOBODY IS SIGNED IN, SO NOTHING IS ATTEMPTED, AND THE DATABASE IS NOT
  // OPENED. This drain is called from the sync cycle, which runs on boot and
  // on every reconnect; opening IndexedDB there to count rows nobody can send
  // is a second database open on a path that has no business needing one.
  const post = options.post ?? defaultPoster();
  if (post === null) return { sent: 0, blocked: 0, remaining: 0 };

  const store = options.store ?? (await getOutboxStore());
  const now = options.now ?? Date.now;

  let sent = 0;
  let blocked = 0;

  for (const record of readFeedbackRecords(store)) {
    if (record.status === 'blocked') continue;
    if (record.nextAttemptAt > now()) continue;

    writeFeedbackRecord(store, { ...record, status: 'sending' });

    let outcome;
    try {
      outcome = classifyFeedbackResponse((await post(buildFeedbackWireBody(record))).status);
    } catch {
      outcome = classifyFeedbackFailure();
    }

    if (outcome === 'sent') {
      store.delRow(FEEDBACK_OUTBOX_TABLE, record.idempotencyKey);
      sent += 1;
      continue;
    }
    if (outcome === 'blocked') {
      writeFeedbackRecord(store, { ...record, status: 'blocked', lastError: 'rejected' });
      blocked += 1;
      continue;
    }

    const attempts = record.attempts + 1;
    if (attempts >= MAX_FLUSH_ATTEMPTS) {
      writeFeedbackRecord(store, { ...record, status: 'blocked', attempts, lastError: 'max-retries' });
      blocked += 1;
      continue;
    }
    writeFeedbackRecord(store, {
      ...record,
      status: 'failed',
      attempts,
      nextAttemptAt: now() + computeBackoffMs(attempts),
      lastError: 'retry',
    });
  }

  return { sent, blocked, remaining: store.getRowCount(FEEDBACK_OUTBOX_TABLE) };
}

/**
 * Single-flight wrapper over the default-store drain, so the reconnect
 * triggers firing in quick succession share one run instead of racing. The
 * same arrangement `flushOutboxOnce` uses, for the same reason.
 */
let inFlight: Promise<DrainFeedbackOutboxResult> | null = null;
export function drainFeedbackOutboxOnce(): Promise<DrainFeedbackOutboxResult> {
  if (!inFlight) {
    inFlight = drainFeedbackOutbox().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
