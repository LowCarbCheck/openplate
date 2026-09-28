/**
 * Per-key token-bucket rate limit.
 *
 * WHY PER KEY AND NOT PER IP. Every request here costs seconds of a GPU or tens
 * of seconds of a CPU, and API-key auth on its own lets one key starve every
 * other tenant on the box. The bucket is keyed on the key fingerprint, so the
 * unit of fairness is the tenant, not the NAT they happen to sit behind.
 *
 * Continuous refill rather than fixed windows: a fixed window lets a caller spend
 * a whole minute's budget in the last second of one window and again in the first
 * second of the next, which is exactly the burst a compute-bound service cannot
 * absorb.
 *
 * In-memory, single-process. That is honest for this service's shape (one
 * container in front of one model runtime) and it means no Redis in a
 * self-hoster's compose file. Horizontal scaling would need a shared store — and
 * would need the admission controller rethought first, so this is not the
 * limiting factor.
 */
import { tooManyRequests } from '../errors.js';

const MILLISECONDS_PER_MINUTE = 60_000;

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimiter {
  /** Consumes one token. Throws `ApiError` (429, with `Retry-After`) when empty. */
  consume(keyId: string): void;
}

export interface CreateRateLimiterOptions {
  requestsPerMinute: number;
  /** Injectable clock so the tests do not sleep. */
  now?: () => number;
}

export function createRateLimiter(options: CreateRateLimiterOptions): RateLimiter {
  const capacity = options.requestsPerMinute;
  const refillPerMs = capacity / MILLISECONDS_PER_MINUTE;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return {
    consume(keyId: string): void {
      const currentMs = now();
      const bucket = buckets.get(keyId) ?? { tokens: capacity, lastRefillMs: currentMs };
      const elapsedMs = Math.max(0, currentMs - bucket.lastRefillMs);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedMs * refillPerMs);
      bucket.lastRefillMs = currentMs;

      if (bucket.tokens < 1) {
        const waitMs = (1 - bucket.tokens) / refillPerMs;
        buckets.set(keyId, bucket);
        throw tooManyRequests(
          `Rate limit reached: ${capacity} requests per minute for this API key.`,
          Math.max(1, Math.ceil(waitMs / 1000)),
        );
      }

      bucket.tokens -= 1;
      buckets.set(keyId, bucket);
    },
  };
}
