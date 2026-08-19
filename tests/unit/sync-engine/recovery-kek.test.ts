import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_CODE_BYTES,
  deriveRecoveryKek,
  generateRecoveryCode,
  parseRecoveryCode,
} from '../../../app/lib/sync/engine/client/recovery-kek';
import { aesGcmDecrypt, aesGcmEncrypt } from '../../../app/lib/sync/engine/crypto/aes-gcm';

test('generateRecoveryCode returns raw bytes at the documented length plus a grouped formatted string', () => {
  const { raw, formatted } = generateRecoveryCode();
  assert.equal(raw.byteLength, RECOVERY_CODE_BYTES);
  assert.match(formatted, /^[0-9A-Z]{1,5}(-[0-9A-Z]{1,5})*$/);
});

test('formatRecoveryCode -> parseRecoveryCode round-trips the raw bytes', () => {
  const { raw, formatted } = generateRecoveryCode();
  const parsed = parseRecoveryCode(formatted);
  assert.deepEqual(parsed, raw);
});

test('parseRecoveryCode tolerates re-typed casing/whitespace variations', () => {
  const { raw, formatted } = generateRecoveryCode();
  const messy = formatted.toLowerCase().replace(/-/g, ' ');
  assert.deepEqual(parseRecoveryCode(messy), raw);
});

test('deriveRecoveryKek is deterministic and usable as an AES-GCM key', async () => {
  const { raw } = generateRecoveryCode();
  const kekA = await deriveRecoveryKek(raw);
  const kekB = await deriveRecoveryKek(raw);

  const plaintext = new TextEncoder().encode('recovery kek round-trip');
  const { iv, ciphertext } = await aesGcmEncrypt({ key: kekA, plaintext });
  const decrypted = await aesGcmDecrypt({ key: kekB, iv, ciphertext });
  assert.deepEqual(decrypted, plaintext);
});

test('a different recovery code derives a different KEK', async () => {
  const codeA = generateRecoveryCode();
  const codeB = generateRecoveryCode();
  const kekA = await deriveRecoveryKek(codeA.raw);
  const kekB = await deriveRecoveryKek(codeB.raw);

  const plaintext = new TextEncoder().encode('should not decrypt across codes');
  const { iv, ciphertext } = await aesGcmEncrypt({ key: kekA, plaintext });
  await assert.rejects(() => aesGcmDecrypt({ key: kekB, iv, ciphertext }));
});
