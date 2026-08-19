/**
 * The `/verify-email` replay guard.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * The route POSTs its token on every mount, and verification tokens are single
 * use. So the first load confirmed the address and every load after it — a
 * reload, a back-navigation, a mail client that opens the link twice — got the
 * same rejection a forged token gets and showed "That link didn't work". The
 * account was fine; the page was lying.
 *
 * Each test below asserts the FAILURE MODE IS GONE, not merely that the helper
 * runs: the marker must survive a second visit, must not contain the token, and
 * must never turn a storage failure into a thrown error on a page whose entire
 * job is reassurance.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasRedeemedVerifyEmailToken,
  rememberRedeemedVerifyEmailToken,
  verifyEmailMarkerKey,
  type VerifyEmailMarkerStorage,
} from '../../app/lib/sync/verify-email-guard';

function memoryStorage(): VerifyEmailMarkerStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

/** Storage that refuses everything — Safari private mode, or an exhausted quota. */
const hostileStorage: VerifyEmailMarkerStorage = {
  getItem: () => {
    throw new Error('storage is blocked');
  },
  setItem: () => {
    throw new Error('storage is blocked');
  },
};

const TOKEN = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('verify-email replay guard', () => {
  it('THE REGRESSION: a second visit with an already-redeemed token is recognised', () => {
    const storage = memoryStorage();
    assert.equal(
      hasRedeemedVerifyEmailToken({ token: TOKEN, storage }),
      false,
      'a first visit must still POST — the address is not confirmed yet',
    );

    rememberRedeemedVerifyEmailToken({ token: TOKEN, storage });

    assert.equal(
      hasRedeemedVerifyEmailToken({ token: TOKEN, storage }),
      true,
      'the reload that used to show "that link didn’t work" must now short-circuit to success',
    );
  });

  it('does not vouch for a DIFFERENT token', () => {
    const storage = memoryStorage();
    rememberRedeemedVerifyEmailToken({ token: TOKEN, storage });
    assert.equal(
      hasRedeemedVerifyEmailToken({ token: 'some-other-token', storage }),
      false,
      'an unredeemed link must still be sent to the service',
    );
  });

  it('never writes the token itself into storage', () => {
    const storage = memoryStorage();
    rememberRedeemedVerifyEmailToken({ token: TOKEN, storage });

    const written = JSON.stringify([...storage.entries.entries()]);
    assert.equal(written.includes(TOKEN), false, 'a credential-shaped value must not be left in web storage');
    assert.equal(verifyEmailMarkerKey(TOKEN).includes(TOKEN), false);
  });

  it('is stable: the same token always derives the same key', () => {
    assert.equal(verifyEmailMarkerKey(TOKEN), verifyEmailMarkerKey(TOKEN));
    assert.notEqual(verifyEmailMarkerKey(TOKEN), verifyEmailMarkerKey(`${TOKEN}x`));
  });

  it('degrades to the old behaviour when storage is unavailable, and never throws', () => {
    for (const storage of [null, hostileStorage]) {
      assert.doesNotThrow(() => rememberRedeemedVerifyEmailToken({ token: TOKEN, storage }));
      assert.equal(hasRedeemedVerifyEmailToken({ token: TOKEN, storage }), false);
    }
  });
});
