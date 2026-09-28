import type { Route } from './+types/api.food-proposals';
import { z } from 'zod';

import { CONFIG } from '#app/config';
import { foodProposalsRateLimitKey } from '#app/lib/food-proposals-rate-limit.server';
import { checkRateLimit, RateLimitExceededError } from '#app/lib/rate-limit.server';
import { parseFoodProposalBatch } from '#app/services/food-db/proposals';
import { forwardFoodProposals } from '#app/services/food-db/proposals.server';

/**
 * Resource route: relays food proposals to LowCarbCheck (M251 spec 04).
 *
 * The page posts `{ proposals: FoodProposal[] }` after a save; this server
 * re-parses every item, drops the ones LowCarbCheck would refuse, rebuilds
 * the rest key by key and forwards at most 20 with the instance key (see
 * `#app/services/food-db/proposals` for the wire shape and
 * `proposals.server.ts` for the relay).
 *
 * OFF MEANS NOTHING LEAVES. With backfill off (`CONFIG.foodDb.backfill`, which
 * also needs the URL and the key) the route answers 404 and reads nothing,
 * whatever the page thinks. The page learns the same fact from the root
 * loader and does not post at all.
 *
 * SILENT TOWARD THE PERSON. Every answer the page can get is a status with no
 * body worth reading, and the page ignores it: a proposal never delays or
 * fails a log. The rate limit has the `/api/food-matches` shape, one bucket per
 * address, because the upstream allowance is the instance's and is shared.
 */

/** A generous window: one confirm posts one request. */
const RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000;
/** Thirty confirms in three minutes is far past a person logging meals. */
const RATE_LIMIT_MAX_REQUESTS = 30;

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const { backfill, apiUrl, apiKey } = CONFIG.foodDb;
  if (!backfill) return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  try {
    checkRateLimit(foodProposalsRateLimitKey(request), { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS });
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    return new Response(null, { status: 429 });
  }

  let body: z.infer<ReturnType<typeof z.json>>;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const proposals = parseFoodProposalBatch(body);
  if (proposals.length === 0) return new Response(null, { status: 400 });

  // Awaited rather than fired and forgotten, so the retry happens inside the
  // request the page is already not waiting for, and a test can read the
  // outcome off the upstream.
  await forwardFoodProposals({ proposals, apiUrl, apiKey });
  return new Response(null, { status: 202 });
}
