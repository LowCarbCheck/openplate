/**
 * The rounding formatters every macro/nutrition number passes through before it
 * is rendered. Both round to at most one decimal and trim trailing zeros so raw
 * floating-point artefacts ("8.370000000000001", "45.953") never leak into a
 * badge or summary line. Pure — unit-tested without React.
 *
 * There are TWO of them, and which one a call site wants is not a style choice.
 * This mirrors the display-vs-parsing discipline `app/i18n/date-locale.ts`
 * already applies to dates:
 *
 *  - `formatMacroNumberIn(language, value)` — DISPLAY. Locale-aware: German
 *    writes "346,7", English "346.7". Use it for anything a person only reads:
 *    a hero figure, an entry row, a chart axis, an interpolated sentence.
 *  - `formatMacroNumber(value)` — PINNED. Always the machine form ("346.7"),
 *    regardless of UI language. Use it for any value that ROUND-TRIPS: a
 *    number `<input>`'s default value, a hidden form field, anything that is
 *    parsed back with `Number()`/`parseFloat`, or compared as a string.
 *
 * Getting that backwards is silently destructive rather than merely ugly: a
 * German-formatted "346,7" placed into a number input is invalid there (the
 * field renders blank, so a saved goal looks deleted), and `Number('346,7')`
 * is `NaN`. So the pinned function keeps the short, unqualified name and no
 * language parameter at all — there is no way to "forget" to pin, only a
 * deliberate choice to localise.
 */
import { numberLocale } from '#app/i18n/date-locale';

/** Round factor for one-decimal precision. */
const ONE_DECIMAL_FACTOR = 10;

/** Rounds to one decimal, normalising the `-0` that `Math.round` can produce. */
function roundToOneDecimal(value: number): number {
  const rounded = Math.round(value * ONE_DECIMAL_FACTOR) / ONE_DECIMAL_FACTOR;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Formats a nutrition number in the PINNED machine form: at most one decimal
 * place, a `.` decimal separator in every language, trailing zeros trimmed
 * (46.0 → "46", 8.4 → "8.4"), `-0` normalised to "0".
 *
 * For anything the user only reads, use `formatMacroNumberIn` — see the module
 * doc for why this one deliberately takes no language.
 *
 * @param value - the raw number to render.
 * @returns the compact, locale-independent string representation.
 */
export function formatMacroNumber(value: number): string {
  return String(roundToOneDecimal(value));
}

/**
 * Formats a nutrition number for DISPLAY in `language`: at most one decimal
 * place, trailing zeros trimmed, and the language's own separators — "346.7"
 * in English, "346,7" in German.
 *
 * Grouping is left on (`1,467` / `1.467`), matching `numberLocale`'s documented
 * contract and the token counter in `app/services/vision/cost.ts`; only the
 * calorie figures reach four digits, and a German reader expects the dot there.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @param value - the raw number to render.
 * @returns the compact, localised string representation.
 */
export function formatMacroNumberIn(language: string | null | undefined, value: number): string {
  return new Intl.NumberFormat(numberLocale(language), { maximumFractionDigits: 1 }).format(roundToOneDecimal(value));
}

/**
 * The single character that separates a number from its unit everywhere in the
 * app: a NO-BREAK space (U+00A0).
 *
 * Two properties, both deliberate. It is a SPACE, because DIN 5008 (and every
 * other typographic convention this app renders under) puts one between a
 * figure and its unit — "0,8 g", never "0,8g". And it does not BREAK, so a
 * narrow phone can never orphan the "g" onto its own line, which is how a
 * "13,8" and a "g" end up looking like two different facts.
 *
 * It is U+00A0 rather than the typographically nicer NARROW no-break space
 * (U+202F) on purpose: dozens of translated strings in `app/i18n/locales/**`
 * carry their own `{{value}} g` with a plain space, and those are not this
 * module's to change. U+00A0 renders at the same width as that plain space, so
 * one screen stays visually uniform; U+202F would be visibly narrower and would
 * make the inconsistency worse, not better.
 */
export const UNIT_SPACE = '\u00a0';

/**
 * Formats a nutrition number for DISPLAY with its unit attached — the ONE
 * helper every "number + unit" render in the app goes through, so the spacing
 * rule is decided once instead of at each `${value}g` template literal.
 *
 * An empty `unit` returns the bare number, so a call site whose label already
 * names the quantity ("Calories 105.6") can share this seam rather than
 * branching around it.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @param value - the raw number to render.
 * @param unit - the unit symbol ("g", "kcal", "ml"), or "" for none.
 * @returns e.g. `"0,8 g"` in German, `"0.8 g"` in English (with a no-break space).
 */
export function formatMeasureIn(language: string | null | undefined, value: number, unit: string): string {
  const number = formatMacroNumberIn(language, value);
  return unit === '' ? number : `${number}${UNIT_SPACE}${unit}`;
}
