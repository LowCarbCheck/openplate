/**
 * The mailbox hash of a deleted account has an end (2026-10-05, ADR-0010).
 *
 * WHAT ONLY A DATABASE CAN SAY. That `trial_address_hashes.created_at` exists
 * (migration 0033) and is written by a real deletion, and that the purge is a
 * real `DELETE ... WHERE created_at < cutoff` that takes the aged row and
 * leaves the fresh one.
 *
 * EVERY CLAIM HAS ITS CONTROL: the same rows with a longer period survive, a
 * run with the purge not called leaves the aged row, and an instance that still
 * grants a trial writes the hash an instance that does not, does not.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTrialAddressHasher } from '../../src/accounts/trial-address.js';
import { purgeExpiredTrialHashes } from '../../src/db/trial-hash-retention.js';
import { signupInvites, trialAddressHashes } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleAuthHash, startService, type ServiceHarness } from './service-harness.js';

const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-05T12:00:00.000Z');

let database: TestDatabase;

before(async () => {
  database = await setupTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

async function hashesLeft(): Promise<string[]> {
  const rows = await database.db.select().from(trialAddressHashes);
  return rows.map((row) => row.hash).toSorted();
}

async function seedHashes(): Promise<void> {
  await database.db.insert(trialAddressHashes).values([
    { hash: 'aged-366-days', createdAt: daysAgo(366) },
    { hash: 'aged-a-decade', createdAt: daysAgo(3650) },
    { hash: 'fresh-364-days', createdAt: daysAgo(364) },
    { hash: 'fresh-today', createdAt: NOW },
  ]);
}

test('a hash older than the period is purged and a newer one stays', async () => {
  await seedHashes();
  assert.equal((await hashesLeft()).length, 4);

  const purged = await purgeExpiredTrialHashes(database.db, { now: NOW, retentionDays: 365 });

  assert.equal(purged, 2);
  assert.deepEqual(await hashesLeft(), ['fresh-364-days', 'fresh-today']);
});

test('CONTROL: with a longer period, or with the purge not run, the aged rows stay', async () => {
  await seedHashes();
  // Not run: nothing moves. This is the control that fails when the purge is
  // what the test above depends on.
  assert.equal((await hashesLeft()).length, 4);

  // A period that reaches back past the oldest row keeps everything.
  assert.equal(await purgeExpiredTrialHashes(database.db, { now: NOW, retentionDays: 3651 }), 0);
  assert.equal((await hashesLeft()).length, 4);

  // A period of one day takes all but the row from today.
  assert.equal(await purgeExpiredTrialHashes(database.db, { now: NOW, retentionDays: 1 }), 3);
  assert.deepEqual(await hashesLeft(), ['fresh-today']);
});

test('the purge refuses a period that is not a whole number of days', async () => {
  await seedHashes();
  for (const retentionDays of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(() => purgeExpiredTrialHashes(database.db, { now: NOW, retentionDays }), /retention period/);
  }
  assert.equal((await hashesLeft()).length, 4, 'a refused call deletes nothing');
});

async function deleteAccountOf(input: { service: ServiceHarness; email: string }): Promise<void> {
  const session = await input.service.signupThroughInvite({ email: input.email, dailyAiLimit: 50, trialScans: 10 });
  const deleted = await input.service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: session.tokens.accessToken,
    body: { authHash: sampleAuthHash() },
  });
  assert.equal(deleted.status, 204);
}

test('a real deletion writes the hash with the instant of the deletion, and the purge then ends it', async () => {
  const service = await startService({ db: database.db, trialAddressPepper: PEPPER });
  try {
    const deletedAround = Date.now();
    await deleteAccountOf({ service, email: 'anna@example.org' });

    const rows = await database.db.select().from(trialAddressHashes);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.hash, createTrialAddressHasher(PEPPER)('anna@example.org'));
    const writtenAt = rows[0]?.createdAt.getTime() ?? 0;
    assert.ok(
      Math.abs(writtenAt - deletedAround) < 60_000,
      `created_at ${rows[0]?.createdAt.toISOString()} is not the deletion's`,
    );

    // A year later the row is gone, and a day later it is not.
    assert.equal(
      await purgeExpiredTrialHashes(database.db, { now: new Date(writtenAt + 364 * MS_PER_DAY), retentionDays: 365 }),
      0,
    );
    assert.equal(
      await purgeExpiredTrialHashes(database.db, { now: new Date(writtenAt + 366 * MS_PER_DAY), retentionDays: 365 }),
      1,
    );
    assert.deepEqual(await hashesLeft(), []);
  } finally {
    await service.close();
  }
});

test('an instance that grants no scan trial keeps no hash on a deletion, and still scrubs the address', async () => {
  const service = await startService({ db: database.db, trialAddressPepper: PEPPER, grantsScanTrial: false });
  try {
    await deleteAccountOf({ service, email: 'ben@example.org' });
    assert.deepEqual(await hashesLeft(), [], 'nothing would read it');
    const rows = await database.db.select().from(signupInvites).where(eq(signupInvites.email, 'ben@example.org'));
    assert.deepEqual(rows, [], 'the address is scrubbed from the invitation rows all the same');
  } finally {
    await service.close();
  }
});
