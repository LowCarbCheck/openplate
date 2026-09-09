/**
 * No sentence in the first run says a RECORDING is sent anywhere.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The feature request behind M200/01 said "a voice message can be sent". The
 * app does not do that, and never has:
 *
 *  - There is no microphone in this app at all since M203. A person dictates
 *    with the KEYBOARD's dictation key, which turns speech into text on the
 *    phone (Google on an Android keyboard, Apple on iOS) and types the result
 *    into the field. openplate has no part in that step.
 *  - What leaves this app is TEXT, exactly as if it had been typed.
 *
 * ── What changed on 2026-09-08, and why this file had to change with it ──
 *
 * Speaking used to fill the search field and stop there, so this file also
 * banned the vocabulary of LOGGING next to speech, and the lesson's own
 * footnote said the microphone "never logs a food by itself".
 *
 * A finished transcript now runs the same AI intake a typed sentence does and
 * lands on the same review screen. Speaking IS a way to log. That made the
 * footnote a false sentence in the one place a person has nothing to check it
 * against, and it made half of this file's ban a gate holding the lie in
 * place: a source-inspection test that passes while the product has moved
 * underneath it is worse than no test, because it reads as coverage.
 *
 * So the LOGGING half of the ban is gone and the SENDING half stays, narrowed
 * to what is still true and still worth protecting: openplate never receives,
 * uploads or stores a recording. The privacy note under the speak card now
 * carries that fact instead of the old one.
 *
 * ── What changed again on 2026-09-09 (M203) ──────────────────────────────
 *
 * The in-app Web Speech microphone was removed. Every failure of it was
 * announced only to an `sr-only` live region, so on a phone it was a button
 * that visibly did nothing. The note therefore has one more job: it must point
 * at the keyboard's dictation key, because that is now the only way to dictate,
 * and it must not imply this app listens. The vendor names stay true, since the
 * keyboard is Google's or Apple's.
 *
 * ── What it can and cannot prove ─────────────────────────────────────────
 *
 * It cannot read English. What it CAN do is hold the facts in place: the
 * strings exist in both languages, and neither language's lesson contains a
 * word from the vocabulary an "openplate records you" claim would need. A new
 * false sentence that avoids every banned word would pass, which is why the
 * banned list is about the RECORDING and about SENDING it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { WAYS_TO_LOG_SPEECH_PRIVACY_KEY, waysToLogCopyKeys } from '../../app/lib/ways-to-log';

/** Every `.ts`/`.tsx` file under a directory, so a sweep cannot miss a subfolder. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

type Catalog = { [key: string]: string | Catalog };

const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/**
 * The translated string at a dotted path, or `undefined` for a miss or a
 * non-leaf. Walked with the schemas rather than a `typeof` check, exactly as
 * `i18n-key-parity.test.ts` does it.
 */
function read(catalog: Catalog, path: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of path.split('.')) {
    const group = catalogSchema.safeParse(node);
    if (!group.success) return undefined;
    node = group.data[part];
  }
  return leafSchema.safeParse(node).data;
}

const LOCALES = ['en', 'de'] as const;

/** Every string the lesson renders, per locale. */
function lessonStrings(locale: string): { key: string; value: string }[] {
  const catalog = loadCatalog(locale);
  return waysToLogCopyKeys().map((key) => {
    const value = read(catalog, key);
    assert.ok(value !== undefined, `${locale} is missing ${key}`);
    return { key, value };
  });
}

/**
 * Words an "openplate records you" claim cannot be made without, in both
 * languages.
 *
 * "voice message" is the request's own phrase. "record" and "audio" are the
 * shapes it would be reworded into. "upload" is the same claim about the file.
 *
 * `send`/`senden` is NOT banned outright any more, because one true sentence
 * now needs it: the privacy note has to say the browser sends the voice to
 * Google or Apple. It is banned everywhere ELSE in the lesson, which is where
 * a false version of the claim would appear, and the note itself is checked
 * separately below for saying the true thing.
 *
 * The old ban on `log`/`eintragen` beside speech is GONE, deliberately.
 * Speaking logs now. See this file's header.
 */
const FORBIDDEN = [
  /\bupload(s|ed|ing)?\b/i,
  /\bvoice message\b/i,
  /\brecord(s|ed|ing)?\b/i,
  /\baudio\b/i,
  /\bsprachnachricht\b/i,
  /\bhochlade(n|st|t)?\b/i,
  /\bhochgeladen\b/i,
  /\baufnahme\b/i,
  /\baufzeichn/i,
];

/** Banned in every string EXCEPT the privacy note, which needs it to be true. */
const FORBIDDEN_OUTSIDE_THE_PRIVACY_NOTE = [/\bsend(s|ing)?\b/i, /\bsent\b/i, /\bsende(n|st|t)?\b/i, /\bgesendet\b/i];

/**
 * The words a claim that THIS APP listens would need, banned everywhere in the
 * lesson including the note.
 *
 * `our microphone` and `in the app` are the shapes the false version takes.
 * The plain word `microphone` is NOT banned: the note has to name the
 * microphone KEY on the keyboard, which is the true and useful sentence.
 */
const FORBIDDEN_APP_MICROPHONE = [
  /\bopenplate('s)? microphone\b/i,
  /\bmikrofon von openplate\b/i,
  /\btap the microphone\b(?! key)/i,
];

describe('the lesson exists in both languages', () => {
  for (const locale of LOCALES) {
    it(`${locale} carries every string the lesson renders`, () => {
      const strings = lessonStrings(locale);
      assert.equal(strings.length, waysToLogCopyKeys().length);
      for (const { key, value } of strings) {
        assert.ok(value.trim().length > 0, `${locale}.${key} is blank`);
      }
    });
  }
});

describe('no string in the lesson claims openplate records anybody', () => {
  for (const locale of LOCALES) {
    it(`${locale} uses none of the vocabulary that claim needs`, () => {
      for (const { key, value } of lessonStrings(locale)) {
        for (const pattern of FORBIDDEN) {
          assert.doesNotMatch(
            value,
            pattern,
            `${locale}.${key} reads "${value}". openplate never receives a recording: Web Speech hands the BROWSER's own transcript back, and only text travels from there (see this file's header). Fix the sentence, not this test.`,
          );
        }
      }
    });

    it(`${locale} never claims openplate has a microphone of its own`, () => {
      for (const { key, value } of lessonStrings(locale)) {
        for (const pattern of FORBIDDEN_APP_MICROPHONE) {
          assert.doesNotMatch(
            value,
            pattern,
            `${locale}.${key} reads "${value}". This app has no microphone since M203: only the keyboard's dictation key does. Fix the sentence, not this test.`,
          );
        }
      }
    });

    it(`${locale} says nothing is sent, except where the note truthfully says who turns speech into text`, () => {
      for (const { key, value } of lessonStrings(locale)) {
        if (key === WAYS_TO_LOG_SPEECH_PRIVACY_KEY) continue;
        for (const pattern of FORBIDDEN_OUTSIDE_THE_PRIVACY_NOTE) {
          assert.doesNotMatch(
            value,
            pattern,
            `${locale}.${key} reads "${value}". Only the privacy note may talk about sending, and only about the BROWSER sending the voice to its own maker.`,
          );
        }
      }
    });
  }
});

/**
 * What the privacy note has to say, in each language.
 *
 * wordsmith (`google/gemini-3.8-flash`) is the FINAL JUDGE on this copy (see
 * the workspace `CLAUDE.md`) and legitimately rephrases it over time, so this
 * must not pin one exact wording. What it DOES pin is the three facts the note
 * exists to state, each as a small set of accepted shapes that grows the next
 * time wordsmith rewords it: that the KEYBOARD is where dictation happens,
 * that its maker turns the speech into text, and that only the TEXT travels
 * onward.
 */
const NAMES_THE_KEYBOARD = {
  en: [/\bkeyboard\b/i],
  de: [/\btastatur\b/i],
};

const NAMES_THE_VENDOR = {
  en: [/\bgoogle\b/i, /\bapple\b/i],
  de: [/\bgoogle\b/i, /\bapple\b/i],
};

const SAYS_ONLY_TEXT_TRAVELS = {
  en: [/\bonly the text\b/i, /\btext only\b/i],
  de: [/\bnur der text\b/i, /\bnur den text\b/i, /\bausschließlich der text\b/i],
};

describe('the privacy note says every true thing it has to', () => {
  for (const locale of LOCALES) {
    it(`${locale} names the keyboard and its maker, and says only text travels`, () => {
      const note = read(loadCatalog(locale), WAYS_TO_LOG_SPEECH_PRIVACY_KEY);
      assert.ok(note !== undefined, `${locale} is missing the privacy note`);
      for (const keyboard of NAMES_THE_KEYBOARD[locale]) {
        assert.match(
          note,
          keyboard,
          `the ${locale} note stopped naming the keyboard, which is now the only place dictation happens`,
        );
      }
      for (const vendor of NAMES_THE_VENDOR[locale]) {
        assert.match(note, vendor, `the ${locale} note stopped naming who actually turns the speech into text`);
      }
      assert.ok(
        SAYS_ONLY_TEXT_TRAVELS[locale].some((pattern) => pattern.test(note)),
        `the ${locale} note reads "${note}" and no longer rules out the recording travelling onward. wordsmith owns this wording: if it rephrased the claim, add the new shape to SAYS_ONLY_TEXT_TRAVELS, do not loosen this check to pass on any string`,
      );
    });
  }
});

describe('the source fact the copy rests on', () => {
  it('no file in the app touches a speech recogniser at all', () => {
    const offenders = sourceFiles(fileURLToPath(new URL('../../app', import.meta.url)))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /SpeechRecognition|webkitSpeechRecognition|MediaRecorder|getUserMedia/.test(source);
      })
      .map((file) => file.slice(file.indexOf('/app/')));
    assert.deepEqual(
      offenders,
      [],
      'a recogniser or a recorder is back in the app. The lesson says openplate has no microphone: rewrite the lesson or drop the code',
    );
  });

  it('reads enough files for the sweep above to mean anything', () => {
    // THE CONTROL. A walk that silently returned nothing would report a clean
    // app forever, which is the failure mode this whole file exists to refuse.
    const files = sourceFiles(fileURLToPath(new URL('../../app', import.meta.url)));
    assert.ok(files.length > 100, `only walked ${files.length} files under app/`);
    assert.ok(
      files.some((file) => file.endsWith('/routes/describe.tsx')),
      'the composer itself was not among the files swept',
    );
  });
});
