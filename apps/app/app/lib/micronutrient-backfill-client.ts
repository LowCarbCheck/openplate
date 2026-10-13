/**
 * The device's caller for `/api/food-micronutrients` (the micronutrient
 * backfill, 2026-10-13).
 *
 * TWO KINDS OF FAILURE, and the ledger only ever sees one of them:
 *
 * - The route ANSWERED, and said `unknown` for a slug. LowCarbCheck failed for
 *   that one food, so the job counts one attempt against it.
 * - The route did NOT answer: offline, a `404` (this instance has no food
 *   database), a `401` or `503` (no live account), a `429` (a throttle), a
 *   `5xx`, or a body that does not parse. Nothing was asked of LowCarbCheck, or
 *   nothing this device can trust came back, so the job STOPS for this session
 *   and writes nothing. No attempt is counted for a failure that says nothing
 *   about the food.
 *
 * The bearer rides along as it does for `/api/food-matches`
 * (`#app/lib/account-bearer`), with one refresh after a `401`.
 */
import { fetchWithAccountBearer, sessionAccountBearer, type AccountBearer } from '#app/lib/account-bearer';
import {
  foodMicronutrientsResponseSchema,
  type SlugMicronutrientsAnswer,
} from '#app/services/food-db/micronutrients-wire';

/** The route's own path. */
export const FOOD_MICRONUTRIENTS_PATH = '/api/food-micronutrients';

/** Why a request produced no answers. Diagnostics only; every reason stops the run the same way. */
export type BackfillRequestStop = 'unavailable' | 'refused' | 'throttled' | 'failed';

/** One request's result: the answers, or the reason there are none. */
export type BackfillRequestResult =
  { kind: 'answered'; answers: SlugMicronutrientsAnswer[] } | { kind: 'stopped'; reason: BackfillRequestStop };

/** The non-2xx statuses that are a decision of this server rather than a failure. */
const STOP_BY_STATUS: ReadonlyMap<number, BackfillRequestStop> = new Map([
  [404, 'unavailable'],
  [401, 'refused'],
  [503, 'refused'],
  [429, 'throttled'],
]);

/**
 * Asks the route about one batch of slugs.
 *
 * Never throws: every failure is a `stopped` result.
 *
 * @param options.slugs - at most `MAX_SLUGS_PER_REQUEST` distinct slugs.
 * @param options.bearer - where the account token comes from; the tab's session by default.
 * @returns the answers the route gave, only for slugs that were sent.
 */
export async function fetchFoodMicronutrients({
  slugs,
  bearer = sessionAccountBearer(),
}: {
  slugs: readonly string[];
  bearer?: AccountBearer;
}): Promise<BackfillRequestResult> {
  let response: Response;
  try {
    response = await fetchWithAccountBearer({
      url: FOOD_MICRONUTRIENTS_PATH,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs }) },
      bearer,
    });
  } catch {
    return { kind: 'stopped', reason: 'failed' };
  }
  if (!response.ok) return { kind: 'stopped', reason: STOP_BY_STATUS.get(response.status) ?? 'failed' };

  const parsed = foodMicronutrientsResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'stopped', reason: 'failed' };
  // Only answers about slugs this request named: a confused server must not
  // be able to settle a food the device never asked about.
  const asked = new Set(slugs);
  return { kind: 'answered', answers: parsed.data.results.filter((answer) => asked.has(answer.slug)) };
}
