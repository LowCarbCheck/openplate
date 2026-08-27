import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../../../app/lib/sync/engine/crypto/hkdf';
import { aesGcmDecrypt, aesGcmEncrypt } from '../../../app/lib/sync/engine/crypto/aes-gcm';

const IKM = new TextEncoder().encode('input-key-material-32-bytes-long!!');
const SALT = new Uint8Array(16).fill(7);

test('deriveAesKeyViaHkdf produces a usable AES-GCM key (round-trips encrypt/decrypt)', async () => {
  const key = await deriveAesKeyViaHkdf({ inputKeyMaterial: IKM, salt: SALT, info: HKDF_INFO.PASSPHRASE_KEK });
  const plaintext = new TextEncoder().encode('hello sync');
  const { iv, ciphertext } = await aesGcmEncrypt({ key, plaintext });
  const decrypted = await aesGcmDecrypt({ key, iv, ciphertext });
  assert.deepEqual(decrypted, plaintext);
});

test('deriveAesKeyViaHkdf is deterministic for the same (ikm, salt, info)', async () => {
  const keyA = await deriveAesKeyViaHkdf({ inputKeyMaterial: IKM, salt: SALT, info: HKDF_INFO.PASSPHRASE_KEK });
  const keyB = await deriveAesKeyViaHkdf({ inputKeyMaterial: IKM, salt: SALT, info: HKDF_INFO.PASSPHRASE_KEK });

  // CryptoKey objects aren't directly comparable, so prove equality via
  // behavior: a key derived by A must decrypt what B encrypted.
  const plaintext = new TextEncoder().encode('determinism check');
  const { iv, ciphertext } = await aesGcmEncrypt({ key: keyB, plaintext });
  const decrypted = await aesGcmDecrypt({ key: keyA, iv, ciphertext });
  assert.deepEqual(decrypted, plaintext);
});

test('a different salt derives a DIFFERENT key (decryption fails across them)', async () => {
  const keyA = await deriveAesKeyViaHkdf({ inputKeyMaterial: IKM, salt: SALT, info: HKDF_INFO.PASSPHRASE_KEK });
  const differentSalt = new Uint8Array(16).fill(9);
  const keyB = await deriveAesKeyViaHkdf({
    inputKeyMaterial: IKM,
    salt: differentSalt,
    info: HKDF_INFO.PASSPHRASE_KEK,
  });

  const plaintext = new TextEncoder().encode('should not decrypt');
  const { iv, ciphertext } = await aesGcmEncrypt({ key: keyA, plaintext });
  await assert.rejects(() => aesGcmDecrypt({ key: keyB, iv, ciphertext }));
});

test('PASSPHRASE_KEK and RECOVERY_KEK derive DIFFERENT keys from the SAME (ikm, salt) — domain separation (security review finding #7)', async () => {
  const passphraseKek = await deriveAesKeyViaHkdf({
    inputKeyMaterial: IKM,
    salt: SALT,
    info: HKDF_INFO.PASSPHRASE_KEK,
  });
  const recoveryKek = await deriveAesKeyViaHkdf({ inputKeyMaterial: IKM, salt: SALT, info: HKDF_INFO.RECOVERY_KEK });

  const plaintext = new TextEncoder().encode('must not cross domains');
  const { iv, ciphertext } = await aesGcmEncrypt({ key: passphraseKek, plaintext });
  await assert.rejects(() => aesGcmDecrypt({ key: recoveryKek, iv, ciphertext }));
});

test('HKDF_INFO.PASSPHRASE_KEK and HKDF_INFO.RECOVERY_KEK are distinct byte labels', () => {
  assert.notDeepEqual(HKDF_INFO.PASSPHRASE_KEK, HKDF_INFO.RECOVERY_KEK);
});

test('every HKDF label is DISTINCT — the domain-separation guard, in code rather than in a grep', () => {
  // The spec's shell guard for this matches `'openplate-sync:<letters>:v1'`,
  // which the share label (`...:share-kek:p256:v1`) does not fit — its curve
  // segment carries digits. So the real check lives here, where it sees every
  // label whatever its shape. Two labels sharing a value is the exact defect
  // security review finding #7 recorded, and it fails SILENTLY: the wrong
  // branch authenticates fine and produces a key that decrypts nothing.
  const labels = Object.values(HKDF_INFO).map((info) => new TextDecoder().decode(info));
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(labels.toSorted(), [
    'openplate-sync:auth:v1',
    'openplate-sync:passphrase-kek:v1',
    'openplate-sync:recovery-kek:v1',
    'openplate-sync:share-kek:p256:v1',
  ]);
});
