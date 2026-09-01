/**
 * Built-in household-unit reference weights, used only when a food has no
 * upstream `portionSize` (LowCarbCheck's curated rows all carry one; a
 * personal food or a previously-logged food usually doesn't). Deliberately
 * SMALL: every entry below is a single, widely-cited reference weight (USDA
 * FoodData Central's "household" portion conventions — the same style of
 * number printed on US nutrition labels), not a measurement of any SPECIFIC
 * food. A real egg, banana, or bread slice varies meaningfully around these
 * numbers. Add a unit here only when there is a broadly-agreed reference
 * weight to point to; otherwise leave the food on plain grams (see
 * `resolveDefaultPortion`'s null-fallback contract in `default-portion.ts`)
 * rather than guessing.
 */
import type { PortionUnitId } from './types';

/** A household unit's id, excluding the generic `'serving'` fallback (that one has no reference weight of its own — see `types.ts`). */
export type HouseholdUnitId = Exclude<PortionUnitId, 'serving'>;

/**
 * A built-in household unit. Deliberately carries NO display noun: the
 * singular/plural words a chip renders ("egg" / "eggs", "Ei" / "Eier") are UI
 * copy and live in the translation bundles under `portions.unit.<id>_one` /
 * `_other`, read by `portion-options.ts`'s `formatPortionLabel`. Keeping an
 * English `label` here as well would be a second source of truth that only
 * ever drifts out of the German one.
 */
export interface HouseholdUnit {
  id: HouseholdUnitId;
  /** Reference grams for ONE unit — see the per-entry sourcing comment below. */
  gramsPerUnit: number;
  /** Lowercase whole words in a food's name that select this unit (see `matchHouseholdUnit`). */
  matchWords: readonly string[];
  /** The quantities offered as portion chips for this unit, in display order. */
  typicalQuantities: readonly number[];
}

export const HOUSEHOLD_UNITS: readonly HouseholdUnit[] = [
  {
    id: 'egg',
    // USDA FoodData Central: one large whole egg, edible portion ≈ 50 g.
    gramsPerUnit: 50,
    matchWords: ['egg', 'eggs'],
    typicalQuantities: [1, 2, 3],
  },
  {
    id: 'slice',
    // USDA generic sliced sandwich bread: commonly published in the 28-32 g
    // range per slice; 30 g used as a rounded middle.
    gramsPerUnit: 30,
    matchWords: ['bread', 'toast'],
    typicalQuantities: [1, 2, 3],
  },
  {
    id: 'cup',
    // USDA: 1 cup of cooked white rice ≈ 158 g.
    gramsPerUnit: 158,
    matchWords: ['rice'],
    typicalQuantities: [0.5, 1, 1.5],
  },
  {
    id: 'tablespoon',
    // 1 US tablespoon (15 mL) of a typical cooking oil (~0.92 g/mL) ≈ 14 g.
    gramsPerUnit: 14,
    matchWords: ['oil'],
    typicalQuantities: [1, 2, 3],
  },
  {
    id: 'banana',
    // USDA: 1 medium banana, peeled ≈ 118 g.
    gramsPerUnit: 118,
    matchWords: ['banana', 'bananas'],
    typicalQuantities: [1, 2],
  },
  {
    id: 'apple',
    // USDA: 1 medium apple, whole ≈ 182 g.
    gramsPerUnit: 182,
    matchWords: ['apple', 'apples'],
    typicalQuantities: [1, 2],
  },
];

const UNITS_BY_ID = new Map(HOUSEHOLD_UNITS.map((unit) => [unit.id, unit]));

/** Looks up a household unit's definition by id (for formatting/quantity presets). */
export function getHouseholdUnit(id: HouseholdUnitId): HouseholdUnit | null {
  return UNITS_BY_ID.get(id) ?? null;
}

/** Lowercase word tokens in a food name — whole-word matching only, so "eggplant" never matches "egg". */
function nameWords(name: string): Set<string> {
  return new Set(name.toLowerCase().match(/[a-z]+/g) ?? []);
}

/**
 * Finds the household unit whose match words appear as a WHOLE WORD in
 * `foodName` (first match wins, in table order — a food name is expected to
 * match at most one of these). Returns null when nothing matches; the caller
 * then falls back to `portionSize` or plain grams (see `resolveDefaultPortion`).
 *
 * @param foodName - the food's name. Pass the canonical (English) name when
 *   one is available (`FoodMatch.canonicalName`) — `matchWords` are English,
 *   so matching a localized display title is unreliable outside English-locale foods.
 */
export function matchHouseholdUnit(foodName: string): HouseholdUnit | null {
  const words = nameWords(foodName);
  for (const unit of HOUSEHOLD_UNITS) {
    if (unit.matchWords.some((word) => words.has(word))) return unit;
  }
  return null;
}
