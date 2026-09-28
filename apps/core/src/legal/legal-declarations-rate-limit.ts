/**
 * A per-IP sliding-window burst limit on `POST /v1/legal/declarations`.
 *
 * KEYED ON THE IP, NOT AN ACCOUNT, because the route is deliberately
 * unauthenticated: both statutes require the button to work for a person who
 * has never logged in. The window, the sweep and the `Retry-After` arithmetic
 * are `lib/ip-rate-limit.ts`, shared with the public price list; what this
 * module owns is the refusal code a client reads, which stays
 * `declaration-rate-limited`.
 */
import type { RequestHandler } from 'express';
import { createIpRateLimit } from '../lib/ip-rate-limit.js';

/** The `429` body's code. Its own, so a client can tell this door from any other that shares the limiter. */
export const LEGAL_DECLARATIONS_RATE_LIMITED = 'declaration-rate-limited';

export interface CreateLegalDeclarationsRateLimitOptions {
  /** Requests allowed per IP in any trailing 60-second window. */
  perMinute: number;
  /** Injectable clock so tests do not sleep. Defaults to `Date.now`. */
  now?: () => number;
}

export function createLegalDeclarationsRateLimit(options: CreateLegalDeclarationsRateLimitOptions): RequestHandler {
  return createIpRateLimit({
    perMinute: options.perMinute,
    refusal: LEGAL_DECLARATIONS_RATE_LIMITED,
    now: options.now,
  });
}
