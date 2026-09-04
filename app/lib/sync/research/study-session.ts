/**
 * THE STUDY CONSOLE'S SESSION — a second sync account, held in a vault of its
 * own, that never touches this device's diary.
 *
 * `openplate-sync` ADR-0003: "a study is an ordinary sync account", and its
 * private key lives in THAT account's owner-private compartment. This module
 * is the composition root that makes it so. Like `sync-actions.ts` and
 * `research-actions.ts` it decides nothing; it wires.
 *
 * ── Why this is not `sync-actions.ts` with a parameter ───────────────────
 *
 * Three reasons, and each one alone would be enough:
 *
 *  1. **The snapshot.** `sync-actions.ts` pushes what it has just read off
 *     this device — the owner's diary. On a study account that is the leak
 *     this whole slice exists to prevent, so the study path reads no device
 *     store at all and pushes `buildStudySnapshot` (`study-snapshot.ts`).
 *  2. **The vault.** `openSyncSession` publishes into the ONE session
 *     `SyncController`, `syncNow` and every sharing surface read. A study
 *     account there would make the next boot-time sync push this device's
 *     diary to the study, or the study's compartment to the diary account.
 *     The study vault below is module-private and is never handed to any of
 *     them.
 *  3. **The account hint.** A study sign-in must not leave the study's address
 *     sitting in the diary's unlock field on a shared laptop. Nothing here
 *     writes it.
 *
 * A flag through the shared path would have to be right in all three places,
 * every time, forever — and a flag is a thing that can be false.
 *
 * ── SIGN-IN PER USE ──────────────────────────────────────────────────────
 *
 * The vault is memory-only and there is no persistence of any kind: no hint,
 * no state store, no token on disk. Closing the tab, reloading, or leaving
 * `/study` ends the session and the researcher signs in again. That is the
 * v1 answer to "one vault must never hold both accounts' keys" — the two
 * vaults are separate objects in separate modules, and this one exists only
 * for as long as the console is on screen.
 *
 * ── Failures throw ───────────────────────────────────────────────────────
 *
 * Same rule as `sync-actions.ts`: the callers are React handlers that show an
 * error, and a return value they can forget to check is a silent no-op button.
 */
import { SyncAuthClient } from '../engine/client/auth-client';
import { SyncHttpClient } from '../engine/client/http-client';
import { SyncRequestError } from '../engine/client/sync-error';
import { workerArgon2idDeriver } from '../engine/client/argon2-worker';
import { deriveCredentialsFromPassphrase } from '../engine/client/derive-credentials';
import { setupSyncKeys, type Argon2idDeriver } from '../engine/client/setup-keys';
import type { PassphraseKdfDescriptor } from '../engine/client/passphrase-kek';
import {
  derivePrivateStoreRecoveryKek,
  deriveRecoveryAuthHash,
  deriveRecoveryKek,
  generateRecoveryCode,
} from '../engine/client/recovery-kek';
import { establishPrivateStore } from '../engine/crypto/private-store';
import { ARGON2ID_DEFAULT_PARAMS, type Argon2idParams } from '../engine/crypto/argon2';
import { generateDek, unwrapDek, wrapDek } from '../engine/crypto/dek-wrap';
import { bytesToBase64 } from '../engine/crypto/base64';
import { shareFingerprintDisplay, shareKeyFingerprint } from '../engine/crypto/share-wrap';
import { deviceStorage, resolveDeviceId } from '../sync-state';
import type { SurfaceRead } from '../engine/client/http-client';
import { pullStudyCohort, type StudyCohort } from './study';
import { pullStudyBlob, pushStudyBlob, type PulledStudyBlob } from './study-blob';
import {
  hasUnopenedStudyCompartment,
  openStudyRegion,
  sealStudyRegion,
  type StudyCompartmentSession,
} from './study-compartment';
import {
  currentStudyPublicKey,
  EMPTY_STUDY_PRIVATE_REGION,
  generateStudyKeyGeneration,
  studyKeyPairsOf,
  withNewStudyKeyGeneration,
  type StudyPrivateRegion,
} from './study-keyring';

/** Overridable seams. Production passes none; tests pass all of them. */
export interface StudySessionOptions {
  deriveHash?: Argon2idDeriver;
  params?: Argon2idParams;
  fetchImpl?: typeof fetch;
}

/**
 * Secrets and clients for the STUDY account. Module-private, never published
 * to React state, never logged, never serialized — the same rule
 * `sync-session.ts` states for the diary vault, and a separate object so that
 * neither module can hand out the other's keys.
 */
interface StudyVault {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  dek: Uint8Array;
  accountId: number;
  email: string;
  serverUrl: string;
  /** This browser's sync device id, reused so the compartment's Lamport tie-break is stable. It never leaves the encrypted envelope. */
  deviceId: string;
  compartment: StudyCompartmentSession;
  /** The keyring as last read from the account's blob. Every generation, never only the newest — see `study-keyring.ts`. */
  region: StudyPrivateRegion;
}

let vault: StudyVault | null = null;

/** What a study console is allowed to show. Carries no key material — a fingerprint is a hash, and the count is a count. */
export interface StudyConsoleIdentity {
  accountId: number;
  email: string;
  /** How many key generations this study holds. All of them are tried when opening a cohort. */
  generationCount: number;
  /** The NEWEST generation's fingerprint, twelve characters in three groups of four — the form printed in a consent document. `null` before any key exists. */
  fingerprint: string | null;
  /**
   * Whether the two fields above are a REPORT or an ADMISSION (M164/07).
   *
   * `generationCount: 0` and `fingerprint: null` are what a study that has
   * minted nothing looks like — the ordinary first visit. They are also what a
   * console that could not open the compartment looks like, because the open
   * answers `null` and the empty region is what is left. Those are opposite
   * situations and one screen cannot say both, so the state comes up with
   * them, in the diary's own vocabulary (`hasUnopenedCompartment`,
   * `private-store.ts`).
   */
  hasUnopenedCompartment: boolean;
}

/** Signing in either finds a complete account, or completes a setup that was interrupted and mints the recovery code that repair needs. */
/**
 * NO `recoveryCode` ON EITHER MEMBER (M192/05). A study account is an ordinary
 * protocol-2 account: its code is escrowed with the service at signup and
 * never shown, so there is nothing for the console to print and no field a
 * future screen could print it from.
 */
export type StudySignInResult = { status: 'connected' } | { status: 'setup-completed' };

/** Creating the account opens the console. There is nothing to hand back: see {@link StudySignInResult}. */
export type StudyAccountSetupResult = { status: 'ready' };

function clientsFor({ serverUrl, fetchImpl }: { serverUrl: string; fetchImpl?: typeof fetch }) {
  const authClient = new SyncAuthClient({ baseUrl: serverUrl, fetchImpl });
  const http = new SyncHttpClient({ baseUrl: serverUrl, tokens: authClient, fetchImpl });
  return { authClient, http };
}

/** Refuses on any §6 handshake mismatch, including an unreachable service — `sync-actions.ts`'s rule, for the same reason. */
async function requireCompatibleService(authClient: SyncAuthClient): Promise<void> {
  const compatibility = await authClient.handshake();
  if (compatibility.status === 'compatible') return;
  throw new SyncRequestError({ kind: 'invalid', message: compatibility.reason });
}

/**
 * Creates the STUDY account and opens the console on it.
 *
 * The recovery code is shown once and never retained, exactly as the diary's
 * is — and here it matters twice over: it is the second door of the
 * compartment that holds the study's private keys, and ADR-0003 is explicit
 * that losing both doors is attrition rather than a brick, with no escrow.
 */
export async function createStudyAccount({
  serverUrl,
  inviteToken,
  passphrase,
  deriveHash = workerArgon2idDeriver,
  params = ARGON2ID_DEFAULT_PARAMS,
  fetchImpl,
}: {
  serverUrl: string;
  /**
   * The `si_` invite this study account is redeemed from.
   *
   * A STUDY ACCOUNT IS AN ORDINARY ACCOUNT under protocol 2, so a researcher
   * gets one the same way anybody else does: an admin invites their address.
   * There is no open signup left to mint one from.
   */
  inviteToken: string;
  passphrase: string;
} & StudySessionOptions): Promise<StudyAccountSetupResult> {
  const { authClient, http } = clientsFor({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  const recovery = generateRecoveryCode();
  const keys = await setupSyncKeys({ passphrase, recoveryCodeRaw: recovery.raw, params, deriveHash });

  const created = await authClient.signup({
    inviteToken,
    authHash: keys.authHash,
    kdfDescriptor: { salt: keys.kdfDescriptor.salt, params: keys.kdfDescriptor.params },
    // The study account's second authenticator, set here or never — the same
    // one-shot registration the diary account gets (`sync-actions.ts`).
    recoveryAuthHash: await deriveRecoveryAuthHash(recovery.raw),
    // ESCROWED, like every other account's, and that is a CHANGE FOR A STUDY:
    // ADR-0003 said losing both doors was attrition with no escrow, and
    // protocol 2 makes the field required for every signup. The consequence is
    // stated rather than hidden — the operator of this instance can now open a
    // study's compartment — and it is the same consequence the diary side took
    // on for the same reason. It is NOT shown either: a code a researcher is
    // told to keep, on an account the operator can already open, would be a
    // ceremony that protects nothing.
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

  vault = {
    authClient,
    http,
    dek: keys.dek,
    accountId: created.account.id,
    email: created.account.email,
    serverUrl,
    deviceId: resolveDeviceId(deviceStorage()),
    compartment: {
      accountId: created.account.id,
      passphraseKek: keys.privateStoreKek,
      cdk: keys.privateStore.cdk,
      wraps: {
        cdkWrapPassphrase: keys.privateStore.cdkWrapPassphrase,
        cdkWrapRecovery: keys.privateStore.cdkWrapRecovery,
      },
      extras: {},
      pulled: null,
    },
    region: EMPTY_STUDY_PRIVATE_REGION,
  };
  return { status: 'ready' };
}

/** A first-time key-record write. A conflict means another device finished setup first, and must not be overwritten. */
async function putFirstKeyRecord(
  http: SyncHttpClient,
  record: { kind: 'passphrase' | 'recovery'; kdfDescriptor: PassphraseKdfDescriptor | null; wrappedDek: Uint8Array },
): Promise<void> {
  const result = await http.putKeyRecord({ ...record, expectedUpdatedAt: null });
  if (result.status === 'conflict') {
    throw new SyncRequestError({
      kind: 'conflict',
      message:
        'This study account already has sync keys — sign in with its existing passphrase instead of setting it up again.',
    });
  }
}

/**
 * Signs the console into an existing study account.
 *
 * An account with NO key records is repaired here rather than refused. That
 * state is reachable whenever a device dies between the signup and the
 * key-record writes, and refusing it would leave the console permanently
 * locked out of an account that exists, which is the bug `sync-actions.ts`
 * documents on the diary side.
 */
export async function signInToStudy({
  serverUrl,
  email,
  passphrase,
  deriveHash = workerArgon2idDeriver,
  fetchImpl,
}: { serverUrl: string; email: string; passphrase: string } & StudySessionOptions): Promise<StudySignInResult> {
  const { authClient, http } = clientsFor({ serverUrl, fetchImpl });
  await requireCompatibleService(authClient);

  // The ACCOUNT'S own parameters, never this build's defaults: an account
  // created under different costs derives differently, and getting that wrong
  // is indistinguishable from a wrong passphrase.
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
    return finishInterruptedStudySetup({
      authClient,
      http,
      serverUrl,
      account: session.account,
      descriptor,
      passphraseKek,
      privateStoreKek,
    });
  }

  let dek: Uint8Array;
  try {
    dek = await unwrapDek({ wrappedDek: passphraseRecord.wrappedDek, kek: passphraseKek });
  } catch {
    throw new SyncRequestError({
      kind: 'invalid',
      message:
        'That passphrase signs this study in, but it cannot open the account\u2019s data \u2014 it was replaced. Use the recovery code to restore access.',
    });
  }

  vault = {
    authClient,
    http,
    dek,
    accountId: session.account.id,
    email: session.account.email,
    serverUrl,
    deviceId: resolveDeviceId(deviceStorage()),
    compartment: {
      accountId: session.account.id,
      passphraseKek: privateStoreKek,
      cdk: null,
      wraps: null,
      extras: {},
      pulled: null,
    },
    region: EMPTY_STUDY_PRIVATE_REGION,
  };
  return { status: 'connected' };
}

/**
 * Writes the key hierarchy for a study account that has none, on the session
 * that is already open.
 *
 * THE DESCRIPTOR IS THE ACCOUNT'S, not a fresh one — a record wrapped under a
 * freshly-salted descriptor would be unopenable by the very next sign-in.
 */
async function finishInterruptedStudySetup({
  authClient,
  http,
  serverUrl,
  account,
  descriptor,
  passphraseKek,
  privateStoreKek,
}: {
  authClient: SyncAuthClient;
  http: SyncHttpClient;
  serverUrl: string;
  account: { id: number; email: string };
  descriptor: PassphraseKdfDescriptor;
  passphraseKek: CryptoKey;
  privateStoreKek: CryptoKey;
}): Promise<StudySignInResult> {
  const recovery = generateRecoveryCode();
  const dek = generateDek();
  // Both compartment doors exist in this frame and nowhere else, so the
  // compartment is established here or not at all.
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

  vault = {
    authClient,
    http,
    dek,
    accountId: account.id,
    email: account.email,
    serverUrl,
    deviceId: resolveDeviceId(deviceStorage()),
    compartment: {
      accountId: account.id,
      passphraseKek: privateStoreKek,
      cdk: privateStore.cdk,
      wraps: { cdkWrapPassphrase: privateStore.cdkWrapPassphrase, cdkWrapRecovery: privateStore.cdkWrapRecovery },
      extras: {},
      pulled: null,
    },
    region: EMPTY_STUDY_PRIVATE_REGION,
  };
  return { status: 'setup-completed' };
}

/** Ends the console session and drops the secrets it held. `fill(0)` is best-effort hygiene, as `closeSyncSession` says of the same line. */
export function closeStudyConsole(): void {
  vault?.dek.fill(0);
  vault = null;
}

/** Whether a console session is open. Deliberately a boolean: nothing outside this module may hold the vault. */
export function isStudyConsoleOpen(): boolean {
  return vault !== null;
}

function requireVault(operation: string): StudyVault {
  if (vault === null) throw new Error(`${operation} called without an open study console session`);
  return vault;
}

/**
 * Reads the study's identity from its own compartment.
 *
 * The fingerprint is computed HERE from the public key this device holds, and
 * is never round-tripped through anything. A fingerprint that came back from a
 * server would be the server reading you its own key.
 */
export async function loadStudyIdentity(): Promise<StudyConsoleIdentity> {
  const open = requireVault('loadStudyIdentity');
  const blob = await pullStudyBlob({ transport: open.http, accountId: open.accountId, dek: open.dek });
  open.region = (await openStudyRegion({ session: open.compartment, sealed: blob.sealed })) ?? open.region;
  return describeStudyIdentity(open);
}

/**
 * What the console may show, from the vault as it stands.
 *
 * One function for both verbs so the mint and the sign-in cannot report the
 * same vault differently — and so the unopened-compartment state is carried by
 * every answer rather than by the one that remembered to.
 */
async function describeStudyIdentity(open: StudyVault): Promise<StudyConsoleIdentity> {
  const publicKeyRaw = currentStudyPublicKey(open.region);
  return {
    accountId: open.accountId,
    email: open.email,
    generationCount: open.region.studyKeyring.length,
    fingerprint: publicKeyRaw === null ? null : shareFingerprintDisplay(await shareKeyFingerprint(publicKeyRaw)),
    hasUnopenedCompartment: hasUnopenedStudyCompartment(open.compartment),
  };
}

interface MintedStudyRegion {
  /**
   * The region the LAST `reseal` attempt produced — the one the push actually
   * carried. A CAS retry replaces it, exactly as it replaces the bytes, and
   * `null` means no attempt ran at all.
   */
  region: StudyPrivateRegion | null;
}

/**
 * Mints a new key generation and stores it in the study's compartment.
 *
 * APPENDED, through `withNewStudyKeyGeneration` and nothing else. The re-read
 * inside `reseal` is what makes a CAS retry correct: it appends onto whatever
 * the server holds NOW, so a generation another device minted a moment ago
 * survives this write instead of being replaced by it.
 *
 * ── THE VAULT IS COMMITTED AFTER THE PUSH, NEVER INSIDE THE SEAL ─────────
 *
 * `reseal` runs once per CAS round and is followed by a request that can fail
 * for reasons that have nothing to do with the keyring: too-large, a conflict
 * loop that runs out of rounds, a transport that drops. Assigning
 * `open.region` in there left the console holding a generation the study
 * account does not have — it reported a fingerprint no contributor could ever
 * seal to, and a researcher who printed it that afternoon printed a key that
 * exists on one laptop. So the minted region is held aside and adopted only
 * once `pushStudyBlob` has returned, which is the moment the server actually
 * has it.
 */
export async function generateStudyKey(): Promise<StudyConsoleIdentity> {
  const open = requireVault('generateStudyKey');
  const generation = await generateStudyKeyGeneration();
  const pulled = await pullStudyBlob({ transport: open.http, accountId: open.accountId, dek: open.dek });

  const minted: MintedStudyRegion = { region: null };
  await pushStudyBlob({
    transport: open.http,
    accountId: open.accountId,
    dek: open.dek,
    deviceId: open.deviceId,
    pulled,
    reseal: async (current: PulledStudyBlob) => {
      const server = await openStudyRegion({ session: open.compartment, sealed: current.sealed });
      // A MINT ONTO A COMPARTMENT THIS CONSOLE CANNOT READ IS A REFUSAL.
      //
      // The seal no longer answers `null` there — it re-emits the pulled bytes
      // (M164/01) — so `pushStudyBlob`'s throw would no longer fire, and this
      // push would land the OLD keyring while reporting a new fingerprint the
      // study does not hold. Losing the generation loudly is the only honest
      // outcome: the keys it would be appended to are unreadable here.
      if (server === null && current.sealed !== null) {
        throw new SyncRequestError({
          kind: 'invalid',
          message: 'This console could not open the study’s existing keys, so a new key cannot be added to them.',
        });
      }
      const next = withNewStudyKeyGeneration({ region: server ?? open.region, generation });
      minted.region = next;
      return sealStudyRegion({ session: open.compartment, region: next });
    },
  });

  // Unreachable: `pushStudyBlob` calls `reseal` on every round and cannot
  // return without one. Stated rather than asserted away, because the
  // alternative — a non-null assertion — would make a future push that skipped
  // the seal report the keyring the console had before it.
  if (minted.region === null) throw new Error('the study push returned without sealing a region');
  open.region = minted.region;
  return describeStudyIdentity(open);
}

/**
 * Pulls the cohort, purged, with EVERY generation this study holds.
 *
 * Passing the whole keyring is not a convenience: `study.ts` reports a row
 * un-openable only after all of them fail, so handing it one key would report
 * a rotated study's back catalogue as unreadable.
 */
export async function pullCohort(): Promise<SurfaceRead<StudyCohort>> {
  const open = requireVault('pullCohort');
  // AND A CONSOLE WITH NO KEYRING BECAUSE IT COULD NOT READ ONE SAYS SO
  // (M164/07). `study.ts` reports a row un-openable once every key it was
  // given has failed, so handing it the empty region here reports the whole
  // cohort as unreadable contributions — a statement about the contributors,
  // when the truth is a statement about this console. The two answers look
  // identical on screen and only one of them is anybody's fault.
  if (hasUnopenedStudyCompartment(open.compartment)) {
    throw new SyncRequestError({
      kind: 'invalid',
      // NO RECOVERY CODE IS OFFERED, because `/study` cannot accept one
      // (M164/08). This module exports `createStudyAccount` and
      // `signInToStudy` and nothing else, and the route collects a passphrase.
      // A remedy a person cannot carry out is worse than none: it sends them
      // looking for a door that is not there.
      message:
        'This console could not open this study’s keys, so it cannot open any contribution either. Sign in with the passphrase those keys were made with.',
    });
  }
  return pullStudyCohort({ transport: open.http, keys: studyKeyPairsOf(open.region) });
}
