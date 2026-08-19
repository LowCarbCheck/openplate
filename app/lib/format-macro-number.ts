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
