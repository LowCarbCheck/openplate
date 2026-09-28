/**
 * A language named by a link (`app/i18n/language-link.ts`).
 *
 * The switch is the app's own (cookie, storage, reload), so what is pinned
 * here is what a link adds: which codes count, where the parameter is read,
 * that it leaves the address BEFORE the reload (or a browser refusing the
 * cookie reloads forever), and that the rest of the address survives.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addressWithoutLanguage,
  applyLanguageLink,
  decideLanguageLink,
  languageParamOf,
  type LanguageLinkEffects,
} from '../../app/i18n/language-link';

/** Effects that record the order they ran in. */
function recordingEffects() {
  const calls: string[] = [];
  const effects: LanguageLinkEffects = {
    writeCookie: (code) => calls.push(`cookie ${code}`),
    writeStorage: (code) => calls.push(`storage ${code}`),
    replaceAddress: (address) => calls.push(`address ${address}`),
    reload: () => calls.push('reload'),
  };
  return { calls, effects };
}

describe('languageParamOf', () => {
  it('reads each of the six app languages from the query string', () => {
    for (const code of ['en', 'de', 'fr', 'it', 'es', 'tr']) {
      assert.equal(languageParamOf({ search: `?lang=${code}`, hash: '' }), code);
    }
  });

  it('reads the fragment, where the mailed join link carries it', () => {
    assert.equal(languageParamOf({ search: '', hash: '#server=https%3A%2F%2Fs.example&invite=si_a&lang=tr' }), 'tr');
  });

  it('prefers the query string, and falls through an unknown query code to the fragment', () => {
    assert.equal(languageParamOf({ search: '?lang=de', hash: '#lang=fr' }), 'de');
    assert.equal(languageParamOf({ search: '?lang=xx', hash: '#lang=fr' }), 'fr');
  });

  it('ignores a code the app does not ship, and a region tag', () => {
    for (const search of ['?lang=xx', '?lang=en-US', '?lang=FR', '?lang=', '?plan=yearly', '']) {
      assert.equal(languageParamOf({ search, hash: '' }), null, search);
    }
  });
});

describe('addressWithoutLanguage', () => {
  it('keeps every other parameter, in order, and the fragment', () => {
    assert.equal(
      addressWithoutLanguage({ pathname: '/sign-up', search: '?plan=yearly&lang=fr&x=1', hash: '#top' }),
      '/sign-up?plan=yearly&x=1#top',
    );
  });

  it('takes it out of the fragment too', () => {
    assert.equal(
      addressWithoutLanguage({ pathname: '/join', search: '', hash: '#invite=si_a&lang=fr&plan=yearly' }),
      '/join#invite=si_a&plan=yearly',
    );
  });

  it('drops the question mark and the hash mark when nothing is left', () => {
    assert.equal(addressWithoutLanguage({ pathname: '/', search: '?lang=de', hash: '#lang=de' }), '/');
  });
});

describe('decideLanguageLink', () => {
  it('switches to another language, to the address it was given', () => {
    assert.deepEqual(decideLanguageLink({ code: 'fr', shownLanguage: 'en', address: '/sign-up?plan=yearly' }), {
      kind: 'switch',
      code: 'fr',
      address: '/sign-up?plan=yearly',
    });
  });

  it('only keeps the preference when the language is already on screen', () => {
    assert.deepEqual(decideLanguageLink({ code: 'fr', shownLanguage: 'fr', address: '/welcome' }), {
      kind: 'persist',
      code: 'fr',
    });
  });

  it('does nothing when the link named no language of the app', () => {
    assert.deepEqual(decideLanguageLink({ code: null, shownLanguage: 'en', address: '/' }), { kind: 'none' });
  });
});

describe('applyLanguageLink', () => {
  it('persists, then cleans the address, then reloads, in that order, and says so', () => {
    const { calls, effects } = recordingEffects();
    assert.equal(applyLanguageLink({ kind: 'switch', code: 'fr', address: '/sign-up?plan=yearly' }, effects), true);
    assert.deepEqual(calls, ['cookie fr', 'storage fr', 'address /sign-up?plan=yearly', 'reload']);
  });

  it('writes the preference and never reloads a page already in that language', () => {
    const { calls, effects } = recordingEffects();
    assert.equal(applyLanguageLink({ kind: 'persist', code: 'de' }, effects), false);
    assert.deepEqual(calls, ['cookie de', 'storage de']);
  });

  it('touches nothing when the link names no language of the app', () => {
    const { calls, effects } = recordingEffects();
    assert.equal(applyLanguageLink({ kind: 'none' }, effects), false);
    assert.deepEqual(calls, []);
  });
});
