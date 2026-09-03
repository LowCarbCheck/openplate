/**
 * Every operation the sync UI can trigger, in one place: create an account,
 * sign in, sync, change the passphrase, recover it with the recovery code,
 * delete the account.
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
  deriveRecoveryAuthHash,
  deriveRecoveryKek,
  generateRecoveryCode,
  parseRecoveryCode,
} from './engine/client/recovery-kek';
import { establishPrivateStore } from './engine/crypto/private-store';
import { ARGON2ID_DEFAULT_PARAMS, generateArgon2idSalt, type Argon2idParams } from './engine/crypto/argon2';
import { generateDek, unwrapDek, wrapDek } from './engine/crypto/dek-wrap';
import { bytesToBase64 } from './engine/crypto/base64';
import type { KdfDescriptorWire, KeyRecordSubmissionWire } from './engine/client/auth-wire';
import type { OperatorNotice, SignupMode } from './engine/protocol';
import type { SyncSetupOutcome } from './setup-flow';
import {
  applyMergedSnapshot,
  parseRemoteSnapshot,
  readLocalOwnerPrivateRegion,
  readLocalSnapshot,
} from './local-store-bridge';
import { partitionSnapshot, recomposeSnapshot, type SyncedSnapshot } from './snapshot-partition';
import {
  adoptEstablishedCompartment,
  adoptRewrappedSlots,
  assertOwnerPrivateCompartment,
  createPrivateStoreSession,
  hasUnopenedCompartment,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
  type EstablishedPrivateStore,
  type PrivateStoreSession,
} from './private-store';
import { rewrapPrivateStoreOnServer } from './private-store-rewrap';
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
 * ── THE RECOVERY CODE IS REGISTERED HERE OR NEVER (M181) ─────────────────
 *
 * `recoveryAuthHash` rides on the signup request, and the service has no other
 * endpoint that can set it. That is why the code is generated BEFORE the
 * account: the second authenticator and the account are one write, so an
 * account cannot exist in a state where its recovery code opens the data but
 * cannot log in.
 *
 * The returned recovery code is the ONLY time it exists in a readable form,
 * and the handle is returned with it: the caller (the ceremony) shows both on
 * one account card, because a user who saves the code and never registers that
 * the handle is equally required cannot get back in either.
 */
/**
 * Asks an instance how it treats new accounts (PROTOCOL.md §5.6).
 *
 * FAILS OPEN — `null` for an unreachable service, a malformed handshake, or a
 * service older than the field — because the answer only decides which sign-up
 * form to draw. The `403` from signup is the contract, and it is still handled
 * whatever this returns. Contrast `requireCompatibleService` above, which fails
 * CLOSED for the opposite reason: a wrong sync can destroy the only copy of a
 * diary, so doubt there must stop the operation.
 */
export async function readSignupMode(serverUrl: string, options: SyncActionOptions = {}): Promise<SignupMode | null> {
  const { authClient } = clients({ serverUrl, fetchImpl: options.fetchImpl });
  return await authClient.signupMode();
}

/**
 * Asks an instance whether its operator has a message for its users
 * (PROTOCOL.md §5.6).
 *
 * FAILS OPEN, like `readSignupMode` — `null` means "no banner", and an
 * unreachable service, a malformed body or one older than the field are all
 * the same answer. This is a PULL channel: the service holds no addresses and
 * cannot contact anyone, so this reaches only the people who open the app.
 *
 * The result is server-supplied and hostile. `SyncNoticeBanner` renders it as
 * text and refuses any link whose scheme it does not allow.
 */
export async function readServerNotice(
  serverUrl: string,
  options: SyncActionOptions = {},
): Promise<OperatorNotice | null> {
  const { authClient } = clients({ serverUrl, fetchImpl: options.fetchImpl });
  return await authClient.notice();
}

export async function createSyncAccount({
  serverUrl,
  handle,
  passphrase,
  inviteToken,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  handle: string;
  passphrase: string;
  /** Required by an invite-only instance (PROTOCOL.md §5.8.1); ignored by an open one. */
  inviteToken?: string;
} & SyncActionOptions): Promise<SyncSetupOutcome> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const recovery = generateRecoveryCode();
  const keys = await setupSyncKeys({ passphrase, recoveryCodeRaw: recovery.raw, params, deriveHash });

  // NOTE ON ORDER: the invite is checked by the service, so a bad one is only
  // discovered after the Argon2id derivation above has already run. That costs
  // an invited person nothing (their token is good) and costs an uninvited one
  // a few seconds, which is the right way round. Checking it earlier would mean
  // a second round trip on the happy path, and would still not be binding.
  const created = await authClient.signup({
    handle,
    authHash: keys.authHash,
    kdfDescriptor: toWireDescriptor(keys.kdfDescriptor),
    // The SECOND authenticator, derived under the `RECOVERY_AUTH` label — a
    // sibling of the recovery KEK and never the KEK itself, which would hand
    // the operator material from the same HKDF output as the key that opens
    // the diary (`recovery-kek.ts`).
    recoveryAuthHash: await deriveRecoveryAuthHash(recovery.raw),
    inviteToken,
  });

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
    handle: created.account.handle,
    dek: keys.dek,
    privateStoreKek: keys.privateStoreKek,
    privateStore: keys.privateStore,
  });
  return { status: 'ready', handle: created.account.handle, recoveryCode: recovery.formatted };
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
 * succeeded and the ceremony never did, because the device died between the
 * two writes (see `createSyncAccount`). The session IS open at that point;
 * what is missing is the key hierarchy, and `completeSetup` is the only thing
 * that can write it.
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
 * ── Three endings, none of them interchangeable ──────────────────────────
 *
 *  - login rejected (`401`) → wrong handle or passphrase. One message for
 *    both, by protocol design (`classifySignInFailure`).
 *  - logged in, but no key records → setup never finished. Returned as
 *    `setup-incomplete`, NOT thrown: this is repairable, and an error here
 *    would leave the account permanently unusable.
 *  - logged in, but the DEK will not unwrap → the passphrase is right for the
 *    ACCOUNT and wrong for the DATA, which happens when another device
 *    recovered the account onto a different passphrase. Thrown, with its own
 *    wording: saying "wrong passphrase" sends people to try harder at
 *    something that cannot work.
 */
export async function signInToSync({
  serverUrl,
  handle,
  passphrase,
  deriveHash = workerArgon2idDeriver,
  fetchImpl,
}: { serverUrl: string; handle: string; passphrase: string } & SyncActionOptions): Promise<SignInToSyncResult> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  // Always the account's OWN parameters, never this build's defaults — an
  // account created under raised costs derives differently, and getting it
  // wrong is indistinguishable from a wrong passphrase.
  const wire = await authClient.fetchKdfDescriptor(handle);
  const descriptor: PassphraseKdfDescriptor = { salt: wire.salt, params: wire.params };
  const { authHash, passphraseKek, privateStoreKek } = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor,
    deriveHash,
  });

  const session = await authClient.login({ handle, authHash });

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
        'That passphrase signs you in, but it cannot open this account’s data — another device set a new one. Use the passphrase that device chose, or your recovery code.',
    });
  }

  openSession({
    authClient,
    http,
    serverUrl,
    accountId: session.account.id,
    handle: session.account.handle,
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
  account: { id: number; handle: string };
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
    handle: account.handle,
    dek,
    privateStoreKek,
    privateStore,
  });
  return { status: 'ready', handle: account.handle, recoveryCode: recovery.formatted };
}

/** Publishes the vault and returns it, so a caller that must keep working on the session it just opened does not have to fetch it back. */
function openSession(input: {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  serverUrl: string;
  accountId: number;
  handle: string;
  dek: Uint8Array;
  /** `K_pp` for the passphrase that just unlocked this session — the compartment's door. */
  privateStoreKek: CryptoKey;
  /** Present only when this call ESTABLISHED the compartment (setup); a sign-in adopts one on its first pull instead. */
  privateStore?: EstablishedPrivateStore | null;
}): SyncVault {
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
    handle: input.handle,
    deviceId: resolveDeviceId(storage),
    state,
    serverUrl: input.serverUrl,
  };
  writeAccountHint(input.handle, storage);
  openSyncSession(vault, { lastSyncedAt: state.load().lastSyncedAt });
  return vault;
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
      // The refusal that has to precede the push. `applySyncedSnapshot` below
      // opens the same compartment and throws the same error, and until M164/06
      // that was the ONLY place it happened — one line after `pushBlob`.
      assertPulledSnapshot: ({ pulled }) =>
        assertOwnerPrivateCompartment({ session: vault.privateStore, sealed: pulled.privateStore }),
      parseRemoteSnapshot,
    });
    updateSyncSession({
      phase: 'idle',
      lastSyncedAt: result.lastSyncedAt,
      hasPendingChanges: false,
      // NOT ALWAYS `null` ON A CYCLE THAT COMPLETED. A session carrying a
      // compartment it could not open has just re-emitted those bytes
      // unchanged (M164/01), which means this device's own key material was
      // silently NOT published — a share identity generated here exists
      // nowhere else. The diary itself synced fine, so this is amber rather
      // than a failure, but reporting it as a clean sync is how a device looks
      // healthy for a week with its share identity stranded.
      error: unopenedCompartmentFailure(vault.privateStore),
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

/**
 * The one failure a COMPLETED cycle can still carry: a compartment this
 * session never opened.
 *
 * ── THREE STATES REACH THIS, NOT ONE (M164/07) ──────────────────────────
 *
 * M164/02 narrowed it by one — "opened, and belongs to a study console" now
 * throws at the open and arrives through `describeSyncFailure` like any other
 * error. The comment that stood here claimed the narrowing went further than
 * that, and the message was written to match: it named a different passphrase
 * as the cause, and sent the reader to a recovery code.
 *
 * `tryOpen` (`private-store.ts`) still answers `null` for three different
 * things, and only the first is about a passphrase:
 *
 *  1. slot 1 belongs to a passphrase this session does not hold — the
 *     ordinary post-passphrase-change state, and the one the recovery code
 *     fixes;
 *  2. slot 1 unwrapped and the GCM tag failed — corrupt or truncated
 *     ciphertext, where a recovery code changes nothing;
 *  3. the plaintext decrypted and the region schema rejected it — a malformed
 *     compartment, which ADR-0009 deliberately does NOT refuse, where a
 *     recovery code changes nothing either.
 *
 * A tag check does not say which, and neither can this. So the message states
 * what is certainly true — the diary synced, and this device's own key
 * material did not — names the likely cause as likely, and offers the remedy
 * for it without promising it.
 *
 * ── AND A FOURTH, WHICH HAS THE KEY (M164/08) ───────────────────────────
 *
 * `adoptRewrappedSlots` leaves a session holding a CDK it has never read with,
 * and the seal re-emits there too. The consequence is identical — this
 * device's own owner-private changes are not published — so it belongs in the
 * same report rather than in a second vocabulary, and
 * {@link hasUnopenedCompartment} now answers for both. The sentence below
 * stays true of it: this device did not open the compartment, and what it
 * keeps there was not published. It normally clears on the next cycle, which
 * is why it is amber here and not a thrown error.
 */
function unopenedCompartmentFailure(session: PrivateStoreSession): SyncFailure | null {
  if (!hasUnopenedCompartment(session)) return null;
  return {
    reason: 'failed',
    message:
      'Your diary is in sync, but this device could not open the account\u2019s private data, so anything it keeps there \u2014 a sharing key, a pinned clinician \u2014 has not been published. Most often the passphrase was changed on another device: sign in with the current one, or use your recovery code.',
  };
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
 * The remembered sign-in name stays too (M183 spec 04): it is not a
 * credential, and keeping it is what turns the next visit into a sign-in
 * instead of a sign-up. "Not you?" is the explicit, visible way to clear it —
 * a side effect of the sign-out button is not.
 */
export async function signOutOfSync(): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) return;
  await vault.authClient.logout();
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

  const currentWire = await vault.authClient.fetchKdfDescriptor(vault.handle);
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
// Recovery
// ---------------------------------------------------------------------------

/**
 * WHAT USED TO BE HERE (M181).
 *
 * `requestSyncReset` and `completeSyncReset` asked the service to mail a link
 * and then redeemed it. Both endpoints are gone: on a zero-knowledge service a
 * mailed reset was an account-TAKEOVER path that returned no recovery, because
 * the DEK is wrapped under keys the server never sees. `recoverSyncAccount`
 * below replaces them with the code the user already holds.
 *
 * `regenerateRecoveryCode` went with them, and its absence is a real
 * limitation rather than an oversight. A recovery code is now the account's
 * SECOND AUTHENTICATOR, and the service registers that verifier at signup or
 * never — so a freshly minted code could still unwrap the DEK but could no
 * longer prove anything to `POST /v1/auth/recover`. Shipping a button that
 * hands the user a code which authenticates nowhere is worse than not offering
 * one, so the button is gone and the setup copy says the code is issued once.
 */

/**
 * Sets a new passphrase using the recovery code — the whole of what "I forgot
 * my passphrase" now means.
 *
 * ── Three round trips, and the order is the safety property ──────────────
 *
 *  1. `POST /v1/auth/recover` — the code proves who this is and opens a
 *     session. Nothing is written.
 *  2. With that session, the `recovery` key record is read and the DEK is
 *     unwrapped with the code. This MUST happen before anything rotates: key
 *     records are behind bearer auth, so a client that rotated first would
 *     have replaced the passphrase record without ever having held the DEK it
 *     is supposed to re-wrap.
 *  3. `POST /v1/auth/recover-rotate` — the new verifier, the new descriptor
 *     and the re-wrapped DEK move together in ONE server transaction. A half
 *     update is impossible; that is the endpoint's whole reason for existing.
 *
 * The recovery code itself is NOT rotated. It still opens the same unchanged
 * DEK, and replacing it here would mean showing a second code on a screen
 * whose entire subject is the passphrase.
 *
 * If both secrets are lost there is no third path, and there is no code here
 * that pretends otherwise: a mechanism that let the server restore access
 * would mean the server could open the data.
 */
export async function recoverSyncAccount({
  serverUrl,
  handle,
  recoveryCode,
  newPassphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  handle: string;
  /** As the user typed it — grouping and case do not matter (`parseRecoveryCode`). */
  recoveryCode: string;
  newPassphrase: string;
} & SyncActionOptions): Promise<void> {
  const { authClient, http } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const rawRecoveryCode = parseRecoveryCode(recoveryCode);
  if (rawRecoveryCode === null) {
    throw new SyncRequestError({ kind: 'invalid', message: 'That recovery code is not in the right format.' });
  }

  const recovered = await authClient.recover({
    handle,
    recoveryAuthHash: await deriveRecoveryAuthHash(rawRecoveryCode),
  });

  const records = await http.listKeyRecords();
  const recoveryRecord = records.find((record) => record.kind === 'recovery');
  if (recoveryRecord === undefined) {
    throw new SyncRequestError({ kind: 'not-found', message: 'This account has no recovery key on file.' });
  }
  let dek: Uint8Array;
  try {
    dek = await unwrapDek({ wrappedDek: recoveryRecord.wrappedDek, kek: await deriveRecoveryKek(rawRecoveryCode) });
  } catch {
    // The code authenticated but does not open the data. That is a genuinely
    // different situation from a wrong code, and saying "wrong code" here
    // would send the user to retype something that already worked.
    throw new SyncRequestError({ kind: 'invalid', message: 'That recovery code does not open this account’s data.' });
  }

  const descriptor = createPassphraseKdfDescriptor(generateArgon2idSalt(), params);
  const credentials = await deriveCredentialsFromPassphrase({ passphrase: newPassphrase, descriptor, deriveHash });

  await authClient.recoverRotate({
    handle,
    recoveryAuthHash: await deriveRecoveryAuthHash(rawRecoveryCode),
    newAuthHash: credentials.authHash,
    kdfDescriptor: toWireDescriptor(descriptor),
    keyRecords: [
      {
        kind: 'passphrase',
        kdfDescriptor: descriptor,
        wrappedDek: bytesToBase64(await wrapDek({ dek, kek: credentials.passphraseKek })),
      },
    ],
  });

  const vault = openSession({
    authClient,
    http,
    serverUrl,
    accountId: recovered.account.id,
    handle: recovered.account.handle,
    dek,
    privateStoreKek: credentials.privateStoreKek,
  });

  // The compartment, LAST and in this same call frame. It opens by `K_pr` —
  // the recovery code is the only door this person has — and BOTH slots are
  // rewritten, because the passphrase behind slot 1 no longer exists. A
  // compartment whose slot 1 belongs to a forgotten passphrase and whose slot 2
  // belongs to a code nobody re-enters is unopenable by anyone, forever.
  await rewrapCompartmentAfterRecovery({
    vault,
    recoveryKek: await derivePrivateStoreRecoveryKek(rawRecoveryCode),
  });
}

/**
 * The recovery's compartment step: moves BOTH slots, or CREATES the
 * compartment when the account has none.
 *
 * ── Why the create branch lives here ─────────────────────────────────────
 *
 * A compartment needs both doors at once, and recovery is now the only
 * routine operation where a recovery code exists in the clear — the session
 * supplies the other door. That makes this the upgrade path for an account
 * whose blob predates the partition (M160/07), a job that used to belong to
 * the recovery-code regeneration this milestone deleted.
 *
 * Nothing is pushed here: clearing the seal cache is enough, because the next
 * sync cycle seals and pushes it.
 *
 * ── The ONE thing this must not do ───────────────────────────────────────
 *
 * Report a completed recovery as a failure. By the time it runs the rotation
 * has committed and the new passphrase works, so a failure is re-thrown with
 * wording that says exactly that, rather than a generic conflict message that
 * would invite the user to start a recovery whose passphrase has already
 * changed.
 *
 * Slot 2 is rewrapped under the SAME `K_pr` it already had. That is not a
 * no-op: it is what makes both slots products of one operation, so a future
 * reader never has to reason about a compartment whose halves were written at
 * different times under different assumptions.
 */
async function rewrapCompartmentAfterRecovery({
  vault,
  recoveryKek,
}: {
  vault: SyncVault;
  recoveryKek: CryptoKey;
}): Promise<void> {
  try {
    const result = await rewrapPrivateStoreOnServer({
      http: vault.http,
      accountId: vault.accountId,
      dek: vault.dek,
      deviceId: vault.deviceId,
      currentKek: recoveryKek,
      currentSlot: 'recovery',
      nextPassphraseKek: vault.privateStore.passphraseKek,
      nextRecoveryKek: recoveryKek,
    });
    if (result.status === 'rewrapped') {
      adoptRewrappedSlots({ session: vault.privateStore, cdk: result.cdk, sealed: result.sealed });
      return;
    }
    if (result.status === 'unopenable') return;

    const established = await establishPrivateStore({
      passphraseKek: vault.privateStore.passphraseKek,
      recoveryKek,
    });
    // THROUGH THE ADOPT, never field by field (M164/08). Written by hand this
    // sets `cdk`, `wraps` and `cache` and never says that this session KNOWS
    // the plaintext — so `sealOwnerPrivateRegion` refuses, re-emits
    // `session.pulled`, and on the very account this branch exists for that is
    // `null`. The compartment the user was just shown a recovery code for
    // would stay on this device, and nothing would ever bring it back.
    adoptEstablishedCompartment({ session: vault.privateStore, established });
  } catch {
    // The cause is deliberately dropped rather than chained: every failure
    // reaching here is already a `SyncRequestError` whose own message would
    // read as "the recovery failed", which is the one thing that is not true.
    throw new SyncRequestError({
      kind: 'conflict',
      message:
        'Your passphrase is set and your diary is intact, but this device could not move your clinician share keys onto the new passphrase. Try sharing again from this device.',
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

  const wire = await vault.authClient.fetchKdfDescriptor(vault.handle);
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
