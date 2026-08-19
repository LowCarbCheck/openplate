/**
 * The write outbox: enqueue offline log intents and flush them in order on
 * reconnect. Each record carries a client-generated `clientId` (the store rowId
 * and the server idempotency key), so a replay is exactly-once — the server
 * dedupes on `(userId, clientId)`. The flush is the imperative shell around the
 * pure `outbox-machine`: this module owns the store I/O and the `fetch`, the
 * machine owns every decision.
 *
 * Records are stored as a single JSON cell per row, so a record is read/written
 * whole — no per-field cell juggling. The low-level `readOutboxRecords` /
 * `writeOutboxRecord` are exported for tests that drive `flushOutbox` against a
 * real in-memory store.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { getOutboxStore } from './persist';
import { OUTBOX_RECORD_CELL, OUTBOX_TABLE } from './store';
import {
  applyFlushOutcome,
  classifyFlushFailure,
  classifyFlushResponse,
  selectFlushableRecords,
} from './outbox-machine';
import type {
  EnqueueLogInput,
  FlushOutcome,
  FlushResponse,
  FlushResult,
  FlushSurface,
  OutboxRecord,
  PendingLogEntry,
} from './types';

/** The existing action endpoint a queued write replays against. */
const OUTBOX_ROUTE = '/add';

/** The queued-record cell as it comes back off the store — a TinyBase cell, not yet JSON text. */
const recordCellSchema = z.string();

/** Posts one record to the add action; the impure boundary the flush loop wraps. */
export type OutboxPoster = (record: OutboxRecord) => Promise<FlushResponse>;

// ---------------------------------------------------------------------------
// Record <-> row (de)serialization
// ---------------------------------------------------------------------------

export function writeOutboxRecord(store: Store, record: OutboxRecord): void {
  store.setRow(OUTBOX_TABLE, record.clientId, { [OUTBOX_RECORD_CELL]: JSON.stringify(record) });
}

function readOutboxRecord(store: Store, rowId: string): OutboxRecord | null {
  const raw = recordCellSchema.safeParse(store.getCell(OUTBOX_TABLE, rowId, OUTBOX_RECORD_CELL));
  if (!raw.success) return null;
  try {
    // SAFETY: this cell is written only by `writeOutboxRecord` above, which
    // stores `JSON.stringify(OutboxRecord)` — the parse of a value this module
    // alone produces. A malformed/foreign value throws and is caught.
    return JSON.parse(raw.data) as OutboxRecord;
  } catch {
    return null;
  }
}

export function readOutboxRecords(store: Store): OutboxRecord[] {
  return store
    .getRowIds(OUTBOX_TABLE)
    .map((rowId) => readOutboxRecord(store, rowId))
    .filter((record): record is OutboxRecord => record !== null);
}

function nextSequence(store: Store): number {
  return readOutboxRecords(store).reduce((max, record) => Math.max(max, record.sequence), 0) + 1;
}

// ---------------------------------------------------------------------------
// Enqueue + read
// ---------------------------------------------------------------------------

/** Queues an offline log intent; returns the persisted record. */
export async function enqueueLogIntent(input: EnqueueLogInput): Promise<OutboxRecord> {
  const store = await getOutboxStore();
  const record: OutboxRecord = {
    clientId: input.clientId,
    intent: input.intent,
    dayKey: input.dayKey,
    sequence: nextSequence(store),
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: '',
    payload: input.payload,
    display: input.display,
  };
  writeOutboxRecord(store, record);
  return record;
}

function recordToPendingEntry(record: OutboxRecord): PendingLogEntry {
  return { clientId: record.clientId, status: record.status, createdAt: record.createdAt, ...record.display };
}

/**
 * The not-yet-synced entries for a given day, oldest first. `excludeClientIds`
 * drops any the server already holds (so a synced entry isn't double-shown while
 * its outbox record is briefly still around before flush cleanup).
 */
export async function pendingEntriesForDate({
  date,
  excludeClientIds = [],
}: {
  date: string;
  excludeClientIds?: Iterable<string>;
}): Promise<PendingLogEntry[]> {
  const store = await getOutboxStore();
  const exclude = new Set(excludeClientIds);
  return readOutboxRecords(store)
    .filter((record) => record.dayKey === date && !exclude.has(record.clientId))
    .toSorted((a, b) => a.sequence - b.sequence)
    .map(recordToPendingEntry);
}

/** Every queued record, for diagnostics/tests. */
export async function listOutboxRecords(): Promise<OutboxRecord[]> {
  return readOutboxRecords(await getOutboxStore());
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/** Builds a form body from a record and POSTs it to the add action. */
async function postRecordToAddAction(record: OutboxRecord): Promise<FlushResponse> {
  const body = new FormData();
  for (const [key, value] of Object.entries(record.payload)) body.append(key, value);
  body.set('clientId', record.clientId);
  const response = await fetch(OUTBOX_ROUTE, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    redirect: 'follow',
  });
  return { ok: response.ok, redirected: response.redirected, url: response.url };
}

/**
 * Flushes the outbox in strict order. Each ready record is POSTed to the add
 * action; a success is removed and the loop continues, any other outcome stops
 * the loop (so a later write never syncs ahead of an earlier failed one). The
 * store, poster, and clock are injectable for tests.
 */
export async function flushOutbox(
  options: { store?: Store; post?: OutboxPoster; now?: () => number } = {},
): Promise<FlushResult> {
  const store = options.store ?? (await getOutboxStore());
  const post = options.post ?? postRecordToAddAction;
  const now = options.now ?? Date.now;

  const ordered = selectFlushableRecords(readOutboxRecords(store), now());
  let flushed = 0;
  let stopped = false;
  let surface: FlushSurface = 'none';

  for (const record of ordered) {
    writeOutboxRecord(store, { ...record, status: 'syncing' });

    let outcome: FlushOutcome;
    try {
      outcome = classifyFlushResponse(await post(record));
    } catch {
      outcome = classifyFlushFailure();
    }

    const transition = applyFlushOutcome({ record, outcome, nowMs: now() });
    if (transition.remove) {
      store.delRow(OUTBOX_TABLE, record.clientId);
      flushed += 1;
    } else if (transition.record) {
      writeOutboxRecord(store, transition.record);
    }
    if (transition.surface !== 'none') surface = transition.surface;
    if (transition.stop) {
      stopped = true;
      break;
    }
  }

  return {
    flushed,
    stopped,
    surface,
    remaining: store.getRowCount(OUTBOX_TABLE),
    nextRetryAt: earliestFailedRetryAt(readOutboxRecords(store)),
  };
}

/** The earliest `nextAttemptAt` among `failed` records, or null when none are waiting on a timer. */
function earliestFailedRetryAt(records: readonly OutboxRecord[]): number | null {
  const failedAt = records.filter((record) => record.status === 'failed').map((record) => record.nextAttemptAt);
  return failedAt.length === 0 ? null : Math.min(...failedAt);
}

/**
 * Single-flight wrapper over the default-store flush, so the reconnect triggers
 * (app start + `online` + `focus`) firing in quick succession share one run
 * instead of racing.
 */
let defaultFlight: Promise<FlushResult> | null = null;
export function flushOutboxOnce(): Promise<FlushResult> {
  if (!defaultFlight) {
    defaultFlight = flushOutbox().finally(() => {
      defaultFlight = null;
    });
  }
  return defaultFlight;
}
