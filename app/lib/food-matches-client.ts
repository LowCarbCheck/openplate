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
}

const NOT_THROTTLED = { throttled: false, retryAfterMs: null } as const;

/**
 * The route's JSON body, read without trusting it — the server contract can
 * drift independently of this client. Only the envelope is validated here; the
 * match objects inside are the route's own owned type and are passed through.
 */
const foodMatchesBodySchema = z.object({
  matches: z.array(z.array(z.custom<FoodMatch>())).optional(),
  throttled: z.boolean().optional(),
  retryAfterMs: z.number().optional(),
});

/**
 * @param names - the food names to resolve, at most `MAX_NAMES_PER_REQUEST`
 *   (server-enforced) worth — an empty array short-circuits with no request.
 * @returns matches parallel to `names` by index, plus the caller's throttle
 *   status; fail-open (`throttled: false`, empty matches) on any
 *   network/parse failure — see the module doc comment.
 */
export async function fetchFoodMatches(names: string[]): Promise<FoodMatchesResult> {
  if (names.length === 0) return { matches: [], ...NOT_THROTTLED };

  try {
    const response = await fetch('/api/food-matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    });
    if (!response.ok) return { matches: names.map(() => []), ...NOT_THROTTLED };

    const parsed = foodMatchesBodySchema.safeParse(await response.json());
    const payload = parsed.success ? parsed.data : {};
    const matches = payload.matches ?? names.map(() => []);
    if (payload.throttled !== true) return { matches, ...NOT_THROTTLED };

    return { matches, throttled: true, retryAfterMs: payload.retryAfterMs ?? null };
  } catch {
    return { matches: names.map(() => []), ...NOT_THROTTLED };
  }
}
