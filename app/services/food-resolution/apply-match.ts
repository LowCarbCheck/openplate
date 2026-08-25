/**
 * Pure mapping from a curated `FoodMatch`'s per-100g macros to the string
 * values the confirm-draft form uses (Conform inputs are strings), plus the
 * decision about which of that match's own facts still describe the item after
 * the user has had a chance to edit it. Kept free of any server-only imports
 * (config, logger, fetch) so it can be pulled into the client component that
 * renders the draft.
 *
 * Honesty rule: a `null` macro maps to an EMPTY string, never `'0'` — applying
 * a curated match must not fabricate a value the source data doesn't have.
 */
import type { Macros } from '#app/lib/macros';
import { toStoredAttribution } from '#app/lib/attribution';
import { macrosDiffer, resolveEditedNetCarbsPer100g } from '#app/lib/log-edit';
import { cloneMicronutrients, type MicronutrientsPer100g } from '#app/lib/micronutrients';
import { carbBasisForOrigin, type CarbBasis } from '#app/lib/net-carbs';
import type { FoodMatch, FoodMatchMacros } from './types';

/** String-valued macro fields as the confirm-draft form's macros fieldset expects them. */
export interface MacroFormValues {
  carbs: string;
  fiber: string;
  sugars: string;
  polyols: string;
  protein: string;
  fat: string;
  kcal: string;
}

function toFieldValue(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Converts a match's macros into form field strings (null -> '' so unknowns stay blank). */
export function matchMacrosToFormValues(macros: FoodMatchMacros): MacroFormValues {
  return {
    carbs: toFieldValue(macros.carbs),
    fiber: toFieldValue(macros.fiber),
    sugars: toFieldValue(macros.sugars),
    polyols: toFieldValue(macros.polyols),
    protein: toFieldValue(macros.protein),
    fat: toFieldValue(macros.fat),
    kcal: toFieldValue(macros.kcal),
  };
}

/** Builds the provenance token stored on a food log when a curated match is applied. */
export function toCuratedSource(slug: string): string {
  return `lowcarbcheck:${slug}`;
}

/**
 * The facts an applied `FoodMatch` contributes to the entry beyond its
 * macros — none of which can be reconstructed from the stored parts later,
 * so all have to be snapshotted at log time (see `LocalFoodLog`'s
 * `netCarbsPer100g`, `attribution` and `micronutrientsPer100g` docs).
 */
export interface AppliedMatchSnapshot {
  /**
   * The match's origin-aware per-100g net carbs, or `undefined` when no match
   * is applied / the applied one no longer describes the item's macros. Three
   * states — see `#app/lib/authoritative-net-carbs`.
   */
  netCarbsPer100g: number | null | undefined;
  /**
   * The match's printed-panel convention, derived from `FoodMatch.origin` via
   * `carbBasisForOrigin`, or `undefined` when the origin is absent/unrecognised
   * (never a guessed basis — see that function's doc). M123/13 second-review
   * finding 1: this follows `attribution`'s rule below, NOT `netCarbsPer100g`'s
   * — a macro edit does NOT withdraw it, because the basis describes which
   * convention the ORIGINAL printed panel used, a fact about the source that
   * a hand-edit to the numbers doesn't change. It is exactly what keeps the
   * compute-from-parts fallback honest once a macro edit clears
   * `netCarbsPer100g` above (see `LocalPersonalFood.carbBasis`'s doc in
   * `#app/lib/local-store/schema`).
   */
  carbBasis: CarbBasis | undefined;
  /** The match's licence credit, or `null` when the source carries none. */
  attribution: string | null;
  /**
   * The match's per-100 g vitamins/minerals, or `undefined` when no match is
   * applied / the match's origin has no micronutrient dimension. Absence is
   * "we have nothing", never "all zero".
   */
  micronutrientsPer100g: MicronutrientsPer100g | undefined;
}

/**
 * Decides which facts of an applied curated match still hold for an item whose
 * macro fields the user can freely edit afterwards (the scan confirm step).
 *
 * The applied match is identified by the `curatedSource` token the form
 * already carries, and looked up in the match list that is still in scope —
 * so there is no second copy of the match's numbers to fall out of sync with
 * the first.
 *
 * The two facts follow DIFFERENT rules, deliberately:
 *
 *  - `netCarbsPer100g` follows `resolveEditedNetCarbsPer100g`, the same rule
 *    the diary's edit form uses: a hand-changed macro means the person is now
 *    the source of these numbers, so an upstream figure computed for DIFFERENT
 *    numbers would be a lie, and it clears to `undefined` (readers fall back to
 *    the parts the user actually typed). Not `null`: that state means "an
 *    upstream source was consulted and had none", a captured fact — after a
 *    user edit there is no upstream source in play at all.
 *
 *  - `attribution` does NOT clear on a macro edit, because it tracks
 *    `curatedSource`, which this flow deliberately preserves through an edit
 *    ("Curated macros aren't AI-guessed... even if the user then tweaked the
 *    numbers — they're still sourced from a curated entry"). CC BY's credit
 *    obligation covers adaptations too — the BLS string literally ends
 *    "(adapted)" — so dropping the credit from a tweaked curated entry, while
 *    still claiming curated provenance for it, would be the actual licence
 *    violation rather than the cautious choice.
 *
 *  - `carbBasis` follows `attribution`'s rule, not `netCarbsPer100g`'s (M123/13
 *    second-review finding 1). It names which convention the ORIGINAL printed
 *    panel used — a fact about the source, not about the numbers currently in
 *    the form — so a hand-edit to those numbers doesn't make the panel's own
 *    convention stop being true. Withdrawing it on edit would be actively
 *    harmful here: it is precisely the fallback that runs the moment
 *    `netCarbsPer100g` clears, so clearing both together would silently
 *    re-introduce the double-subtraction spec 13 exists to prevent, for every
 *    edited bls/curated-origin match.
 *
 * @param options.appliedCuratedSource - the item's current `curatedSource` field value, if any.
 * @param options.matches - the curated matches offered for this item.
 * @param options.editedMacrosPer100g - the item's current per-100g macro field values.
 * @returns the facts to carry onto the logged entry.
 */
export function resolveAppliedMatchSnapshot({
  appliedCuratedSource,
  matches,
  editedMacrosPer100g,
}: {
  appliedCuratedSource: string | undefined;
  matches: readonly FoodMatch[];
  editedMacrosPer100g: Macros;
}): AppliedMatchSnapshot {
  const applied = matches.find((match) => toCuratedSource(match.slug) === appliedCuratedSource);
  if (!applied) {
    return { netCarbsPer100g: undefined, carbBasis: undefined, attribution: null, micronutrientsPer100g: undefined };
  }
  const macrosChanged = macrosDiffer(applied.macrosPer100g, editedMacrosPer100g);
  return {
    netCarbsPer100g: resolveEditedNetCarbsPer100g({ macrosChanged, current: applied.netCarbsPer100g }),
    carbBasis: carbBasisForOrigin(applied.origin),
    attribution: toStoredAttribution(applied.attribution),
    // Follows `attribution`'s rule, NOT `netCarbsPer100g`'s: net carbs are
    // derived from the very macros being edited, so a hand-edit makes the
    // upstream figure describe numbers that are no longer there. A vitamin C
    // measurement is an independent fact about the matched food — the person
    // adjusting a carb value has neither measured it nor invalidated it, and
    // withdrawing it would just turn a covered entry uncovered for no reason.
    micronutrientsPer100g: cloneMicronutrients(applied.micronutrientsPer100g),
  };
}
