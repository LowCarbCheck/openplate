/**
 * What the sign-up and invite letters say about where the diary lives, M3/01.
 *
 * Until 2026-10-04 both letters said "openplate is a food diary that keeps your data on your own
 * device." That is false for a hosted instance and for a self-hosted one: the account keeps an
 * encrypted copy on the server so the diary can be restored on another device. A person who pays
 * for the hosted plan reads this letter first, so the claim has a test.
 *
 * THE ENGLISH IS FIXED. The other five languages are not yet. `strings.ts` has `de` by hand and
 * four generated modules (`pnpm translate:mail`), `signup-letter-strings.ts` has all five by hand
 * (wordsmith). A person runs those passes at a keyboard, so this file FREEZES the languages that
 * still carry the old claim in `STILL_CARRIES_THE_OLD_CLAIM`, the same way the app freezes the
 * colour literals it ships. The list is held both ways: a language on it must still say the old
 * thing (the detector can fail), and a language off it must not. Emptying the list is the last
 * step of the translation pass, and the test goes red until it is done.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_STRINGS } from '../../src/mail/strings.js';
import { SIGNUP_LETTER_STRINGS } from '../../src/mail/signup-letter-strings.js';
import { INSTANCE_LANGUAGES, type InstanceLanguage } from '../../src/protocol.js';

/** The old claim in each language, as a pattern that survives the small wording gaps between letters. */
const OLD_CLAIM = {
  en: /keeps your data on your own device/,
  de: /deine Daten auf deinem eigenen Gerät speichert/,
  fr: /tes données sur ton propre appareil/,
  it: /i tuoi dati (direttamente )?sul tuo dispositivo/,
  es: /tus datos en tu propio dispositivo/,
  tr: /[Vv]erilerini kendi cihazında/,
} satisfies Record<InstanceLanguage, RegExp>;

/** The sentences as they shipped, to prove each pattern above can match. */
const OLD_SENTENCE = {
  en: 'You are invited to openplate, a food diary that keeps your data on your own device.',
  de: 'openplate ist ein Ernährungstagebuch, das deine Daten auf deinem eigenen Gerät speichert.',
  fr: 'openplate est un journal alimentaire qui conserve tes données sur ton propre appareil.',
  it: 'openplate è un diario alimentare che conserva i tuoi dati direttamente sul tuo dispositivo.',
  es: 'openplate es un diario de comidas que guarda tus datos en tu propio dispositivo.',
  tr: 'openplate, verilerini kendi cihazında saklayan bir yemek günlüğüdür.',
} satisfies Record<InstanceLanguage, string>;

/**
 * Languages still waiting for the translation pass. Remove a language here when its letters are
 * regenerated or rewritten; the test below fails if it is removed too early or kept too long.
 */
const STILL_CARRIES_THE_OLD_CLAIM: readonly InstanceLanguage[] = ['de', 'fr', 'it', 'es', 'tr'];

/** The two letters that introduce openplate to a person: the invitation and the sign-up request. */
function introductions(language: InstanceLanguage): Array<[name: string, text: string]> {
  return [
    [`invite/${language}`, MAIL_STRINGS[language].invite.invited],
    [`signup/${language}`, SIGNUP_LETTER_STRINGS[language].request.asked],
  ];
}

test('control: each pattern matches the sentence it was written to catch', () => {
  for (const language of INSTANCE_LANGUAGES) {
    assert.match(OLD_SENTENCE[language], OLD_CLAIM[language], `${language} pattern cannot match its own old claim`);
  }
});

test('the English letters say the diary lives on the device and the account keeps an encrypted copy', () => {
  for (const [name, text] of introductions('en')) {
    assert.doesNotMatch(text, OLD_CLAIM.en, `${name} still says the data stays on the device`);
    assert.match(text, /Your diary lives on your device/, `${name} lacks the device sentence`);
    assert.match(
      text,
      /your account keeps an encrypted copy on the server/,
      `${name} does not say the server keeps a copy`,
    );
  }
});

test('the English letters never claim the server cannot read the diary', () => {
  // The recovery key means the operator can read it (M3 README, "The promise"). A letter that
  // implied otherwise would repeat the mistake in the other direction.
  for (const [name, text] of introductions('en')) {
    assert.doesNotMatch(text, /cannot read|can't read|zero.knowledge|only you can/i, `${name} over-claims`);
  }
});

test('every language off the waiting list is free of the old claim', () => {
  for (const language of INSTANCE_LANGUAGES) {
    if (STILL_CARRIES_THE_OLD_CLAIM.includes(language)) continue;
    for (const [name, text] of introductions(language)) {
      assert.doesNotMatch(text, OLD_CLAIM[language], `${name} still says the data stays on the device`);
    }
  }
});

test('every language on the waiting list still carries the old claim, so the list cannot go stale', () => {
  for (const language of STILL_CARRIES_THE_OLD_CLAIM) {
    for (const [name, text] of introductions(language)) {
      assert.match(
        text,
        OLD_CLAIM[language],
        `${name} no longer says the old claim: remove ${language} from STILL_CARRIES_THE_OLD_CLAIM`,
      );
    }
  }
});
