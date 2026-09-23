/**
 * calendar-locale.ts: the UI language to the date picker's locale object.
 *
 * `react-day-picker` does not take a BCP-47 tag. It takes a date-fns locale
 * object with its own translated labels, so the picker cannot read
 * `dateLabelLocale` directly and needs one object per language.
 *
 * THIS IS NOT A SECOND DECISION. Which regional variant a language uses is
 * decided once, in `date-locale.ts`, and each object below is the one that
 * matches that tag: English is `enGB` because the date labels are `en-GB`,
 * which also starts the week on Monday, the way every week in this app is
 * counted (`adherence-grid-days.ts`, `slot-stats.ts`).
 * `tests/unit/calendar-locale.test.ts` fails the day the two disagree.
 *
 * The map is checked with `satisfies Record<LanguageCode, ...>`, so a seventh
 * language is a typecheck failure here until it has a picker locale.
 */
import { labelDayButton as englishDayButtonLabel, type DayPickerLocale } from 'react-day-picker';
import { de, enGB, es, fr, it, tr } from 'react-day-picker/locale';

import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from './language-prefs';

const CALENDAR_LOCALES = {
  en: enGB,
  de,
  fr,
  it,
  es,
  tr,
} satisfies Record<LanguageCode, DayPickerLocale>;

/**
 * The date picker's locale for `language`.
 *
 * A value that is not a supported language falls back to the default rather
 * than throwing, for the reason `date-locale.ts` gives: the language cookie is
 * writable by anyone, and the worst outcome here must be an English calendar.
 *
 * @param language - the active UI language (`i18n.language`, or a stored code).
 * @returns the locale object to hand `<DayPicker locale>`.
 */
export function calendarLocale(language: string | null | undefined): DayPickerLocale {
  return CALENDAR_LOCALES[isLanguageCode(language) ? language : DEFAULT_LANGUAGE];
}

/** The function react-day-picker calls for a day button's `aria-label`. */
export type DayButtonLabel = typeof englishDayButtonLabel;

/**
 * The day-button label for `language`, for a caller that decorates it.
 *
 * react-day-picker's exported `labelDayButton` is the ENGLISH one: it appends
 * "Today" and "selected" in English whatever locale the picker has. A caller
 * that wraps the label (the diary adds each day's goal status) has to start
 * from the locale's own, or a German picker reads "Today, Dienstag, …".
 *
 * @param language - the active UI language.
 * @returns the locale's day-button label function.
 */
export function calendarDayButtonLabel(language: string | null | undefined): DayButtonLabel {
  // SAFETY: each of the six objects in CALENDAR_LOCALES defines
  // `labels.labelDayButton` as a function (`react-day-picker/locale/<code>.js`).
  // The library types it `string | function` only because a locale MAY give a
  // constant; `tests/unit/calendar-locale.test.ts` calls it for every language.
  return (calendarLocale(language).labels?.labelDayButton ?? englishDayButtonLabel) as DayButtonLabel;
}
