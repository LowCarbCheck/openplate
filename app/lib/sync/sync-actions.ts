/**
 * Every operation the sync UI can trigger, in one place: create an account,
 * sign in, sync, change the passphrase, reset it, delete the account.
 *
 * This is the composition root for the feature. The engine modules underneath
 * are all injectable and individually testable; nothing here is, and nothing
 * here decides anything — it wires. Keeping the wiring in one file is what
 * makes "does the passphrase ever get stored" answerable by reading a single
 * screen of code.
 *
 * ── The rule every function here obeys ────────────────────────────────────
 *
 * A `passphrase` parameter is used, derived from, and dropped. It is never
 * assigned to module state, never put in the vault, never persisted, and never
 * placed in a request body — only its `AUTH` HKDF branch goes out
 * (`derive-credentials.ts`). `tests/unit/sync-auth-client.test.ts` asserts
 * this against every storage surface and every captured request.
 *
 * ── Failures throw ───────────────────────────────────────────────────────
 *
 * No booleans, no `{ ok: false }`. Callers are React event handlers that show
 * an error; a return value they can forget to check is precisely the shape
 * that produces a silent no-op button.
 */
import { SyncAuthClient } from './engine/client/auth-client';
import { SyncHttpClient } from './engine/client/http-client';
import { SyncRequestError } from './engine/client/sync-error';
import { workerArgon2idDeriver } from './engine/client/argon2-worker';
import { deriveCredentialsFromPassphrase } from './engine/client/derive-credentials';
import { setupSyncKeys, type Argon2idDeriver, type SyncKeySetupRecord } from './engine/client/setup-keys';
import { createPassphraseKdfDescriptor, type PassphraseKdfDescriptor } from './engine/client/passphrase-kek';
import {
  derivePrivateStoreRecoveryKek,
  deriveRecoveryKek,
  generateRecoveryCode,
  parseRecoveryCode,
} from './engine/client/recovery-kek';
import { establishPrivateStore } from './engine/crypto/private-store';
import { ARGON2ID_DEFAULT_PARAMS, generateArgon2idSalt, type Argon2idParams } from './engine/crypto/argon2';
import { generateDek, unwrapDek, wrapDek } from './engine/crypto/dek-wrap';
import { bytesToBase64 } from './engine/crypto/base64';
import type { KdfDescriptorWire, KeyRecordSubmissionWire } from './engine/client/auth-wire';
import type { SyncSetupOutcome } from './setup-flow';
import {
  applyMergedSnapshot,
  parseRemoteSnapshot,
  readLocalOwnerPrivateRegion,
  readLocalSnapshot,
} from './local-store-bridge';
import { partitionSnapshot, recomposeSnapshot, type SyncedSnapshot } from './snapshot-partition';
import {
  adoptRewrappedSlots,
  createPrivateStoreSession,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
  type EstablishedPrivateStore,
  type PrivateStoreSession,
} from './private-store';
import { rewrapPrivateStoreOnServer, type BlobTransport } from './private-store-rewrap';
import { runSyncCycle } from './orchestrator';
import { createSyncStateStore, deviceStorage, resolveDeviceId } from './sync-state';
import {
  clearAccountHint,
  closeSyncSession,
  getSyncVault,
  openSyncSession,
  updateSyncSession,
  writeAccountHint,
  type SyncErrorReason,
  type SyncVault,
} from './sync-session';

/** Overridable seams. Production passes none of these; tests pass all of them. */
export interface SyncActionOptions {
  /** Where Argon2id runs. Defaults to the Worker; tests inject tiny in-process parameters. */
  deriveHash?: Argon2idDeriver;
  /** Argon2id cost for NEW accounts and passphrase changes. Existing accounts always use their own recorded parameters. */
  params?: Argon2idParams;
  fetchImpl?: typeof fetch;
}

function clients({ serverUrl, fetchImpl }: { serverUrl: string; fetchImpl?: typeof fetch }) {
  const authClient = new SyncAuthClient({ baseUrl: serverUrl, fetchImpl });
  const http = new SyncHttpClient({ baseUrl: serverUrl, tokens: authClient, fetchImpl });
  return { authClient, http };
}

/**
 * Runs the §6 handshake and REFUSES on any mismatch — including an
 * unreachable service.
 *
 * Called before the first sync of every session, never skipped and never
 * downgraded to a warning. The blob is frequently the only copy of someone's
 * diary; a client that pushes an envelope a differently-versioned service
 * frames another way can destroy it, and "the sync button showed an error" is
 * a far cheaper outcome than discovering that weeks later.
 */
async function requireCompatibleService(authClient: SyncAuthClient): Promise<void> {
  const compatibility = await authClient.handshake();
  if (compatibility.status === 'compatible') return;
  throw new SyncRequestError({ kind: 'invalid', message: compatibility.reason });
}

function toWireDescriptor(descriptor: PassphraseKdfDescriptor): KdfDescriptorWire {
  return { salt: descriptor.salt, params: descriptor.params };
}

// ---------------------------------------------------------------------------
// Create an account (first-time setup)
// ---------------------------------------------------------------------------

/**
 * Creates the account, generates the key hierarchy, and pushes both key
 * records — the whole first-time setup, minus the ceremony around it.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY: the account is created first, because
 * key records need an authenticated session to write. That leaves one
 * recoverable interruption — an account that exists with no key records, if
 * the device dies between the two — which `signInToSync` detects (an empty
 * key-record list) and repairs, rather than presenting an account that can
 * never be unlocked.
 *
 * ── `tokens: null` is an OUTCOME, not a failure ───────────────────────────
 *
 * An instance running with `REQUIRE_EMAIL_VERIFICATION` withholds the session
 * until the address is confirmed (`PROTOCOL.md` §5.8). This used to throw,
 * which deadlocked the feature completely on every such instance: the account
 * was created, so a second attempt answered `409`, and signing in after
 * confirming reached an account with no key records and errored there too. So
 * it returns `awaiting-email-verification` instead, and the SETUP CEREMONY
 * MOVES to the sign-in that follows — see `signInToSync`, which is the one
 * place that can complete it, because writing key records needs the session
 * this response deliberately did not hand out.
 *
 * NOTHING IS KEPT from that branch. The derived KEK, the DEK and the recovery
 * code are all local to this call and are dropped when it returns; no session
 * is opened, nothing is written to the device, and the code the user would
 * eventually save is minted fresh during the repair. Persisting any of it "so
 * setup can carry on later" would put key material on disk for the sake of
 * saving one Argon2id run.
 *
 * On the `ready` branch the returned recovery code is the ONLY time it exists
 * in a readable form. The caller (the ceremony) must show it before resolving.
 */
export async function createSyncAccount({
  serverUrl,
  email,
  passphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: { serverUrl: string; email: string; passphrase: string } & SyncActionOptions): Promise<SyncSetupOutcome> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const recovery = generateRecoveryCode();
  const keys = await setupSyncKeys({ passphrase, recoveryCodeRaw: recovery.raw, params, deriveHash });

  const created = await authClient.signup({
    email,
    authHash: keys.authHash,
    kdfDescriptor: toWireDescriptor(keys.kdfDescriptor),
  });
  if (created.tokens === null) {
    return { status: 'awaiting-email-verification', email: created.account.email };
  }

  // First-time create: `expectedUpdatedAt: null` asserts "no record of this
  // kind exists yet". A conflict here means another device completed setup
  // first, which is a real (if rare) race and not something to overwrite.
  await putFirstKeyRecord(http, {
    kind: 'passphrase',
    kdfDescriptor: keys.passphraseKeyRecord.kdfDescriptor,
    wrappedDek: keys.passphraseKeyRecord.wrappedDek,
  });
  await putFirstKeyRecord(http, {
    kind: 'recovery',
    kdfDescriptor: null,
    wrappedDek: keys.recoveryKeyRecord.wrappedDek,
  });

  openSession({
    authClient,
    http,
    serverUrl,
    accountId: created.account.id,
    email: created.account.email,
    dek: keys.dek,
    privateStoreKek: keys.privateStoreKek,
    privateStore: keys.privateStore,
  });
  return { status: 'ready', recoveryCode: recovery.formatted };
}

/** A setup key record plus the slot it fills — what a first-time `PUT /v1/keys` needs. */
interface FirstKeyRecord extends SyncKeySetupRecord {
  kind: 'passphrase' | 'recovery';
}

async function putFirstKeyRecord(http: SyncHttpClient, record: FirstKeyRecord): Promise<void> {
  const result = await http.putKeyRecord({ ...record, expectedUpdatedAt: null });
  if (result.status === 'conflict') {
    throw new SyncRequestError({
      kind: 'conflict',
      message:
        'This account already has sync keys — sign in with your existing passphrase instead of setting up again.',
    });
  }
}

// ---------------------------------------------------------------------------
// Sign in / unlock
// ---------------------------------------------------------------------------

/**
 * The three ways a sign-in can end, all of them designed.
 *
 * `setup-incomplete` is the account that exists with no key records — signup
 * succeeded and the ceremony never did, either because the device died between
 * the two writes or because this instance requires email verification and
 * therefore refused signup a session at all (see `createSyncAccount`). The
 * session IS open at that point; what is missing is the key hierarchy, and
 * `completeSetup` is the only thing that can write it.
 */
export type SignInToSyncResult =
  | { status: 'connected' }
  /**
   * Hand this straight to the setup ceremony as its `provision`. It re-derives
   * from the passphrase the user just typed, mints a DEK and a recovery code,
   * pushes both key records and opens the vault — so the ceremony's own
   * "I've saved this code" gate is what stands between the code and the rest of
   * the app, exactly as in first-time setup.
   */
  | { status: 'setup-incomplete'; completeSetup: (input: { passphrase: string }) => Promise<SyncSetupOutcome> };

/**
 * Signs in and unlocks the vault: authenticate with the auth branch, then
 * unwrap the DEK with the KEK branch of the SAME Argon2id run.
 *
 * ── Four endings, none of them interchangeable ───────────────────────────
 *
 *  - login rejected (`401`) → wrong email or passphrase. Thrown.
 *  - login refused for an unconfirmed address (`403`) → the credentials are
 *    RIGHT; the address is not confirmed yet. Thrown, and the sign-in UI tells
 *    the user to use the link in their inbox rather than to try harder at a
 *    passphrase that already worked (`classifySignInFailure`).
 *  - logged in, but no key records → setup never finished. Returned as
 *    `setup-incomplete`, NOT thrown: this is repairable, and it is the only
 *    state a verification-required signup can leave behind, so an error here
 *    made the whole feature a dead end on those instances.
 *  - logged in, but the DEK will not unwrap → the passphrase is right for the
 *    ACCOUNT and wrong for the DATA, which happens after a reset completed
 *    without a recovery code. Thrown, with its own wording: saying "wrong
 *    passphrase" sends people to try harder at something that cannot work.
 */
export async function signInToSync({
  serverUrl,
  email,
  passphrase,
  deriveHash = workerArgon2idDeriver,
  fetchImpl,
}: { serverUrl: string; email: string; passphrase: string } & SyncActionOptions): Promise<SignInToSyncResult> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  // Always the account's OWN parameters, never this build's defaults — an
  // account created under raised costs derives differently, and getting it
  // wrong is indistinguishable from a wrong passphrase.
  const wire = await authClient.fetchKdfDescriptor(email);
  const descriptor: PassphraseKdfDescriptor = { salt: wire.salt, params: wire.params };
  const { authHash, passphraseKek, privateStoreKek } = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor,
    deriveHash,
  });

  const session = await authClient.login({ email, authHash });

  const records = await http.listKeyRecords();
  const passphraseRecord = records.find((record) => record.kind === 'passphrase');
  if (passphraseRecord === undefined) {
    return {
      status: 'setup-incomplete',
      completeSetup: async (input) =>
        finishInterruptedSetup({
          authClient,
          http,
          serverUrl,
          account: session.account,
          // Re-derived from the passphrase the ceremony collects rather than
          // captured from this call: the ceremony may be retried, and a stale
          // KEK closed over here would silently write a record that the
          // passphrase the user just typed cannot open.
          passphrase: input.passphrase,
          descriptor,
          deriveHash,
        }),
    };
  }

  let dek: Uint8Array;
  try {
    dek = await unwrapDek({ wrappedDek: passphraseRecord.wrappedDek, kek: passphraseKek });
  } catch {
    throw new SyncRequestError({
      kind: 'invalid',
      message:
        'That passphrase signs you in, but it cannot open this account’s data — it was replaced by a reset. Use your recovery code to restore access.',
    });
  }

  openSession({
    authClient,
    http,
    serverUrl,
    accountId: session.account.id,
    email: session.account.email,
    dek,
    privateStoreKek,
  });
  return { status: 'connected' };
}

/**
 * Writes the key hierarchy for an account that has none, using the session
 * that is already open.
 *
 * THE DESCRIPTOR IS THE ACCOUNT'S, not a fresh one. `signInToSync` unwraps the
 * passphrase record with a KEK derived from the descriptor the `/kdf` endpoint
 * serves for the account, and ignores the one stored on the record itself — so
 * a record wrapped under a freshly-salted descriptor would be unopenable by the
 * very next sign-in. Reusing the account's descriptor also avoids rotating a
 * credential (the verifier is bound to it) during what is meant to be a repair.
 *
 * `expectedUpdatedAt: null` on both writes, via `putFirstKeyRecord`: this is
 * still a first-time create, and a conflict means another device finished
 * setup first — which must not be overwritten, because that device has already
 * shown its user a recovery code for a different DEK.
 */
async function finishInterruptedSetup({
  authClient,
  http,
  serverUrl,
  account,
  passphrase,
  descriptor,
  deriveHash,
}: {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  serverUrl: string;
  account: { id: number; email: string };
  passphrase: string;
  descriptor: PassphraseKdfDescriptor;
  deriveHash: Argon2idDeriver;
}): Promise<SyncSetupOutcome> {
  const { passphraseKek, privateStoreKek } = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor,
    deriveHash,
  });
  const recovery = generateRecoveryCode();
  const dek = generateDek();
  // Both compartment doors exist in this frame and nowhere else — the recovery
  // code is shown once and never retained — so the compartment is established
  // here or not at all. See `engine/crypto/private-store.ts`.
  const privateStore = await establishPrivateStore({
    passphraseKek: privateStoreKek,
    recoveryKek: await derivePrivateStoreRecoveryKek(recovery.raw),
  });

  await putFirstKeyRecord(http, {
    kind: 'passphrase',
    kdfDescriptor: descriptor,
    wrappedDek: await wrapDek({ dek, kek: passphraseKek }),
  });
  await putFirstKeyRecord(http, {
    kind: 'recovery',
    kdfDescriptor: null,
    wrappedDek: await wrapDek({ dek, kek: await deriveRecoveryKek(recovery.raw) }),
  });

  openSession({
    authClient,
    http,
    serverUrl,
    accountId: account.id,
    email: account.email,
    dek,
    privateStoreKek,
    privateStore,
  });
  return { status: 'ready', recoveryCode: recovery.formatted };
}

function openSession(input: {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  serverUrl: string;
  accountId: number;
  email: string;
  dek: Uint8Array;
  /** `K_pp` for the passphrase that just unlocked this session — the compartment's door. */
  privateStoreKek: CryptoKey;
  /** Present only when this call ESTABLISHED the compartment (setup); a sign-in adopts one on its first pull instead. */
  privateStore?: EstablishedPrivateStore | null;
}): void {
  const storage = deviceStorage();
  const state = createSyncStateStore({ storage, accountId: input.accountId });
  const vault: SyncVault = {
    authClient: input.authClient,
    http: input.http,
    dek: input.dek,
    privateStore: createPrivateStoreSession({
      accountId: input.accountId,
      passphraseKek: input.privateStoreKek,
      established: input.privateStore ?? null,
    }),
    accountId: input.accountId,
    email: input.email,
    deviceId: resolveDeviceId(storage),
    state,
    serverUrl: input.serverUrl,
  };
  writeAccountHint(input.email, storage);
  openSyncSession(vault, { lastSyncedAt: state.load().lastSyncedAt });
}

// ---------------------------------------------------------------------------
// Syncing
// ---------------------------------------------------------------------------

/**
 * Runs one sync cycle and reflects the outcome in the session snapshot.
 *
 * A NO-OP WITHOUT A SESSION, on purpose: this is called on boot, on `online`,
 * and after a debounce, and none of those callers should have to know whether
 * sync is configured or unlocked. Throwing there would turn "the user hasn't
 * set up sync" into an error report on every page load.
 */
export async function syncNow(): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) return;

  updateSyncSession({ phase: 'syncing', error: null });
  try {
    const result = await runSyncCycle({
      accountId: vault.accountId,
      dek: vault.dek,
      http: vault.http,
      state: vault.state,
      deviceId: vault.deviceId,
      readSnapshot: () => readSyncedSnapshot(vault.privateStore),
      applySnapshot: (input) => applySyncedSnapshot({ session: vault.privateStore, ...input }),
      parseRemoteSnapshot,
    });
    updateSyncSession({
      phase: 'idle',
      lastSyncedAt: result.lastSyncedAt,
      hasPendingChanges: false,
      error: null,
    });
  } catch (error) {
    updateSyncSession({ phase: 'idle', error: describeSyncFailure(error) });
    throw error;
  }
}

/**
 * The device snapshot AS SYNCED: the shareable region, plus the owner-private
 * region SEALED into one opaque compartment (`snapshot-partition.ts`).
 *
 * This is the single point where the partition is applied to an outgoing
 * payload. Nothing above it can push a snapshot that skipped it, because the
 * orchestrator's `readSnapshot` is typed as `SyncedSnapshot` and only this
 * function produces one from the device.
 */
async function readSyncedSnapshot(session: PrivateStoreSession): Promise<SyncedSnapshot> {
  const { shareable, ownerPrivate } = partitionSnapshot(await readLocalSnapshot());
  return { ...shareable, privateStore: await sealOwnerPrivateRegion({ session, region: ownerPrivate }) };
}

/**
 * Writes a merged payload onto the device, opening the compartment on the way.
 *
 * A compartment that will not open falls back to what the device already
 * holds. That is the safe direction: the states it covers are all "we learned
 * nothing", and none of them justifies blanking a working share key pair to
 * represent a decryption failure.
 */
async function applySyncedSnapshot({
  session,
  merged,
  local,
}: {
  session: PrivateStoreSession;
  merged: SyncedSnapshot;
  local: SyncedSnapshot;
}): Promise<void> {
  const ownerPrivate =
    (await openOwnerPrivateRegion({ session, sealed: merged.privateStore })) ?? (await readLocalOwnerPrivateRegion());
  await applyMergedSnapshot({ merged: recomposeSnapshot({ shareable: merged, ownerPrivate }), local });
}

/** Why sync stopped, with the message the status surface shows — `SyncSessionSnapshot['error']`. */
export interface SyncFailure {
  reason: SyncErrorReason;
  message: string;
}

/**
 * Classifies a failure for the status surface.
 *
 * `reauth-required` is the one that must not be swallowed: the session
 * expired, the refresh could not renew it, and the ONLY correct response is a
 * visible prompt. Silently retrying there produces a device that has looked
 * "synced" for a week and has not sent a byte.
 */
export function describeSyncFailure(cause: unknown): SyncFailure {
  if (cause instanceof SyncRequestError) {
    if (cause.kind === 'unauthorized') return { reason: 'reauth-required', message: cause.message };
    if (cause.kind === 'transport') return { reason: 'offline', message: cause.message };
    if (cause.kind === 'invalid') return { reason: 'incompatible', message: cause.message };
    return { reason: 'failed', message: cause.message };
  }
  return { reason: 'failed', message: cause instanceof Error ? cause.message : 'Sync failed.' };
}

/** Marks that this device has changes the server hasn't seen — the "waiting to sync" dot. */
export function markSyncPending(): void {
  if (getSyncVault() === null) return;
  updateSyncSession({ hasPendingChanges: true });
}

// ---------------------------------------------------------------------------
// Session end
// ---------------------------------------------------------------------------

/**
 * Signs out: revokes THIS device's token family server-side and drops the
 * local session.
 *
 * The device's synced data stays on the device — signing out of sync is not a
 * wipe, and treating it as one would make it a terrifying button to press.
 * The baseline is kept too, so signing back in does not re-upload everything.
 */
export async function signOutOfSync(): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) return;
  await vault.authClient.logout();
  clearAccountHint();
  closeSyncSession();
}

// ---------------------------------------------------------------------------
// Passphrase change
// ---------------------------------------------------------------------------

/**
 * Rotates the passphrase: re-derives both branches under a FRESH salt,
 * re-wraps the DEK under the new KEK, and submits everything as one atomic
 * change.
 *
 * The DEK itself is unchanged, so the account's existing blob stays readable
 * and the `recovery` key record — which wraps that same DEK — stays valid and
 * is deliberately not touched. Re-keying the data instead would mean
 * re-encrypting and re-pushing the user's entire history to change a
 * passphrase.
 */
export async function changeSyncPassphrase({
  currentPassphrase,
  newPassphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
}: { currentPassphrase: string; newPassphrase: string } & SyncActionOptions): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) throw new Error('changeSyncPassphrase called without an open sync session');

  const currentWire = await vault.authClient.fetchKdfDescriptor(vault.email);
  const current = await deriveCredentialsFromPassphrase({
    passphrase: currentPassphrase,
    descriptor: { salt: currentWire.salt, params: currentWire.params },
    deriveHash,
  });

  const nextDescriptor = createPassphraseKdfDescriptor(generateArgon2idSalt(), params);
  const next = await deriveCredentialsFromPassphrase({
    passphrase: newPassphrase,
    descriptor: nextDescriptor,
    deriveHash,
  });

  const rewrapped = await wrapDek({ dek: vault.dek, kek: next.passphraseKek });
  const keyRecords: KeyRecordSubmissionWire[] = [
    { kind: 'passphrase', kdfDescriptor: nextDescriptor, wrappedDek: bytesToBase64(rewrapped) },
  ];

  await vault.authClient.changePassphrase({
    currentAuthHash: current.authHash,
    newAuthHash: next.authHash,
    kdfDescriptor: toWireDescriptor(nextDescriptor),
    keyRecords,
  });

  // THE COMPARTMENT'S SLOT 1 MOVES IN THE SAME CLIENT MOMENT (ADR-0002's
  // partition amendment). It cannot ride in the request above — it lives
  // inside the blob, not in a key record — so it is a second write, and the
  // ORDER is chosen so that the device which can repair a half-done change is
  // the device that caused it: this session still holds the CDK, so its next
  // cycle re-emits the new wrap even if this call fails. The old passphrase
  // is gone by now, which is why the rewrap opens slot 1 with the CURRENT key
  // BEFORE the session adopts the new one.
  await rewrapCompartmentForNewPassphrase({ vault, current: current.privateStoreKek, next: next.privateStoreKek });
}

/**
 * Moves the compartment onto a new `K_pp`.
 *
 * `unopenable` is not thrown for a reason: it means this account has a
 * compartment slot 1 no longer matches — a passphrase change that landed on
 * another device first — and the passphrase change itself has already
 * succeeded. Failing here would report a change that DID happen as an error
 * and invite the user to repeat it. The compartment stays openable by the
 * recovery code and by the device that wrote it.
 */
async function rewrapCompartmentForNewPassphrase({
  vault,
  current,
  next,
}: {
  vault: SyncVault;
  current: CryptoKey;
  next: CryptoKey;
}): Promise<void> {
  const result = await rewrapPrivateStoreOnServer({
    http: vault.http,
    accountId: vault.accountId,
    dek: vault.dek,
    deviceId: vault.deviceId,
    currentKek: current,
    currentSlot: 'passphrase',
    nextPassphraseKek: next,
    nextRecoveryKek: null,
  });
  vault.privateStore.passphraseKek = next;
  if (result.status !== 'rewrapped') return;
  adoptRewrappedSlots({ session: vault.privateStore, cdk: result.cdk, sealed: result.sealed });
}

// ---------------------------------------------------------------------------
// Recovery code
// ---------------------------------------------------------------------------

/**
 * Mints a NEW recovery code and rotates the account's `recovery` key record
 * onto it. Returns the code — which, like the one from setup, is displayed
 * exactly once and cannot be retrieved afterwards.
 *
 * ── Why this has to exist ────────────────────────────────────────────────
 *
 * Two ordinary situations leave an account with a recovery record whose code
 * nobody knows, and until this existed there was no way out of either:
 *
 *  1. **The tab dies during the setup ceremony.** The account and both key
 *     records are already written by then; only the display is lost. The user
 *     can still sign in with their passphrase and their data is completely
 *     intact — so this is NOT data loss. What is lost is the BACKUP: the
 *     recovery record on file is opened by a code that no longer exists
 *     anywhere. The degradation is silent, which is the dangerous part.
 *  2. **The user loses the paper.** Far more common, same end state.
 *
 * Change-passphrase does NOT cover either case, despite the intuition that it
 * should: it deliberately leaves the `recovery` record untouched, because that
 * record wraps the same unchanged DEK and stays valid across a passphrase
 * rotation (see `changeSyncPassphrase`). Rotating the recovery record is a
 * genuinely separate operation, and this is it.
 *
 * It needs no re-authentication because it grants no new access: the caller
 * already holds the DEK, and the only thing being replaced is one of the two
 * doors to it. The old code stops working the moment this succeeds.
 */
export async function regenerateRecoveryCode(): Promise<{ recoveryCode: string }> {
  const vault = getSyncVault();
  if (vault === null) throw new Error('regenerateRecoveryCode called without an open sync session');

  // Read first for the CAS token: another device may have rotated this record,
  // and blind-overwriting it would invalidate a code that device just showed
  // its user.
  const records = await vault.http.listKeyRecords();
  const existing = records.find((record) => record.kind === 'recovery');

  const recovery = generateRecoveryCode();
  const result = await vault.http.putKeyRecord({
    kind: 'recovery',
    // Always null for this kind — the recovery path is HKDF-only and has no
    // parameters to record; the service rejects a descriptor here.
    kdfDescriptor: null,
    wrappedDek: await wrapDek({ dek: vault.dek, kek: await deriveRecoveryKek(recovery.raw) }),
    expectedUpdatedAt: existing?.updatedAt ?? null,
  });
  if (result.status === 'conflict') {
    throw new SyncRequestError({
      kind: 'conflict',
      message: 'Another device changed this account’s recovery key just now. Try again to get a fresh code.',
    });
  }

  // THE COMPARTMENT'S SLOT 2 MOVES WITH IT (ADR-0002's partition amendment).
  // Forgetting this would leave the OLD code — the one the user is about to
  // discard — as the only thing that opens their share keys, and the failure
  // would surface months later on a recovery restore that recovered the diary
  // and lost every patient's access.
  await rotateCompartmentRecoverySlot({ vault, recoveryKek: await derivePrivateStoreRecoveryKek(recovery.raw) });

  return { recoveryCode: recovery.formatted };
}

/**
 * Moves the compartment onto a new `K_pr`, or CREATES one when the account has
 * none.
 *
 * The create branch is the upgrade path for an account whose compartment
 * predates the partition: a compartment needs both doors at once, this is the
 * only routine operation where a recovery code exists in the clear, and the
 * session supplies the other door. Nothing is pushed here — clearing the seal
 * cache is enough, because the next sync cycle seals and pushes it.
 */
async function rotateCompartmentRecoverySlot({
  vault,
  recoveryKek,
}: {
  vault: SyncVault;
  recoveryKek: CryptoKey;
}): Promise<void> {
  const result = await rewrapPrivateStoreOnServer({
    http: vault.http,
    accountId: vault.accountId,
    dek: vault.dek,
    deviceId: vault.deviceId,
    currentKek: vault.privateStore.passphraseKek,
    currentSlot: 'passphrase',
    nextPassphraseKek: null,
    nextRecoveryKek: recoveryKek,
  });
  if (result.status === 'rewrapped') {
    adoptRewrappedSlots({ session: vault.privateStore, cdk: result.cdk, sealed: result.sealed });
    return;
  }
  if (result.status === 'unopenable') return;

  const established = await establishPrivateStore({ passphraseKek: vault.privateStore.passphraseKek, recoveryKek });
  vault.privateStore.cdk = established.cdk;
  vault.privateStore.wraps = {
    cdkWrapPassphrase: established.cdkWrapPassphrase,
    cdkWrapRecovery: established.cdkWrapRecovery,
  };
  vault.privateStore.cache = null;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/** Asks the service to email a reset link. Always succeeds from the client's point of view — the response reveals nothing. */
export async function requestSyncReset({
  serverUrl,
  email,
  fetchImpl,
}: { serverUrl: string; email: string } & SyncActionOptions): Promise<void> {
  const { authClient } = clients({ serverUrl, fetchImpl });
  await authClient.requestReset(email);
}

/**
 * Completes a reset.
 *
 * THE FORK, in code. `recoveryCode` is the whole difference between the two
 * outcomes, and the type says so — a required parameter that may be `null`,
 * never an omittable option, so no caller reaches this function without having
 * decided.
 *
 * ── Why the two branches take different shapes ────────────────────────────
 *
 * Key records are behind bearer auth (`PROTOCOL.md` §5), and a person who has
 * forgotten their passphrase has no session — so the recovery-code branch
 * CANNOT read the wrapped DEK before resetting. It is therefore two phases,
 * and both use documented endpoints only:
 *
 *  1. `POST /v1/auth/reset` with `keyRecords: []`. §5.14: "kinds not submitted
 *     are left untouched" — so this restores LOGIN and touches no key
 *     material at all. Nothing is destroyed, and the response carries a
 *     session.
 *  2. With that session: read the `recovery` record, unwrap the DEK with the
 *     code, and CAS-rotate the `passphrase` record to wrap that same DEK under
 *     the new passphrase's KEK.
 *
 * If the device dies between the two, the account is in a recoverable state,
 * not a broken one: the new passphrase signs in, and `signInToSync` detects
 * the un-rotated record and says so in those words rather than "wrong
 * passphrase".
 *
 * The no-code branch is a single ATOMIC submission instead — a brand-new DEK
 * and a brand-new recovery code, applied together with the new verifier. Every
 * blob written under the old DEK becomes permanently undecryptable, by
 * everyone, forever. `app/lib/sync/reset-flow.ts` is the gate that makes a
 * user choose that knowingly.
 */
export async function completeSyncReset({
  serverUrl,
  token,
  newPassphrase,
  recoveryCode,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  /** The single-use token from the emailed link. The email address itself is never needed — the token identifies the account. */
  token: string;
  newPassphrase: string;
  /** `null` is the explicit "I do not have it, and I accept losing the data" branch. */
  recoveryCode: string | null;
} & SyncActionOptions): Promise<{ dataPreserved: boolean; recoveryCode: string | null }> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const descriptor = createPassphraseKdfDescriptor(generateArgon2idSalt(), params);
  const credentials = await deriveCredentialsFromPassphrase({ passphrase: newPassphrase, descriptor, deriveHash });

  const rawRecoveryCode = recoveryCode === null ? null : parseRecoveryCode(recoveryCode);
  if (recoveryCode !== null && rawRecoveryCode === null) {
    throw new SyncRequestError({ kind: 'invalid', message: 'That recovery code is not in the right format.' });
  }

  if (rawRecoveryCode === null) {
    const freshRecovery = generateRecoveryCode();
    const dek = generateDek();
    await authClient.resetCredential({
      token,
      authHash: credentials.authHash,
      kdfDescriptor: toWireDescriptor(descriptor),
      keyRecords: [
        {
          kind: 'passphrase',
          kdfDescriptor: descriptor,
          wrappedDek: bytesToBase64(await wrapDek({ dek, kek: credentials.passphraseKek })),
        },
        // The old recovery record wraps a DEK nobody can produce any more;
        // leaving it would leave a "recovery" path that recovers nothing.
        {
          kind: 'recovery',
          kdfDescriptor: null,
          wrappedDek: bytesToBase64(await wrapDek({ dek, kek: await deriveRecoveryKek(freshRecovery.raw) })),
        },
      ],
    });
    return { dataPreserved: false, recoveryCode: freshRecovery.formatted };
  }

  // Phase 1: restore login only. `keyRecords: []` is submitted EXPLICITLY —
  // §5.14 requires the key to be present even when empty, so that silence is
  // never read as consent on a path that can strand data.
  const tokens = await authClient.resetCredential({
    token,
    authHash: credentials.authHash,
    kdfDescriptor: toWireDescriptor(descriptor),
    keyRecords: [],
  });
  const adopted = await authClient.adoptTokens(tokens);

  // Phase 2: reopen the DEK with the recovery code and rotate the passphrase
  // record onto the new KEK.
  const records = await http.listKeyRecords();
  const recoveryRecord = records.find((record) => record.kind === 'recovery');
  if (recoveryRecord === undefined) {
    throw new SyncRequestError({ kind: 'not-found', message: 'This account has no recovery key on file.' });
  }
  let dek: Uint8Array;
  try {
    dek = await unwrapDek({ wrappedDek: recoveryRecord.wrappedDek, kek: await deriveRecoveryKek(rawRecoveryCode) });
  } catch {
    throw new SyncRequestError({ kind: 'invalid', message: 'That recovery code does not open this account.' });
  }

  const existingPassphraseRecord = records.find((record) => record.kind === 'passphrase');
  const rotated = await http.putKeyRecord({
    kind: 'passphrase',
    kdfDescriptor: descriptor,
    wrappedDek: await wrapDek({ dek, kek: credentials.passphraseKek }),
    expectedUpdatedAt: existingPassphraseRecord?.updatedAt ?? null,
  });
  if (rotated.status === 'conflict') {
    throw new SyncRequestError({
      kind: 'conflict',
      message: 'Another device changed this account’s keys while the reset was in progress. Start the reset again.',
    });
  }

  // Phase 3: the compartment. It opens by `K_pr` here — the recovery code is
  // the only door this person has — and BOTH slots are rewritten, because the
  // passphrase behind slot 1 no longer exists. This must happen while the code
  // is still in this call frame: a compartment whose slot 1 belongs to a
  // forgotten passphrase and whose slot 2 belongs to a spent code is
  // unopenable by anyone, forever.
  const compartmentRecoveryKek = await derivePrivateStoreRecoveryKek(rawRecoveryCode);
  await rewrapCompartmentAfterReset({
    http,
    accountId: adopted.account.id,
    dek,
    recoveryKek: compartmentRecoveryKek,
    passphraseKek: credentials.privateStoreKek,
  });

  return { dataPreserved: true, recoveryCode: null };
}

/**
 * The reset's compartment step, with the ONE thing it must not do: report a
 * completed reset as a failure.
 *
 * By the time this runs, login is restored and the passphrase key record is
 * rotated — the reset SUCCEEDED. So a failure here is re-thrown with wording
 * that says exactly that, rather than the generic conflict message that would
 * invite the user to start a reset whose token is already spent.
 *
 * Slot 2 is rewrapped under the SAME `K_pr` it already had. That is not a
 * no-op: it is what makes both slots products of one operation, so a future
 * reader never has to reason about a compartment whose halves were written at
 * different times under different assumptions.
 */
async function rewrapCompartmentAfterReset({
  http,
  accountId,
  dek,
  recoveryKek,
  passphraseKek,
}: {
  http: BlobTransport;
  accountId: number;
  dek: Uint8Array;
  recoveryKek: CryptoKey;
  passphraseKek: CryptoKey;
}): Promise<void> {
  try {
    await rewrapPrivateStoreOnServer({
      http,
      accountId,
      dek,
      deviceId: resolveDeviceId(deviceStorage()),
      currentKek: recoveryKek,
      currentSlot: 'recovery',
      nextPassphraseKek: passphraseKek,
      nextRecoveryKek: recoveryKek,
    });
  } catch {
    // The cause is deliberately dropped rather than chained: every failure
    // reaching here is already a `SyncRequestError` whose own message would
    // read as "the reset failed", which is the one thing that is not true.
    throw new SyncRequestError({
      kind: 'conflict',
      message:
        'Your passphrase was reset and your diary is intact, but this device could not move your clinician share keys onto the new passphrase. Sign in and try sharing again.',
    });
  }
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Deletes the sync account and everything the service holds for it — no soft
 * delete, no grace period.
 *
 * Re-authentication is required by the protocol even though a valid token is
 * already held, so a session left open on a shared device cannot destroy
 * someone's account. The DEVICE keeps its diary: this removes the copy in the
 * cloud, not the one in front of the user.
 */
export async function deleteSyncAccount({
  passphrase,
  deriveHash = workerArgon2idDeriver,
}: { passphrase: string } & SyncActionOptions): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) throw new Error('deleteSyncAccount called without an open sync session');

  const wire = await vault.authClient.fetchKdfDescriptor(vault.email);
  const { authHash } = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor: { salt: wire.salt, params: wire.params },
    deriveHash,
  });

  await vault.authClient.deleteAccount({ authHash });
  vault.state.clear();
  clearAccountHint();
  closeSyncSession();
}
