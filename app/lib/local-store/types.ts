/**
 * Shared shapes for the TinyBase local-first layer. Pure types only — this
 * module has no runtime dependencies (every import is `import type`), so the
 * pure logic modules (`outbox-machine`, `eviction`) that consume it stay
 * trivially unit-testable without a browser or a TinyBase store.
 */
import type { MealType } from '#types/enums';
import type { Macros } from '#app/lib/macros';

/** Which add-action intent an outbox record replays (`_intent` on the POST). */
export type OutboxIntent = 'log' | 'manual';

/**
 * Lifecycle of a queued write:
 * - `pending`  — enqueued, waiting for the next flush.
 * - `syncing`  — a flush attempt is in flight.
 * - `failed`   — a transient failure; retried after `nextAttemptAt` (backoff).
 * - `blocked`  — a permanent rejection or exhausted retries; kept, never dropped.
 */
export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'blocked';

/** The provisional-entry fields the diary renders for a not-yet-synced log. */
export interface PendingLogDisplay {
  name: string;
  quantityGrams: number;
  mealType: MealType | null;
  /** Per-serving snapshot (already scaled from per-100g) for an honest preview. */
  macros: Macros;
  aiEstimated: boolean;
  curatedSource: string | null;
}

/**
 * One queued offline write. `clientId` is a client-generated UUID that doubles
 * as the store rowId and the server-side idempotency key, so replaying the same
 * record is exactly-once. `payload` is the verbatim string field-set POSTed to
 * the existing `/add` action; `display` powers the provisional diary card.
 */
export interface OutboxRecord {
  clientId: string;
  intent: OutboxIntent;
  /** Local calendar day (`YYYY-MM-DD`) the entry belongs to, for diary placement. */
  dayKey: string;
  /** Monotonic enqueue order — the flush replays strictly ascending. */
  sequence: number;
  createdAt: number;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which a `failed` record is not retried; 0 = ready now. */
  nextAttemptAt: number;
  /** Last failure reason (never a secret); '' when none. */
  lastError: string;
  payload: Record<string, string>;
  display: PendingLogDisplay;
}

/** The diary-facing view of an outbox record (drops the replay `payload`). */
export interface PendingLogEntry extends PendingLogDisplay {
  clientId: string;
  status: OutboxStatus;
  createdAt: number;
}

/** Input to `enqueueLogIntent` — everything but the assigned `sequence`/`createdAt`. */
export interface EnqueueLogInput {
  intent: OutboxIntent;
  clientId: string;
  dayKey: string;
  payload: Record<string, string>;
  display: PendingLogDisplay;
}

/** What a flush attempt should trigger in the UI after it settles. */
export type FlushSurface = 'none' | 'reauth' | 'blocked';

/** Classification of a single flush attempt against the add action. */
export type FlushOutcome = 'success' | 'retry' | 'authStop' | 'fatal';

/** The subset of a `fetch` `Response` the flush state machine reasons about. */
export interface FlushResponse {
  ok: boolean;
  redirected: boolean;
  url: string;
}

/** Summary of a whole flush run. */
export interface FlushResult {
  /** Records confirmed and removed this run. */
  flushed: number;
  /** True when the loop stopped early (retry/auth/blocked) rather than draining. */
  stopped: boolean;
  surface: FlushSurface;
  /** Records still queued after the run. */
  remaining: number;
  /**
   * The earliest `nextAttemptAt` among any `failed` records left queued after
   * this run, or `null` when nothing needs a scheduled retry (drained, or
   * every remaining record is `blocked`/`pending`-behind-an-auth-stop). Lets a
   * caller (e.g. `OutboxSyncController`) schedule the next automatic flush
   * instead of waiting indefinitely for the next online/focus event.
   */
  nextRetryAt: number | null;
}
