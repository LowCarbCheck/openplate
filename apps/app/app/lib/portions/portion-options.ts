/**
 * Real portion choices ("1 egg" / "2 eggs" / "3 eggs"), the replacement for
 * the old flat ½×/1×/1.5×/2× multiplier chips in non-photo entry points (see
 * `#app/lib/portion-preview`'s scope note on why that shared module keeps its
 * own, photo-specific chip set for scan.tsx).
 */
import { numberLocale } from '#app/i18n/date-locale';
import { translateStatic } from '#app/i18n/meta-title';
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

/**
 * Formats a whole/half quantity as a compact glyph where one exists, and
 * otherwise as a LOCALISED number — a stray 2.5 reads "2,5" in German, the
 * same convention every other figure in the app follows (`numberLocale`).
 *
 * The two glyphs are deliberately not localised: `½` and `1½` are typographic
 * characters, not digits, and both English and German recipe writing use them
 * as-is.
 */
function formatPortionQuantity(quantity: number, language: string | null | undefined): string {
  if (quantity === 0.5) return '½';
  if (quantity === 1.5) return '1½';
  return new Intl.NumberFormat(numberLocale(language), { maximumFractionDigits: 2 }).format(quantity);
}

/** The catalog key for a unit noun, in i18next's own plural-suffix form (`portions.unit.egg_one`). */
function portionUnitKey(unit: PortionUnitId, isPlural: boolean): string {
  return `portions.unit.${unit}_${isPlural ? 'other' : 'one'}`;
}

/**
 * Formats a unit + quantity into a TRANSLATED label — "2 eggs" in English,
 * "2 Eier" in German. Singular/plural aware, and plural only kicks in ABOVE
 * one, so a half quantity reads "½ cup" / "½ Tasse", not "½ cups" (English
 * convention: "half a cup", not "half cups"; German agrees).
 *
 * The language is a PARAMETER rather than a read of the i18next singleton:
 * this helper is pure and is called from `meta()`-adjacent pure code and from
 * the server, where that singleton is one process-wide instance shared by
 * every in-flight request (see `#app/i18n/meta-title`'s module doc). A React
 * caller passes `i18n.language`; a pure caller passes the language it was
 * already handed.
 *
 * Only the UI vocabulary is translated here. A food-specific portion name
 * that came from the catalogue ("1 apple" off a food row) is DATA, not UI,
 * and is never routed through this function.
 *
 * @param unit - the portion unit id.
 * @param quantity - how many of `unit`.
 * @param language - the active UI language; an unknown value degrades to English.
 * @returns e.g. `"2 eggs"`, `"2 Eier"`, `"½ cup"`.
 */
export function formatPortionLabel({
  unit,
  quantity,
  language,
}: {
  unit: PortionUnitId;
  quantity: number;
  language: string | null | undefined;
}): string {
  const count = formatPortionQuantity(quantity, language);
  const key = portionUnitKey(unit, quantity > 1);
  const translated = translateStatic(language, key, { count });
  // A missing key resolves to the key itself (`translateStatic`'s documented
  // last resort). Rendering "portions.unit.egg_one" on a chip would be worse
  // than the untranslated noun, so fall back to the raw unit id instead.
  return translated === key ? `${count} ${unit}` : translated;
}

/**
 * The chip choices for a resolved default portion (see `resolveDefaultPortion`
 * in `default-portion.ts`). Quantities come from the matched household unit's
 * own `typicalQuantities` (e.g. eggs offer 1/2/3, a cup of rice offers
 * ½/1/1½); the generic "serving" unit offers 1/2/3. A grams input stays
 * available alongside these in the UI for anyone who weighs their food — this
 * function only produces the chip row, never removes the grams field.
 *
 * @param portion - the resolved default portion (unit + reference grams).
 * @param language - the active UI language, for the chip labels (see `formatPortionLabel`).
 */
export function derivePortionChoices(portion: DisplayPortion, language: string | null | undefined): PortionChoice[] {
  const householdUnit = isNamedHouseholdUnit(portion.unit) ? getHouseholdUnit(portion.unit) : null;
  const quantities = householdUnit?.typicalQuantities ?? SERVING_TYPICAL_QUANTITIES;
  return quantities.map((quantity) => ({
    quantity,
    unit: portion.unit,
    label: formatPortionLabel({ unit: portion.unit, quantity, language }),
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
