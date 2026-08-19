/**
 * date-locale.ts — the UI language → BCP-47 formatting-tag mapping.
 *
 * `Intl` needs a BCP-47 tag, not our two-letter `LanguageCode`, and "which tag
 * for which language" is a product decision rather than a mechanical
 * `language + '-' + language.toUpperCase()`. Keeping it in one pure module
 * means a display formatter anywhere in the app can ask for the right tag
 * without each call site re-deciding, and means the decision is testable.
 *
 * Two kinds of formatter, two mappings, because the answer genuinely differs
 * for English:
 *
 *  - DATE LABELS use `en-GB`, not `en-US`: the app writes days as "Sat 12 Jul"
 *    (day before month). That is what the existing UI and its tests render,
 *    and it is unambiguous next to the German "Sa., 12. Juli" — whereas
 *    `en-US`'s "Sat, Jul 12" would flip the field order between the two
 *    languages for no gain.
 *  - CLOCK TIMES use `en-US`, not `en-GB`: English-speaking users of this app
 *    expect a 12-hour clock ("8:32 AM"), which `en-GB` does not give (it is
 *    24-hour). German gets `de-DE`, which is 24-hour ("08:32") — the correct
 *    convention there.
 *
 * Pure: no i18next singleton, no React, no `document`. Callers pass the active
 * language in (`i18n.language` in a component, an explicit parameter in a pure
 * lib) so this module stays import-safe from `node:test` and from the server.
 */
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from './language-prefs';

/** Tag used for human day/date labels — see the module doc for why English is `en-GB`. */
const DATE_LABEL_LOCALES = {
  en: 'en-GB',
  de: 'de-DE',
} satisfies Record<LanguageCode, string>;

/** Tag used for wall-clock times — see the module doc for why English is `en-US`. */
const CLOCK_LOCALES = {
  en: 'en-US',
  de: 'de-DE',
} satisfies Record<LanguageCode, string>;

/** Tag used for plain numbers (thousands separators): `1,467` in English, `1.467` in German. */
const NUMBER_LOCALES = {
  en: 'en-US',
  de: 'de-DE',
} satisfies Record<LanguageCode, string>;

/**
 * Narrows any language-ish value to a supported `LanguageCode`, falling back to
 * the default rather than throwing. The input is ultimately attacker-writable
 * (the language cookie is not httpOnly) and a bad value must not be able to
 * blank the diary — the worst outcome here is English dates.
 */
function toLanguageCode(language: string | null | undefined): LanguageCode {
  return isLanguageCode(language) ? language : DEFAULT_LANGUAGE;
}

/**
 * BCP-47 tag for formatting a human-readable DATE label in `language`.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @returns the tag to hand `Intl.DateTimeFormat`.
 */
export function dateLabelLocale(language: string | null | undefined): string {
  return DATE_LABEL_LOCALES[toLanguageCode(language)];
}

/**
 * BCP-47 tag for formatting a wall-clock TIME in `language`.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @returns the tag to hand `Intl.DateTimeFormat`.
 */
export function clockLocale(language: string | null | undefined): string {
  return CLOCK_LOCALES[toLanguageCode(language)];
}

/**
 * The hour/minute field options a wall-clock time uses in `language`, meant to
 * be spread alongside `clockLocale(language)` — always pass the SAME language
 * to both.
 *
 * The tag alone isn't enough: `hour: 'numeric'` renders "8:32" under `de-DE`,
 * but German writes the 24-hour clock zero-padded ("08:32"). English keeps
 * `'numeric'` because `'2-digit'` there would produce "02:32 PM", which reads
 * like a stopwatch rather than a time of day.
 *
 * @param language - the active UI language.
 * @returns the hour/minute options to merge into an `Intl.DateTimeFormat` config.
 */
export function clockTimeOptions(language: string | null | undefined): Intl.DateTimeFormatOptions {
  return {
    hour: toLanguageCode(language) === 'en' ? 'numeric' : '2-digit',
    minute: '2-digit',
  };
}

/**
 * BCP-47 tag for formatting a plain NUMBER in `language`.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @returns the tag to hand `Intl.NumberFormat` / `toLocaleString`.
 */
export function numberLocale(language: string | null | undefined): string {
  return NUMBER_LOCALES[toLanguageCode(language)];
}
