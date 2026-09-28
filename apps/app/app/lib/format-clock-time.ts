/**
 * Wall-clock time for an epoch instant — "8:32 AM" in English, "08:32" in
 * German (12- vs 24-hour is a locale convention, not a setting).
 *
 * The shared version of a formatting pair the app already spells out twice, in
 * `diary.tsx`'s `formatEntryTime` and in `diary.entry.$id.tsx`. M132 needed a
 * third call site and put THIS module there rather than a fourth copy; adopting
 * it in the two diary routes is a real follow-up and deliberately not done in
 * the same round as a new feature.
 *
 * Pure and store-free, so it unit-tests without a browser.
 */
import { clockLocale, clockTimeOptions } from '#app/i18n/date-locale';

/**
 * Formats an instant as a wall-clock time in the given zone and language.
 *
 * @param atMs - the epoch-ms instant.
 * @param options - the IANA `timezone` to read it in and the active `language`.
 * @returns the localized clock time.
 */
export function formatClockTime(atMs: number, { timezone, language }: { timezone: string; language: string }): string {
  return new Intl.DateTimeFormat(clockLocale(language), {
    timeZone: timezone,
    ...clockTimeOptions(language),
  }).format(atMs);
}
