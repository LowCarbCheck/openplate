/**
 * A per-IP sliding-window burst limit for an unauthenticated route.
 *
 * KEYED ON THE IP, NOT AN ACCOUNT, because the routes it guards have no
 * account to key on: the statutory declarations work for a person who never
 * logged in (`server/legal-declarations.ts`), and the public price list is read
 * before anybody has one (`server/plans-proxy.ts`). `ai/rate-limit.ts` keys on
 * the resolved account for exactly the opposite reason; this module is that
 * one's shape, with the identity swapped for the one thing an anonymous caller
 * has.
 *
 * SLIDING WINDOW, NOT FIXED WINDOWS, for the reason `ai/rate-limit.ts` gives:
 * a fixed window lets a caller spend two windows' worth of budget either side
 * of the boundary. Keeping timestamps and counting only the ones inside the
 * trailing window costs a short array per IP and has no such seam.
 *
 * ONE REFUSAL CODE PER ROUTE, named by the caller, so a client that meets a
 * `429` can tell which door refused it, and so a route's code never changes
 * because another route started sharing this module.
 *
 * AN IPv6 CALLER IS ONE /64, NOT ONE ADDRESS (2026-09-30). A home router or a
 * phone carrier hands one subscriber a whole /64, and every address in it is
 * theirs to use, so a limit keyed on the full address is a limit of 2^64
 * buckets for anybody with IPv6. An IPv4-mapped address (`::ffff:a.b.c.d`,
 * which a dual-stack socket reports for an IPv4 peer) is the IPv4 address it
 * carries, so one caller cannot hold two buckets by switching stacks. The fold
 * is `lib/client-address.ts`, shared with the sign-in throttles, so the two
 * kinds of limit count a caller the same way.
 *
 * IN-MEMORY AND SINGLE-PROCESS, deliberately, exactly as `ai/rate-limit.ts`
 * and `lib/throttle.ts` both are: one container, no Redis in a self-hoster's
 * compose file. The state resets on restart, which is the same real and
 * documented limitation every other in-memory limiter here carries.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { clientAddressKey } from './client-address.js';

const WINDOW_MS = 60_000;

/** Amortised across requests rather than a `setInterval`, for the reason `ai/rate-limit.ts` gives: no handle to keep alive, no clock to inject twice. */
const SWEEP_INTERVAL_MS = WINDOW_MS;

export interface CreateIpRateLimitOptions {
  /** Requests allowed per IP in any trailing 60-second window. */
  perMinute: number;
  /** The machine code of the `429` body, in the `{"error": "..."}` envelope PROTOCOL.md §4 promises. */
  refusal: string;
  /** Injectable clock so tests do not sleep. Defaults to `Date.now`. */
  now?: () => number;
}

/** Drops timestamps that have fallen out of the trailing window. Mutates in place, because this is the hot path. */
function pruneExpired(timestamps: number[], windowStartMs: number): void {
  let firstLive = 0;
  while (firstLive < timestamps.length && (timestamps[firstLive] ?? 0) <= windowStartMs) {
    firstLive += 1;
  }
  if (firstLive > 0) timestamps.splice(0, firstLive);
}

/** Seconds until the oldest in-window request ages out. Floored at 1, so a `Retry-After: 0` never invites an immediate retry that is guaranteed to fail again. */
function secondsUntilSlotFrees(input: { oldestMs: number; currentMs: number }): number {
  return Math.max(1, Math.ceil((input.oldestMs + WINDOW_MS - input.currentMs) / 1000));
}

export function createIpRateLimit(options: CreateIpRateLimitOptions): RequestHandler {
  const limit = options.perMinute;
  const now = options.now ?? ((): number => Date.now());
  /** Caller key (an IPv4 address or an IPv6 /64) -> timestamps of its in-window requests, oldest first. */
  const windows = new Map<string, number[]>();
  let lastSweepMs = now();

  /** Bounded memory: the map's size tracks ACTIVE IPs rather than every IP that has ever called, exactly as `ai/rate-limit.ts` argues. */
  function sweep(currentMs: number): void {
    if (currentMs - lastSweepMs < SWEEP_INTERVAL_MS) return;
    lastSweepMs = currentMs;
    const windowStartMs = currentMs - WINDOW_MS;
    for (const [key, timestamps] of windows) {
      pruneExpired(timestamps, windowStartMs);
      if (timestamps.length === 0) windows.delete(key);
    }
  }

  return function enforceIpRateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = clientAddressKey(req);
    const currentMs = now();
    sweep(currentMs);

    const windowStartMs = currentMs - WINDOW_MS;
    const timestamps = windows.get(key) ?? [];
    pruneExpired(timestamps, windowStartMs);

    if (timestamps.length >= limit) {
      const oldestMs = timestamps[0] ?? currentMs;
      windows.set(key, timestamps);
      const retryAfterSeconds = secondsUntilSlotFrees({ oldestMs, currentMs });
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: options.refusal });
      return;
    }

    timestamps.push(currentMs);
    windows.set(key, timestamps);
    next();
  };
}
