/**
 * Pure decision helpers for editing a food-log entry's macros. No I/O, so both
 * the diary entry route's save action (server) and its unit tests exercise the
 * same logic. Three jobs:
 *  1. Detect whether the user hand-changed any per-100g macro value.
 *  2. Decide how that change affects provenance flags — hand-verifying the
 *     numbers demotes an AI-estimated or curated entry to a plain manual one
 *     (the same honesty rule the scan flow applies when a curated match is
 *     used: the stored numbers must never claim a provenance they no longer
 *     have).
 *  3. Compose both into the full save patch (`computeEditPatch`) so the route's
 *     save action is a thin imperative shell over one pure decision, and that
 *     decision is unit-testable without a form, a Collapsible, or a DB.
 */
import { scaleMacrosPer100gToServing, type Macros } from './macros';

/** The 7 macro fields compared field-by-field. */
const MACRO_KEYS: readonly (keyof Macros)[] = ['carbs', 'fiber', 'sugars', 'polyols', 'protein', 'fat', 'kcal'];

/** Rounds to one decimal — the precision every macro is displayed and prefilled at (see `formatMacroNumber`). */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Whether two macro values differ at display precision. `null` (unknown) and a
 * number always differ; two numbers differ only when they round to different
 * one-decimal values — so the reconstructed-basis prefill (rounded to one
 * decimal) reads as "unchanged" when the user leaves it untouched.
 */
function fieldDiffers(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return roundToTenth(a) !== roundToTenth(b);
}

/**
 * True when any per-100g macro field changed between the prefilled basis and
 * the submitted values, at one-decimal display precision.
 *
 * @param original - the per-100g basis the edit form was prefilled from.
 * @param edited - the per-100g values the user submitted.
 * @returns whether the two macro sets differ.
 */
export function macrosDiffer(original: Macros, edited: Macros): boolean {
  return MACRO_KEYS.some((key) => fieldDiffers(original[key], edited[key]));
}

/**
 * The per-100g basis a save (or a live preview) must actually compute from.
 *
 * The edit form prefills its number inputs with `formatMacroNumber(basis[key])`
 * — ROUNDED to one decimal, because that is what a `<input type="number">` can
 * honestly hold. So an untouched form resubmits a *rounded* copy of the basis,
 * and scaling that copy to the portion rounds twice: a 0.43 g/100 g protein
 * becomes 0.4, and 0.4 x 1.82 renders "0.7" next to the receipt's "0.8" for the
 * very same entry. `macrosDiffer` already treats the two as EQUAL (it compares
 * at display precision) — this helper is the other half of that rule: when the
 * user did not change anything, keep the ORIGINAL unrounded basis and let the
 * single render-time rounding be the only rounding there is.
 *
 * A real edit returns the submitted values verbatim: they are then the source.
 *
 * @param options.originalBasis - the unrounded per-100g basis the form was prefilled from.
 * @param options.editedPer100g - the per-100g values submitted (or currently typed).
 * @returns the basis to scale from.
 */
export function resolveEditedBasis({
  originalBasis,
  editedPer100g,
}: {
  originalBasis: Macros;
  editedPer100g: Macros;
}): Macros {
  return macrosDiffer(originalBasis, editedPer100g) ? editedPer100g : originalBasis;
}

/** Provenance flags on a food-log row that a macro edit can affect. */
export interface EntryProvenance {
  aiEstimated: boolean;
  curatedSource: string | null;
}

/**
 * The provenance flags a saved edit should persist. A hand-changed macro means
 * the numbers are now user-verified, so both provenance markers clear (the
 * entry becomes a plain manual one); an untouched macro set keeps whatever
 * provenance the entry already had.
 *
 * @param options.macrosChanged - whether any per-100g macro value was edited.
 * @param options.current - the entry's existing provenance flags.
 * @returns the provenance flags to write back.
 */
export function resolveEditedProvenance({
  macrosChanged,
  current,
}: {
  macrosChanged: boolean;
  current: EntryProvenance;
}): EntryProvenance {
  if (macrosChanged) return { aiEstimated: false, curatedSource: null };
  return { aiEstimated: current.aiEstimated, curatedSource: current.curatedSource };
}

/**
 * The authoritative per-100g net carbs a saved edit should persist. A
 * hand-changed macro means the person is now the source of these numbers, so a
 * figure snapshotted from an upstream food database no longer describes them —
 * it clears to `undefined` ("no authoritative figure"), putting the readers
 * back on the user's own parts. An untouched macro set preserves it verbatim:
 * the stored figure is PER 100 g, so re-portioning the entry leaves it exactly
 * as valid as it was.
 *
 * This mirrors `resolveEditedProvenance` deliberately — both clear on the same
 * signal, because they encode the same fact: the entry's numbers stopped being
 * the source's and became the user's.
 *
 * @param options.macrosChanged - whether any per-100g macro value was edited.
 * @param options.current - the entry's stored figure before this save.
 * @returns the figure to write back (`undefined` clears it on write).
 */
export function resolveEditedNetCarbsPer100g({
  macrosChanged,
  current,
}: {
  macrosChanged: boolean;
  current: number | null | undefined;
}): number | null | undefined {
  if (macrosChanged) return undefined;
  return current;
}

/** Input to `computeEditPatch`: the submitted portion + macros against the entry's prior state. */
export interface ComputeEditPatchInput {
  /** The (possibly re-portioned) grams the entry is now logged at. */
  grams: number;
  /** The per-100g macros submitted by the form (always present — see the module comment on forceMount). */
  editedPer100g: Macros;
  /** The per-100g basis the edit form was prefilled from (reconstructed pre-edit state). */
  originalBasis: Macros;
  /** The entry's provenance flags before this save. */
  currentProvenance: EntryProvenance;
  /**
   * The entry's stored authoritative per-100g net carbs before this save
   * (`LocalFoodLog.netCarbsPer100g`). Absent for the many entries that never
   * had one.
   */
  currentNetCarbsPer100g?: number | null;
}

/** The full decision a food-log edit save needs to persist. */
export interface EditPatchResult {
  /** Whether any per-100g macro value differs from the prefilled basis. */
  macrosChanged: boolean;
  /** The provenance flags to write back (cleared only when `macrosChanged`). */
  provenance: EntryProvenance;
  /** The re-scaled per-serving snapshot to persist (`editedPer100g` × `grams` / 100). */
  snapshot: Macros;
  /** The authoritative per-100g net carbs to write back (cleared only when `macrosChanged`). */
  netCarbsPer100g: number | null | undefined;
}

/**
 * The single decision a food-log edit save makes: did the macros actually
 * change, what provenance follows from that, what per-serving snapshot to
 * persist, and whether the entry's authoritative net-carbs figure survives. A
 * portion-only edit (grams changed, macros untouched) rescales the snapshot
 * from the SAME per-100g basis and preserves both provenance and the
 * authoritative figure exactly — changing how much you ate is not a correction
 * of the numbers. Only a real per-100g macro edit demotes provenance to plain
 * manual and clears the upstream figure.
 *
 * @param input - see `ComputeEditPatchInput`.
 * @returns the patch to persist (see `EditPatchResult`).
 */
export function computeEditPatch({
  grams,
  editedPer100g,
  originalBasis,
  currentProvenance,
  currentNetCarbsPer100g,
}: ComputeEditPatchInput): EditPatchResult {
  const macrosChanged = macrosDiffer(originalBasis, editedPer100g);
  const provenance = resolveEditedProvenance({ macrosChanged, current: currentProvenance });
  // `resolveEditedBasis`, never `editedPer100g` directly: an untouched form
  // resubmits the basis rounded to one decimal, and scaling THAT is what made
  // the edit form and the receipt print two different protein figures for one
  // entry. See that helper's doc.
  const snapshot = scaleMacrosPer100gToServing(resolveEditedBasis({ originalBasis, editedPer100g }), grams);
  const netCarbsPer100g = resolveEditedNetCarbsPer100g({ macrosChanged, current: currentNetCarbsPer100g });
  return { macrosChanged, provenance, snapshot, netCarbsPer100g };
}
