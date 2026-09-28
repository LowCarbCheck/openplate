import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_PUBLIC_KEY_BYTES,
  SHARE_WRAP_BYTES,
  generateShareKeyPair,
  shareFingerprintDisplay,
  shareFingerprintMatchesTyped,
  shareKeyFingerprint,
  unwrapDekAsRecipient,
  wrapDekForRecipient,
} from '../../app/lib/sync/engine/crypto/share-wrap';
import { HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { generateDek } from '../../app/lib/sync/engine/crypto/dek-wrap';

const GRANTOR_ACCOUNT_ID = 4242;

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * FROZEN VECTORS — captured 2026-08-27 from this implementation and never
 * regenerated to make a test pass.
 *
 * Their whole job is to fail LOUDLY when the construction changes. Every
 * round-trip test below would still pass if the HKDF label, the AAD's key
 * order, the packing order, or the fingerprint encoding were all changed at
 * once — both ends would simply agree on something new, and every existing
 * share in the world would have become unopenable in silence. This wrap was
 * produced by the construction `PROTOCOL.md` §3.4 freezes, so if it stops
 * opening, the construction has drifted and that is the bug.
 */
const VECTOR = {
  publicKeyRaw: 'BJ5xqpaxdRXhW/pVMrRoOGVNCKwhYIhtOI5TsZOQHlZfafThmD/jzLa7ulU7SaqZmKqLxzb2stZMpUFaI2o12I0=',
  privateKeyPkcs8:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgBze0oFXd4zd0gZNLWaeHpvgpupFoQVTRrwEUGJY0GmmhRANCAASecaqWsXUV4Vv6VTK0aDhlTQisIWCIbTiOU7GTkB5WX2n04Zg/48y2u7pVO0mqmZiqi8c29rLWTKVBWiNqNdiN',
  dek: 'u21NA6FyDqicysndosxgIj/AVH+fKlPf1KK7jMErDAE=',
  wrap: 'BCPn07MTwrkUr5lFxN0sNR7W+Q9wo4S+2oP2kb0g0JO9syOVW2ejXYkcT82CO5PrY97qogpTFDlMOwX9CeVuFUcXxyAnjmlrNEPeSnn5uGfwS6NmdcR5LLeAGF85/nauXjevF0uWoS5S86ZzgjOPofwndeVf8Ey1Wwk4P80=',
  fingerprint: 'YP9Q-0YBF-5X3M-MVK6-3NS8-18YX-5GQQ-9W66-BX8M-RTFF-29GA-BDXE-YCSG',
} as const;

test('the share HKDF label is frozen, and names the curve', () => {
  assert.equal(new TextDecoder().decode(HKDF_INFO.SHARE_KEK), 'openplate-sync:share-kek:p256:v1');
});

test('share wrap round-trip: the recipient recovers the exact DEK', async () => {
  const recipient = await generateShareKeyPair();
  const dek = generateDek();

  const wrap = await wrapDekForRecipient({
    dek,
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });
  const recovered = await unwrapDekAsRecipient({
    wrap,
    privateKeyPkcs8: recipient.privateKeyPkcs8,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    ownPublicKeyRaw: recipient.publicKeyRaw,
  });

  assert.deepEqual(recovered, dek);
});

test('share wrap round-trip against the FROZEN vector — a construction change must fail here, not in production', async () => {
  const recovered = await unwrapDekAsRecipient({
    wrap: fromBase64(VECTOR.wrap),
    privateKeyPkcs8: fromBase64(VECTOR.privateKeyPkcs8),
    grantorAccountId: GRANTOR_ACCOUNT_ID,
    ownPublicKeyRaw: fromBase64(VECTOR.publicKeyRaw),
  });
  assert.deepEqual(recovered, fromBase64(VECTOR.dek));
});

test('the wrap is 125 bytes: ephPub(65) + iv(12) + ciphertext+tag(48)', async () => {
  const recipient = await generateShareKeyPair();
  const wrap = await wrapDekForRecipient({
    dek: generateDek(),
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });

  assert.equal(wrap.byteLength, SHARE_WRAP_BYTES);
  assert.equal(wrap.byteLength, 125);
  assert.equal(fromBase64(VECTOR.wrap).byteLength, 125);
  // The ephemeral key leads, uncompressed SEC1 — `0x04` is its tag byte.
  assert.equal(recipient.publicKeyRaw.byteLength, SHARE_PUBLIC_KEY_BYTES);
  assert.equal(wrap[0], 0x04);
});

test('a wrap of the wrong length is refused before any crypto runs', async () => {
  const recipient = await generateShareKeyPair();
  await assert.rejects(
    () =>
      unwrapDekAsRecipient({
        wrap: new Uint8Array(SHARE_WRAP_BYTES - 1),
        privateKeyPkcs8: recipient.privateKeyPkcs8,
        grantorAccountId: GRANTOR_ACCOUNT_ID,
        ownPublicKeyRaw: recipient.publicKeyRaw,
      }),
    /exactly 125 bytes/,
  );
});

test('AAD binds the recipient key: a wrap replayed under a different grantor fails its tag check', async () => {
  const recipient = await generateShareKeyPair();
  const dek = generateDek();
  const wrap = await wrapDekForRecipient({
    dek,
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });

  await assert.rejects(() =>
    unwrapDekAsRecipient({
      wrap,
      privateKeyPkcs8: recipient.privateKeyPkcs8,
      grantorAccountId: GRANTOR_ACCOUNT_ID + 1,
      ownPublicKeyRaw: recipient.publicKeyRaw,
    }),
  );
});

test('AAD binds the recipient key: rebuilding it from a DIFFERENT public key fails, even with the right private key', async () => {
  const recipient = await generateShareKeyPair();
  const someoneElse = await generateShareKeyPair();
  const wrap = await wrapDekForRecipient({
    dek: generateDek(),
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });

  // The ECDH half succeeds — this is the RIGHT private key. Only the AAD
  // differs, so this proves the binding and not merely the key agreement.
  await assert.rejects(() =>
    unwrapDekAsRecipient({
      wrap,
      privateKeyPkcs8: recipient.privateKeyPkcs8,
      grantorAccountId: GRANTOR_ACCOUNT_ID,
      ownPublicKeyRaw: someoneElse.publicKeyRaw,
    }),
  );
});

test('AAD binds the recipient key: a wrap addressed to someone else does not open with your key', async () => {
  const recipient = await generateShareKeyPair();
  const clinicianB = await generateShareKeyPair();
  const wrap = await wrapDekForRecipient({
    dek: generateDek(),
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });

  await assert.rejects(() =>
    unwrapDekAsRecipient({
      wrap,
      privateKeyPkcs8: clinicianB.privateKeyPkcs8,
      grantorAccountId: GRANTOR_ACCOUNT_ID,
      ownPublicKeyRaw: clinicianB.publicKeyRaw,
    }),
  );
});

test('a non-integer grantor account id is refused rather than interpolated into the AAD', async () => {
  const recipient = await generateShareKeyPair();
  await assert.rejects(
    () =>
      wrapDekForRecipient({
        dek: generateDek(),
        recipientPublicKeyRaw: recipient.publicKeyRaw,
        grantorAccountId: 1.5,
      }),
    /safe integer/,
  );
});

test('ephemeral key is fresh per wrap: two wraps of the same DEK to the same recipient differ', async () => {
  const recipient = await generateShareKeyPair();
  const dek = generateDek();

  const first = await wrapDekForRecipient({
    dek,
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });
  const second = await wrapDekForRecipient({
    dek,
    recipientPublicKeyRaw: recipient.publicKeyRaw,
    grantorAccountId: GRANTOR_ACCOUNT_ID,
  });

  assert.notDeepEqual(first, second);
  // Specifically the EPHEMERAL PUBLIC KEY differs, not just the IV — a fixed
  // ephemeral key with a fresh IV would also make the wraps differ while
  // reusing one shared secret across every share.
  assert.notDeepEqual(first.slice(0, SHARE_PUBLIC_KEY_BYTES), second.slice(0, SHARE_PUBLIC_KEY_BYTES));

  // Both still open. Freshness must not cost correctness.
  for (const wrap of [first, second]) {
    assert.deepEqual(
      await unwrapDekAsRecipient({
        wrap,
        privateKeyPkcs8: recipient.privateKeyPkcs8,
        grantorAccountId: GRANTOR_ACCOUNT_ID,
        ownPublicKeyRaw: recipient.publicKeyRaw,
      }),
      dek,
    );
  }
});

test('generateShareKeyPair returns a fresh pair each call', async () => {
  const first = await generateShareKeyPair();
  const second = await generateShareKeyPair();
  assert.equal(first.publicKeyRaw.byteLength, SHARE_PUBLIC_KEY_BYTES);
  assert.notDeepEqual(first.publicKeyRaw, second.publicKeyRaw);
  assert.notDeepEqual(first.privateKeyPkcs8, second.privateKeyPkcs8);
});

test('fingerprint: the FROZEN vector key still renders the same string', async () => {
  assert.equal(await shareKeyFingerprint(fromBase64(VECTOR.publicKeyRaw)), VECTOR.fingerprint);
});

test('fingerprint: flipping ONE BIT of the public key changes it', async () => {
  const keyA = fromBase64(VECTOR.publicKeyRaw);
  const keyB = Uint8Array.from(keyA);
  const lastIndex = keyB.length - 1;
  keyB[lastIndex] = (keyB[lastIndex] ?? 0) ^ 0x01;

  const fingerprintA = await shareKeyFingerprint(keyA);
  const fingerprintB = await shareKeyFingerprint(keyB);
  assert.notEqual(fingerprintA, fingerprintB);
  // The DISPLAYED 60 bits must change too — a fingerprint that only differs
  // past the twelfth character is not one a person can check.
  assert.notEqual(shareFingerprintDisplay(fingerprintA), shareFingerprintDisplay(fingerprintB));
});

test('fingerprint: the display is 12 characters in three groups of four', async () => {
  const display = shareFingerprintDisplay(await shareKeyFingerprint(fromBase64(VECTOR.publicKeyRaw)));
  assert.equal(display, 'YP9Q-0YBF-5X3M');
  assert.equal(display.replaceAll('-', '').length, 12);
  assert.equal(display.split('-').length, 3);
});

test('fingerprint: a typed value matches regardless of grouping and case, and only on the real value', async () => {
  const fingerprint = await shareKeyFingerprint(fromBase64(VECTOR.publicKeyRaw));

  assert.equal(shareFingerprintMatchesTyped({ typed: 'YP9Q-0YBF-5X3M', fingerprint }), true);
  assert.equal(shareFingerprintMatchesTyped({ typed: 'yp9q 0ybf 5x3m', fingerprint }), true);
  assert.equal(shareFingerprintMatchesTyped({ typed: 'YP9Q0YBF5X3M', fingerprint }), true);

  assert.equal(shareFingerprintMatchesTyped({ typed: 'YP9Q-0YBF-5X3N', fingerprint }), false);
  // A prefix must NOT pass: partial entry is not verification.
  assert.equal(shareFingerprintMatchesTyped({ typed: 'YP9Q-0YBF', fingerprint }), false);
  assert.equal(shareFingerprintMatchesTyped({ typed: '', fingerprint }), false);
});
