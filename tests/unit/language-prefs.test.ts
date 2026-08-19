/**
 * Unit tests for `#app/i18n/language-prefs` — the device-local language
 * preference.
 *
 * The rules worth pinning are the ones that are invisible until they break in
 * production: the cookie is the ONLY signal the server render agrees with, so
 * the client must never resolve to something else on boot; and a language
 * change must persist BEFORE it reloads, or the reload races the write and the
 * page comes back in the old language.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  applyLanguageChange,
  isLanguageCode,
  parseLanguageCookie,
} from '../../app/i18n/language-prefs';

describe('parseLanguageCookie', () => {
  it('reads a supported language out of a real cookie header', () => {
    assert.equal(parseLanguageCookie(`theme=dark; ${LANGUAGE_COOKIE}=de; other=1`), 'de');
  });

  it('is null when the cookie is absent — the caller falls back to the default', () => {
    assert.equal(parseLanguageCookie('theme=dark'), null);
    assert.equal(parseLanguageCookie(null), null);
    assert.equal(parseLanguageCookie(''), null);
  });

  it('rejects an unsupported or tampered value instead of trusting it', () => {
    // A locale we removed, or a hand-edited cookie, must not reach i18next as
    // a language — it would resolve to an empty catalog, not to English.
    assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE}=tr`), null);
    assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE}=../../etc/passwd`), null);
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    assert.equal(parseLanguageCookie(`not-openplate-language=de`), null);
  });
});

describe('isLanguageCode', () => {
  it('accepts exactly the shipped locales', () => {
    assert.equal(isLanguageCode('en'), true);
    assert.equal(isLanguageCode('de'), true);
    assert.equal(isLanguageCode('fr'), false);
    assert.equal(isLanguageCode(undefined), false);
    assert.equal(isLanguageCode(42), false);
  });

  it('names English as the default — the fallback catalog and the cookie default agree', () => {
    assert.equal(DEFAULT_LANGUAGE, 'en');
  });
});

describe('applyLanguageChange', () => {
  it('persists to BOTH the cookie and localStorage before reloading', () => {
    const calls: string[] = [];
    applyLanguageChange('de', {
      writeCookie: (code) => calls.push(`cookie:${code}`),
      writeStorage: (code) => calls.push(`storage:${code}`),
      reload: () => calls.push('reload'),
    });

    // Order is the whole point: a reload that beats the cookie write brings
    // the page back in the previous language.
    assert.deepEqual(calls, ['cookie:de', 'storage:de', 'reload']);
  });

  it('reloads even when re-selecting the active language — an idempotent no-op, never a dead button', () => {
    let reloaded = false;
    applyLanguageChange('en', {
      writeCookie: () => {},
      writeStorage: () => {},
      reload: () => {
        reloaded = true;
      },
    });
    assert.equal(reloaded, true);
  });
});
