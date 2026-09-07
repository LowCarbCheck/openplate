/**
 * No sentence in the first run says a voice message is sent.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The feature request behind M200/01 said "a voice message can be sent". The
 * app does not do that, and never has:
 *
 *  - `app/lib/speech-input.ts` wraps the browser's own Web Speech API. On
 *    Chrome the audio goes to Google, on Safari to Apple. It never reaches
 *    openplate and it never reaches the AI provider the person chose.
 *  - `app/components/add/speech-input-button.tsx` fills the add screen's
 *    SEARCH FIELD with the transcript. It creates no log entry, ever.
 *
 * So dictation is a faster way to type, and the first run is the worst place
 * in the product to teach anything else: the person has no other model of the
 * app to correct a false one against, and the first tap on the microphone
 * would already have proved the app lied. This file is the gate on that.
 *
 * ── What it can and cannot prove ─────────────────────────────────────────
 *
 * It cannot read English. What it CAN do is hold the two facts in place: the
 * strings exist in both languages, and neither language's lesson contains a
 * word from the vocabulary a voice-message claim would have to use. A new
 * false sentence that avoids every banned word would pass, which is why the
 * banned list is about SENDING and about LOGGING, the two verbs the claim
 * cannot be made without.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { WAYS_TO_LOG_DICTATION_KEY, waysToLogCopyKeys } from '../../app/lib/ways-to-log';

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
 * Words a voice-message claim cannot be made without, in both languages.
 *
 * "send" is the request's own verb. "record", "audio" and "voice message"
 * are the shapes it would be reworded into. "upload" is the same claim about
 * the file. `log`/`eintragen` next to speaking is the OTHER false claim: that
 * a spoken sentence creates a diary entry.
 */
const FORBIDDEN = [
  /\bsend(s|ing)?\b/i,
  /\bsent\b/i,
  /\bupload(s|ed|ing)?\b/i,
  /\bvoice message\b/i,
  /\brecord(s|ed|ing)?\b/i,
  /\baudio\b/i,
  /\bsprachnachricht\b/i,
  /\bsende(n|st|t)?\b/i,
  /\bgesendet\b/i,
  /\bhochlade(n|st|t)?\b/i,
  /\bhochgeladen\b/i,
  /\baufnahme\b/i,
  /\baufzeichn/i,
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

describe('no string in the lesson claims a voice message is sent, or that speaking logs a food', () => {
  for (const locale of LOCALES) {
    it(`${locale} uses none of the vocabulary that claim needs`, () => {
      for (const { key, value } of lessonStrings(locale)) {
        for (const pattern of FORBIDDEN) {
          assert.doesNotMatch(
            value,
            pattern,
            `${locale}.${key} reads "${value}". The app has no voice message: Web Speech hands the browser's own transcript to the SEARCH FIELD (see this file's header). Fix the sentence, not this test.`,
          );
        }
      }
    });
  }
});

/**
 * wordsmith (`google/gemini-3.8-flash`) is the FINAL JUDGE on German copy
 * (see the workspace `CLAUDE.md`), and it legitimately rephrases this note
 * over time: "... und wird nie von selbst eingetragen" became "... und trägt
 * nie selbstständig etwas ein" without changing what the sentence claims. So
 * this file must not pin one exact wording, or the next honest rephrase
 * breaks a passing test for no reason. What it DOES pin is the one fact the
 * note exists to state: that speaking never enters a food by itself. It
 * checks that the German string carries SOME explicit negation of automatic
 * entry -- "nie" (never) next to a word for "by itself" / "on its own" /
 * "automatically", in the same sentence -- and this accepted set grows the
 * next time wordsmith rewords it again.
 */
const GERMAN_NEGATES_AUTOMATIC_ENTRY = [
  /\bnie\b[^.]*\bvon\s+selbst\b/i, // "... nie von selbst ..." (the original wording)
  /\bnie\b[^.]*\bselbstständig\b/i, // "... nie selbstständig ..." (the current wording)
  /\bnie\b[^.]*\bselbständig\b/i, // the older spelling of the same word
  /\bnie\b[^.]*\bautomatisch\b/i, // "... nie automatisch ..."
];

describe('the dictation note says the two true things', () => {
  it('en names the search box, and says speaking does not log', () => {
    const en = read(loadCatalog('en'), WAYS_TO_LOG_DICTATION_KEY);
    assert.ok(en !== undefined);
    assert.match(en, /search box/i, 'the note stopped naming where the transcript actually goes');
    assert.match(en, /never logs/i, 'the note stopped ruling out the claim it exists to rule out');
  });

  it('de names the search field, and says speaking does not enter anything', () => {
    const de = read(loadCatalog('de'), WAYS_TO_LOG_DICTATION_KEY);
    assert.ok(de !== undefined);
    assert.match(de, /suchfeld/i, 'the German note stopped naming where the transcript actually goes');
    assert.ok(
      GERMAN_NEGATES_AUTOMATIC_ENTRY.some((pattern) => pattern.test(de)),
      `the German note reads "${de}" and none of the accepted phrasings rule out automatic logging any more. wordsmith owns this wording -- if it rephrased the negation again, add the new shape to GERMAN_NEGATES_AUTOMATIC_ENTRY, don't loosen this check to pass on any string`,
    );
  });
});

describe('the two source facts the copy rests on', () => {
  it("speech input is still the BROWSER's recognizer, not a call openplate makes", () => {
    const speech = readFileSync(fileURLToPath(new URL('../../app/lib/speech-input.ts', import.meta.url)), 'utf8');
    assert.match(
      speech,
      /window\.SpeechRecognition \?\? window\.webkitSpeechRecognition/,
      "speech input no longer resolves the browser's own recognizer. If audio now leaves through openplate, this whole lesson needs rewriting",
    );
    assert.doesNotMatch(speech, /\bfetch\(/, 'speech-input.ts now makes a network call of its own');
  });

  it('the microphone button still only fills the search field', () => {
    const button = readFileSync(
      fileURLToPath(new URL('../../app/components/add/speech-input-button.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(button, /A way to TYPE, not a way to log/, 'the microphone button changed what it is');
  });
});
