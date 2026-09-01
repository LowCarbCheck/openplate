/**
 * Unit tests for `DEFAULT_UI_LANGUAGE` — the instance default (M167/01).
 *
 * The variable answers ONE question: what does a visitor who has never chosen
 * see? Three things about it are worth pinning, and all three are invisible
 * until they are wrong in production:
 *
 *  1. Unset means `en`. A self-hoster who sets nothing must get exactly what
 *     they got before this variable existed.
 *  2. An unknown code THROWS. This is the case that would otherwise rot: an
 *     operator writes `fr`, gets English forever, and nothing anywhere says
 *     why. There is no correct silent answer, so the boot fails instead.
 *  3. It is a starting language, not a lock — see `resolveRequestLanguage`
 *     below, where the cookie beats it.
 *
 * `parseDefaultUiLanguage` is exported and takes its input as an ARGUMENT
 * rather than reading `process.env`, so none of this needs an environment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseDefaultUiLanguage } from '../../app/config/index';
import { resolveRequestLanguage, LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';

describe('parseDefaultUiLanguage', () => {
  it('is `en` when unset — an instance that configures nothing is unchanged', () => {
    assert.equal(parseDefaultUiLanguage(undefined), 'en');
  });

  it('treats empty and whitespace-only as unset', () => {
    assert.equal(parseDefaultUiLanguage(''), 'en');
    assert.equal(parseDefaultUiLanguage('   '), 'en');
    assert.equal(parseDefaultUiLanguage('\n\t'), 'en');
  });

  it('accepts both supported codes', () => {
    assert.equal(parseDefaultUiLanguage('en'), 'en');
    assert.equal(parseDefaultUiLanguage('de'), 'de');
  });

  it('tolerates the casing and padding a real .env file produces', () => {
    assert.equal(parseDefaultUiLanguage('DE'), 'de');
    assert.equal(parseDefaultUiLanguage(' De '), 'de');
    assert.equal(parseDefaultUiLanguage('EN\n'), 'en');
  });

  it('THROWS on a language we do not ship, rather than quietly serving English', () => {
    // The whole point of the rule: `fr` is a request for French. Answering it
    // with English would be wrong on every page, forever, and silent.
    assert.throws(() => parseDefaultUiLanguage('fr'), /DEFAULT_UI_LANGUAGE/);
    assert.throws(() => parseDefaultUiLanguage('de-DE'), /DEFAULT_UI_LANGUAGE/);
    assert.throws(() => parseDefaultUiLanguage('english'), /DEFAULT_UI_LANGUAGE/);
  });

  it('names the value it refused, so the operator can see their own typo', () => {
    assert.throws(() => parseDefaultUiLanguage('fr'), /"fr"/);
  });
});

describe('resolveRequestLanguage', () => {
  it('serves the instance default when the visitor has not chosen', () => {
    assert.equal(resolveRequestLanguage(null, 'de'), 'de');
    assert.equal(resolveRequestLanguage('theme=dark', 'de'), 'de');
  });

  it('lets the visitor overrule the operator — the default is a start, not a lock', () => {
    // The case that proves it is a DEFAULT: a German instance, an English
    // visitor. If this ever returns 'de', the switcher has stopped working on
    // every instance that set the variable.
    assert.equal(resolveRequestLanguage(`${LANGUAGE_COOKIE}=en`, 'de'), 'en');
    assert.equal(resolveRequestLanguage(`${LANGUAGE_COOKIE}=de`, 'en'), 'de');
  });

  it('falls back to the instance default when the cookie is junk', () => {
    assert.equal(resolveRequestLanguage(`${LANGUAGE_COOKIE}=fr`, 'de'), 'de');
    assert.equal(resolveRequestLanguage(`${LANGUAGE_COOKIE}=`, 'de'), 'de');
  });
});
