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
import type { InstanceDescriptor, OperatorNotice } from './engine/protocol';
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
  hasUnopenedCompartment,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
  type PrivateStoreSession,
} from './private-store';
import { rewrapPrivateStoreOnServer } from './private-store-rewrap';
import { runSyncCycle } from './orchestrator';
import {
  clearAccountHint,
  getSyncVault,
  updateSyncSession,
  type SyncErrorReason,
  type SyncVault,
} from './sync-session';
import { cacheOpenSession, closeAndForgetSyncSession, openSyncVault } from './session-cache';

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
 * Asks an instance to describe itself: its name, its language, whether it can
 * send mail, and which model its AI proxy serves (protocol 2's `/health`).
 *
 * FAILS OPEN — `null` for an unreachable service, a malformed handshake, or a
 * service older than the field — because nothing it answers can destroy
 * anything. Contrast `requireCompatibleService` above, which fails CLOSED for
 * the opposite reason: a wrong sync can destroy the only copy of a diary, so
 * doubt there must stop the operation.
 *
 * It replaced `readSignupMode`, which asked a question protocol 2 has no
 * answer to: there is one way in, an invite addressed to an email.
 */
export async function readServerInstance(
  serverUrl: string,
  options: SyncActionOptions = {},
): Promise<InstanceDescriptor | null> {
  const { authClient } = clients({ serverUrl, fetchImpl: options.fetchImpl });
  return await authClient.instance();
}

/**
 * Asks an instance whether its operator has a message for its users
 * (PROTOCOL.md §5.6).
 *
 * FAILS OPEN, like `readServerInstance` — `null` means "no banner", and an
 * unreachable service, a malformed body or one older than the field are all
 * the same answer. This is a PULL channel: the client asks, so it reaches only
 * the people who open the app.
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

/** What the join screen shows about an invite it has not yet redeemed. */
export interface SyncInviteDetails {
  email: string;
  displayName: string | null;
  expiresAt: string;
}

/**
 * Reads what an invite says about itself, before a passphrase is typed or a
 * key is derived.
 *
 * `{ status: 'invalid' }` covers every dead invite — unknown, spent, revoked,
 * expired — as one outcome, because they have one screen. Anything else still
 * throws: "we could not reach the server" must never be shown as "your
 * invitation is not valid".
 */
export async function readSyncInvite({
  serverUrl,
  inviteToken,
  fetchImpl,
}: { serverUrl: string; inviteToken: string } & SyncActionOptions): Promise<SyncInviteDetails | { status: 'invalid' }> {
  const { authClient } = clients({ serverUrl, fetchImpl });
  const looked = await authClient.inviteLookup({ inviteToken });
  if ('status' in looked) return looked;
  return { email: looked.email, displayName: looked.displayName, expiresAt: looked.expiresAt };
}

/**
 * Redeems an invite into an account, generates the key hierarchy, writes both
 * key records, and opens the session — the whole of first-time setup.
 *
 * ── THE RECOVERY CODE IS NEVER RETURNED, AND THAT IS THE POINT (M192) ────
 *
 * It is generated here, it wraps the DEK and the compartment's second door,
 * and the RAW code is sent to the service in the signup body so the service
 * can escrow it. It is not returned, not stored, not rendered, and it is not
 * in this function's return type — which is what stops a later caller from
 * "just showing it to be safe". The person is never asked to keep anything.
 *
 * The honest consequence, stated in the privacy copy and in the milestone's
 * decisions: the operator of a managed instance holds what it takes to open a
 * diary. It already sees every plate photo that passes through its AI proxy,
 * so this changes the promise less than it looks — and what it buys is that
 * "I forgot my password" returns the DIARY, rather than a working login to
 * something permanently unreadable.
 *
 * ── ORDER MATTERS AND IS NOT ARBITRARY ──────────────────────────────────
 *
 * The account is created first, because key records need an authenticated
 * session to write. Under protocol 2 the account, BOTH key records and the
 * escrow commit in one server transaction, so the old "an account with no key
 * records" hole is closed at the source — the two `PUT`s below are what a
 * client of the older shape needed and are kept because the service still
 * accepts them and `signInToSync` still repairs an account that lacks them.
 */
export async function createSyncAccount({
  serverUrl,
  inviteToken,
  passphrase,
  displayName,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  /**
   * The `si_` token from the invite link.
   *
   * THE ONLY IDENTITY INPUT. There is deliberately no `email` parameter beside
   * it: the service reads the address off the invite and returns it on the
   * created account, so a second copy passed in here could only ever disagree
   * with the authoritative one — and the caller that had it would be the one
   * naming the session.
   */
  inviteToken: string;
  passphrase: string;
  displayName?: string | null;
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
    inviteToken,
    authHash: keys.authHash,
    kdfDescriptor: toWireDescriptor(keys.kdfDescriptor),
    displayName: displayName ?? null,
    // The SECOND authenticator, derived under the `RECOVERY_AUTH` label — a
    // sibling of the recovery KEK and never the KEK itself, which would hand
    // the operator material from the same HKDF output as the key that opens
    // the diary (`recovery-kek.ts`).
    recoveryAuthHash: await deriveRecoveryAuthHash(recovery.raw),
    // THE ESCROW, and the encoding is a decision the contract left open.
    //
    // It is the FORMATTED code — the exact `XXXXX-XXXXX-…` string this client
    // used to print on the account card — because `/reset/open` hands it
    // straight back and `parseRecoveryCode` is the ONE decoder this client
    // has. Escrowing raw base64 would need a second decoder on the reset path,
    // and a second decoder for one value is how the two drift. The service
    // treats it as an opaque string either way.
    recoveryCode: recovery.formatted,
    keyRecords: [
      {
        kind: 'passphrase',
        kdfDescriptor: keys.passphraseKeyRecord.kdfDescriptor,
        wrappedDek: bytesToBase64(keys.passphraseKeyRecord.wrappedDek),
      },
      { kind: 'recovery', kdfDescriptor: null, wrappedDek: bytesToBase64(keys.recoveryKeyRecord.wrappedDek) },
    ],
  });

  openSyncVault({
    authClient,
    http,
    serverUrl,
    accountId: created.account.id,
    email: created.account.email,
    dek: keys.dek,
    privateStoreKek: keys.privateStoreKek,
    privateStore: keys.privateStore,
  });
  return { status: 'ready', email: created.account.email };
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
 *  - login rejected (`401`) → wrong address or passphrase. One message for
 *    both, by protocol design (`classifySignInFailure`).
 *  - `403 account-suspended` → an admin suspended this account. Its own
 *    `SyncErrorKind`, because it is true of every call, not just this one.
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
        'That passphrase signs you in, but it cannot open this account’s data — another device set a new one. Use the passphrase that device chose, or your recovery code.',
    });
  }

  openSyncVault({
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

  openSyncVault({
    authClient,
    http,
    serverUrl,
    accountId: account.id,
    email: account.email,
    dek,
    privateStoreKek,
    privateStore,
  });
  // THE CODE IS NOT RETURNED, exactly as in `createSyncAccount`. This branch
  // repairs an account that has no key records, and a repair cannot escrow: an
  // account's recovery verifier is set at signup or never, so the code minted
  // here proves nothing to the service and could not be used to reset
  // anything. Showing it would be handing somebody a key to no door.
  return { status: 'ready', email: account.email };
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
    const failure = describeSyncFailure(error);
    updateSyncSession({ phase: 'idle', error: failure });
    // A REFUSED SESSION DROPS THE CACHE, wherever it surfaces. The auth client
    // has already cleared its own tokens by this point; leaving the cached
    // copy behind would let the next reload resume a session the service has
    // ended, fail again, and keep doing so — a device that looks signed in and
    // has not sent a byte since the day it was suspended.
    if (failure.reason === 'reauth-required') await closeAndForgetSyncSession();
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
    // A SUSPENSION IS A REAUTH, not a generic failure, because the response is
    // the same one: this session is over and the app must stop pretending
    // otherwise. The message is this app's own rather than the server's token
    // (`account-suspended` is a protocol word, not a sentence).
    if (cause.kind === 'suspended') {
      return {
        reason: 'reauth-required',
        message: 'An administrator has suspended this account, so it cannot sync. Ask them to reactivate it.',
      };
    }
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
 * The remembered address stays too (M183 spec 04): it is not a credential, and
 * keeping it is what turns the next visit into a sign-in instead of a dead
 * end. "Not you?" is the explicit, visible way to clear it — a side effect of
 * the sign-out button is not.
 *
 * The CACHED SESSION does not stay. It is the credential the address is not,
 * and a sign-out that left it behind would be undone by the next reload.
 */
export async function signOutOfSync(): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) return;
  await vault.authClient.logout();
  await closeAndForgetSyncSession();
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

  // THE CACHE HOLDS `K_pp`, and the one above just moved. Re-writing it here
  // rather than leaving it to the next sign-in is what stops the next RELOAD
  // from resuming with a compartment door the account no longer has — a
  // session that syncs the diary perfectly and cannot publish a share key,
  // reported as the amber "this device could not open the account's private
  // data" a passphrase change is supposed to have just fixed. The tokens moved
  // too (`change-passphrase` revokes every session and mints a new pair).
  await cacheOpenSession(vault);
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
 * WHAT USED TO BE HERE, TWICE OVER.
 *
 * M181 deleted `requestSyncReset` / `completeSyncReset`: on a zero-knowledge
 * service a mailed reset was an account-TAKEOVER path that returned no
 * recovery, because the DEK is wrapped under keys the server never saw.
 * Whoever held the mailbox got a login to a diary they still could not read.
 *
 * M192 brings the mailed reset back, and the thing that changed is the
 * premise, not the mechanism: the service now ESCROWS the recovery code at
 * signup, so the mailed link can hand the code back and the same ceremony that
 * has always worked runs with it. `resetSyncPassphrase` below is that path.
 *
 * `regenerateRecoveryCode` is still gone, and it is no longer a limitation:
 * the reset path rotates the code on every use, and nobody is ever shown one.
 */

/**
 * Renames the account, or clears the name.
 *
 * The ADDRESS is not editable and there is no action here for it: it is the
 * identity, an admin issued the invitation that carries it, and changing it
 * would silently move an account away from the person the organization
 * invited.
 *
 * The updated view is adopted into the session by the auth client, so the
 * avatar menu two rows away reads the new name from the same object this
 * screen does.
 */
export async function setSyncDisplayName({ displayName }: { displayName: string | null }): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) throw new Error('setSyncDisplayName called without an open sync session');
  const account = await vault.authClient.patchAccount({ displayName });
  // The SNAPSHOT is what React reads, and the auth client cannot publish to
  // it: the vault is deliberately unreachable from a snapshot (see
  // `sync-session.ts`). So the one field that changed is copied across here.
  updateSyncSession({
    account: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      dailyAiLimit: account.dailyAiLimit,
      aiUsedToday: account.aiUsedToday,
    },
  });
}

/**
 * Re-reads the account from the service and publishes it to the snapshot.
 *
 * WHAT MOVES ON THE SERVER while a tab is open: `aiUsedToday` on every scan,
 * `dailyAiLimit` and `suspendedAt` whenever an administrator touches the row.
 * The snapshot is a photograph taken at sign-in, and the account page is the
 * one screen whose whole job is to show those three (M192/06). Every other
 * surface is content with the sign-in snapshot, so this is called from there
 * and nowhere else.
 *
 * FAIL-OPEN. A refused or unreachable refresh leaves the previous numbers on
 * screen, which are stale rather than wrong, and an error card on the account
 * page would be a worse answer than a slightly old count.
 */
export async function refreshSyncAccount(): Promise<void> {
  const vault = getSyncVault();
  if (vault === null) return;
  try {
    const account = await vault.authClient.getAccount();
    updateSyncSession({
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        dailyAiLimit: account.dailyAiLimit,
        aiUsedToday: account.aiUsedToday,
      },
    });
  } catch {
    // Offline, or a service mid-deploy. The numbers already on screen stay.
  }
}

/**
 * Asks the instance to mail a password-reset link.
 *
 * RESOLVES THE SAME WAY WHATEVER HAPPENS, and the caller must show the same
 * screen either way. The service answers `202` whether or not the address has
 * an account, so that this cannot be used to ask whether somebody is a member
 * of the organization — and a caller that branched on the answer would be
 * building the oracle the endpoint exists to refuse.
 *
 * A TRANSPORT failure still throws, because that one is "we could not reach
 * the server", which is worth saying. It says nothing about the address.
 */
export async function requestSyncPasswordReset({
  serverUrl,
  email,
  fetchImpl,
}: { serverUrl: string; email: string } & SyncActionOptions): Promise<void> {
  const { authClient } = clients({ serverUrl, fetchImpl });
  await authClient.resetRequest({ email });
}

/**
 * "I forgot my password": open the mailed reset token, then run the recovery
 * ceremony with the code the service was holding.
 *
 * ── The code is rotated, and that is not optional ────────────────────────
 *
 * A fresh code is minted, wrapped under the new door, AND re-escrowed in the
 * same `recover-rotate` transaction. Leaving the old code in place would work
 * — it opens the same unchanged DEK — and it would mean the code that just
 * travelled through a mailbox stays valid forever. Rotating costs one extra
 * field and retires the value the moment it has been used.
 *
 * ── What the person sees ────────────────────────────────────────────────
 *
 * A password field, and then their diary. No code, at any point, in either
 * direction: {@link recoverSyncAccount} is called with a value fetched from
 * the service microseconds earlier and dropped when this frame ends.
 */
export async function resetSyncPassphrase({
  serverUrl,
  resetToken,
  newPassphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  /** The `sr_` token out of the mailed link's fragment. Single use: opening it spends it. */
  resetToken: string;
  newPassphrase: string;
} & SyncActionOptions): Promise<ResetSyncPassphraseResult> {
  const { authClient } = clients({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const opened = await authClient.resetOpen({ resetToken });
  // A dead link is an ordinary thing to arrive with — forwarded mail, a second
  // click, a request superseded by a newer one — so it is a RETURN with its
  // own screen rather than a throw. Everything else still throws.
  if ('status' in opened) return { status: 'invalid' };

  await recoverSyncAccount({
    serverUrl,
    email: opened.email,
    recoveryCode: opened.recoveryCode,
    newPassphrase,
    deriveHash,
    params,
    fetchImpl,
  });
  return { status: 'ready', email: opened.email };
}

/** The two ways a mailed reset ends. A dead token has a screen; anything else throws. */
export type ResetSyncPassphraseResult = { status: 'ready'; email: string } | { status: 'invalid' };

/**
 * Sets a new passphrase using the recovery code, and mints a replacement code
 * in the same transaction.
 *
 * ── NO UI CALLS THIS. Its only caller is the reset path above ────────────
 *
 * Nobody is ever shown a recovery code and nobody is ever asked to type one,
 * so `recoveryCode` here always arrives from `/reset/open` — the escrowed copy
 * the service was holding. It stays a separate function because the ceremony
 * is genuinely three round trips of ordering rules, and burying that inside
 * the token exchange would hide them.
 *
 * ── Four round trips, and the order is the safety property ───────────────
 *
 *  1. `POST /v1/auth/recover` — the code proves who this is and opens a
 *     session. Nothing is written.
 *  2. With that session, the `recovery` key record is read and the DEK is
 *     unwrapped with the code. This MUST happen before anything rotates: key
 *     records are behind bearer auth, so a client that rotated first would
 *     have replaced the passphrase record without ever having held the DEK it
 *     is supposed to re-wrap.
 *  3. `POST /v1/auth/recover-rotate` — the new verifier, the new descriptor,
 *     the re-wrapped DEK, the NEW recovery verifier, its own re-wrapped record
 *     and the new escrow move together in ONE server transaction. A half
 *     update is impossible; that is the endpoint's whole reason for existing.
 *  4. The compartment, last, in this same call frame — see
 *     `rewrapCompartmentAfterRecovery`.
 */
export async function recoverSyncAccount({
  serverUrl,
  email,
  recoveryCode,
  newPassphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  email: string;
  /** The escrowed code, exactly as `/reset/open` returned it (`parseRecoveryCode` tolerates the grouping). */
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
    email,
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

  // THE REPLACEMENT CODE. Minted here, wrapped under its own KEK, and sent
  // raw so the service can replace the escrow in the same transaction. All
  // three halves travel together or the service refuses: a new verifier with
  // the OLD escrow behind it would leave the next reset returning a code that
  // authenticates and unwraps nothing, one reset later, with nothing to
  // connect the failure to this call.
  const nextRecovery = generateRecoveryCode();

  await authClient.recoverRotate({
    email,
    recoveryAuthHash: await deriveRecoveryAuthHash(rawRecoveryCode),
    newAuthHash: credentials.authHash,
    kdfDescriptor: toWireDescriptor(descriptor),
    keyRecords: [
      {
        kind: 'passphrase',
        kdfDescriptor: descriptor,
        wrappedDek: bytesToBase64(await wrapDek({ dek, kek: credentials.passphraseKek })),
      },
      {
        kind: 'recovery',
        kdfDescriptor: null,
        wrappedDek: bytesToBase64(await wrapDek({ dek, kek: await deriveRecoveryKek(nextRecovery.raw) })),
      },
    ],
    newRecoveryAuthHash: await deriveRecoveryAuthHash(nextRecovery.raw),
    recoveryCode: nextRecovery.formatted,
  });

  const vault = openSyncVault({
    authClient,
    http,
    serverUrl,
    accountId: recovered.account.id,
    email: recovered.account.email,
    dek,
    privateStoreKek: credentials.privateStoreKek,
  });

  // The compartment, LAST and in this same call frame. It opens by the OLD
  // `K_pr` — the code that just unwrapped the DEK is the only door this
  // session has — and both slots are rewritten: slot 1 onto the new
  // passphrase, slot 2 onto the NEW code, so the compartment and the key
  // records end this call describing the same pair of doors. A compartment
  // whose slot 2 still belonged to the retired code would be openable only by
  // a value the service has already thrown away.
  await rewrapCompartmentAfterRecovery({
    vault,
    currentRecoveryKek: await derivePrivateStoreRecoveryKek(rawRecoveryCode),
    nextRecoveryKek: await derivePrivateStoreRecoveryKek(nextRecovery.raw),
  });
}

/**
 * The recovery's compartment step: moves BOTH slots, or CREATES the
 * compartment when the account has none.
 *
 * ── Why the create branch lives here ─────────────────────────────────────
 *
 * A compartment needs both doors at once, and the reset is the only routine
 * operation where a recovery code exists in the clear — the session supplies
 * the other door. That makes this the upgrade path for an account whose blob
 * predates the partition (M160/07).
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
 * SLOT 2 MOVES ONTO A NEW `K_pr`, and that is the M192 change here. The reset
 * retires the code it just used, so re-wrapping slot 2 under the OLD one would
 * leave the compartment's second door belonging to a value the service has
 * already replaced — openable by nobody, discovered only by whoever needs it.
 */
async function rewrapCompartmentAfterRecovery({
  vault,
  currentRecoveryKek,
  nextRecoveryKek,
}: {
  vault: SyncVault;
  /** `K_pr` of the code that just opened this account — the door this session can use. */
  currentRecoveryKek: CryptoKey;
  /** `K_pr` of the replacement code, which the key records and the escrow already carry. */
  nextRecoveryKek: CryptoKey;
}): Promise<void> {
  try {
    const result = await rewrapPrivateStoreOnServer({
      http: vault.http,
      accountId: vault.accountId,
      dek: vault.dek,
      deviceId: vault.deviceId,
      currentKek: currentRecoveryKek,
      currentSlot: 'recovery',
      nextPassphraseKek: vault.privateStore.passphraseKek,
      nextRecoveryKek,
    });
    if (result.status === 'rewrapped') {
      adoptRewrappedSlots({ session: vault.privateStore, cdk: result.cdk, sealed: result.sealed });
      return;
    }
    if (result.status === 'unopenable') return;

    const established = await establishPrivateStore({
      passphraseKek: vault.privateStore.passphraseKek,
      recoveryKek: nextRecoveryKek,
    });
    // THROUGH THE ADOPT, never field by field (M164/08). Written by hand this
    // sets `cdk`, `wraps` and `cache` and never says that this session KNOWS
    // the plaintext — so `sealOwnerPrivateRegion` refuses, re-emits
    // `session.pulled`, and on the very account this branch exists for that is
    // `null`. The compartment this account just recovered would stay on this
    // device, and nothing would ever bring it back.
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

  const wire = await vault.authClient.fetchKdfDescriptor(vault.email);
  const { authHash } = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor: { salt: wire.salt, params: wire.params },
    deriveHash,
  });

  await vault.authClient.deleteAccount({ authHash });
  vault.state.clear();
  clearAccountHint();
  await closeAndForgetSyncSession();
}
