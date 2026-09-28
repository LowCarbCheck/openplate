/**
 * `#app/lib/secure-context`: the server's first guess at whether a page is a
 * secure context, and the browser's own answer (2026-09-27 install rehearsal).
 *
 * The guess decides the account pages' first paint, so both directions are
 * pinned: every address a browser calls secure must be guessed secure (or the
 * form would be hidden from somebody who could use it), and the plain-http
 * addresses a self-hoster really uses must be guessed insecure (or the notice
 * would be swapped in after hydration, a layout shift).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { canRunAccountCrypto, isPotentiallyTrustworthyUrl } from '../../app/lib/secure-context';

describe('isPotentiallyTrustworthyUrl', () => {
  const secure = [
    'https://openplate.example.com/sign-in',
    'https://192.168.1.20:3000/sign-in',
    'http://localhost:3000/sign-in',
    'http://LOCALHOST:3000/',
    'http://app.localhost:3000/',
    'http://127.0.0.1:3000/',
    'http://127.12.0.3/',
    'http://[::1]:3000/',
  ];
  for (const url of secure) {
    it(`calls ${url} secure`, () => {
      assert.equal(isPotentiallyTrustworthyUrl(url), true);
    });
  }

  // THE CONTROLS: the addresses the rehearsal and a home server actually use.
  const insecure = [
    'http://192.168.122.86:3000/sign-in',
    'http://10.0.0.5/',
    'http://bluefin:3000/',
    'http://openplate.example.com/',
    'http://localhost.example.com/',
    'http://128.0.0.1/',
    'http://[::2]/',
    'ftp://localhost/',
  ];
  for (const url of insecure) {
    it(`calls ${url} not secure`, () => {
      assert.equal(isPotentiallyTrustworthyUrl(url), false);
    });
  }

  it('guesses secure for a URL it cannot read, because the browser corrects it', () => {
    assert.equal(isPotentiallyTrustworthyUrl('not a url'), true);
  });
});

describe('canRunAccountCrypto', () => {
  it('needs both a secure context and crypto.subtle', () => {
    assert.equal(canRunAccountCrypto({ isSecureContext: true, hasSubtleCrypto: true }), true);
    assert.equal(canRunAccountCrypto({ isSecureContext: false, hasSubtleCrypto: false }), false);
    assert.equal(canRunAccountCrypto({ isSecureContext: true, hasSubtleCrypto: false }), false);
    assert.equal(canRunAccountCrypto({ isSecureContext: false, hasSubtleCrypto: true }), false);
  });
});
