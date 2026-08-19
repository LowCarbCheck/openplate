import type { Route } from './+types/api.nutrients';
import { fetchNutrientReferences, fetchNutrientSourceFoods } from '#app/services/nutrient-reference/index.server';
import type { NutrientReference, NutrientSourceFood } from '#app/lib/nutrient-reference';

/**
 * Resource route: server-proxied read of LowCarbCheck's public nutrient data
 * (M135/06), in the same shape and for the same reason as
 * `/api/food-matches` — the browser never holds `CONFIG.foodDb`, so the
 * self-hoster's `FOOD_DB_API_URL` override (and their ability to switch the
 * integration off entirely) keeps working without leaking into the client
 * bundle. It is also what keeps the production CSP's `connect-src` closed: the
 * browser talks only to `'self'`.
 *
 * Two shapes on one path, because they are one concern (published reference
 * data) with one fail-open story:
 *
 *   GET /api/nutrients                      → { nutrients: NutrientReference[] }
 *   GET /api/nutrients?foodsFor=<slug>      → { foods: NutrientSourceFood[] }
 *
 * NOTHING about the caller is sent upstream — not the food log, not the body
 * metrics, and least of all the pregnancy/lactation status the personalisation
 * uses. Reference amounts are resolved entirely on the device, from data that
 * is the same for everyone.
 *
 * FAIL OPEN, always, and deliberately WITHOUT a rate limiter (unlike
 * `/api/food-matches`, which fronts an interactive search-as-you-type box):
 * every response here is served from a process-wide cache over a fixed
 * 17-slug allowlist, so a flood costs the upstream API nothing after the first
 * call per slug — the thing a limiter exists to protect is already protected by
 * construction, and an IP bucket would only mean an office NAT can lock its
 * neighbours out of their own reference amounts.
 */

/** The list shape — served when no `foodsFor` slug is given. */
export interface NutrientReferenceResponseBody {
  nutrients: NutrientReference[];
}

/** The per-nutrient source shape. Empty whenever the slug is unknown or upstream is unreachable. */
export interface NutrientFoodsResponseBody {
  foods: NutrientSourceFood[];
}

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('foodsFor');

  if (slug !== null) {
    // `fetchNutrientSourceFoods` validates the slug against the allowlist and
    // answers `[]` for anything else — this route never 4xxs, so a stale or
    // hand-typed slug degrades to "no suggestions" rather than an error state
    // the screen would have to render.
    const foods: NutrientFoodsResponseBody = { foods: await fetchNutrientSourceFoods(slug) };
    return Response.json(foods);
  }

  const nutrients: NutrientReferenceResponseBody = { nutrients: await fetchNutrientReferences() };
  return Response.json(nutrients);
}
