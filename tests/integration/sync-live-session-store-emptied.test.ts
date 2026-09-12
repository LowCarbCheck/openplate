/**
 * A LIVE SESSION WHOSE STORE WAS EMPTIED UNDER IT, driven through the real
 * sync verb (M226).
 *
 * `private-store-compartment.test.ts` proves the FUNCTION: a seal handed a
 * region smaller than the one its session last read, with nothing in the
 * journal, answers `held`. That is the rule. This file proves the WIRING,
 * because the rule only helps if the production path asks the question with
 * the production arguments, and the loss it prevents is measured in bytes on
 * somebody's account rather than in a return value.
 *
 * ── The state, spelled the way it happens ────────────────────────────────
 *
 * The session is NOT degraded in any way the older refusals can see: it minted
 * the compartment, it holds the CDK, both wraps and the extras, and it has
 * read the plaintext. What goes away is the STORE, under a session that keeps
 * running: a browser evicting the database, a `t` object store that lost its
 * rows, a second tab clearing site data. `partitionSnapshot` then hands the
 * seal an empty region, and before M226 the seal wrote it: a new ciphertext, a
 * new content hash, a stamp of `previous + 1` that outranks the account's
 * copy, and a push that replaced the share key pair and every pinned peer with
 * nothing. No tombstone is involved anywhere in it, so the delete journal rule
 * that protects the diary never fired.
 *
 * ── Why the disk is waited for, twice ────────────────────────────────────
 *
 * The seal weighs TWO signals, the journal and the disk-versus-memory
 * comparison, and either one alone would hold the compartment here. A test
 * that ran while the autosave was still in flight would pass on the second
 * signal and say nothing about the first, which is the one this spec is
 * about. So the FIRST case waits until the disk agrees with memory, and only
 * the journal is left to decide.
 *
 * The SECOND case (M227) is about what the cycle does with the journal row
 * afterwards, and it holds the compartment on purpose; its own doc says how
 * and why.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount, syncNow } from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { closeSyncSession, getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { createPrivateStoreSession, openOwnerPrivateRegion } from '../../app/lib/sync/private-store';
import { readSealedPrivateStore, type SealedPrivateStore } from '../../app/lib/sync/snapshot-partition';
import {
  deleteLocalSharePeer,
  getLocalShareIdentity,
  listDeletedEntityKeys,
  listLocalSharePeers,
  putLocalShareIdentity,
  putLocalSharePeer,
} from '../../app/lib/local-store';
import { forgetPinnedPeer } from '../../app/lib/sync/share-actions';
import { getPrimaryStore, readPersistedTableRowCounts } from '../../app/lib/local-store/persist';
import { PRIMARY_DB_NAME } from '../../app/lib/local-store/store';
import { SHARE_IDENTITY_ROW_ID, SHARE_IDENTITY_TABLE, SHARE_PEERS_TABLE } from '../../app/lib/local-store/schema';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });
const PASSPHRASE = 'seventeen purple lanterns drifting';

/** The marker that must survive every cycle here: the account's own share private key. */
const PRIVATE_KEY_MARKER = 'THE-KEY-THAT-MUST-SURVIVE';
/** The clinician this device verified in person. Her account id is the peer row's id. */
const PEER_ACCOUNT_ID = 9;
/** The clinician the second case un-pins through the production verb, on its own account. */
const UNPINNED_PEER_ACCOUNT_ID = 11;
/** The clinician whose row the browser drops in that same case, with nothing written down. */
const EVICTED_PEER_ACCOUNT_ID = 12;

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`, which
  // is how `persist.ts` decides it may open a database at all.
  globalThis.window = globalThis as typeof globalThis & Window;
  // The store's autoLoad poll would hold this process open, so every interval
  // it schedules is unref'd. Installed for the whole file, because the open
  // happens deep inside `syncNow()` where there is nothing to wrap.
  const scheduleInterval = globalThis.setInterval;
  function unrefdSetInterval<TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): NodeJS.Timeout {
    return scheduleInterval(callback, delay, ...args).unref();
  }
  // SAFETY: the DOM overload answers a `number`; in node the handle carries `unref`.
  globalThis.setInterval = unrefdSetInterval as typeof globalThis.setInterval;
});

after(async () => {
  closeSyncSession();
  await service.close();
});

function expectReady(outcome: SyncSetupOutcome): string {
  assert.equal(outcome.status, 'ready', 'a signup must complete and open a session');
  return outcome.email;
}

function requireVault(): SyncVault {
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

/**
 * THE COMPARTMENT THE SERVICE ACTUALLY HOLDS, decrypted out of the blob.
 *
 * Never an in-memory copy of what we hoped was pushed: the whole defect was a
 * push that looked ordinary from the inside.
 */
async function compartmentOnTheService(vault: SyncVault): Promise<SealedPrivateStore> {
  const pulled = await vault.http.pullBlob();
  assert.ok(pulled !== null, 'the service must be holding a blob');
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: vault.accountId,
    dek: vault.dek,
  });
  const sealed = readSealedPrivateStore({ snapshot: decrypted.payload.snapshot });
  assert.ok(sealed !== null, 'the account must be holding a compartment');
  return sealed;
}

/**
 * What the account's compartment SAYS, opened by a reader that shares nothing
 * with the session under test but the passphrase.
 *
 * "The bytes did not change" is an absence assertion and passes against
 * rubbish; this is what makes each claim about the key material itself.
 */
async function regionOnTheService(vault: SyncVault) {
  const reader = createPrivateStoreSession({
    accountId: vault.accountId,
    passphraseKek: vault.privateStore.passphraseKek,
  });
  const region = await openOwnerPrivateRegion({ session: reader, sealed: await compartmentOnTheService(vault) });
  assert.ok(region !== null, 'the account’s compartment must still open with this account’s passphrase');
  return region;
}

/**
 * Waits until the DISK holds exactly this many rows of a table.
 *
 * Bounded, and it throws rather than returning a boolean: a test that ran on
 * before the autosave landed would be measuring the disk-versus-memory signal
 * instead of the journal, and silently passing for the wrong reason.
 */
async function untilPersistedRowCount(table: string, expected: number): Promise<void> {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const probe = await readPersistedTableRowCounts(PRIMARY_DB_NAME);
    if (probe.kind === 'present' && (probe.counts[table] ?? 0) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the store never persisted ${expected} row(s) in ${table}`);
}

async function signUpFresh(label: string): Promise<string> {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.org`;
  return expectReady(
    await createSyncAccount({
      serverUrl: service.url,
      inviteToken: service.createInvite({ email }),
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    }),
  );
}

test('an emptied store does not blank the account’s compartment, and an un-pin still does', async () => {
  await signUpFresh('store-emptied');
  const vault = requireVault();

  // A device that generated a share key and verified one clinician in person.
  await putLocalShareIdentity({ publicKeyRaw: 'a-public-key', privateKeyPkcs8: PRIVATE_KEY_MARKER, createdAt: 7_000 });
  await putLocalSharePeer({
    id: String(PEER_ACCOUNT_ID),
    accountId: PEER_ACCOUNT_ID,
    publicKeyRaw: 'peer-public-key',
    label: 'Dr. Meier',
    createdAt: 8_000,
  });
  await syncNow();

  // NON-VACUITY: the account really holds both, so everything below is about
  // something the push could destroy.
  const published = await compartmentOnTheService(vault);
  const beforeRegion = await regionOnTheService(vault);
  assert.equal(beforeRegion.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
  assert.deepEqual(
    beforeRegion.sharePeers.map((peer) => peer.id),
    [String(PEER_ACCOUNT_ID)],
  );

  // ── THE EMPTIED STORE ───────────────────────────────────────────────────
  // `delRow` directly, which is what an eviction leaves behind: the rows are
  // gone and NOTHING was written down, because no person removed them.
  const store = await getPrimaryStore();
  store.delRow(SHARE_IDENTITY_TABLE, SHARE_IDENTITY_ROW_ID);
  store.delRow(SHARE_PEERS_TABLE, String(PEER_ACCOUNT_ID));
  assert.equal(await getLocalShareIdentity(), null, 'the device must really have lost the row');
  // The disk agrees, so the storage signal says nothing and the empty journal
  // is the only thing left that can hold the compartment.
  await untilPersistedRowCount(SHARE_IDENTITY_TABLE, 0);
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 0);

  await syncNow();

  // THE CLAIM, in bytes. All three fields separately: a compartment re-sealed
  // over the empty region would carry the same wraps with different
  // ciphertext, and a `deepEqual` alone would not say which half moved.
  const afterEmptying = await compartmentOnTheService(vault);
  assert.equal(afterEmptying.ciphertext, published.ciphertext, 'the account’s ciphertext must be untouched');
  assert.equal(afterEmptying.cdkWrapPassphrase, published.cdkWrapPassphrase);
  assert.equal(afterEmptying.cdkWrapRecovery, published.cdkWrapRecovery);

  // AND THE DEVICE IS HEALED BY THE ORDINARY PATH: the cycle pulled the
  // compartment it re-emitted, opened it, and wrote the rows back.
  assert.equal((await getLocalShareIdentity())?.privateKeyPkcs8, PRIVATE_KEY_MARKER, 'the key must be back locally');
  assert.deepEqual(
    (await listLocalSharePeers()).map((peer) => peer.id),
    [String(PEER_ACCOUNT_ID)],
    'and so must the pin',
  );

  // ── THE CONTROL: an un-pin the person performed ─────────────────────────
  // Same shrink, same session, one difference: the verb wrote the removal
  // down. Without this the rule above could be "never shrink a compartment",
  // which would strand every un-pin on the device that performed it.
  await deleteLocalSharePeer(PEER_ACCOUNT_ID);
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 0);

  await syncNow();

  const afterUnpin = await compartmentOnTheService(vault);
  assert.notEqual(afterUnpin.ciphertext, published.ciphertext, 'a recorded un-pin must reach the account');
  const afterRegion = await regionOnTheService(vault);
  assert.deepEqual(afterRegion.sharePeers, [], 'the peer must be gone from the account');
  // And ONLY the peer: the un-pin is not a licence to lose the key beside it.
  assert.equal(afterRegion.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
});

/**
 * AN UN-PIN INSIDE A COMPARTMENT THE SEAL HOLDS, driven through the production
 * verb (M227).
 *
 * The case above waits for the disk before every sync so that only the journal
 * decides. Production does not wait: `forgetPinnedPeer` removes the row and
 * calls `syncNow` in the same breath, and the cycle can easily read a device
 * that cannot yet prove the shrink. The seal then HOLDS, and until this spec
 * the journal row was dropped anyway by the cycle's prune, so the NEXT cycle
 * had no evidence at all: it held again, and the apply wrote the peer back out
 * of the account's own compartment. The person un-pinned a clinician and found
 * her pinned again, under a notice saying their data had been restored.
 *
 * ── Why the hold is planted rather than raced ────────────────────────────
 *
 * The state is a race in a browser and not one here: `fake-indexeddb` commits
 * before the cycle's probe runs, so a delete-then-sync in node always ends up
 * provable and always publishes on the first cycle. So the hold is produced by
 * the OTHER half of the same rule, which needs no timing at all: a second peer
 * whose row the browser lost with nothing written down. Every lost key must be
 * proven or none is (`isShrinkProven`), so the recorded un-pin beside it goes
 * unpublished, which is the state under test. The un-pin itself is still the
 * real verb, and what it leaves behind is still the real journal row.
 */
test('a recorded un-pin inside a HELD compartment survives the prune and lands on the next cycle', async () => {
  await signUpFresh('unpin-held');
  const vault = requireVault();

  await putLocalShareIdentity({ publicKeyRaw: 'a-public-key', privateKeyPkcs8: PRIVATE_KEY_MARKER, createdAt: 7_000 });
  for (const accountId of [UNPINNED_PEER_ACCOUNT_ID, EVICTED_PEER_ACCOUNT_ID]) {
    await putLocalSharePeer({
      id: String(accountId),
      accountId,
      publicKeyRaw: 'peer-public-key',
      label: `Dr. ${accountId}`,
      createdAt: 8_000,
    });
  }
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 2);
  await syncNow();

  // NON-VACUITY: the account really holds both pins, so everything below is
  // about rows that can be lost and a removal that can be undone.
  const beforeRegion = await regionOnTheService(vault);
  assert.deepEqual(
    beforeRegion.sharePeers.map((peer) => peer.id).toSorted(),
    [String(UNPINNED_PEER_ACCOUNT_ID), String(EVICTED_PEER_ACCOUNT_ID)].toSorted(),
    'precondition: the account must be holding both pins',
  );
  const published = await compartmentOnTheService(vault);

  // ── CYCLE 1, the held one ───────────────────────────────────────────────
  // The browser loses one row with nothing written down, and the person
  // un-pins the other through the verb the UI calls.
  const store = await getPrimaryStore();
  store.delRow(SHARE_PEERS_TABLE, String(EVICTED_PEER_ACCOUNT_ID));
  await forgetPinnedPeer(UNPINNED_PEER_ACCOUNT_ID);

  assert.equal(
    (await compartmentOnTheService(vault)).ciphertext,
    published.ciphertext,
    'precondition: one unproven loss holds the whole compartment, so nothing was published',
  );
  // THE CLAIM OF PART ONE. The un-pin reached nobody, so the row that proves
  // it must still be here. Prune the whole read set, which is the rule this
  // replaced, and this line goes red, and so does every assertion after it.
  assert.ok(
    (await listDeletedEntityKeys()).includes(`sharePeer:${UNPINNED_PEER_ACCOUNT_ID}`),
    'a held compartment must keep the row that proves the un-pin',
  );
  // THE CLAIM OF PART TWO, and the heal beside it: the held bytes name both
  // peers, and the apply may write back only the one nobody removed.
  assert.deepEqual(
    (await listLocalSharePeers()).map((peer) => peer.id),
    [String(EVICTED_PEER_ACCOUNT_ID)],
    'the evicted pin is healed and the un-pinned one is not written back',
  );

  // ── CYCLE 2: the only loss left is the recorded one ─────────────────────
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 1);
  await syncNow();

  const afterRegion = await regionOnTheService(vault);
  assert.deepEqual(
    afterRegion.sharePeers.map((peer) => peer.id),
    [String(EVICTED_PEER_ACCOUNT_ID)],
    'the un-pin must reach the account, and take nothing else with it',
  );
  // And the key material beside it: an un-pin is not a licence to lose it.
  assert.equal(afterRegion.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
  assert.ok(
    !(await listDeletedEntityKeys()).includes(`sharePeer:${UNPINNED_PEER_ACCOUNT_ID}`),
    'and only now is the journal row spent',
  );
});

/**
 * THE BOOT AFTER THE HELD CYCLE, driven on the real store (M228).
 *
 * The case above proves the journal row survives the cycle that held. This one
 * is what happens next in the only way a person actually hits it: they close
 * the tab.
 *
 * A resumed session is built by `openSyncVault` with no compartment session to
 * adopt, so it starts with no CDK, no pulled bytes and `hasPulled: false`,
 * and `readSyncedSnapshot` seals BEFORE the cycle pulls. The first cycle after
 * every boot therefore answers `unknown`: it publishes nothing at all, least
 * of all an owner-private removal. Reading that as "not held, so the removal
 * published" spent the un-pin's journal row on the launch, the apply wrote the
 * peer back out of the account's own compartment, and the second cycle had no
 * evidence left to try again with. The clinician was pinned again, for good.
 *
 * ── Why the hold is planted rather than raced ────────────────────────────
 *
 * Same reason as the case above: in node the autosave always lands before the
 * cycle's disk probe, so a delete-then-sync is always provable here. The hold
 * is produced by the other half of `isShrinkProven` instead, a second peer
 * whose row the browser lost with nothing written down, which needs no timing.
 */
test('the first cycle after a BOOT does not spend an un-pin that reached nobody', async () => {
  await signUpFresh('boot-after-hold');
  const vault = requireVault();

  await putLocalShareIdentity({ publicKeyRaw: 'a-public-key', privateKeyPkcs8: PRIVATE_KEY_MARKER, createdAt: 7_000 });
  for (const accountId of [PEER_ACCOUNT_ID, EVICTED_PEER_ACCOUNT_ID]) {
    await putLocalSharePeer({
      id: String(accountId),
      accountId,
      publicKeyRaw: 'peer-public-key',
      label: `Dr. ${accountId}`,
      createdAt: 8_000,
    });
  }
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 2);
  await syncNow();

  // NON-VACUITY: the account really holds both pins.
  const beforeRegion = await regionOnTheService(vault);
  assert.deepEqual(
    beforeRegion.sharePeers.map((peer) => peer.id).toSorted(),
    [String(PEER_ACCOUNT_ID), String(EVICTED_PEER_ACCOUNT_ID)].toSorted(),
    'precondition: the account must be holding both pins',
  );
  const published = await compartmentOnTheService(vault);

  // ── THE HELD CYCLE, and then the tab closes ─────────────────────────────
  const store = await getPrimaryStore();
  store.delRow(SHARE_PEERS_TABLE, String(EVICTED_PEER_ACCOUNT_ID));
  await forgetPinnedPeer(PEER_ACCOUNT_ID);
  assert.equal(
    (await compartmentOnTheService(vault)).ciphertext,
    published.ciphertext,
    'precondition: one unproven loss holds the whole compartment, so the un-pin published nothing',
  );
  assert.ok(
    (await listDeletedEntityKeys()).includes(`sharePeer:${PEER_ACCOUNT_ID}`),
    'precondition: the held cycle kept the row that proves the un-pin',
  );

  // ── THE BOOT ────────────────────────────────────────────────────────────
  // The session a resume builds, over the same device store and the same sync
  // state: `session-cache.ts`'s `openSyncVault` calls exactly this constructor
  // when it has no compartment session to adopt.
  vault.privateStore = createPrivateStoreSession({
    accountId: vault.accountId,
    passphraseKek: vault.privateStore.passphraseKek,
  });
  assert.equal(vault.privateStore.cdk, null, 'precondition: a resumed session holds no compartment key');
  assert.equal(vault.privateStore.pulled, null, 'precondition: and no pulled bytes');
  assert.equal(vault.privateStore.hasPulled, false, 'precondition: and has not looked yet');

  // ── CYCLE 1 of the new session: it seals before it pulls, so it publishes
  // nothing.
  await syncNow();

  // THE CLAIM. Set the kept-keys flag for `held` alone, which is the rule this
  // replaced, and this line goes red: the row is spent on the boot, and every
  // assertion after it follows.
  assert.ok(
    (await listDeletedEntityKeys()).includes(`sharePeer:${PEER_ACCOUNT_ID}`),
    'a cycle that published nothing must keep the row that proves the un-pin',
  );
  assert.deepEqual(
    (await listLocalSharePeers()).map((peer) => peer.id),
    [String(EVICTED_PEER_ACCOUNT_ID)],
    'and the apply must not write the un-pinned peer back',
  );

  // ── CYCLE 2: the session has read the compartment now, and the only loss
  // left is the recorded one.
  await untilPersistedRowCount(SHARE_PEERS_TABLE, 1);
  await syncNow();

  const afterRegion = await regionOnTheService(vault);
  assert.deepEqual(
    afterRegion.sharePeers.map((peer) => peer.id),
    [String(EVICTED_PEER_ACCOUNT_ID)],
    'the un-pin must reach the account, and take nothing else with it',
  );
  assert.equal(afterRegion.shareIdentity?.privateKeyPkcs8, PRIVATE_KEY_MARKER);
  assert.deepEqual(await listDeletedEntityKeys(), [], 'and only now is the journal row spent');
});
