/**
 * Household-portion model (M12x): lets a logged entry say "2 eggs" instead
 * of a bare gram figure, while still storing an authoritative gram weight
 * for the macro math. See each module's header for its specific job:
 *
 *  - `types.ts` — `DisplayPortion`/`PortionUnitId`, `portionToGrams`. Also
 *    consumed by `#app/lib/local-store/schema`'s `LocalFoodLog.portion`
 *    (`import type` only — that module stays pure/runtime-dep-free).
 *  - `household-units.ts` — the small, sourced built-in unit table + name matcher.
 *  - `default-portion.ts` — `resolveDefaultPortion` (portionSize > table > null),
 *    consumed by `#app/lib/local-store/local-quick-add`'s candidate builders
 *    so selecting a food preselects its natural portion, not a flat 100 g.
 *  - `portion-options.ts` — real chip choices ("2 eggs") + label formatting +
 *    selection derivation, the non-photo replacement for the old flat
 *    multiplier chips (see `#app/lib/portion-preview`'s scope note).
 *  - `portion-form.ts` — the shared hidden-input encoding (`encodeDisplayPortion`)
 *    and zod field (`portionField`) every flow that carries a chosen portion
 *    through a form uses, so the JSON wire shape is written once.
 *  - `serving-macros.ts` — per-100g vs per-serving ("per serving (30 g): ...")
 *    macro entry conversion, for a package-label-faithful custom-food form.
 *
 * UI integration (add.tsx's `PortionStep`/`ManualAddForm`, diary.entry.$id.tsx's
 * edit form) is a later phase — see the round's handoff notes for exactly
 * what each route must call.
 */
export type { PortionUnitId, DisplayPortion } from './types';
export { portionToGrams } from './types';

export type { HouseholdUnit, HouseholdUnitId } from './household-units';
export { HOUSEHOLD_UNITS, getHouseholdUnit, matchHouseholdUnit } from './household-units';

export type { DefaultPortionInput } from './default-portion';
export { FALLBACK_PORTION_GRAMS, resolveDefaultPortion, defaultPortionGrams } from './default-portion';

export type { PortionChoice } from './portion-options';
export { derivePortionChoices, deriveSelectedPortionQuantity, formatPortionLabel } from './portion-options';

export { displayPortionSchema, portionField, encodeDisplayPortion } from './portion-form';

export type { MacroEntryBasis, MacroEntryInput } from './serving-macros';
export { resolveMacrosPer100gFromEntry } from './serving-macros';
