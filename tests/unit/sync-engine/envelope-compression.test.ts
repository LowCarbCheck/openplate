/**
 * Covers the gzip step `ENVELOPE_VERSION` 1 applies to the plaintext before
 * encryption (M128 spec 01) — both the primitive in isolation and the fact
 * that the full envelope round trip still returns exactly what went in.
 *
 * The size assertion is the one that matters: compression was added because
 * an uncompressed whole-store blob reaches the 2MB cap within a few years of
 * daily use, so a change that silently stopped compressing would be invisible
 * until a user hit the cliff. This test makes that regression fail loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipCompress, gzipDecompress } from '../../../app/lib/sync/engine/envelope/compression';
import { buildEnvelope, parseEnvelope } from '../../../app/lib/sync/engine/envelope/build-envelope';
import { MAX_BLOB_BYTES } from '../../../app/lib/sync/engine/protocol';
import { generateDek } from '../../../app/lib/sync/engine/crypto/dek-wrap';
import type { SyncPayload } from '../../../app/lib/sync/engine/envelope/types';

/** A realistically repetitive food-log payload — the actual shape compression is meant to shrink. */
function payloadWithLogs(count: number): SyncPayload {
  const foodLogs = Array.from({ length: count }, (_, index) => ({
    id: `log-${index}`,
    name: 'Greek yoghurt, plain, full fat',
    loggedAt: '2026-08-04T08:30:00.000Z',
    quantityGrams: 150,
    mealType: 'breakfast',
    source: 'manual',
    macros: { carbs: 5.4, fiber: 0, sugars: 5.4, polyols: 0, protein: 8.1, fat: 15, kcal: 190 },
  }));
  return {
    snapshot: { foods: [], foodLogs, weightEntries: [], profile: null },
    syncMeta: { perEntity: {}, tombstones: [] },
  };
}

test('gzipCompress/gzipDecompress round-trips arbitrary bytes', async () => {
  const original = crypto.getRandomValues(new Uint8Array(4096));
  const restored = await gzipDecompress(await gzipCompress(original));
  assert.deepEqual(restored, original);
});

test('gzipCompress round-trips an empty input', async () => {
  const restored = await gzipDecompress(await gzipCompress(new Uint8Array(0)));
  assert.equal(restored.byteLength, 0);
});

test('gzipDecompress rejects bytes that are not a gzip stream', async () => {
  await assert.rejects(() => gzipDecompress(new TextEncoder().encode('definitely not gzip')));
});

test('gzip shrinks repetitive food-log JSON by at least 5x', async () => {
  const json = new TextEncoder().encode(JSON.stringify(payloadWithLogs(500)));
  const compressed = await gzipCompress(json);
  // Measured ratio on this fixture is far better than 5x; the assertion is a
  // deliberately loose floor so it fails on "compression silently stopped
  // happening", not on a codec tuning difference between runtimes.
  assert.ok(
    compressed.byteLength * 5 < json.byteLength,
    `expected >5x compression, got ${json.byteLength} -> ${compressed.byteLength} bytes`,
  );
});

test('an envelope round-trips a large payload unchanged through compress -> encrypt -> decrypt -> decompress', async () => {
  const dek = generateDek();
  const aadFields = { accountId: 9, blobVersion: 4, payloadSchemaVersion: 1 };
  const payload = payloadWithLogs(500);

  const envelope = await buildEnvelope({ payload, dek, aadFields });
  const decrypted = await parseEnvelope({ envelope, dek, aadFields });

  assert.deepEqual(decrypted, payload);
});

test('the built envelope is smaller than the raw JSON it encrypts, and well under the blob cap', async () => {
  const dek = generateDek();
  const aadFields = { accountId: 9, blobVersion: 1, payloadSchemaVersion: 1 };
  const payload = payloadWithLogs(500);

  const rawJsonBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  const envelope = await buildEnvelope({ payload, dek, aadFields });

  assert.ok(
    envelope.ciphertext.byteLength < rawJsonBytes,
    `expected the compressed envelope (${envelope.ciphertext.byteLength}) to beat raw JSON (${rawJsonBytes})`,
  );
  assert.ok(envelope.ciphertext.byteLength < MAX_BLOB_BYTES);
});
