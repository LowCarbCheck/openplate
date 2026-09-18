/**
 * The food-database status as it crosses from this server to this browser
 * (M238 spec 02).
 *
 * A MODULE OF ITS OWN, and it has to be. The producer
 * (`#app/services/food-db/status`) holds module-level state and is server-only;
 * the consumer (`#app/lib/food-matches-client`) runs in the page. Putting the
 * type, the recognised reason list and the parser here means both ends read
 * ONE definition, and the browser bundle never pulls in the server's state
 * just to name a field.
 *
 * NOTHING SECRET CROSSES. A boolean and one word from a closed list. The API
 * key is not here, is not derivable from here, and is not in `PublicConfig`
 * either; see `#app/services/food-db/request` for why that matters.
 */
import { z } from 'zod';

/**
 * Why the food database is refusing this instance.
 *
 * A CLOSED LIST, and the three values M202 froze. The upstream sends its own
 * `error.code`; anything this app does not recognise degrades to the reason
 * the STATUS CODE implies, because the status code is what drives behaviour
 * and the body only improves the wording.
 */
export type FoodDbRefusalReason = 'invalid_key' | 'rate_limited' | 'allowance_exhausted';

/** Every recognised refusal, so a newer upstream's fourth code is ignored rather than published. */
export const FOOD_DB_REFUSAL_REASONS: readonly FoodDbRefusalReason[] = [
  'invalid_key',
  'rate_limited',
  'allowance_exhausted',
];

/** What the app knows about the food database's willingness to answer. */
export interface FoodDbStatus {
  /** `false` once a refusal has been seen and no successful call has followed it. Degraded, never fatal. */
  ok: boolean;
  /** Which refusal, or `null` while healthy. */
  reason: FoodDbRefusalReason | null;
}

/**
 * The quiet answer, and the one every "we do not know" path reports.
 *
 * `ok: true` is deliberate: the line on the scan review appears only when the
 * server POSITIVELY reports a refusal it saw. A browser that could not reach
 * this app's own server has learned nothing about LowCarbCheck, and inventing
 * a warning out of that would put an "unavailable" line under a page that is
 * merely offline.
 */
export const FOOD_DB_STATUS_UNKNOWN: FoodDbStatus = { ok: true, reason: null };

/**
 * The status as it appears in a response body.
 *
 * `reason` is a plain string here rather than the closed union above, on
 * purpose: a newer server that grows a fourth refusal code must not make the
 * whole envelope fail to parse. {@link parseFoodDbStatus} is what narrows it.
 */
export const foodDbStatusWireSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() });

/** The status as it appears on the wire, before the reason is narrowed. */
type UnnarrowedFoodDbStatus = z.infer<typeof foodDbStatusWireSchema>;

/**
 * Narrows a parsed wire status into the app's own type.
 *
 * @param wire - the parsed `foodDb` field, or `undefined` when the server did not send one.
 * @returns the status, or {@link FOOD_DB_STATUS_UNKNOWN} when there was nothing to read.
 */
export function parseFoodDbStatus(wire: UnnarrowedFoodDbStatus | undefined): FoodDbStatus {
  if (wire === undefined) return FOOD_DB_STATUS_UNKNOWN;
  return { ok: wire.ok, reason: FOOD_DB_REFUSAL_REASONS.find((known) => known === wire.reason) ?? null };
}
