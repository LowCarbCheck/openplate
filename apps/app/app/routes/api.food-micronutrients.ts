import type { Route } from './+types/api.food-micronutrients';
import { z } from 'zod';

import { CONFIG } from '#app/config';
import { resolveRequestLanguage } from '#app/i18n/language-prefs';
import { DailyCallLimitExceededError } from '#app/lib/food-db-daily-budget';
import { reserveFoodDbCalls } from '#app/lib/food-db-daily-budget.server';
import { foodMicronutrientsRateLimitKey } from '#app/lib/food-micronutrients-rate-limit.server';
import { refuseWithoutAccount } from '#app/lib/managed-account-gate.server';
import { checkRateLimit, RateLimitExceededError } from '#app/lib/rate-limit.server';
import { countUncachedSlugs, lookupFoodMicronutrients } from '#app/services/food-db/micronutrients.server';
import {
  parseRequestedSlugs,
  type FoodMicronutrientsResponseBody,
  type FoodMicronutrientsThrottledBody,
} from '#app/services/food-db/micronutrients-wire';

/**
 * Resource route: the vitamins and minerals of foods a device names BY SLUG
 * (the micronutrient backfill, 2026-10-13).
 *
 * The device posts `{ slugs }`, the LowCarbCheck slugs its old entries carry
 * with no block, and gets one answer per distinct slug: `filled`, `no-data`,
 * `not-found` or `unknown` (see `#app/services/food-db/micronutrients-wire`
 * for what each promises, and `micronutrients.server.ts` for the lookup).
 *
 * THE SAME THREE GUARDS AS `/api/food-matches`, because this spends the same
 * key, and in the same order, each answering before anything leaves for
 * LowCarbCheck:
 *
 * 1. ON A MANAGED INSTANCE, a live account token (`refuseWithoutAccount`):
 *    `401` without one, `503` when core cannot be asked.
 * 2. The per-address limiter, an IPv6 caller counted by its /64. Charged only
 *    when a slug needs an upstream call, so a device re-asking cached foods
 *    costs nothing.
 * 3. The server's daily cap (`FOOD_DB_DAILY_CALL_LIMIT`): the first call of
 *    every uncached slug is reserved up front, `429` when that would pass the
 *    cap. A later locale of the same slug reserves its own call, and a cap
 *    reached there answers that slug `unknown`.
 *
 * Both throttles answer `429` with `{ throttled, retryAfterMs }`. The device
 * reads every non-2xx answer as "nothing was asked" and records nothing.
 *
 * WITH NO FOOD DATABASE, `404` and nothing is read, the way
 * `/api/food-proposals` answers with backfill off: there is no catalogue to
 * ask, and the device stops for this session without counting an attempt.
 */

/** One device asks in batches of 20 and stops at the first throttle; thirty batches in three minutes is a 600-food history. */
const RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

/** HTTP 429, the status of both throttles. */
const TOO_MANY_REQUESTS = 429;

function throttled(retryAfterMs: number): Response {
  const body: FoodMicronutrientsThrottledBody = { throttled: true, retryAfterMs };
  return Response.json(body, { status: TOO_MANY_REQUESTS });
}

/** Reserves one locale call after a slug's first. Throws `DailyCallLimitExceededError` when the day is spent. */
function reserveExtraCall(): void {
  reserveFoodDbCalls(1);
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const { enabled, apiUrl, apiKey } = CONFIG.foodDb;
  if (!enabled) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  // FIRST, before the body is read: a caller this instance does not serve
  // costs nothing beyond this check.
  const refusal = await refuseWithoutAccount(request);
  if (refusal !== null) return refusal;

  let body: z.infer<ReturnType<typeof z.json>>;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const slugs = parseRequestedSlugs(body);
  if (slugs === null) return new Response(null, { status: 400 });

  const upstreamCalls = countUncachedSlugs({ slugs, apiUrl });
  if (upstreamCalls > 0) {
    try {
      checkRateLimit(foodMicronutrientsRateLimitKey(request), {
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX_REQUESTS,
      });
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) throw error;
      return throttled(error.retryAfterMs);
    }
    // AFTER the limiter, so a request it refuses reserves nothing.
    try {
      reserveFoodDbCalls(upstreamCalls);
    } catch (error) {
      if (!(error instanceof DailyCallLimitExceededError)) throw error;
      return throttled(error.retryAfterMs);
    }
  }

  const language = resolveRequestLanguage(request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);
  const results = await lookupFoodMicronutrients({ slugs, apiUrl, apiKey, language, reserveExtraCall });
  const success: FoodMicronutrientsResponseBody = { results };
  return Response.json(success);
}
