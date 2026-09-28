/**
 * Unit tests for `#app/lib/uuid` — the secure-context-safe UUID seam.
 *
 * The bug this guards: `crypto.randomUUID` only exists in a secure context, so
 * every direct call throws `TypeError: crypto.randomUUID is not a function`
 * when the app is served over plain http on a LAN/tailnet address or an
 * http-only self-host. The fallback path is therefore the interesting one and
 * is exercised explicitly here by removing `crypto.randomUUID` for the
 * duration of a test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { randomUuid } from '../../app/lib/uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Runs `body` with `crypto.randomUUID` made unavailable, restoring it after.
 *
 * Under Node the global `crypto` is a `Crypto` instance whose `randomUUID`
 * lives on the PROTOTYPE, so deleting it off the instance is a no-op — the
 * shadowing own property below is what actually hides it. In a real non-secure
 * browser context the method is absent from the prototype too; either way what
 * `randomUuid()` sees is `typeof crypto.randomUUID !== 'function'`.
 */
function withoutNativeRandomUuid(body: () => void): void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
  try {
    body();
  } finally {
    if (ownDescriptor) Object.defineProperty(crypto, 'randomUUID', ownDescriptor);
    else Reflect.deleteProperty(crypto, 'randomUUID');
  }
}

describe('randomUuid', () => {
  it('returns a well-formed v4 UUID', () => {
    assert.match(randomUuid(), UUID_V4);
  });

  it('returns a different value on every call', () => {
    assert.notEqual(randomUuid(), randomUuid());
  });

  it('still returns a well-formed v4 UUID when crypto.randomUUID is unavailable', () => {
    withoutNativeRandomUuid(() => {
      assert.equal(Object.getOwnPropertyDescriptor(crypto, 'randomUUID')?.value, undefined);
      assert.match(randomUuid(), UUID_V4);
    });
  });

  it('does not throw in a non-secure context, and stays unique on the fallback path', () => {
    withoutNativeRandomUuid(() => {
      const generated = new Set(Array.from({ length: 500 }, () => randomUuid()));
      assert.equal(generated.size, 500);
      for (const value of generated) assert.match(value, UUID_V4);
    });
  });

  it('restores crypto.randomUUID after the fallback test', () => {
    assert.notEqual(crypto.randomUUID, undefined);
  });
});
