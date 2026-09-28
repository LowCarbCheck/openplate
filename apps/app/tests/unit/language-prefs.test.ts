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
  LANGUAGE_LABELS,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  applyLanguageChange,
  isLanguageCode,
  parseLanguageCookie,
  readDeviceLanguage,
} from '../../app/i18n/language-prefs';

/**
 * A browser's `document` and `localStorage`, as far as `readDeviceLanguage`
 * reads them, installed on `globalThis` for one case and removed after. The
 * region tag on `navigator.language` is the CONTROL: Node's own navigator
 * reports `en-US`, and the reader must never return it.
 */
function withBrowser(state: { cookie: string; stored: string | null }, run: () => void): void {
  const store = new Map<string, string>();
  if (state.stored !== null) store.set(LANGUAGE_STORAGE_KEY, state.stored);
  Object.defineProperty(globalThis, 'document', { value: { cookie: state.cookie }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (key: string) => store.get(key) ?? null },
    configurable: true,
  });
  try {
    run();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

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
    // `tr` ships since M230; `pt` is the one that does not.
    assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE}=pt`), null);
    assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE}=../../etc/passwd`), null);
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    assert.equal(parseLanguageCookie(`not-openplate-language=de`), null);
  });
});

describe('isLanguageCode', () => {
  it('accepts exactly the shipped locales', () => {
    for (const code of SUPPORTED_LANGUAGES) assert.equal(isLanguageCode(code), true, code);
    assert.equal(isLanguageCode('pt'), false);
    assert.equal(isLanguageCode('en-US'), false);
    assert.equal(isLanguageCode(undefined), false);
    assert.equal(isLanguageCode(42), false);
  });

  it('ships six languages, each named in its own language (M230)', () => {
    assert.deepEqual([...SUPPORTED_LANGUAGES].toSorted(), ['de', 'en', 'es', 'fr', 'it', 'tr']);
    assert.equal(LANGUAGE_LABELS.fr, 'Français');
    assert.equal(LANGUAGE_LABELS.it, 'Italiano');
    assert.equal(LANGUAGE_LABELS.es, 'Español');
    assert.equal(LANGUAGE_LABELS.tr, 'Türkçe');
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

describe('readDeviceLanguage', () => {
  it('is the default on the server, where there is no document', () => {
    assert.equal(globalThis.document, undefined);
    assert.equal(readDeviceLanguage(), DEFAULT_LANGUAGE);
  });

  it('is the cookie first, the storage mirror second, the default last', () => {
    withBrowser({ cookie: `${LANGUAGE_COOKIE}=tr`, stored: 'fr' }, () => assert.equal(readDeviceLanguage(), 'tr'));
    withBrowser({ cookie: '', stored: 'fr' }, () => assert.equal(readDeviceLanguage(), 'fr'));
    withBrowser({ cookie: '', stored: null }, () => assert.equal(readDeviceLanguage(), DEFAULT_LANGUAGE));
  });

  it('THE CONTROL: never a region tag, not from the cookie and not from the browser', () => {
    // Node's navigator says `en-US`, exactly what a browser would; the reader must not consult it.
    assert.match(String(globalThis.navigator.language), /^[a-z]{2}-[A-Z]{2}$/u);
    withBrowser({ cookie: `${LANGUAGE_COOKIE}=en-US`, stored: null }, () => {
      const read = readDeviceLanguage();
      assert.equal(read, DEFAULT_LANGUAGE);
      assert.doesNotMatch(read, /-/u);
    });
  });
});
