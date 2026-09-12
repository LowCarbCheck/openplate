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
 * about. So each case waits until the disk agrees with memory, and only the
 * journal is left to decide.
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
  listLocalSharePeers,
  putLocalShareIdentity,
  putLocalSharePeer,
} from '../../app/lib/local-store';
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
