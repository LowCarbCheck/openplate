/**
 * The browser's own language list (`Accept-Language`), read for the app's six languages.
 *
 * ONE CALLER, ON PURPOSE. The app itself never reads this header: `<html lang>` and every string
 * come from the language cookie and then `DEFAULT_UI_LANGUAGE` (`language-prefs.ts` says why the
 * cookie is the only server signal the app trusts, and i18next detects from it alone). The moved
 * page (`app/lib/moved/`) is the exception. It is the one page a person may meet with no cookie
 * and no earlier visit, and it runs no script that could ask them, so the browser's list is the
 * best answer between their own choice and the operator's default.
 *
 * Client- and server-safe, no imports beyond the language list.
 */
import { isLanguageCode, type LanguageCode } from './language-prefs';

/** One entry of the header: a language range and the weight the browser gave it. */
interface WeightedRange {
  readonly range: string;
  readonly quality: number;
  /** Where it stood in the header, so equal weights keep the browser's own order. */
  readonly position: number;
}

/** `q=` followed by a weight between 0 and 1, the only parameter a language range carries. */
const QUALITY_PARAMETER = /^q=(\d(?:\.\d{0,3})?)$/i;

/**
 * Reads one comma-separated entry. An entry whose weight does not parse is dropped, as RFC 9110
 * asks, rather than read as the default weight of 1.
 */
function readRange(entry: string, position: number): WeightedRange | null {
  const [range = '', ...parameters] = entry.split(';').map((part) => part.trim());
  if (range === '') return null;
  const qualityParameter = parameters.find((parameter) => parameter.toLowerCase().startsWith('q='));
  if (qualityParameter === undefined) return { range, quality: 1, position };
  const match = QUALITY_PARAMETER.exec(qualityParameter);
  const quality = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(quality) || quality > 1) return null;
  return { range, quality, position };
}

/**
 * The first of the app's languages the browser asks for, heaviest weight first.
 *
 * A region is ignored (`de-AT` asks for `de`), a weight of 0 means "not this one", and the
 * wildcard `*` names no language, so it never picks one.
 *
 * @param header - the request's `Accept-Language` header, or `null` when it sent none.
 * @returns the language, or `null` when the header names none of the six.
 */
export function pickAcceptedLanguage(header: string | null): LanguageCode | null {
  if (header === null) return null;
  const ranked = header
    .split(',')
    .map((entry, position) => readRange(entry, position))
    .filter((range): range is WeightedRange => range !== null && range.quality > 0)
    .toSorted((left, right) => right.quality - left.quality || left.position - right.position);
  for (const { range } of ranked) {
    const primary = range.split('-')[0]?.toLowerCase();
    if (isLanguageCode(primary)) return primary;
  }
  return null;
}
