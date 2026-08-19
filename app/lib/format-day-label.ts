/**
 * Human day label ("Sat 12 Jul") for a `YYYY-MM-DD` calendar date. Pure — no DB,
 * no React. Used by the /add and /scan "logging to <day>" context banners and
 * their success toasts when the user logs to a day other than today.
 *
 * A calendar date's weekday is timezone-invariant (2026-07-12 is a Sunday
 * everywhere), so the parts are read in UTC and never shifted by the runtime
 * zone — no time-zone argument is needed.
 *
 * The label IS user-facing text, so it follows the active UI language: a
 * German UI rendering "Sat 12 Jul" is the same bug as an untranslated string.
 * The language is an explicit parameter rather than a read of the i18next
 * singleton, so this module stays pure and `node:test`-importable.
 */
import { DEFAULT_LANGUAGE } from '#app/i18n/language-prefs';
import { dateLabelLocale } from '#app/i18n/date-locale';

/** Matches a bare `YYYY-MM-DD` calendar date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * One formatter per locale, built lazily and kept forever. `Intl.DateTimeFormat`
 * construction is the expensive part (locale data resolution) and this runs on
 * every diary render, so a per-call `new` would be a real cost — the previous
 * module-level singleton existed for exactly that reason. The key space is the
 * supported-language list, so this cannot grow unboundedly.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/** Abbreviated weekday + day + abbreviated month, in the locale's own field order. */
function dayLabelFormatter(locale: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(locale);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  FORMATTER_CACHE.set(locale, formatter);
  return formatter;
}

/**
 * Formats a `YYYY-MM-DD` calendar date as a compact day label — "Sat 12 Jul"
 * in English, "Sa., 12. Juli" in German.
 *
 * @param date - the calendar date as `YYYY-MM-DD`.
 * @param language - the active UI language; defaults to English.
 * @returns the human-readable day label.
 * @throws if `date` is not a `YYYY-MM-DD` string.
 */
export function formatDayLabel(date: string, language: string = DEFAULT_LANGUAGE): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return dayLabelFormatter(dateLabelLocale(language)).format(instant);
}
