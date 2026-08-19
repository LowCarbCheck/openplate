/**
 * Real portion choices ("1 egg" / "2 eggs" / "3 eggs"), the replacement for
 * the old flat ½×/1×/1.5×/2× multiplier chips in non-photo entry points (see
 * `#app/lib/portion-preview`'s scope note on why that shared module keeps its
 * own, photo-specific chip set for scan.tsx).
 */
import { roundToTenth } from '#app/lib/portion-preview';
import { getHouseholdUnit } from './household-units';
import type { DisplayPortion, PortionUnitId } from './types';

/** The quantities offered for the generic "serving" unit (no named household unit matched, but a `portionSize` was known). */
const SERVING_TYPICAL_QUANTITIES: readonly number[] = [1, 2, 3];

/** A single selectable portion choice — a real quantity+unit chip, e.g. "2 eggs". */
export interface PortionChoice {
  quantity: number;
  unit: PortionUnitId;
  /** Human label, e.g. "2 eggs", "1 cup", "1 serving". */
  label: string;
  /** Grams this choice represents. */
  grams: number;
}

function isNamedHouseholdUnit(unit: PortionUnitId): unit is Exclude<PortionUnitId, 'serving'> {
  return unit !== 'serving';
}

/** Formats a whole/half quantity as a compact glyph where one exists, digits otherwise. */
function formatPortionQuantity(quantity: number): string {
  if (quantity === 0.5) return '½';
  if (quantity === 1.5) return '1½';
  return String(quantity);
}

/**
 * Formats a unit + quantity into a plain-English label — no jargon, singular/
 * plural aware ("1 egg" vs "2 eggs"). Plural only kicks in ABOVE one, so a
 * half quantity reads "½ cup", not "½ cups" (English convention: "half a
 * cup", not "half cups").
 */
export function formatPortionLabel({ unit, quantity }: { unit: PortionUnitId; quantity: number }): string {
  const quantityLabel = formatPortionQuantity(quantity);
  const isPlural = quantity > 1;
  if (unit === 'serving') return `${quantityLabel} ${isPlural ? 'servings' : 'serving'}`;
  const householdUnit = getHouseholdUnit(unit);
  const noun = householdUnit ? (isPlural ? householdUnit.labelPlural : householdUnit.label) : unit;
  return `${quantityLabel} ${noun}`;
}

/**
 * The chip choices for a resolved default portion (see `resolveDefaultPortion`
 * in `default-portion.ts`). Quantities come from the matched household unit's
 * own `typicalQuantities` (e.g. eggs offer 1/2/3, a cup of rice offers
 * ½/1/1½); the generic "serving" unit offers 1/2/3. A grams input stays
 * available alongside these in the UI for anyone who weighs their food — this
 * function only produces the chip row, never removes the grams field.
 */
export function derivePortionChoices(portion: DisplayPortion): PortionChoice[] {
  const householdUnit = isNamedHouseholdUnit(portion.unit) ? getHouseholdUnit(portion.unit) : null;
  const quantities = householdUnit?.typicalQuantities ?? SERVING_TYPICAL_QUANTITIES;
  return quantities.map((quantity) => ({
    quantity,
    unit: portion.unit,
    label: formatPortionLabel({ unit: portion.unit, quantity }),
    grams: roundToTenth(quantity * portion.gramsPerUnit),
  }));
}

/**
 * Which choice (if any) `currentGrams` corresponds to, so chip selection is a
 * function of the grams field — never duplicated state. Mirrors
 * `derivePortionMultiplier`'s pattern in `#app/lib/portion-preview`. Returns
 * null when a manual grams edit matches no choice (all chips deselected).
 */
export function deriveSelectedPortionQuantity({
  choices,
  currentGrams,
}: {
  choices: readonly PortionChoice[];
  currentGrams: number;
}): number | null {
  const target = roundToTenth(currentGrams);
  const match = choices.find((choice) => choice.grams === target);
  return match ? match.quantity : null;
}
