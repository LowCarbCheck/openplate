/**
 * Every router under `/v1/sync` enforces ITS OWN body limit, per route.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-30 each of the four sync routers mounted
 * `express.json()` on the whole `SYNC_API_PREFIX`. `express.json()` marks a
 * request as parsed, so the first parser to run wins, and the blob router is
 * registered first. Its 2.8 MB limit therefore applied to every sync route:
 *
 *  - the share family, sized at 8 KB, accepted about 2.8 MB,
 *  - the research family, sized at 512 KB, accepted about 2.8 MB,
 *  - and `rotate-dek`, sized at the blob plus 64 KB for a keep list, was cut
 *    to the blob plus 4 KB, so a maximum blob with a long keep list was a 413.
 *
 * Each case below sends a body that one limit admits and the other refuses,
 * and every one of them failed before the parsers were scoped per route.
 *
 * THE PADDING FIELD. Each oversized body is a valid request plus one unknown
 * top-level field. No handler here reads unknown fields, so the only thing the
 * padding can change is which parser limit the body meets. For `rotate-dek` it
 * stands in for a long keep list, which would need dozens of real grantees.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import {
  sampleAuthHash,
  sampleCiphertext,
  sampleContributionBody,
  sampleKdfDescriptor,
  sampleRecoveryCode,
  sampleShareWrap,
  sampleWrappedDek,
  recoveryAuthHashFor,
  startService,
  type ServiceHarness,
} from './service-harness.js';
import { MAX_BLOB_BYTES } from '../../src/protocol.js';
import { SYNC_JSON_BODY_LIMIT } from '../../src/server/register-routes.js';
import { ROTATE_DEK_JSON_BODY_LIMIT } from '../../src/server/rotate-dek-route.js';
import { SHARE_JSON_BODY_LIMIT } from '../../src/server/share-routes.js';
import { RESEARCH_JSON_BODY_LIMIT } from '../../src/server/research-routes.js';

/** What `server/error-middleware.ts` answers for a body the parser refused. */
const PARSER_REFUSAL = 'request body exceeds the maximum accepted size';

const FINGERPRINT = 'K3TB-9WQZ-4M7N';
const PSEUDONYM = 'J7K2QW9ZP4M6N8R3T5V0XB1CDE';
const SCHEMA_TIER = 'daily-intake:v1';

interface Party {
  accountId: number;
  accessToken: string;
}

let database: TestDatabase;
let service: ServiceHarness;

before(async () => {
  database = await setupTestDatabase();
  service = await startService({ db: database.db, sharing: true, research: true });
});

after(async () => {
  await service.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

async function signUp(name: string, seed: number): Promise<Party> {
  const session = await service.signupThroughInvite({ email: `${name}@example.org`, authHash: sampleAuthHash(seed) });
  return { accountId: session.account.id, accessToken: session.tokens.accessToken };
}

/** The serialised size of a body, which is what a parser limit counts. */
function sizeOf<T extends object>(body: T): number {
  return Buffer.byteLength(JSON.stringify(body));
}

/** Pads `body` with one unknown field until it serialises to exactly `bytes`. */
function padTo<T extends object>(body: T, bytes: number): T & { padding: string } {
  const withEmptyPadding = { ...body, padding: '' };
  const missing = bytes - sizeOf(withEmptyPadding);
  assert.ok(missing >= 0, 'the body is already larger than the target size');
  const padded = { ...body, padding: 'x'.repeat(missing) };
  assert.equal(sizeOf(padded), bytes);
  return padded;
}

test('the limits themselves are ordered the way the routes need them', () => {
  // A cheap guard on the premise every case below relies on.
  assert.ok(SHARE_JSON_BODY_LIMIT < RESEARCH_JSON_BODY_LIMIT);
  assert.ok(RESEARCH_JSON_BODY_LIMIT < SYNC_JSON_BODY_LIMIT);
  assert.ok(SYNC_JSON_BODY_LIMIT < ROTATE_DEK_JSON_BODY_LIMIT);
});

test('a share grant over 8 KB is refused by the share parser, and one under it is stored', async () => {
  const owner = await signUp('owner', 11);
  const grantee = await signUp('grantee', 12);
  const grant = { wrappedDek: sampleShareWrap(5), recipientKeyFingerprint: FINGERPRINT, expectedUpdatedAt: null };

  const oversized = await service.request<{ error: string }>({
    method: 'PUT',
    path: `/v1/sync/shares/${grantee.accountId}`,
    accessToken: owner.accessToken,
    body: padTo(grant, SHARE_JSON_BODY_LIMIT + 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error, PARSER_REFUSAL);

  const fits = await service.request({
    method: 'PUT',
    path: `/v1/sync/shares/${grantee.accountId}`,
    accessToken: owner.accessToken,
    body: padTo(grant, SHARE_JSON_BODY_LIMIT),
  });
  assert.equal(fits.status, 200);
});

test('a contribution over 512 KB is refused by the research parser, and one under it is stored', async () => {
  const contributor = await signUp('contributor', 21);
  const study = await signUp('study', 22);
  const contribution = {
    pseudonym: PSEUDONYM,
    schemaTier: SCHEMA_TIER,
    body: sampleContributionBody(),
    contributionVersion: 1,
  };

  const oversized = await service.request<{ error: string }>({
    method: 'PUT',
    path: `/v1/sync/contributions/${study.accountId}`,
    accessToken: contributor.accessToken,
    body: padTo(contribution, RESEARCH_JSON_BODY_LIMIT + 1),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error, PARSER_REFUSAL);

  const fits = await service.request({
    method: 'PUT',
    path: `/v1/sync/contributions/${study.accountId}`,
    accessToken: contributor.accessToken,
    body: padTo(contribution, RESEARCH_JSON_BODY_LIMIT),
  });
  assert.equal(fits.status, 200);
});

test('a rotation carrying a maximum-size blob and more than 4 KB beside it reaches the handler', async () => {
  const owner = await signUp('rotator', 31);
  const first = await service.request({
    method: 'POST',
    path: '/v1/sync/blob',
    accessToken: owner.accessToken,
    body: { baseVersion: 0, envelopeVersion: 1, ciphertext: sampleCiphertext(17, 512) },
  });
  assert.equal(first.status, 200);

  const rotation = {
    blob: { baseVersion: 1, envelopeVersion: 1, ciphertext: sampleCiphertext(23, MAX_BLOB_BYTES) },
    keyRecords: [
      { kind: 'passphrase', kdfDescriptor: sampleKdfDescriptor(77), wrappedDek: sampleWrappedDek(21) },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: sampleWrappedDek(22) },
    ],
    // What the rotation must prove since the auth pass (2026-09-30): the
    // owner's current passphrase, and a recovery proof derived from the code.
    currentAuthHash: sampleAuthHash(31),
    newRecoveryAuthHash: recoveryAuthHashFor(sampleRecoveryCode(5)),
    recoveryCode: sampleRecoveryCode(5),
    shares: [],
  };
  // Past the blob router's limit by 32 KB, and still inside the rotation's own.
  const target = SYNC_JSON_BODY_LIMIT + 32 * 1024;
  assert.ok(target < ROTATE_DEK_JSON_BODY_LIMIT);

  const response = await service.request<{ newVersion: number }>({
    method: 'POST',
    path: '/v1/sync/rotate-dek',
    accessToken: owner.accessToken,
    body: padTo(rotation, target),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.newVersion, 2);

  // And the rotation's own ceiling still holds.
  const tooLarge = await service.request<{ error: string }>({
    method: 'POST',
    path: '/v1/sync/rotate-dek',
    accessToken: owner.accessToken,
    body: padTo({ ...rotation, blob: { ...rotation.blob, baseVersion: 2 } }, ROTATE_DEK_JSON_BODY_LIMIT + 1),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error, PARSER_REFUSAL);
});

test('the blob route keeps its own limit', async () => {
  const owner = await signUp('pusher', 41);
  const response = await service.request<{ error: string }>({
    method: 'POST',
    path: '/v1/sync/blob',
    accessToken: owner.accessToken,
    body: padTo({ baseVersion: 0, envelopeVersion: 1, ciphertext: sampleCiphertext(3, 256) }, SYNC_JSON_BODY_LIMIT + 1),
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.error, PARSER_REFUSAL);
});
