/**
 * The one place a LowCarbCheck request is authenticated (M238 spec 01).
 *
 * TWO SERVICES CALL LOWCARBCHECK, not one: `#app/services/food-resolution`
 * searches the catalogue and `#app/services/nutrient-reference` reads the
 * published reference intakes. A key threaded into one of them and forgotten
 * in the other is the defect class this repository already has a name for
 * (`tests/unit/authoritative-net-carbs-wiring.test.ts`), so the header is
 * built HERE, once, and both fetch sites spread the result. A third caller
 * added later cannot forget it, and the day the header name moves there is
 * one line to change.
 *
 * THE KEY IS NEVER LOGGED. Not on failure, not at debug, not inside an error
 * object somebody serialises later. When a log line genuinely has to say WHICH
 * key was refused, it carries `foodDbKeyDisplayPrefix` and nothing else, the
 * 16-character display prefix the LowCarbCheck side defines for exactly this.
 *
 * THE KEY NEVER REACHES A BROWSER either. It lives on `CONFIG.foodDb.apiKey`,
 * which is server-only; `PublicConfig` is a closed four-key allowlist and this
 * is not on it. That matters because the LowCarbCheck API is CORS-open, so a
 * key that reached a page would be a public key.
 */

/**
 * How many leading characters of a key may appear in a log line.
 *
 * `lcc_live_` plus seven of the thirty-two random characters: enough for an
 * operator holding several keys to tell which one was refused, far too little
 * to use.
 */
export const FOOD_DB_KEY_DISPLAY_PREFIX_LENGTH = 16;

/**
 * Every header a LowCarbCheck request carries, plus the bearer when this
 * instance holds a key.
 *
 * With no key configured the result is exactly the `accept` this app sent
 * before M238, the anonymous tier, and the default.
 *
 * A `Headers` rather than a plain object, so a caller that needs one more
 * header ADDS to what came back instead of building a second literal beside
 * it, and so the header name is spelled once in this file and nowhere else.
 *
 * `content-type` is deliberately NOT here: only the catalogue search POSTs a
 * body, and a header that describes a body belongs to the call site that has
 * one.
 *
 * @param options.apiKey - `CONFIG.foodDb.apiKey`, or `null` for the anonymous tier.
 * @returns a fresh `Headers` the caller owns and may add to.
 */
export function foodDbRequestHeaders({ apiKey }: { apiKey: string | null }): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (apiKey !== null) headers.set('authorization', `Bearer ${apiKey}`);
  return headers;
}

/**
 * The only part of a key that may be written down.
 *
 * @param apiKey - the configured key, or `null`.
 * @returns the first {@link FOOD_DB_KEY_DISPLAY_PREFIX_LENGTH} characters, or `null` when there is no key.
 */
export function foodDbKeyDisplayPrefix(apiKey: string | null): string | null {
  if (apiKey === null) return null;
  return apiKey.slice(0, FOOD_DB_KEY_DISPLAY_PREFIX_LENGTH);
}
