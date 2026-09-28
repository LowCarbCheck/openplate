/**
 * In-memory fixed-window rate limiter. Single-process only (no Redis) —
 * good enough for a single-container deployment; limits reset on restart
 * and are not shared across replicas. If this app ever runs multiple
 * replicas, replace the in-memory `Map` with a shared store.
 */

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
  /**
   * The window this bucket was opened under, carried on the bucket itself.
   *
   * WHY IT IS STORED RATHER THAN PASSED: the sweep below runs on whichever
   * caller happens to trip the threshold, and different callers can use very
   * different windows. Judging every bucket by the SWEEPING caller's window
   * meant a one-minute limiter could evict a one-hour limiter's live buckets
   * — silently resetting a limit that had not elapsed, i.e. handing an
   * over-limit client a fresh allowance. A bucket is only ever compared
   * against its own window now.
   */
  windowMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export class RateLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Bucket count above which a hit may also drop every window that has already
 * expired — "may", because `lastSweptAt` below caps that to once per window.
 *
 * WHY A SWEEP AT ALL: the map is keyed by client IP and nothing ever removed
 * an entry, so a process that has been up for a month held one small object
 * per IP that ever hit a limited endpoint, forever — a slow leak that only
 * shows up on a long-lived container. A public, unauthenticated endpoint (the
 * newsletter proxy) makes that reachable by anyone, which is what turned it
 * from untidy into worth fixing.
 *
 * WHY NOT A TIMER: a `setInterval` in a module holds the event loop open, has
 * to be unref'd, and runs in every unit test that imports this file. Sweeping
 * opportunistically on a hit costs nothing until the map is actually large,
 * and an idle process has no garbage worth collecting by definition.
 */
const SWEEP_THRESHOLD = 1000;

/**
 * When the last sweep ran, so a map that stays above the threshold is walked
 * once per window rather than once per request.
 *
 * WHY: the threshold is a size, not a rate. Once the map is genuinely large —
 * which is exactly the flood the sweep exists for — EVERY subsequent hit paid
 * a full O(n) walk of a map that the previous hit had just cleaned, turning a
 * memory guard into a per-request cost under precisely the load that must stay
 * cheap. Nothing expires in the microseconds between two requests anyway.
 *
 * `0` means "never swept", and `now - 0` clears any real window, so the first
 * hit past the threshold sweeps immediately.
 */
let lastSweptAt = 0;

/** Drops every bucket whose OWN window has already elapsed. */
function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt >= bucket.windowMs) buckets.delete(key);
  }
}

/**
 * Sweeps at most once per `windowMs`, and only while the map is large enough
 * to be worth walking.
 */
function maybeSweep(now: number, windowMs: number): void {
  if (buckets.size <= SWEEP_THRESHOLD) return;
  if (now - lastSweptAt < windowMs) return;
  lastSweptAt = now;
  sweepExpired(now);
}

/**
 * Records one hit for `key` and throws `RateLimitExceededError` if it has
 * exceeded `options.max` hits within the current `options.windowMs` window.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  maybeSweep(now, options.windowMs);
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= options.windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now, windowMs: options.windowMs });
    return;
  }

  if (existing.count >= options.max) {
    const retryAfterMs = options.windowMs - (now - existing.windowStartedAt);
    throw new RateLimitExceededError(retryAfterMs);
  }

  existing.count += 1;
}

/**
 * Forgets `key`'s window entirely, so its very next hit starts a fresh one.
 * A no-op for a key that has no bucket.
 *
 * Exists because every bucket in this process is shared module state: with
 * accounts gone (M128 spec 03) the only caller left keys by client IP, which
 * collapses to a single bucket for every request that arrives without a
 * trusted proxy hop — including every constructed `Request` in the unit
 * suite. Tests use this to start each case from a known-empty window rather
 * than inheriting the previous case's count.
 */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * How many buckets are currently held. TEST SEAM, and nothing in the app calls
 * it.
 *
 * Both properties worth asserting about the sweep — that it drops what has
 * expired, and that it does NOT run again inside the same window — are
 * properties of the map's SIZE, which is otherwise module-private. The
 * alternative was to assert them indirectly through limit outcomes, which
 * cannot distinguish "swept and rebuilt" from "never swept".
 */
export function rateLimitBucketCount(): number {
  return buckets.size;
}
