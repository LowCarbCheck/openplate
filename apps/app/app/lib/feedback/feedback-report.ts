/**
 * The wire shape of `POST /v1/feedback`, and the pure decisions the durable
 * queue makes about one attempt.
 *
 * TRANSCRIBED FROM THE SERVER, NOT GUESSED. Every bound and every field name
 * below is read off `openplate-core/src/feedback/register-feedback-route.ts`
 * (`decodeSubmission`, `parseImage`, `MAX_FEEDBACK_IMAGE_BYTES`,
 * `MAX_MEASUREMENTS_BYTES`, `ALLOWED_FEEDBACK_IMAGE_TYPES`). A client that
 * invents a field here does not get a helpful error; it gets the same
 * `400 invalid request body` every malformed report gets, forever, from a
 * queue that will retry it forever.
 *
 * NO SIDE EFFECTS LIVE HERE. The store I/O and the `fetch` are
 * `local-store/feedback-outbox.ts`'s; the photo cache is
 * `feedback-photo-export.ts`'s. This module is plain data in, plain data out,
 * so the queue's behaviour is testable without a browser.
 */
import type { FeedbackConsentRecord } from './feedback-consent';

/** The path the report is posted to. OUTSIDE `/v1/sync`, exactly as the server mounts it. */
export const FEEDBACK_API_PATH = '/v1/feedback';

/**
 * The largest DECODED image the server stores, in bytes.
 *
 * Mirrors `MAX_FEEDBACK_IMAGE_BYTES` on the server. Enforced here as well as
 * there so an oversized photo is never queued: a queued report the server is
 * certain to refuse is a report that sits in the outbox burning retries.
 */
export const MAX_FEEDBACK_IMAGE_BYTES = 5_000_000;

/** Mirrors `MAX_MEASUREMENTS_BYTES`. A bound on the figures, never a schema. */
export const MAX_FEEDBACK_MEASUREMENTS_BYTES = 16 * 1024;

/**
 * The image types the server accepts. `image/svg+xml` is absent there because
 * an SVG is a document that can carry script, and it is absent here for the
 * same reason: this app must not queue something a reviewer's browser would
 * refuse to open safely.
 */
export const ALLOWED_FEEDBACK_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The figures being disputed. Deliberately just this entry: no day around it, no diary. */
export interface FeedbackMeasurements {
  name: string;
  quantityGrams: number;
  loggedAt: string;
  source: string;
  aiEstimated: boolean;
  carbs: number | null;
  fiber: number | null;
  sugars: number | null;
  polyols: number | null;
  protein: number | null;
  fat: number | null;
  kcal: number | null;
}

/** The photograph as it sits in the queue and as it goes on the wire: base64, with its type. */
export interface FeedbackImagePayload {
  contentType: string;
  data: string;
}

/** One queued report. `idempotencyKey` is the row id, so a retry cannot become a second report. */
export interface FeedbackReportRecord {
  idempotencyKey: string;
  /** The diary entry this report is about. Local only; never sent. */
  logId: string;
  createdAt: number;
  status: 'pending' | 'sending' | 'failed' | 'blocked';
  attempts: number;
  nextAttemptAt: number;
  lastError: string;
  measurements: FeedbackMeasurements;
  consent: FeedbackConsentRecord;
  /** `null` is a legitimate report with no photograph, never an error. See `feedback-photo-export.ts`. */
  image: FeedbackImagePayload | null;
}

/** The JSON body, exactly as `decodeSubmission` reads it. */
export interface FeedbackWireBody {
  idempotencyKey: string;
  measurements: FeedbackMeasurements;
  consent: { agreedAt: string; wordingVersion: string };
  image: FeedbackImagePayload | null;
}

export function buildFeedbackWireBody(record: FeedbackReportRecord): FeedbackWireBody {
  return {
    idempotencyKey: record.idempotencyKey,
    measurements: record.measurements,
    consent: { agreedAt: record.consent.agreedAt, wordingVersion: record.consent.wordingVersion },
    image: record.image,
  };
}

/** Whether the figures fit the server's size bound. Checked before queueing, so nothing unsendable is queued. */
export function measurementsWithinBound(measurements: FeedbackMeasurements): boolean {
  return new TextEncoder().encode(JSON.stringify(measurements)).byteLength <= MAX_FEEDBACK_MEASUREMENTS_BYTES;
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2
    : data.endsWith('=') ? 1
    : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * Whether an image payload is one this server would store.
 *
 * An image that fails here is DROPPED from the report, never the reason the
 * report is dropped: the figures alone are still worth a reviewer's time, and
 * the row is flagged as having no image.
 */
export function imageWithinBounds(image: FeedbackImagePayload): boolean {
  if (!ALLOWED_FEEDBACK_IMAGE_TYPES.includes(image.contentType)) return false;
  const bytes = base64ByteLength(image.data);
  return bytes > 0 && bytes <= MAX_FEEDBACK_IMAGE_BYTES;
}

/**
 * What one attempt achieved.
 *
 *  - `sent`, the server stored it, OR already held it under this key. Both
 *    are successes and both remove the row: a duplicate answers `200` and a
 *    client that read that as a failure would retry forever against a server
 *    that will never change its answer.
 *  - `retry`, nothing was decided. Offline, a 5xx, a 401 the token refresh
 *    could not repair, a 429 that resets at midnight.
 *  - `blocked`, the server will never accept this body. A 400, a 413, or a
 *    404 from an instance whose operator has not switched the feature on.
 *    Kept, never silently dropped, so the person's report is not lost if the
 *    operator turns it on tomorrow.
 */
export type FeedbackAttemptOutcome = 'sent' | 'retry' | 'blocked';

/** Maps an HTTP status onto {@link FeedbackAttemptOutcome}. The one place a status code is interpreted. */
export function classifyFeedbackResponse(status: number): FeedbackAttemptOutcome {
  if (status === 200 || status === 201) return 'sent';
  if (status === 400 || status === 404 || status === 413) return 'blocked';
  return 'retry';
}

/** A thrown `fetch` is a network that dropped, never a verdict on the body. */
export function classifyFeedbackFailure(): FeedbackAttemptOutcome {
  return 'retry';
}

/** The one entry a report is about, as this app reads it off a diary row. */
export interface FeedbackMeasurementsInput {
  name: string;
  quantityGrams: number;
  /** Epoch-ms the entry is logged against. */
  loggedAt: number;
  source: string;
  aiEstimated: boolean;
  macros: {
    carbs: number | null;
    fiber: number | null;
    sugars: number | null;
    polyols: number | null;
    protein: number | null;
    fat: number | null;
    kcal: number | null;
  };
}

/**
 * The figures, and NOTHING AROUND THEM.
 *
 * The field list is exhaustive on purpose, and it is the client half of the
 * server's own prohibition: no diary content, no day totals, no sibling
 * entries from the same scan, no device identifier. "While we are sending this
 * entry we may as well send the day around it" is the pressure this explicit
 * list exists to meet.
 */
export function buildFeedbackMeasurements(input: FeedbackMeasurementsInput): FeedbackMeasurements {
  return {
    name: input.name,
    quantityGrams: input.quantityGrams,
    loggedAt: new Date(input.loggedAt).toISOString(),
    source: input.source,
    aiEstimated: input.aiEstimated,
    carbs: input.macros.carbs,
    fiber: input.macros.fiber,
    sugars: input.macros.sugars,
    polyols: input.macros.polyols,
    protein: input.macros.protein,
    fat: input.macros.fat,
    kcal: input.macros.kcal,
  };
}
