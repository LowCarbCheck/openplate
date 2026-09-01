import { z } from 'zod';
import type { Route } from './+types/api.food-matches';
import { CONFIG } from '#app/config';
import { resolveRequestLanguage } from '#app/i18n/language-prefs';
import { foodMatchesRateLimitKey } from '#app/lib/food-matches-rate-limit.server';
import { allNamesCached, foodResolutionOptions, resolveIdentifiedFoods } from '#app/services/food-resolution';
import type { FoodMatch } from '#app/services/food-resolution';
import { checkRateLimit, RateLimitExceededError } from '#app/lib/rate-limit.server';

/**
 * Resource route: resolves plate-identified food NAMES against the curated
 * LowCarbCheck catalog (M117/02). The plate-identity vision call itself now
 * runs entirely browser -> provider (see `scan.tsx`'s `clientAction`) — the
 * photo and the BYOK key never transit this server. The LCC name lookup stays
 * server-proxied deliberately (see the spec's food-resolution note): the
 * openplate server never sees the photo or the key, only transient food
 * names, and this keeps the self-hoster `FOOD_DB_API_URL` opt-out/override
 * (`#app/config`) working without exposing it to the client bundle.
 *
 * The rate-limit bucket is keyed by the caller's IP, and only by that (M128
 * spec 03): there are no accounts, so there is no per-caller identifier to
 * bucket on. That makes the budget a SHARED resource in any IP-shared context
 * (office NAT, campus wifi, mobile carrier CGNAT) — unrelated people can
 * exhaust each other's window (M123/05). The cache-miss-only accounting below
 * is what keeps that tolerable.
 *
 * FAIL OPEN, always: `resolveIdentifiedFoods` itself never throws, and this
 * route never returns a non-2xx for a malformed/oversized request — it just
 * resolves fewer (or zero) names. A curated-match suggestion is an
 * enrichment, never a dependency of the confirm-draft flow.
 *
 * M123/05: a rate-limited caller must never be told "no matches" — that
 * message is reserved for a genuine, checked, empty result. The rate-limit
 * branch below returns a response shape distinguishable from the plain
 * `{ matches }` success shape (`throttled: true` + `retryAfterMs`), so the
 * client can render an honest "try again shortly" instead of a false
 * no-match. Every OTHER failure path here (malformed body) still can't know
 * how many names were intended — an empty array is the only honest response
 * when the request itself couldn't be parsed — so only the rate-limit branch
 * changes shape; the by-index-parallel-to-`names` contract on `matches`
 * documented on `resolveIdentifiedFoods` continues to hold for every
 * response that actually resolves names.
 *
 * LANGUAGE (M167 fix): the LCC lookup is searched in the CALLER'S UI
 * language, resolved from the same locale cookie `app/root.tsx` reads, with
 * `CONFIG.i18n.defaultLanguage` as the fallback. This is not cosmetic — LCC's
 * `locale` decides which rows exist for a query at all, so a German visitor
 * typing "Hähnchenbrust" got literally nothing back while the search was
 * pinned to `en`, taking `/add`'s own German suggestion chips down with it.
 * Both callers of this route benefit and neither regresses: `/add` sends
 * text the person typed in their own language, and `/scan` sends
 * model-produced (English-prompted) names, which LCC still matches under
 * `de` via the canonical name — and then returns with German titles, which
 * is what that person should be reading anyway.
 *
 * M123/07 (budget fix): the previous budget (20 requests / 10 minutes) was
 * sized for occasional lookups, not an interactive search-as-you-type box —
 * `add.tsx`'s search debounces at 250ms per settled keystroke pause, so a
 * single ordinary session (typos, refinements, several distinct foods)
 * routinely fires 20+ requests on its own, before any IP-sharing is even in
 * play. Two changes, both deliberate:
 *
 * 1. The raw budget is much larger (`RATE_LIMIT_MAX_REQUESTS`) and the
 *    window shorter (`RATE_LIMIT_WINDOW_MS`), so a legitimate session has
 *    generous headroom and an unlucky throttle recovers quickly. A
 *    continuously-refilling token bucket would smooth the edges further,
 *    but that's a bigger, riskier change to `rate-limit.server.ts` for a
 *    UX-only route; not worth it here.
 * 2. A request only counts against the budget when it needs a genuine
 *    upstream LCC call (`allNamesCached`, from the food-resolution service's
 *    own per-name cache) — see that function's doc comment. This is what
 *    actually protects a SHARED IP (office NAT, campus wifi, carrier CGNAT):
 *    once anyone behind that IP has searched a common food, everyone else
 *    re-searching the same thing within the cache TTL is free, while a
 *    flood of genuinely novel names (the only thing worth protecting the
 *    upstream LCC API from) is still fully throttled — a novel name can
 *    never satisfy the cache check. Counting only cache-missing calls also
 *    means a malformed body (which never reaches resolution either) is
 *    exempt too — see the body-parsing step below.
 */
/** Exported for unit testing — keeps the test's truncation/rate-limit assertions in lockstep with the real caps. */
export const MAX_NAMES_PER_REQUEST = 20;
/** Recovers in well under the previous 10 minutes if a caller does get throttled (M123/07). */
const RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000;
/** ~20 requests/minute sustained, generous headroom over a realistic typing session (M123/07 — see module doc comment). */
export const RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * Any JSON value, exactly as `request.json()` hands it over — the raw input
 * this route validates. Named so the parse boundary states what it accepts
 * instead of shrugging with `unknown`.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A body carrying a `names` list; every element is validated one by one below. */
const foodMatchesRequestSchema = z.object({ names: z.array(z.unknown()) });

/** A usable candidate name: a string with something other than whitespace in it. */
const candidateNameSchema = z.string().refine((name) => name.trim() !== '');

/** The route's plain success shape — `matches` is parallel to the request's `names` by index. */
export interface FoodMatchesResponseBody {
  matches: FoodMatch[][];
}

/**
 * Distinct signal for a caller who hit the rate limiter (M123/05) — never to
 * be rendered as "no matches" by the UI. `matches` stays empty (this route's
 * fail-open contract: never a 4xx, never blocks the confirm-draft flow), but
 * `throttled`/`retryAfterMs` let the caller show an honest "try again in a
 * moment" message instead of a false "we checked, nothing matched".
 */
export interface FoodMatchesThrottledResponseBody extends FoodMatchesResponseBody {
  throttled: true;
  retryAfterMs: number;
}

/** Narrows an arbitrary JSON body to a bounded list of non-empty string names. Exported for unit testing. */
export function parseNames(body: JsonValue): string[] {
  const parsed = foodMatchesRequestSchema.safeParse(body);
  if (!parsed.success) return [];
  const names: string[] = [];
  for (const candidate of parsed.data.names) {
    const name = candidateNameSchema.safeParse(candidate);
    if (name.success) names.push(name.data);
    if (names.length === MAX_NAMES_PER_REQUEST) break;
  }
  return names;
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const rateLimitKey = foodMatchesRateLimitKey(request);

  let body: JsonValue;
  try {
    body = await request.json();
  } catch {
    // Never reaches resolution either way — nothing upstream to protect, so
    // this never counts against the rate-limit budget (M123/07).
    const empty: FoodMatchesResponseBody = { matches: [] };
    return Response.json(empty);
  }

  const names = parseNames(body);

  // Resolved once and passed to BOTH calls below: `allNamesCached` reads the
  // same language-keyed cache `resolveIdentifiedFoods` writes, so a
  // mismatch here would charge (or exempt) the wrong bucket.
  const language = resolveRequestLanguage(request.headers.get('cookie'), CONFIG.i18n.defaultLanguage);
  const options = foodResolutionOptions(language);

  // Only a request that needs a genuine upstream lookup counts against the
  // budget (M123/07) — see the module doc comment and `allNamesCached` for
  // the full rationale. Checked BEFORE calling `resolveIdentifiedFoods` so a
  // throttled caller (the `false` branch below, once over budget) still
  // never reaches the upstream lookup.
  if (!allNamesCached(names, options)) {
    try {
      checkRateLimit(rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS });
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) throw error;
      const throttled: FoodMatchesThrottledResponseBody = {
        matches: [],
        throttled: true,
        retryAfterMs: error.retryAfterMs,
      };
      return Response.json(throttled);
    }
  }

  const matches: FoodMatch[][] = await resolveIdentifiedFoods(
    names.map((name) => ({ name })),
    options,
  );
  const success: FoodMatchesResponseBody = { matches };
  return Response.json(success);
}
