/**
 * Finished invitations lose their address, against REAL Postgres (2026-09-28).
 *
 * The hosted privacy notice promises that an invitation's address is deleted once the invitation
 * is redeemed, revoked or expired. `db/invite-retention.ts` is the sweep that keeps that promise;
 * this file proves which rows it scrubs, which it must leave alone, and that the two rules that
 * read these rows (the one mailbox, one trial rule and `reissue`) still answer correctly after it.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { signupInvites } from '../../src/db/schema.js';
import { scrubFinishedInvites } from '../../src/db/invite-retention.js';
import { createDrizzleInviteStore } from '../../src/db/invite-store.js';
import { mailboxHadTrial } from '../../src/db/trial-mailbox.js';
import { createTrialAddressHasher } from '../../src/accounts/trial-address.js';

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

const NOW = new Date('2026-09-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const hashAddress = createTrialAddressHasher('a-test-pepper-that-is-long-enough-for-hmac');

type RowState = 'pending' | 'expired' | 'revoked' | 'redeemed';

/** Writes one invite row in a given state, straight into the table. */
async function insertInvite(
  email: string,
  state: RowState,
  extra: { trialKey?: string | null; trialScans?: number | null } = {},
): Promise<number> {
  const [row] = await database.db
    .insert(signupInvites)
    .values({
      tokenHash: `hash-${email}-${state}-${Math.random()}`,
      email,
      displayName: `Name of ${email}`,
      role: 'member',
      dailyAiLimit: 0,
      expiresAt: state === 'expired' ? new Date(NOW.getTime() - HOUR) : new Date(NOW.getTime() + HOUR),
      revokedAt: state === 'revoked' ? new Date(NOW.getTime() - HOUR) : null,
      redeemedAt: state === 'redeemed' ? new Date(NOW.getTime() - HOUR) : null,
      trialKey: extra.trialKey ?? null,
      trialScans: extra.trialScans ?? null,
    })
    .returning({ id: signupInvites.id });
  if (!row) throw new Error('insert failed');
  return row.id;
}

async function readRow(id: number) {
  const [row] = await database.db
    .select({
      email: signupInvites.email,
      displayName: signupInvites.displayName,
      trialKey: signupInvites.trialKey,
      trialScans: signupInvites.trialScans,
      redeemedAt: signupInvites.redeemedAt,
    })
    .from(signupInvites)
    .where(eq(signupInvites.id, id));
  if (!row) throw new Error(`row ${id} is gone`);
  return row;
}

test('with a pepper, every finished row loses its address and name, and a pending row keeps both', async () => {
  const pending = await insertInvite('pending@example.org', 'pending', {
    trialKey: hashAddress('pending@example.org'),
  });
  const expired = await insertInvite('expired@example.org', 'expired', {
    trialKey: hashAddress('expired@example.org'),
  });
  const revoked = await insertInvite('revoked@example.org', 'revoked', {
    trialKey: hashAddress('revoked@example.org'),
  });
  const redeemed = await insertInvite('redeemed@example.org', 'redeemed', {
    trialKey: hashAddress('redeemed@example.org'),
    trialScans: 10,
  });

  const scrubbed = await scrubFinishedInvites(database.db, { now: NOW, hashAddress });
  assert.equal(scrubbed, 3);

  // THE CONTROL: the pending row is where a letter goes, so it must be untouched. Without it this
  // test would pass against a sweep that wiped every row.
  const stillPending = await readRow(pending);
  assert.equal(stillPending.email, 'pending@example.org');
  assert.equal(stillPending.displayName, 'Name of pending@example.org');
  assert.equal(stillPending.trialKey, hashAddress('pending@example.org'));

  for (const id of [expired, revoked, redeemed]) {
    const row = await readRow(id);
    assert.equal(row.email, '', `row ${id} still holds an address`);
    assert.equal(row.displayName, null, `row ${id} still holds a name`);
  }

  // An unredeemed row's keyed hash answers nothing, so it goes; a redeemed row's hash is the
  // record the one mailbox, one trial rule reads, so it stays.
  assert.equal((await readRow(expired)).trialKey, null);
  assert.equal((await readRow(revoked)).trialKey, null);
  assert.equal((await readRow(redeemed)).trialKey, hashAddress('redeemed@example.org'));
  assert.equal((await readRow(redeemed)).trialScans, 10);

  // A second sweep finds nothing more to do.
  assert.equal(await scrubFinishedInvites(database.db, { now: NOW, hashAddress }), 0);
});

test('a redeemed row minted before trial_key existed gets its keyed hash before it loses its address', async () => {
  const legacy = await insertInvite('legacy@example.org', 'redeemed', { trialKey: null, trialScans: 10 });

  // Before the sweep, the one mailbox, one trial rule cannot see this row: it reads only the hash.
  assert.equal(await mailboxHadTrial(database.db, { hash: hashAddress('legacy@example.org') }), false);

  await scrubFinishedInvites(database.db, { now: NOW, hashAddress });

  const row = await readRow(legacy);
  assert.equal(row.email, '');
  assert.equal(row.trialKey, hashAddress('legacy@example.org'));
  // So the trial this mailbox already had is still counted, now without its address.
  assert.equal(await mailboxHadTrial(database.db, { hash: hashAddress('legacy@example.org') }), true);
});

test('without a pepper, a redeemed row keeps its address, and revoked and expired rows still lose theirs', async () => {
  const redeemed = await insertInvite('kept@example.org', 'redeemed');
  const revoked = await insertInvite('gone@example.org', 'revoked');
  const expired = await insertInvite('also-gone@example.org', 'expired');

  const scrubbed = await scrubFinishedInvites(database.db, { now: NOW, hashAddress: null });
  assert.equal(scrubbed, 2);

  // The re-invite rule and the deletion path read a redeemed row's address on such an instance,
  // and there is no keyed hash to keep in its place.
  assert.equal((await readRow(redeemed)).email, 'kept@example.org');
  assert.equal((await readRow(revoked)).email, '');
  assert.equal((await readRow(expired)).email, '');
});

test('reissue refuses an expired row whose address is gone, and still revives one that has an address', async () => {
  const store = createDrizzleInviteStore(database.db, { hashAddress });
  const scrubbedAway = await insertInvite('scrubbed@example.org', 'expired');
  await scrubFinishedInvites(database.db, { now: NOW, hashAddress });

  const refused = await store.reissue({ inviteId: scrubbedAway, expiresAt: new Date(NOW.getTime() + 24 * HOUR) });
  assert.equal(refused, null, 'a row with no address must not become a live invitation');

  // THE CONTROL: an expired row the sweep has not reached yet can still be sent again.
  const notYet = await insertInvite('not-yet@example.org', 'expired');
  const revived = await store.reissue({ inviteId: notYet, expiresAt: new Date(NOW.getTime() + 24 * HOUR) });
  assert.notEqual(revived, null);
  assert.equal(revived?.invite.email, 'not-yet@example.org');
});
