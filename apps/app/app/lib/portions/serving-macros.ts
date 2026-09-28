/**
 * Package-label macro entry: a food label almost never prints "per 100 g" —
 * it prints "per serving (30 g): 120 kcal". This module lets a person type
 * macros exactly as printed (per-100g OR per-serving) and converts internally
 * to the per-100g basis the rest of the tracker stores.
 */
import { snapshotToPer100gAtGrams } from '#app/lib/quick-add-search';
import type { Macros } from '#app/lib/macros';

/** Which basis a person is entering macros under. */
export type MacroEntryBasis = 'per100g' | 'perServing';

export interface MacroEntryInput {
  basis: MacroEntryBasis;
  /** The macros as typed, in whichever basis `basis` declares. */
  macros: Macros;
  /** The serving size in grams — read (and required to be positive) only when `basis` is `'perServing'`. */
  servingGrams: number;
}

/**
 * Converts a macro entry — typed either per 100 g or per the label's own
 * serving size — into the per-100g basis the rest of the tracker stores.
 * The per-serving case reuses the exact same un-scale math as
 * `snapshotToPer100gAtGrams` (entering "per serving (30 g)" macros IS that
 * operation, just from a manual form instead of a recovered log snapshot): a
 * non-positive `servingGrams` degrades to all-null macros rather than
 * dividing by zero, the same honesty contract as everywhere else in the app
 * — no field is ever fabricated as 0.
 */
export function resolveMacrosPer100gFromEntry({ basis, macros, servingGrams }: MacroEntryInput): Macros {
  if (basis === 'per100g') return macros;
  return snapshotToPer100gAtGrams({ snapshot: macros, grams: servingGrams });
}
