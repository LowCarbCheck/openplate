import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, parseEnvelope } from '../../../app/lib/sync/engine/envelope/build-envelope';
import { buildEnvelopeAad } from '../../../app/lib/sync/engine/envelope/aad';
import { ENVELOPE_VERSION, type SyncPayload } from '../../../app/lib/sync/engine/envelope/types';
import { generateDek } from '../../../app/lib/sync/engine/crypto/dek-wrap';

function samplePayload(): SyncPayload {
  return {
    snapshot: { foods: [], foodLogs: [], weightEntries: [], profile: null },
    syncMeta: { perEntity: {}, tombstones: [] },
  };
}

test('buildEnvelope/parseEnvelope round-trips the payload', async () => {
  const dek = generateDek();
  const aadFields = { accountId: 42, blobVersion: 1, payloadSchemaVersion: 2 };
  const payload = samplePayload();

  const envelope = await buildEnvelope({ payload, dek, aadFields });
  assert.equal(envelope.envelopeVersion, ENVELOPE_VERSION);

  const decrypted = await parseEnvelope({ envelope, dek, aadFields });
  assert.deepEqual(decrypted, payload);
});

test('parseEnvelope fails when aadFields do not match what was used to build (rollback/cut-and-paste defense)', async () => {
  const dek = generateDek();
  const payload = samplePayload();
  const envelope = await buildEnvelope({
    payload,
    dek,
    aadFields: { accountId: 1, blobVersion: 1, payloadSchemaVersion: 1 },
  });

  await assert.rejects(() =>
    parseEnvelope({ envelope, dek, aadFields: { accountId: 2, blobVersion: 1, payloadSchemaVersion: 1 } }),
  );
  await assert.rejects(() =>
    parseEnvelope({ envelope, dek, aadFields: { accountId: 1, blobVersion: 2, payloadSchemaVersion: 1 } }),
  );
});

test('parseEnvelope fails with the wrong DEK', async () => {
  const dek = generateDek();
  const wrongDek = generateDek();
  const aadFields = { accountId: 1, blobVersion: 1, payloadSchemaVersion: 1 };
  const envelope = await buildEnvelope({ payload: samplePayload(), dek, aadFields });

  await assert.rejects(() => parseEnvelope({ envelope, dek: wrongDek, aadFields }));
});

test('parseEnvelope throws on an unsupported envelopeVersion', async () => {
  const dek = generateDek();
  const aadFields = { accountId: 1, blobVersion: 1, payloadSchemaVersion: 1 };
  const envelope = await buildEnvelope({ payload: samplePayload(), dek, aadFields });

  await assert.rejects(
    () => parseEnvelope({ envelope: { ...envelope, envelopeVersion: 999 }, dek, aadFields }),
    /Unsupported envelope version/,
  );
});

test('the built envelope packs the IV into ciphertext as a single blob (security review finding #1)', async () => {
  const dek = generateDek();
  const aadFields = { accountId: 1, blobVersion: 1, payloadSchemaVersion: 1 };
  const envelope = await buildEnvelope({ payload: samplePayload(), dek, aadFields });
  // 12-byte IV + at least SOME ciphertext+tag — proves it's not just the bare 12-byte IV
  // (i.e. the ciphertext was actually appended, not dropped).
  assert.ok(envelope.ciphertext.byteLength > 12);
});

test('an envelope survives a base64 round trip (serialize -> DB-shape -> parse) and still decrypts', async () => {
  // Proves the packed blob survives exactly what production does to it:
  // `register-routes.ts` base64-encodes `ciphertext` for the JSON wire
  // response/request, and Postgres stores/returns it via a `bytea` column
  // (`sync_blobs.ciphertext`) — round-tripping through base64 here stands in
  // for both hops without needing a live DB or HTTP server.
  const dek = generateDek();
  const aadFields = { accountId: 7, blobVersion: 3, payloadSchemaVersion: 1 };
  const payload = samplePayload();
  const envelope = await buildEnvelope({ payload, dek, aadFields });

  const wireBase64 = Buffer.from(envelope.ciphertext).toString('base64');
  const rehydratedCiphertext = new Uint8Array(Buffer.from(wireBase64, 'base64'));
  assert.deepEqual(rehydratedCiphertext, envelope.ciphertext);

  const rehydratedEnvelope = { envelopeVersion: envelope.envelopeVersion, ciphertext: rehydratedCiphertext };
  const decrypted = await parseEnvelope({ envelope: rehydratedEnvelope, dek, aadFields });
  assert.deepEqual(decrypted, payload);
});

test('buildEnvelopeAad is deterministic for the same fields', () => {
  const fields = { accountId: 7, blobVersion: 3, payloadSchemaVersion: 2 };
  assert.deepEqual(buildEnvelopeAad(fields), buildEnvelopeAad(fields));
});

test('buildEnvelopeAad differs when any field differs', () => {
  const base = buildEnvelopeAad({ accountId: 7, blobVersion: 3, payloadSchemaVersion: 2 });
  const differentAccount = buildEnvelopeAad({ accountId: 8, blobVersion: 3, payloadSchemaVersion: 2 });
  const differentBlobVersion = buildEnvelopeAad({ accountId: 7, blobVersion: 4, payloadSchemaVersion: 2 });
  const differentSchemaVersion = buildEnvelopeAad({ accountId: 7, blobVersion: 3, payloadSchemaVersion: 3 });
  assert.notDeepEqual(base, differentAccount);
  assert.notDeepEqual(base, differentBlobVersion);
  assert.notDeepEqual(base, differentSchemaVersion);
});
