/**
 * THE SHARING COMPOSITION ROOT, driven end to end over real HTTP against the
 * protocol-faithful fake (`fake-sync-service.ts`).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `app/lib/sync/share-actions.ts` is where the pure ceremony in `sharing.ts`
 * is wired to a vault, a device store and a transport. Its own header says it
 * "decides nothing" — and until this file, no file under `tests/` imported it
 * at all. That is the third instance of one measured shape: M163/04 deleted
 * `markSyncPending()` + `syncNow()` from `submitContributionAction` and the
 * whole suite stayed green at 2251 pass / 0 fail.
 *
 * The module makes the same two calls at three sites, and each dropped sync
 * costs something specific:
 *
 *  1. `ensureShareIdentity` — the share key pair is written to the device and
 *     never reaches the blob. A second device restoring from that blob finds
 *     no identity and generates a SECOND key pair, which the function's own
 *     header says "would silently orphan every wrap already addressed to the
 *     first, and the failure would look like 'my patients disappeared' months
 *     later".
 *  2. `grantShare` — the pin IS the verification record for a ceremony two
 *     people performed in one room. A pin that never syncs makes the account's
 *     other devices demand that ceremony again.
 *  3. `forgetPinnedPeer` — the forget stays local, so the peer reappears on
 *     the next pull and the next grant skips the ceremony it was meant to
 *     require.
 *
 * ── Assert the OUTCOME, never the call ───────────────────────────────────
 *
 * `research-actions.test.ts`'s rule, inherited whole and re-stated by
 * `study-session.test.ts`: nothing here spies on `markSyncPending` or
 * `syncNow`, because a spy is green when the wiring is invoked AND broken. The
 * observation point is {@link compartmentOnTheService} — the owner-private
 * compartment as the SERVICE holds it, pulled back over HTTP and opened with
 * the session's own compartment key. A test that read `getLocalShareIdentity()`
 * or `listLocalSharePeers()` would pass with all six lines deleted.
 *
 * ── The forget is a DELETION, so its assertion needs two peers ───────────
 *
 * "The peer is absent from the compartment" passes just as well against a
 * compartment the peer never reached, against a compartment that failed to
 * push, and against no compartment at all. So the forget test grants TWO
 * peers, proves both landed on the service, forgets one, and asserts the
 * service then holds EXACTLY the other. The survivor is what makes the
 * absence a deletion rather than a vacuum: it can only be there if a
 * compartment was pushed after the forget.
 *
 * ── Key material is never an assertion operand ───────────────────────────
 *
 * A failing `assert.deepEqual` prints both sides. The private half of a share
 * key pair must not be printed anywhere, so it is only ever compared inside
 * `assert.ok(a === b, '…')`, which prints the message and nothing else, and
 * every structural comparison runs over {@link identityMarkOf}'s public
 * fields.
 *
 * ── The substitutions ────────────────────────────────────────────────────
 *
 * Two, both inherited:
 *
 *  - Argon2id runs in-process with tiny parameters, through the `deriveHash`
 *    and `params` seams `setup-keys.ts` exposes for exactly this.
 *  - THE DEVICE STORE IS REAL — `fake-indexeddb` behind the production
 *    `getPrimaryStore()` singleton. It has to be: these actions call
 *    `putLocalShareIdentity` and `deleteLocalSharePeer` directly, and
 *    substituting them would substitute the wiring under test. See
 *    {@link openTheDeviceStore} for the autoLoad poll that would otherwise
 *    hold `node --test` open forever.
 *
 * Nothing about `share-actions.ts` itself is substituted: no transport double,
 * no fake vault, no injected compartment. The fake service's §5.16 handlers
 * are new for this file — see their comment there for why a dark deployment
 * cannot express any of this.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount } from '../../app/lib/sync/sync-actions';
import { ensureShareIdentity, forgetPinnedPeer, grantShare } from '../../app/lib/sync/share-actions';
import { getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { createPrivateStoreSession, openOwnerPrivateRegion } from '../../app/lib/sync/private-store';
import { readSealedPrivateStore, type OwnerPrivateRegion } from '../../app/lib/sync/snapshot-partition';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { generateShareKeyPair, shareKeyFingerprint } from '../../app/lib/sync/engine/crypto/share-wrap';
import { deleteLocalShareIdentity, deleteLocalSharePeer, getLocalShareIdentity } from '../../app/lib/local-store';
import { listLocalSharePeers } from '../../app/lib/local-store';
import type { LocalShareIdentity } from '../../app/lib/local-store';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
/** Tiny parameters, injected at the seam `setup-keys.ts` exposes for exactly this. */
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

const PASSPHRASE = 'seventeen purple lanterns drifting';

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  await openTheDeviceStore();
});

after(async () => {
  await service.close();
});

/**
 * Returns the device to "sharing has never been used here".
 *
 * The store is a PROCESS-WIDE singleton, so an identity one test generates is
 * in every later test's snapshot — and the second test's whole claim is about
 * what happens when there is no identity yet. Each case therefore starts from
 * a device that has generated nothing and pinned nobody.
 */
afterEach(async () => {
  await deleteLocalShareIdentity();
  for (const peer of await listLocalSharePeers()) await deleteLocalSharePeer(peer.accountId);
});

/**
 * Opens the REAL device store once, without letting its autoLoad poll hold the
 * test process open. Copied deliberately from `research-actions.test.ts`: the
 * reasoning is that file's, and the three must not drift.
 */
async function openTheDeviceStore(): Promise<void> {
  // `getPrimaryStore()` refuses outside a browser with IndexedDB. `window` is
  // a MARKER here, not a browser: nothing in these paths reads a property off
  // it, and the one place that would (`installFlushOnHide`) also requires
  // `document`, which stays absent.
  // SAFETY: the guard this satisfies is `globalThis.window !== undefined`.
  globalThis.window = globalThis as typeof globalThis & Window;

  const scheduleInterval = globalThis.setInterval;
  function unrefdSetInterval<TArgs extends unknown[]>(
    callback: (...args: TArgs) => void,
    delay?: number,
    ...args: TArgs
  ): NodeJS.Timeout {
    return scheduleInterval(callback, delay, ...args).unref();
  }
  // SAFETY: the DOM overload of `setInterval` answers a `number`; in node the
  // handle is a `Timeout` that carries `unref`, and node is the only runtime
  // this file executes in.
  globalThis.setInterval = unrefdSetInterval as typeof globalThis.setInterval;
  try {
    await listLocalSharePeers();
  } finally {
    globalThis.setInterval = scheduleInterval;
  }
}

/** Makes each generated address unique within one run, since the whole file shares a service. */
let accountCounter = 0;

/**
 * Creates an account on the fake service and returns the session it opened.
 *
 * The session is a MODULE SINGLETON, so the last account created is the one
 * every action below reaches for — the earlier vaults are kept only for their
 * own transports.
 */
async function createAccount(label: string): Promise<SyncVault> {
  await createSyncAccount({
    serverUrl: service.url,
    email: `${label}-${Date.now()}-${accountCounter++}@example.test`,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

/**
 * THE OBSERVATION POINT OF THIS FILE: the owner-private compartment as the
 * SERVICE holds it.
 *
 * Pulls the blob back over HTTP, decrypts it with the session's DEK, and opens
 * the compartment nested inside it. Nothing local is consulted — a test that
 * read the device store would pass with the sync deleted, which is the exact
 * defect this file exists to catch.
 *
 * ── THE OPEN RUNS ON A THROWAWAY SESSION, NOT THE LIVE ONE (M164/07) ─────
 *
 * `openOwnerPrivateRegion` is not a reader. It records `pulled`, adopts a CDK
 * and the two wraps, and writes `extras` — so calling it on `vault.privateStore`
 * would mean that merely LOOKING at the service changed the session every
 * assertion afterwards runs against. It happens not to break the cases in this
 * file today, and it is exactly the trap the next test to observe-then-expect-
 * unchanged would fall into.
 *
 * The throwaway session is given the live session's `K_pp` and nothing else:
 * that is what unwraps slot 1 of the account's own compartment, and it is read
 * from the vault rather than copied.
 */
async function compartmentOnTheService(vault: SyncVault): Promise<OwnerPrivateRegion> {
  const pulled = await vault.http.pullBlob();
  assert.ok(pulled !== null, 'the service is holding no blob at all for this account');
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: vault.accountId,
    dek: vault.dek,
  });
  const region = await openOwnerPrivateRegion({
    session: createPrivateStoreSession({
      accountId: vault.accountId,
      passphraseKek: vault.privateStore.passphraseKek,
    }),
    sealed: readSealedPrivateStore({ snapshot: decrypted.payload.snapshot }),
  });
  assert.ok(region !== null, 'the blob carries no owner-private compartment');
  return region;
}

/**
 * The identity's PUBLIC fields, and only those.
 *
 * Every structural assertion runs over this rather than over the record: a
 * failing `deepEqual` prints both operands, and the private half of a share
 * key pair must not be printed anywhere. Where the private half itself has to
 * be compared, `assert.ok(a === b, '…')` does it — that form prints the
 * message and nothing else.
 */
function identityMarkOf(identity: LocalShareIdentity) {
  return { publicKeyRaw: identity.publicKeyRaw, createdAt: identity.createdAt };
}

/** The pinned peers on the service, as account ids, in a stable order. */
function pinnedAccountIdsOf(region: OwnerPrivateRegion): number[] {
  return region.sharePeers.map((peer) => peer.accountId).toSorted((left, right) => left - right);
}

/** A clinician: an account on the service to grant to, plus the key pair their consent materials publish. */
interface Clinician {
  accountId: number;
  publicKeyBase64: string;
  /** What the patient TYPES after the clinician reads it aloud. */
  fingerprint: string;
}

async function createClinician(label: string): Promise<Clinician> {
  const vault = await createAccount(label);
  const keys = await generateShareKeyPair();
  return {
    accountId: vault.accountId,
    publicKeyBase64: bytesToBase64(keys.publicKeyRaw),
    fingerprint: await shareKeyFingerprint(keys.publicKeyRaw),
  };
}

/** Runs the real ceremony against a clinician, asserting it reached `granted` — every assertion after one depends on that. */
async function grant(clinician: Clinician, label: string): Promise<void> {
  const result = await grantShare({
    granteeAccountId: clinician.accountId,
    publicKeyBase64: clinician.publicKeyBase64,
    label,
    typedFingerprint: clinician.fingerprint,
  });
  assert.equal(result.status, 'granted', 'the fingerprint typed in this test is the offered key’s own');
}

test('a share identity reaches the other devices', async () => {
  const account = await createAccount('identity');

  const generated = await ensureShareIdentity();

  // THE ASSERTION THIS TEST WAS WRITTEN FOR. The key pair lives in the
  // owner-private compartment, which travels inside the blob; with the
  // generation's sync dropped it exists on this device and nowhere else, and
  // the next device to restore this account mints the second pair the
  // function's header warns about.
  const onTheService = (await compartmentOnTheService(account)).shareIdentity;
  assert.ok(onTheService !== null, 'the generated key pair must reach the service inside the compartment');
  assert.equal(
    onTheService.publicKeyRaw,
    generated.publicKeyBase64,
    'the pair on the service must be the one the caller was told about',
  );

  // AND THE PRIVATE HALF, which is the half that makes a restored device able
  // to open a wrap at all. Compared inside `assert.ok` so that a failure
  // prints this message rather than the key.
  const onTheDevice = await getLocalShareIdentity();
  assert.ok(onTheDevice !== null, 'the pair must also be on the device that generated it');
  assert.ok(
    onTheService.privateKeyPkcs8 === onTheDevice.privateKeyPkcs8,
    'the private half must travel too — a public key alone opens no wrap on a restored device',
  );
});

test('ensureShareIdentity never produces a second key pair', async () => {
  const account = await createAccount('idempotent');

  const first = await ensureShareIdentity();
  const afterFirst = (await compartmentOnTheService(account)).shareIdentity;
  assert.ok(
    afterFirst !== null,
    'the first call must have put a pair on the service, or the comparison below is vacuous',
  );

  const second = await ensureShareIdentity();
  assert.equal(
    second.publicKeyBase64,
    first.publicKeyBase64,
    'the second call must answer the pair the first generated',
  );

  // THE FAILURE THIS TEST EXISTS FOR, and it is invisible on the device: a
  // regenerating implementation writes a fresh pair, syncs it, and the
  // compartment the account's other devices read now addresses a key nothing
  // was ever wrapped to. Asserted against the BLOB, because that is where a
  // second pair does its damage.
  const afterSecond = (await compartmentOnTheService(account)).shareIdentity;
  assert.ok(afterSecond !== null, 'the compartment must still carry a pair after a second call');
  assert.deepEqual(
    identityMarkOf(afterSecond),
    identityMarkOf(afterFirst),
    'a second call must leave the pair on the service byte for byte as the first left it',
  );
});

test("a granted peer's pin reaches the other devices", async () => {
  const clinician = await createClinician('grant-clinician');
  const patient = await createAccount('grant-patient');

  await grant(clinician, 'Dr. Meier');

  // The pin is the verification record for a ceremony two people performed in
  // one room. A pin that stays on this device makes the account's other
  // devices report the grant as `unpinned` and demand the ceremony again.
  const region = await compartmentOnTheService(patient);
  assert.deepEqual(
    region.sharePeers.map((peer) => ({
      accountId: peer.accountId,
      publicKeyRaw: peer.publicKeyRaw,
      label: peer.label,
    })),
    [{ accountId: clinician.accountId, publicKeyRaw: clinician.publicKeyBase64, label: 'Dr. Meier' }],
    'the pinned key, its account and its label must reach the service inside the compartment',
  );
});

test('forgetting a peer that reached the service removes it there', async () => {
  const forgotten = await createClinician('forgotten-clinician');
  const kept = await createClinician('kept-clinician');
  const patient = await createAccount('forget-patient');

  await grant(forgotten, 'Dr. Meier');
  await grant(kept, 'Dr. Roth');

  // ESTABLISHED FIRST, AND PROVEN TO HAVE LANDED. Without this the assertion
  // below is an absence checked against a compartment the peer never reached,
  // which passes on a device that never synced anything at all.
  assert.deepEqual(
    pinnedAccountIdsOf(await compartmentOnTheService(patient)),
    [forgotten.accountId, kept.accountId].toSorted((left, right) => left - right),
    'both ceremonies must have reached the service before a forget can be shown to remove one',
  );

  await forgetPinnedPeer(forgotten.accountId);

  // THE DELETION, and the survivor is what makes it one: `kept` can only be
  // here if a compartment was pushed AFTER the forget. With the forget's sync
  // dropped, the service still holds both — and the peer reappears on this
  // device's next pull, after which the next grant to them skips the ceremony
  // it was meant to require.
  assert.deepEqual(
    pinnedAccountIdsOf(await compartmentOnTheService(patient)),
    [kept.accountId],
    'the forget must reach the service — exactly the forgotten peer gone, the other still pinned',
  );
});
