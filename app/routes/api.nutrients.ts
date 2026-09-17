import type { Route } from './+types/api.nutrients';
import { CONFIG } from '#app/config';
import { fetchNutrientReferences, fetchNutrientSourceFoods } from '#app/services/nutrient-reference/index.server';
import { NUTRIENT_REFERENCE_BASES, isNutrientReferenceBasis } from '#app/lib/nutrient-reference';
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
 *   GET /api/nutrients?basis=dge|efsa|us    → the same list on that basis
 *   GET /api/nutrients?foodsFor=<slug>      → { foods: NutrientSourceFood[] }
 *
 * THE BASIS IS CHOSEN HERE, per request, and never cached with the data: the
 * service holds all three published bases for twelve hours, this route picks
 * one. So an operator who changes `NUTRIENT_REFERENCE_BASIS` is served the new
 * document on the next request, not after the cache expires.
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

/** The refusal shape for an unknown `basis`. Deliberately NOT a nutrient list, so a caller cannot read it as one. */
export interface NutrientBasisErrorBody {
  error: 'unknown_basis';
  supported: string[];
}

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const slug = parameters.get('foodsFor');

  if (slug !== null) {
    // `fetchNutrientSourceFoods` validates the slug against the allowlist and
    // answers `[]` for anything else: a stale or hand-typed slug degrades to
    // "no suggestions" rather than an error state the screen would have to
    // render. This branch has no basis to get wrong, so it keeps failing open.
    const foods: NutrientFoodsResponseBody = { foods: await fetchNutrientSourceFoods(slug) };
    return Response.json(foods);
  }

  // The one 4xx on this route, and it is deliberate. Everything else here
  // fails open to an empty list, but a `basis` this build does not know is a
  // caller error, not an upstream one, and answering it with the default would
  // serve one standards body's numbers under a request for another's. A door
  // that looks locked. The caller is told instead.
  const requested = parameters.get('basis');
  if (requested !== null && !isNutrientReferenceBasis(requested)) {
    const error: NutrientBasisErrorBody = {
      error: 'unknown_basis',
      supported: [...NUTRIENT_REFERENCE_BASES],
    };
    return Response.json(error, { status: 400 });
  }

  const basis = requested ?? CONFIG.nutrients.referenceBasis;
  const document = await fetchNutrientReferences();
  const nutrients: NutrientReferenceResponseBody = { nutrients: document[basis] };
  return Response.json(nutrients);
}
