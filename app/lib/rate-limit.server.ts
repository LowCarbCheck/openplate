/**
 * In-memory fixed-window rate limiter. Single-process only (no Redis) —
 * good enough for a single-container deployment; limits reset on restart
 * and are not shared across replicas. If this app ever runs multiple
 * replicas, replace the in-memory `Map` with a shared store.
 */

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
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
 * Bucket count above which a hit also drops every window that has already
 * expired.
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

/** Drops every bucket whose window has already elapsed. */
function sweepExpired(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt >= windowMs) buckets.delete(key);
  }
}

/**
 * Records one hit for `key` and throws `RateLimitExceededError` if it has
 * exceeded `options.max` hits within the current `options.windowMs` window.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  if (buckets.size > SWEEP_THRESHOLD) sweepExpired(now, options.windowMs);
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= options.windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
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
