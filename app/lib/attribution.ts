/**
 * The single rule for what counts as a storable licence credit on a food-log
 * entry (`LocalFoodLog.attribution`) — the sibling of
 * `#app/lib/authoritative-net-carbs`, which does the same job for that field's
 * three-state form encoding.
 *
 * Why this exists as its own rule rather than an inline ternary at each of the
 * writers: CC BY requires the credit to travel with the data wherever the data
 * is shown, so EVERY path that creates an entry from a credited source has to
 * copy it, and they must all agree on what "no credit" looks like. A single
 * shared normalizer is what keeps the fourth writer added next year from
 * inventing its own (that is exactly how this field ended up with a reader on
 * the entry detail page and no writer at all).
 *
 * Unlike `netCarbsPer100g` this field has only TWO meaningful states, not
 * three: either there is a credit to display or there isn't. "Upstream was
 * consulted and had none" and "never captured" are indistinguishable to a
 * reader — both mean "render no credit line" — so they collapse to `null`
 * rather than needing a marker to keep them apart. `LocalFoodLog.attribution`
 * documents `null` and absent as equivalent for exactly this reason.
 *
 * Pure string handling — no store, no browser, no React — so it unit-tests
 * directly.
 */

/**
 * Normalizes a form-carried or source-carried attribution into the value to
 * persist. Blank, whitespace-only, absent, and `null` all mean "this source
 * carries no credit" and become `null`; a real credit is stored trimmed but
 * otherwise VERBATIM (never truncated, reworded, or re-cased — a licence
 * credit is a legal string, not display copy).
 *
 * @param raw - the candidate credit, from a hidden form field or a `FoodMatch`.
 * @returns the credit to store, or `null` when there is none.
 */
export function toStoredAttribution(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
