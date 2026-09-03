/**
 * The three pure pieces of voice input on the add screen: feature detection,
 * the UI-language → BCP-47 mapping, and the consent gate.
 *
 * WHY THESE THREE. Voice input is the only path in this app that hands a
 * recording to a third party (the browser's maker, not openplate and not the
 * person's own AI provider). Everything about it that can be decided without a
 * DOM is decided here, so the claim that matters — a device that has never
 * accepted the disclosure can never reach `'listen'` — is checked as
 * arithmetic rather than as a rendering accident.
 *
 * The detection tests pass a plain object as the scope on purpose. The real
 * call reads `window`, but the question "does this browser have a recogniser"
 * is a question about two property names, and a fake scope is a truer test of
 * it than a jsdom that would have to be taught the same two names anyway.
 *
 * If you are reading this because a test here failed: check that the button
 * still cannot appear (`'hidden'`) without a recogniser and cannot listen
 * without consent. Both are user-facing promises, not implementation details.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySpeechError,
  isSpeechInputAvailable,
  resolveSpeakAction,
  speechLanguageTag,
  type SpeechRecognitionLike,
} from '../../app/lib/speech-input';
import { speechResultsMessage, type Translate } from '../../app/routes/add';

/**
 * A stand-in recogniser constructor. Every method that would touch a
 * microphone throws, so a detection path that did more than read a property
 * name fails here loudly instead of quietly opening one.
 */
class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  addEventListener(): void {
    throw new Error('the detection must never subscribe to a recogniser');
  }
  start(): void {
    throw new Error('the detection must never start a recogniser');
  }
  stop(): void {
    throw new Error('the detection must never stop a recogniser');
  }
  abort(): void {
    throw new Error('the detection must never abort a recogniser');
  }
}

describe('isSpeechInputAvailable', () => {
  it('finds the standard global', () => {
    assert.equal(isSpeechInputAvailable({ SpeechRecognition: FakeRecognition }), true);
  });

  it('finds the WebKit-prefixed global — that is the only one Safari ships', () => {
    assert.equal(isSpeechInputAvailable({ webkitSpeechRecognition: FakeRecognition }), true);
  });

  it('is false for a browser with neither — Firefox is a supported outcome, not a degraded one', () => {
    assert.equal(isSpeechInputAvailable({}), false);
  });

  it('is false off the browser entirely, so a server render never emits the button', () => {
    assert.equal(isSpeechInputAvailable(undefined), false);
  });

  it('never constructs a recogniser, so detection cannot open a microphone', () => {
    // The fake throws when called; reaching `true` proves only the property
    // was read.
    assert.equal(isSpeechInputAvailable({ SpeechRecognition: FakeRecognition }), true);
  });
});

describe('speechLanguageTag', () => {
  it('gives a bare UI language this app’s default region', () => {
    assert.equal(speechLanguageTag('de'), 'de-DE');
    assert.equal(speechLanguageTag('en'), 'en-US');
  });

  it('trusts a tag that already names a region', () => {
    assert.equal(speechLanguageTag('de-AT'), 'de-AT');
    assert.equal(speechLanguageTag('en-GB'), 'en-GB');
  });

  it('normalises case and the underscore form i18next detectors can produce', () => {
    assert.equal(speechLanguageTag('de-de'), 'de-DE');
    assert.equal(speechLanguageTag('EN_gb'), 'en-GB');
  });

  it('falls back rather than handing the recogniser a language we ship no region for', () => {
    assert.equal(speechLanguageTag('fr'), 'en-US');
  });

  it('falls back on an empty or whitespace language', () => {
    assert.equal(speechLanguageTag(''), 'en-US');
    assert.equal(speechLanguageTag('   '), 'en-US');
  });

  it('always returns a tag the recogniser can be given', () => {
    for (const language of ['de', 'en', 'de-AT', 'fr', '', 'xx-YY']) {
      assert.match(speechLanguageTag(language), /^[a-z]+(-[A-Z0-9]+)?$/u);
    }
  });
});

describe('resolveSpeakAction', () => {
  it('hides the button entirely when the browser has no recogniser', () => {
    assert.equal(resolveSpeakAction({ consented: false, available: false }), 'hidden');
    assert.equal(resolveSpeakAction({ consented: true, available: false }), 'hidden');
  });

  it('asks before the first listen, so nobody is recorded before being told where it goes', () => {
    assert.equal(resolveSpeakAction({ consented: false, available: true }), 'ask-consent');
  });

  it('listens at once once the device has accepted the disclosure', () => {
    assert.equal(resolveSpeakAction({ consented: true, available: true }), 'listen');
  });

  it('never reaches listen without consent, for any combination', () => {
    for (const available of [true, false]) {
      assert.notEqual(resolveSpeakAction({ consented: false, available }), 'listen');
    }
  });
});

describe('classifySpeechError', () => {
  it('reads both permission refusals as the same thing the person can act on', () => {
    assert.equal(classifySpeechError('not-allowed'), 'permission-denied');
    assert.equal(classifySpeechError('service-not-allowed'), 'permission-denied');
  });

  it('keeps silence distinct from failure', () => {
    assert.equal(classifySpeechError('no-speech'), 'no-speech');
  });

  it('collapses every remaining code onto the one message that still helps', () => {
    for (const code of ['network', 'audio-capture', 'language-not-supported', 'phrases-not-supported'] as const) {
      assert.equal(classifySpeechError(code), 'failed');
    }
  });
});

/** Echoes the key plus its interpolation values, so these claims survive any re-wording of the catalog. */
const stubT: Translate = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;

describe('speechResultsMessage', () => {
  it('names the transcript in every case, because a count alone cannot be acted on', () => {
    for (const count of [0, 1, 7]) {
      assert.ok(speechResultsMessage({ count, transcript: 'chicken breast', t: stubT }).includes('chicken breast'));
    }
  });

  it('splits none/one/many onto three separate keys', () => {
    assert.ok(speechResultsMessage({ count: 0, transcript: 'apple', t: stubT }).startsWith('add.speak.results.none:'));
    assert.ok(speechResultsMessage({ count: 1, transcript: 'apple', t: stubT }).startsWith('add.speak.results.one:'));
    assert.ok(speechResultsMessage({ count: 2, transcript: 'apple', t: stubT }).startsWith('add.speak.results.many:'));
  });

  it('passes the number as `n`, never as `count` — `count` would switch i18next into plural lookup', () => {
    const message = speechResultsMessage({ count: 4, transcript: 'apple', t: stubT });
    assert.ok(message.includes('"n":4'));
    assert.ok(!message.includes('"count"'));
  });
});
