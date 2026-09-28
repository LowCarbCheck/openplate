/**
 * Locale-aware rendering of a portion-scale multiplier hint ("1.5×").
 *
 * `PORTION_SCALE_OPTIONS` (`#app/lib/portion-preview`) is a shared, literal-
 * English table: its `hint` strings are authored once and reused by the scan,
 * add and entry-edit flows. That made the "Bigger (1.5×)" chip the only number
 * on a German edit form written with an English decimal POINT, sitting beside
 * "182 g" and "0,8 g" — the same figure, two separator conventions, one screen.
 *
 * The fix is deliberately narrow: reformat only the leading NUMERIC token and
 * leave everything else in the hint verbatim. So "1.5×" localises to "1,5×" in
 * German and stays "1.5×" in English, while "½×" (a fraction GLYPH, which no
 * locale rewrites) and the plain "1×"/"2×" come back untouched. Rendering 0.5
 * through a number formatter instead would silently demote "½×" to "0.5×" in
 * English — a copy regression, not a fix.
 */
import { numberLocale } from '#app/i18n/date-locale';

/** A leading decimal number ("1.5", "2") followed by whatever the hint suffixes it with ("×"). */
const LEADING_NUMBER = /^(\d+(?:\.\d+)?)(.*)$/;

/**
 * Localises the numeric part of a multiplier hint.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @param hint - the shared, English-authored hint (e.g. `"1.5×"`, `"½×"`).
 * @returns the hint with its leading number in the language's own notation.
 */
export function formatMultiplierHintIn(language: string | null | undefined, hint: string): string {
  const match = LEADING_NUMBER.exec(hint);
  if (!match) return hint;
  const [, digits, suffix] = match;
  const value = Number(digits);
  if (!Number.isFinite(value)) return hint;
  return `${new Intl.NumberFormat(numberLocale(language), { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}
