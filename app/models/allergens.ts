/**
 * The EU 14 allergens (M219/02), the list a person can tick on the "About you"
 * page and on the onboarding body step. Pure: no store, no DOM, no clock, the
 * same terms `body-metrics.ts` is written under, so a `node:test` file pins
 * every branch with no browser.
 *
 * ── Why exactly these fourteen ─────────────────────────────────────────────
 *
 * Regulation (EU) 1169/2011, Annex II, names fourteen substances a food label
 * in the EU must declare. They are the vocabulary a person already knows from
 * every packet, and they are the vocabulary the model is asked to answer in
 * (spec 01), so a chip here and a flag there can be compared by value with no
 * mapping table in between. "Nuts" is the regulation's tree-nut group,
 * distinct from peanuts, which are a legume and their own entry.
 *
 * ── The list lives on the profile and goes nowhere else ────────────────────
 *
 * It sits on `LocalProfileGoals` beside the reproductive status, rides the
 * JSON backup and the E2EE sync payload like every other profile field, and is
 * never part of any outbound request. The model flags every food it sees
 * regardless of who is asking; the DEVICE decides which flag becomes a chip.
 *
 * ── Unknown strings are dropped, never refused ─────────────────────────────
 *
 * `parseAllergens` behaves like `parseReproductiveStatus`: anything that is
 * not one of the fourteen is dropped, so an older backup, a hand-edited one
 * or a newer build's wider list restores instead of failing.
 */

/** Selectable allergens, the EU 14 in the order Annex II lists them, which is the order the chips render in. */
export const ALLERGEN_VALUES = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

/** One of the EU 14. */
export type Allergen = (typeof ALLERGEN_VALUES)[number];

/** The same fourteen as a set, the house idiom for narrowing a string without `typeof`. */
const ALLERGEN_SET: ReadonlySet<string> = new Set<Allergen>(ALLERGEN_VALUES);

/** Narrows one raw string to an `Allergen`. */
export function isAllergen(value: string): value is Allergen {
  return ALLERGEN_SET.has(value);
}

/**
 * Narrows a raw list of strings to a clean allergen list. Unknown strings are
 * dropped and duplicates collapse to one, so the result is always a subset of
 * `ALLERGEN_VALUES`, in the order the input named them.
 *
 * Takes the strings a form or a stored record actually holds rather than an
 * `unknown`: the JSON boundary (`backup.ts`) proves "array of strings" with
 * zod first, and the form boundary reads `formData.getAll`, which is already
 * a string list.
 *
 * @param raw - the raw strings, from a form or a stored record.
 * @returns the recognised allergens, each at most once.
 */
export function parseAllergens(raw: readonly string[]): Allergen[] {
  const seen = new Set<Allergen>();
  for (const value of raw) {
    if (isAllergen(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * The checkbox group both forms submit the chips under, one value per chosen
 * chip. One name in one place, so the wizard and the settings page cannot
 * disagree with the action that reads them.
 */
export const ALLERGENS_FIELD = 'allergens';

/**
 * Reads the allergen chips off a submitted form. `getAll` is the whole list
 * (a checkbox that is not ticked submits nothing), so an empty answer is
 * "none", and the narrowing above drops anything that is not one of the
 * fourteen. A `File` under that name is not a chip and is dropped with it.
 *
 * @param formData - the submitted form.
 * @returns the recognised allergens, each at most once.
 */
export function readAllergensField(formData: FormData): Allergen[] {
  return parseAllergens(formData.getAll(ALLERGENS_FIELD).flatMap((entry) => (entry instanceof File ? [] : [entry])));
}
