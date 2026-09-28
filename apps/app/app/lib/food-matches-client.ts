/**
 * Client-safe caller for the `/api/food-matches` resource route (M117/02) —
 * resolves free-text food NAMES against the curated LowCarbCheck catalog
 * without the browser ever holding the LCC API config (`CONFIG.foodDb`,
 * server-only). Shared by `scan.tsx`'s confirm-draft matching and `add.tsx`'s
 * search-step curated results (M117/03) — one client entry point for the same
 * server-proxied lookup.
 *
 * FAIL OPEN, always: any network/parse failure yields an empty match list per
 * name (and `throttled: false`), mirroring `resolveIdentifiedFoods`'s own
 * contract — a curated suggestion is an enrichment, never a dependency.
 *
 * M123/06 (review fix): the route distinguishes a genuine "no matches" from a
 * rate-limited caller via `throttled`/`retryAfterMs` on its response body
 * (`FoodMatchesThrottledResponseBody` in `app/routes/api.food-matches.ts`).
 * Previously this client read only `payload.matches` and silently discarded
 * that signal, so a throttled caller was indistinguishable from a genuine
 * empty result and the UI rendered a false "No matches for ... Add it
 * manually below." `fetchFoodMatches` now returns the full
 * `FoodMatchesResult` (matches + throttled + retryAfterMs) so a caller can
 * render an honest "try again shortly" instead of a false no-match message.
 */
import { z } from 'zod';
import type { FoodMatch } from '#app/services/food-resolution';
import { FOOD_DB_STATUS_UNKNOWN, foodDbStatusWireSchema, parseFoodDbStatus } from '#app/services/food-db/wire';
import type { FoodDbStatus } from '#app/services/food-db/wire';

/**
 * The client's return shape. `throttled` always resolves to a concrete
 * boolean (never absent) so callers don't need to special-case "the field
 * was missing from the response" vs "explicitly false" — every return path
 * below, including every fail-open branch, sets it explicitly.
 */
export interface FoodMatchesResult {
  /** One match list per input name, in the same order; fail-open to `[]` per name. */
  matches: FoodMatch[][];
  /**
   * True only when the caller hit the route's rate limiter (M123/05). MUST
   * NOT be rendered as "no matches" — see `retryAfterMs` for how long to
   * wait before retrying.
   */
  throttled: boolean;
  /** Milliseconds until the caller's rate-limit window resets. Present only when `throttled` is true. */
  retryAfterMs: number | null;
  /**
   * What the SERVER last saw from the upstream food database (M238 spec 02).
   *
   * Always a concrete object, never absent, for the reason `throttled` is
   * always a concrete boolean: a caller must not have to tell "the field was
   * missing" from "it said ok". Every fail-open branch below reports
   * `FOOD_DB_STATUS_UNKNOWN`, which is `ok: true` and therefore renders
   * nothing, a failure to reach OUR OWN server says nothing about the food
   * database, and inventing a warning from it would put an "unavailable" line
   * under a page that is merely offline.
   */
  foodDb: FoodDbStatus;
}

const NOT_THROTTLED = { throttled: false, retryAfterMs: null } as const;

/**
 * Every field a branch that never heard from the server has to fill.
 *
 * One constant rather than three spreads, so a new field on
 * `FoodMatchesResult` is added here once and the compiler finds the branches
 * that still need it.
 */
const NOTHING_HEARD = { ...NOT_THROTTLED, foodDb: FOOD_DB_STATUS_UNKNOWN } as const;

/**
 * The route's JSON body, read without trusting it — the server contract can
 * drift independently of this client. Only the envelope is validated here; the
 * match objects inside are the route's own owned type and are passed through.
 */
const foodMatchesBodySchema = z.object({
  matches: z.array(z.array(z.custom<FoodMatch>())).optional(),
  throttled: z.boolean().optional(),
  retryAfterMs: z.number().optional(),
  // Optional, because an OLDER server does not send it at all. See
  // `foodDbStatusWireSchema` for why `reason` is read as a plain string.
  foodDb: foodDbStatusWireSchema.optional(),
});

/**
 * @param names - the food names to resolve, at most `MAX_NAMES_PER_REQUEST`
 *   (server-enforced) worth — an empty array short-circuits with no request.
 * @returns matches parallel to `names` by index, plus the caller's throttle
 *   status; fail-open (`throttled: false`, empty matches) on any
 *   network/parse failure — see the module doc comment.
 */
export async function fetchFoodMatches(names: string[]): Promise<FoodMatchesResult> {
  if (names.length === 0) return { matches: [], ...NOTHING_HEARD };

  try {
    const response = await fetch('/api/food-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    });
    if (!response.ok) return { matches: names.map(() => []), ...NOTHING_HEARD };

    const parsed = foodMatchesBodySchema.safeParse(await response.json());
    const payload = parsed.success ? parsed.data : {};
    const matches = payload.matches ?? names.map(() => []);
    // The server answered, so whatever it says about the food database is the
    // best this client will ever know. Read on BOTH remaining branches: a
    // throttled caller never reached the upstream, but the last refusal the
    // server saw is still true and still worth reporting.
    const foodDb = parseFoodDbStatus(payload.foodDb);
    if (payload.throttled !== true) return { matches, ...NOT_THROTTLED, foodDb };

    return { matches, throttled: true, retryAfterMs: payload.retryAfterMs ?? null, foodDb };
  } catch {
    return { matches: names.map(() => []), ...NOTHING_HEARD };
  }
}
