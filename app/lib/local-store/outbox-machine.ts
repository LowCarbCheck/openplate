/**
 * The outbox flush state machine — pure, browser-free, and the unit-tested
 * heart of reconnect sync. It classifies a single flush attempt, computes retry
 * backoff, orders the queue, and folds an attempt's outcome into the next record
 * state. All I/O (the actual `fetch`, the store writes) lives in `outbox.ts`;
 * this module never touches either, so its behaviour is fully testable by
 * feeding it plain records and response shapes.
 */
import type { FlushOutcome, FlushResponse, FlushSurface, OutboxRecord } from './types';

/** After this many failed attempts a record is parked as `blocked` (never dropped). */
export const MAX_FLUSH_ATTEMPTS = 8;
/** First retry delay; each subsequent attempt doubles it up to the cap. */
export const BASE_BACKOFF_MS = 5_000;
/** Ceiling on the exponential backoff so a long-parked record still retries hourly-ish. */
export const MAX_BACKOFF_MS = 5 * 60_000;
/** A followed redirect landing here means the session expired mid-flush. */
export const LOGIN_PATH = '/login';

/**
 * Classifies a followed-redirect flush response. The add action `throw redirect`s
 * to `/diary` on success and the `_auth` middleware `throw redirect`s to `/login`
 * when the session is gone — so the final URL distinguishes success from an auth
 * stop. A 2xx with no redirect means the action re-rendered with a validation
 * error (a permanently-bad payload); a non-ok status is transient.
 */
export function classifyFlushResponse(response: FlushResponse): FlushOutcome {
  if (response.redirected && response.url.includes(LOGIN_PATH)) return 'authStop';
  if (response.redirected && response.ok) return 'success';
  if (response.ok) return 'fatal';
  return 'retry';
}

/** A thrown `fetch` (network dropped mid-flush) is always transient. */
export function classifyFlushFailure(): FlushOutcome {
  return 'retry';
}

/** Exponential backoff (ms) for the given attempt count, capped. `attempts` is 1-based. */
export function computeBackoffMs(attempts: number): number {
  const raw = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(raw, MAX_BACKOFF_MS);
}

/**
 * The records eligible to flush right now, in strict enqueue order. `blocked`
 * records are excluded entirely (never auto-retried — see `applyFlushOutcome`).
 * Among the rest, selection STOPS at the first record whose backoff window
 * hasn't elapsed yet: a later-sequence record is never selected while an
 * earlier one is still parked, even across separate flush invocations —
 * `flushOutbox`'s own within-run stop-on-first-failure only protects a SINGLE
 * run; without this prefix-stop here, a fresh run (a new `flushOutboxOnce()`
 * call after the earlier record's own run already parked it) would happily
 * select a later-sequence ready record and flush it ahead of the still-backed-
 * off earlier one, violating the module's strict-ascending-replay invariant.
 */
export function selectFlushableRecords(records: readonly OutboxRecord[], nowMs: number): OutboxRecord[] {
  const ordered = records
    .filter((record) => record.status !== 'blocked')
    .toSorted((a, b) => a.sequence - b.sequence);

  const selected: OutboxRecord[] = [];
  for (const record of ordered) {
    if (record.nextAttemptAt > nowMs) break;
    selected.push(record);
  }
  return selected;
}

/** The next-state decision for one flushed record. */
export interface FlushTransition {
  /** Remove the record — it was confirmed (or idempotently already present). */
  remove: boolean;
  /** The updated record when it is kept; null when removed. */
  record: OutboxRecord | null;
  /** Stop the whole flush loop after this record (preserves strict ordering). */
  stop: boolean;
  surface: FlushSurface;
}

/**
 * Folds a single attempt's outcome into the next record state. A success is
 * removed and the loop continues; every other outcome stops the loop so a later
 * record can never sync ahead of an earlier failed one. A transient failure
 * backs the record off (and blocks it once retries are exhausted); an auth stop
 * keeps the record pending and surfaces a re-login prompt; a fatal rejection
 * parks the record as blocked — always kept, never silently dropped.
 */
export function applyFlushOutcome({
  record,
  outcome,
  nowMs,
}: {
  record: OutboxRecord;
  outcome: FlushOutcome;
  nowMs: number;
}): FlushTransition {
  if (outcome === 'success') {
    return { remove: true, record: null, stop: false, surface: 'none' };
  }
  if (outcome === 'authStop') {
    return { remove: false, record: { ...record, status: 'pending' }, stop: true, surface: 'reauth' };
  }
  if (outcome === 'fatal') {
    return {
      remove: false,
      record: { ...record, status: 'blocked', lastError: 'rejected' },
      stop: true,
      surface: 'blocked',
    };
  }
  const attempts = record.attempts + 1;
  if (attempts >= MAX_FLUSH_ATTEMPTS) {
    return {
      remove: false,
      record: { ...record, status: 'blocked', attempts, lastError: 'max-retries' },
      stop: true,
      surface: 'blocked',
    };
  }
  return {
    remove: false,
    record: {
      ...record,
      status: 'failed',
      attempts,
      nextAttemptAt: nowMs + computeBackoffMs(attempts),
      lastError: 'retry',
    },
    stop: true,
    surface: 'none',
  };
}
