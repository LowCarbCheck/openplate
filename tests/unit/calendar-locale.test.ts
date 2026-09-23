/**
 * Unit tests for `app/i18n/calendar-locale.ts`, the date picker's locale per
 * app language (M251 spec 01).
 *
 * The picker needs a locale OBJECT, so it cannot read `dateLabelLocale`'s tag
 * directly. What these tests hold is that the object never makes a second
 * decision: its code is the tag `date-locale.ts` already chose, language by
 * language, so the picker and every day label agree on the region.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enUS } from 'react-day-picker/locale';

import { calendarDayButtonLabel, calendarLocale } from '../../app/i18n/calendar-locale';
import { dateLabelLocale } from '../../app/i18n/date-locale';
import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';

/** Whether a picker locale code names the same language and region as a BCP-47 date tag. */
function agreesWithDateTag(code: string, tag: string): boolean {
  return tag === code || tag.startsWith(`${code}-`);
}

describe('calendarLocale', () => {
  it('follows the date-label tag for every app language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const { code } = calendarLocale(language);
      assert.ok(
        agreesWithDateTag(code, dateLabelLocale(language)),
        `${language}: picker locale ${code} against date tag ${dateLabelLocale(language)}`,
      );
    }
  });

  it('control: the American locale does NOT agree with the English date tag', () => {
    // Without this, a check that accepted any English locale would pass the
    // default the picker used to fall back to.
    assert.equal(agreesWithDateTag(enUS.code, dateLabelLocale('en')), false);
  });

  it('gives a distinct locale to every app language', () => {
    const codes = new Set(SUPPORTED_LANGUAGES.map((language) => calendarLocale(language).code));
    assert.equal(codes.size, SUPPORTED_LANGUAGES.length);
  });

  it('starts the week on Monday in every app language, as every week in the app is counted', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      assert.equal(calendarLocale(language).options?.weekStartsOn, 1, language);
    }
  });

  it('falls back to the English picker for a value that is not an app language', () => {
    assert.equal(calendarLocale('xx').code, calendarLocale('en').code);
    assert.equal(calendarLocale(null).code, calendarLocale('en').code);
  });
});

describe('calendarDayButtonLabel', () => {
  // A day that is both today and selected, so the label carries both words.
  const day = new Date(2026, 2, 10);
  const modifiers = { today: true, selected: true };

  it('is a callable label in every app language, and each language says it differently', () => {
    const labels = SUPPORTED_LANGUAGES.map((language) =>
      calendarDayButtonLabel(language)(day, modifiers, { locale: calendarLocale(language) }),
    );
    for (const label of labels) assert.ok(label.length > 0);
    assert.equal(new Set(labels).size, SUPPORTED_LANGUAGES.length);
  });

  it('control: the German label is not the English one with a German date inside', () => {
    // react-day-picker's exported `labelDayButton` formats the date in the
    // locale it is given but adds "Today" and "selected" in English. This is
    // the label the diary used to build on.
    const german = calendarDayButtonLabel('de')(day, modifiers, { locale: calendarLocale('de') });
    const englishWords = calendarDayButtonLabel('en')(day, modifiers, { locale: calendarLocale('en') });
    const englishFirstWord = englishWords.split(',')[0] ?? '';
    assert.ok(englishFirstWord.length > 0);
    assert.equal(german.includes(englishFirstWord), false);
  });
});
