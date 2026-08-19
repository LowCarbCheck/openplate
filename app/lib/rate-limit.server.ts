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
 * Records one hit for `key` and throws `RateLimitExceededError` if it has
 * exceeded `options.max` hits within the current `options.windowMs` window.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
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
