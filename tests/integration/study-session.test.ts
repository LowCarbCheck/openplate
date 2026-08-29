/**
 * THE STUDY CONSOLE'S COMPOSITION ROOT, driven end to end over real HTTP
 * against the protocol-faithful fake (`fake-sync-service.ts`).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The console's session module is where the pure study modules — the keyring,
 * the compartment, the blob verbs, the cohort reader — are wired to an
 * account, a transport and a vault of their own. Its own header says it
 * "decides nothing; it wires", and until this file no test under `tests/`
 * imported it at all. That is the same shape M163/04 measured on the research
 * lane by deleting two lines and watching 2251 tests stay green.
 *
 * Three behaviours had no coverage, and each one fails silently:
 *
 *  1. The mint's CAS retry re-appends onto WHAT THE SERVER HOLDS NOW. Append
 *     onto the stale local keyring instead and a generation another device
 *     minted a moment earlier is dropped — after which every contribution
 *     sealed to it stops opening, with nothing failing anywhere.
 *  2. The cohort read passes EVERY generation. Pass only the newest and a
 *     rotated study's whole back catalogue is reported as `unopenableCount`,
 *     and the cohort shrinks with nothing failing either.
 *  3. The two vaults' isolation — the snapshot, the vault and the account
 *     hint, the three reasons the console is not the diary's path with a flag.
 *     A leak in any of them writes the researcher's own diary into the study
 *     account, or the study's address into the diary's unlock field.
 *
 * ── Assert the OUTCOME, never the call ───────────────────────────────────
 *
 * `research-actions.test.ts`'s rule, inherited whole: nothing here spies on a
 * function, because a spy is green when the wiring is invoked and broken. The
 * observation point is {@link keyringOnTheService} — the study compartment as
 * the SERVICE holds it, pulled back over HTTP by an independent reader that
 * derives its own keys from the passphrase. A test that read the console's
 * own in-memory region would pass with the push deleted.
 *
 * The isolation assertions have no precedent, so they are concrete about what
 * they observe: the diary account's blob BYTE FOR BYTE (version, envelope
 * version and ciphertext) before and after a whole study session, and the
 * device's unlock hint read out of the same storage `sync-actions.ts` writes
 * it to. Both are things a leak would change.
 *
 * ── The substitutions ────────────────────────────────────────────────────
 *
 *  - Argon2id runs in-process with tiny parameters, through the `deriveHash`
 *    and `params` seams the console exposes for exactly this.
 *  - THE DEVICE STORE IS REAL — `fake-indexeddb` behind the production
 *    `getPrimaryStore()` singleton. The contributor half of the rotation test
 *    reaches it through `research-actions.ts`, and substituting it would
 *    substitute the wiring under test. See {@link openTheDeviceStore} for the
 *    autoLoad poll that otherwise holds `node --test` open forever.
 *  - Nothing about the console itself is substituted: no transport double, no
 *    fake vault, no injected compartment. The one wrapper here is
 *    {@link interposingFetch}, and it does not answer a single request — it
 *    lets a competing device write first and then forwards the real one, which
 *    is the only way to get a CAS conflict at a moment of this test's choosing.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import {
  closeStudyConsole,
  createStudyAccount,
  generateStudyKey,
  loadStudyIdentity,
  pullCohort,
  signInToStudy,
} from '../../app/lib/sync/research/study-session';
import { createSyncAccount, markSyncPending, syncNow } from '../../app/lib/sync/sync-actions';
import { enrolInStudyAction, submitContributionAction } from '../../app/lib/sync/research-actions';
import { getSyncVault, readAccountHint, type SyncVault } from '../../app/lib/sync/sync-session';
import { deviceStorage } from '../../app/lib/sync/sync-state';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import { WrongCompartmentKindError } from '../../app/lib/sync/compartment-kind';
import { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { SyncHttpClient } from '../../app/lib/sync/engine/client/http-client';
import { deriveCredentialsFromPassphrase } from '../../app/lib/sync/engine/client/derive-credentials';
import { unwrapDek } from '../../app/lib/sync/engine/crypto/dek-wrap';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { base64ToBytes, bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { shareFingerprintDisplay, shareKeyFingerprint } from '../../app/lib/sync/engine/crypto/share-wrap';
import { SYNC_API_PREFIX } from '../../app/lib/sync/engine/protocol';
import { pullStudyBlob, pushStudyBlob } from '../../app/lib/sync/research/study-blob';
import { openStudyRegion, sealStudyRegion } from '../../app/lib/sync/research/study-compartment';
import { establishPrivateStore } from '../../app/lib/sync/engine/crypto/private-store';
import {
  EMPTY_STUDY_PRIVATE_REGION,
  generateStudyKeyGeneration,
  withNewStudyKeyGeneration,
  type StudyPrivateRegion,
} from '../../app/lib/sync/research/study-keyring';
import { deleteLocalFoodLog, listLocalStudyEnrolments, putLocalFoodLog } from '../../app/lib/local-store';
import { shareableSnapshotSchema } from '../../app/lib/local-store/backup';
import type { LocalFoodLog } from '../../app/lib/local-store';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
/** Tiny parameters, injected at the seam `setup-keys.ts` exposes for exactly this. */
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

const PASSPHRASE = 'seventeen purple lanterns drifting';

/**
 * A day's energy total that only the study's own key can reveal.
 *
 * The rotation test needs the OLD contribution's content back, not merely a
 * row count: a cohort that opened a body and then lost its days would satisfy
 * `unopenableCount === 0` and still be the defect.
 */
const ROTATION_MARKER = 717_171;

/**
 * One window per test, and they do not overlap.
 *
 * The device store is a real, PROCESS-WIDE singleton, so a diary entry one
 * test logs is in every later test's snapshot — `research-actions.test.ts`
 * learned that the hard way, and this file shares the store with it only in
 * the sense that both open the same singleton in their own process.
 */
const WINDOWS = {
  rotation: { from: '2026-09-01', to: '2026-09-03' },
  isolation: { from: '2026-09-11', to: '2026-09-13' },
  refusal: { from: '2026-09-21', to: '2026-09-23' },
} as const;

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  await openTheDeviceStore();
});

after(async () => {
  await service.close();
});

/**
 * The console's vault is a MODULE SINGLETON, so a session left open is a
 * session the next test inherits — including its account, its DEK and the
 * keyring it last read. Closing after every case makes each test say what it
 * signed in as.
 */
afterEach(() => {
  closeStudyConsole();
});

/**
 * Opens the REAL device store once, without letting its autoLoad poll hold the
 * test process open. Copied deliberately from `research-actions.test.ts`: the
 * reasoning is that file's, and the two must not drift.
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
    await listLocalStudyEnrolments();
  } finally {
    globalThis.setInterval = scheduleInterval;
  }
}

/** Makes each generated address unique within one run, since the whole file shares a service. */
let accountCounter = 0;

function freshEmail(label: string): string {
  return `${label}-${Date.now()}-${accountCounter++}@example.test`;
}

/** What is needed to read a study account's compartment back from the outside. Carries no key material — a passphrase this file chose, and an id. */
interface StudyAccountUnderTest {
  email: string;
  accountId: number;
}

/** Creates a study account through the real console and reports what it opened. */
async function createStudy(label: string, fetchImpl?: typeof fetch): Promise<StudyAccountUnderTest> {
  const email = freshEmail(label);
  const created = await createStudyAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
    fetchImpl,
  });
  assert.equal(created.status, 'ready', 'the fake service does not require email verification');
  const identity = await loadStudyIdentity();
  assert.equal(identity.generationCount, 0, 'a study that has minted nothing holds no generations');
  return { email, accountId: identity.accountId };
}

/** Signs the console into an existing study account, asserting the sign-in itself passed. */
async function signIn(email: string): Promise<void> {
  const result = await signInToStudy({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
  });
  assert.equal(result.status, 'connected', 'this account already completed setup, so nothing is being repaired here');
}

/**
 * THE OBSERVATION POINT OF THIS FILE: a study account read from the outside.
 *
 * An INDEPENDENT reader — its own auth client, its own derived KEKs, its own
 * unwrapped DEK — so that nothing it reports comes from the console's memory.
 * The console keeps its region in the vault and returns only a count and a
 * fingerprint; a test that trusted those would be green with the push deleted,
 * which is the whole defect this file exists to catch.
 */
async function readStudyAccountFromOutside(account: StudyAccountUnderTest) {
  const authClient = new SyncAuthClient({ baseUrl: service.url });
  const wire = await authClient.fetchKdfDescriptor(account.email);
  const { authHash, passphraseKek, privateStoreKek } = await deriveCredentialsFromPassphrase({
    passphrase: PASSPHRASE,
    descriptor: { salt: wire.salt, params: wire.params },
    deriveHash: fastDeriver,
  });
  await authClient.login({ email: account.email, authHash });
  const http = new SyncHttpClient({ baseUrl: service.url, tokens: authClient });

  const passphraseRecord = (await http.listKeyRecords()).find((record) => record.kind === 'passphrase');
  assert.ok(passphraseRecord !== undefined, 'the study account must hold a passphrase key record');
  const dek = await unwrapDek({ wrappedDek: passphraseRecord.wrappedDek, kek: passphraseKek });
  return { http, dek, privateStoreKek };
}

/** The study's keyring as the service holds it, opened through the reader above. */
async function keyringOnTheService(account: StudyAccountUnderTest): Promise<StudyPrivateRegion> {
  const { http, dek, privateStoreKek } = await readStudyAccountFromOutside(account);

  const pulled = await pullStudyBlob({ transport: http, accountId: account.accountId, dek });
  const region = await openStudyRegion({
    session: {
      accountId: account.accountId,
      passphraseKek: privateStoreKek,
      cdk: null,
      wraps: null,
      extras: {},
      pulled: null,
    },
    sealed: pulled.sealed,
  });
  assert.ok(region !== null, 'the blob the service holds for this study carries no readable compartment');
  return region;
}

/**
 * The DIARY REGION of the study account's own blob, as the service holds it.
 *
 * The study account's shareable region must be empty — reason 1 of the
 * console's header, and the leak with the worst blast radius: a researcher
 * signing into her study account in the browser profile that holds her diary
 * would otherwise publish that diary under a fingerprint printed in a consent
 * document.
 */
async function studySnapshotOnTheService(account: StudyAccountUnderTest) {
  const { http, dek } = await readStudyAccountFromOutside(account);
  const pulled = await http.pullBlob();
  assert.ok(pulled !== null, 'the study account must have pushed a blob for there to be anything to inspect');
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: account.accountId,
    dek,
  });
  // Parsed with the store's own shareable-region schema rather than asserted
  // into shape: `SyncPayload.snapshot` is `unknown` because the wire is
  // untrusted, and this reader is on the untrusted side of it like any other.
  return shareableSnapshotSchema.parse(decrypted.payload.snapshot);
}

/** Every generation's fingerprint, in the printed form the console reports, oldest first. */
async function fingerprintsOf(region: StudyPrivateRegion): Promise<string[]> {
  const fingerprints: string[] = [];
  for (const generation of region.studyKeyring) {
    fingerprints.push(shareFingerprintDisplay(await shareKeyFingerprint(base64ToBytes(generation.publicKey))));
  }
  return fingerprints;
}

/**
 * A competing write, performed at the instant of this file's choosing.
 *
 * The wrapper answers nothing itself: when armed, it runs the competing write
 * FIRST and then forwards the request it was given, so the console's push
 * arrives at a version the service has already moved past. That is a genuine
 * CAS conflict — the same one two researchers minting from two laptops
 * produce — and there is no other way to schedule it from outside.
 */
let interpose: (() => Promise<void>) | null = null;

const interposingFetch: typeof fetch = async (input, init) => {
  // Both sync clients call their `fetchImpl` with a string URL, so this is a
  // string in every call this file makes.
  const url = String(input);
  if (init?.method === 'POST' && url.endsWith(`${SYNC_API_PREFIX}/blob`) && interpose !== null) {
    const competing = interpose;
    // One-shot: the competing device's own push travels the default fetch, but
    // disarming here is what keeps a retry from interposing a second time.
    interpose = null;
    await competing();
  }
  return fetch(input, init);
};

/** A diary account and the session it opened, for the isolation assertions. */
interface DiaryUnderTest {
  vault: SyncVault;
  email: string;
}

/**
 * Creates a diary account and gets a blob onto the service for it.
 *
 * The food log is what makes the push real: a blob is the thing the isolation
 * assertions compare byte for byte, and an account with none has nothing to
 * leave untouched.
 */
async function createDiaryWithABlob(label: string, dayKey: string): Promise<DiaryUnderTest> {
  const email = freshEmail(label);
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open diary session');

  await putLocalFoodLog(foodLog(`${label}-log`, dayKey, 'Lentil soup', 430));
  markSyncPending();
  await syncNow();
  return { vault, email };
}

/** The diary account's blob exactly as the service holds it: the version, the envelope version and the ciphertext. */
async function diaryBlobOnTheService(diary: DiaryUnderTest) {
  const pulled = await diary.vault.http.pullBlob();
  assert.ok(pulled !== null, 'the diary account must have a blob, or "unchanged" is a statement about nothing');
  return {
    blobVersion: pulled.blobVersion,
    envelopeVersion: pulled.envelopeVersion,
    ciphertext: bytesToBase64(pulled.ciphertext),
  };
}

/** A complete diary entry for one day. */
function foodLog(id: string, dayKey: string, name: string, kcal: number): LocalFoodLog {
  return {
    id,
    name,
    quantityGrams: 100,
    macros: { carbs: 10, fiber: 2, sugars: 3, polyols: null, protein: 5, fat: 4, kcal },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey,
    loggedAt: 1_770_000_000_000,
    createdAt: 1_770_000_000_000,
    logBatchId: null,
  };
}

test('a mint that loses the CAS re-reads the server: both generations survive a competing write', async () => {
  const study = await createStudy('cas-study', interposingFetch);

  // Generation one. The compartment does not exist until this push, so it is
  // also what lets a SECOND console open the account at all.
  const first = await generateStudyKey();
  assert.equal(first.generationCount, 1);

  // The competing device: a second console, signed into the same study, that
  // mints and pushes while this console's own push is in flight. Its clients
  // travel the default fetch, so it cannot interpose on itself.
  let competingFingerprint: string | null = null;
  interpose = async () => {
    await signIn(study.email);
    competingFingerprint = (await generateStudyKey()).fingerprint;
  };

  const third = await generateStudyKey();
  assert.equal(interpose, null, 'the competing write must actually have happened, or this test proves nothing');

  // THE ASSERTION THIS TEST WAS WRITTEN FOR, and it is deliberately not "the
  // push succeeded": a mint that re-appended onto its own stale region would
  // succeed too, and would have dropped the generation the other device made.
  // Three generations, in mint order, read back off the service.
  assert.deepEqual(
    await fingerprintsOf(await keyringOnTheService(study)),
    [first.fingerprint, competingFingerprint, third.fingerprint],
    'the retry must re-append onto what the server holds now, so both devices’ generations survive',
  );
  assert.equal(third.generationCount, 3, 'the console must report the keyring it actually stored');
});

test('a contribution sealed to an old generation still opens after a rotation', async () => {
  const study = await createStudy('rotation-study');
  const minted = await generateStudyKey();

  // The consent document a contributor is handed today: the newest generation's
  // public key, taken off the service rather than out of the console's memory.
  const published = (await keyringOnTheService(study)).studyKeyring.at(-1);
  assert.ok(published !== undefined, 'the study must have published a generation to enrol against');
  const publishedPublicKey = base64ToBytes(published.publicKey);

  const window = WINDOWS.rotation;
  await createSyncAccount({
    serverUrl: service.url,
    email: freshEmail('rotation-contributor'),
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  await putLocalFoodLog(foodLog('rotation-log', window.from, 'Roast chicken', ROTATION_MARKER));

  const enrolled = await enrolInStudyAction({
    studyAccountId: study.accountId,
    publicKeyBase64: published.publicKey,
    typedFingerprint: await shareKeyFingerprint(publishedPublicKey),
    label: 'Rotation trial',
  });
  assert.equal(enrolled.status, 'enrolled', 'the fingerprint typed here is the published key’s own');
  const submitted = await submitContributionAction({
    studyAccountId: study.accountId,
    fromDayKey: window.from,
    toDayKey: window.to,
  });
  assert.equal(submitted.status, 'submitted');

  // THE ROTATION. Generation two is what the study prints from now on; nothing
  // that was sealed to generation one is re-sealed, and nothing can be.
  const rotated = await generateStudyKey();
  assert.equal(rotated.generationCount, 2);
  assert.notEqual(rotated.fingerprint, minted.fingerprint, 'a rotation must produce a different key');

  const cohort = await pullCohort();
  assert.equal(cohort.status, 'available', 'this deployment has a research lane');
  const value = cohort.status === 'available' ? cohort.value : null;
  assert.ok(value !== null);

  // BOTH HALVES, because either alone passes on a broken console: a cohort of
  // nothing has an `unopenableCount` of zero, and a count of zero says nothing
  // about whether the days came back.
  assert.equal(
    value.unopenableCount,
    0,
    'the cohort read must pass every generation, or a rotated study reports its back catalogue as unreadable',
  );
  assert.equal(value.rows.length, 1, 'the contribution submitted above must be in the cohort');
  assert.deepEqual(
    value.rows[0]?.days.map((day) => day.energyKcal),
    [ROTATION_MARKER, 0, 0],
    'the old generation’s contribution must come back with its content, not merely be counted',
  );

  // This day's log would otherwise ride along in every later test's snapshot.
  await deleteLocalFoodLog('rotation-log');
});

test("a whole study session leaves the diary account's blob untouched", async () => {
  const diary = await createDiaryWithABlob('isolation-diary', WINDOWS.isolation.from);
  const blobBefore = await diaryBlobOnTheService(diary);
  assert.equal(
    readAccountHint(deviceStorage()),
    diary.email,
    'the diary sign-in must have written the hint, or the assertion below is about an empty field',
  );

  // A WHOLE SESSION, not a sign-in: create the account, mint, read the identity
  // back, pull a cohort, and close. Every verb the console has.
  const study = await createStudy('isolation-study', undefined);
  await generateStudyKey();
  const identity = await loadStudyIdentity();
  assert.equal(identity.generationCount, 1);
  assert.equal((await pullCohort()).status, 'available');
  closeStudyConsole();

  // REASON 1, and the direction the byte comparison below cannot see: what the
  // study account itself now holds. This device's store has a diary entry in
  // it — the log pushed above — so an empty shareable region here is a
  // statement, not an accident of an empty fixture.
  const localSnapshot = await readLocalSnapshot();
  assert.ok(
    localSnapshot.foodLogs.length > 0,
    'this device must actually hold a diary, or "the study blob carries none" proves nothing',
  );
  const studySnapshot = await studySnapshotOnTheService(study);
  assert.deepEqual(
    {
      foods: studySnapshot.foods,
      foodLogs: studySnapshot.foodLogs,
      weightEntries: studySnapshot.weightEntries,
      profile: studySnapshot.profile,
      fasts: studySnapshot.fasts,
      savedMeals: studySnapshot.savedMeals,
    },
    { foods: [], foodLogs: [], weightEntries: [], profile: null, fasts: [], savedMeals: [] },
    'a study account’s blob must carry an empty diary, whatever the device it was pushed from holds',
  );

  // REASON 2, the other direction: the study's compartment never reached the
  // diary's vault, and no study push landed on the diary account. A byte-level
  // comparison, because a rewrite that happened to reproduce the same content
  // would still be a study session writing to a diary account.
  assert.deepEqual(
    await diaryBlobOnTheService(diary),
    blobBefore,
    'a study session must not touch the diary account’s blob at all — not its version, not one byte of it',
  );

  // Reason 3: the study's address must not be sitting in the unlock field of a
  // shared laptop.
  const hint = readAccountHint(deviceStorage());
  assert.equal(hint, diary.email, 'the unlock hint must still name the diary account');
  assert.notEqual(hint, study.email, 'no study address may be written to the device’s unlock hint');

  await deleteLocalFoodLog('isolation-diary-log');
});

test('the study console refuses a diary account, and writes nothing to it', async () => {
  const diary = await createDiaryWithABlob('refused-diary', WINDOWS.refusal.from);
  const blobBefore = await diaryBlobOnTheService(diary);

  // `/study` is an open route and a researcher's own diary address signs in
  // there perfectly well — the address and the passphrase are hers. So the
  // sign-in SUCCEEDS, and the refusal has to come from the compartment.
  await signIn(diary.email);

  const refusal = await loadStudyIdentity().then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(refusal instanceof WrongCompartmentKindError, 'a diary compartment must be refused, not read as empty');
  assert.deepEqual({ expected: refusal.expected, actual: refusal.actual }, { expected: 'study', actual: 'diary' });
  assert.match(refusal.message, /not a study account/, 'the message must name the mismatch it found');
  assert.match(refusal.message, /diary/, 'the message must name what the account actually is');

  // AND THE MINT REFUSES TOO, which is the half that has something to lose.
  // Before the compartment carried its kind, this call opened the diary's
  // compartment as an empty study region and pushed a keyring over the
  // account's share private key, its pseudonym root and every study it had
  // joined. The refusal is worthless if it fires after that write.
  const mintRefusal = await generateStudyKey().then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(mintRefusal instanceof WrongCompartmentKindError, 'a mint onto a diary compartment must be refused too');

  assert.deepEqual(
    await diaryBlobOnTheService(diary),
    blobBefore,
    'the refusal must land before any write — the diary’s blob must be byte-identical',
  );

  await deleteLocalFoodLog('refused-diary-log');
});

/**
 * "NO KEYS YET" AND "I CANNOT READ YOUR KEYS" ARE THE SAME SCREEN (M164/07).
 *
 * `loadStudyIdentity` does `open.region = (await openStudyRegion(...)) ??
 * open.region`, and after `signInToStudy` that fallback is
 * `EMPTY_STUDY_PRIVATE_REGION`. So a compartment this console could not open
 * came back as `generationCount: 0, fingerprint: null` — which is exactly what
 * a study that has minted nothing shows, and that one is a normal thing a
 * researcher sees on her first visit.
 *
 * The consequence is not cosmetic. The next thing she does on that screen is
 * mint a generation onto a keyring she cannot read, and `pullCohort` reports
 * every contribution in the study as un-openable — a statement about the
 * contributors, when the truth is a statement about this console.
 *
 * ── The fixture is a REAL compartment under a passphrase this console has
 * never held ────────────────────────────────────────────────────────────
 *
 * Which is the ordinary state: a second researcher's laptop signing in after
 * the study's passphrase was changed on the first one. It is planted through
 * the production seal and the production push, over HTTP, so the console pulls
 * bytes no test wrote by hand.
 */
async function plantAnUnopenableCompartment(account: StudyAccountUnderTest): Promise<StudyPrivateRegion> {
  const { http, dek } = await readStudyAccountFromOutside(account);
  const strangerKek = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(29), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const established = await establishPrivateStore({ passphraseKek: strangerKek, recoveryKek: strangerKek });
  const region = withNewStudyKeyGeneration({
    region: EMPTY_STUDY_PRIVATE_REGION,
    generation: await generateStudyKeyGeneration(),
  });
  const sealed = await sealStudyRegion({
    session: {
      accountId: account.accountId,
      passphraseKek: strangerKek,
      cdk: established.cdk,
      wraps: { cdkWrapPassphrase: established.cdkWrapPassphrase, cdkWrapRecovery: established.cdkWrapRecovery },
      extras: {},
      pulled: null,
    },
    region,
  });
  assert.ok(sealed !== null, 'the planted compartment must be real, or nothing below is a statement');

  await pushStudyBlob({
    transport: http,
    accountId: account.accountId,
    dek,
    deviceId: 'the-laptop-that-changed-the-passphrase',
    pulled: await pullStudyBlob({ transport: http, accountId: account.accountId, dek }),
    reseal: async () => sealed,
  });
  return region;
}

test('the console reports a compartment it could not open, never an empty keyring', async () => {
  const study = await createStudy('unopened-study');
  const planted = await plantAnUnopenableCompartment(study);

  // A FRESH SIGN-IN, which is the whole point: the console that created the
  // account still holds its own CDK, and a session that holds one is not the
  // situation. This one derives `K_pp` from the study's passphrase, and slot 1
  // of the planted compartment belongs to another.
  closeStudyConsole();
  await signIn(study.email);

  const identity = await loadStudyIdentity();

  // THE ASSERTION THIS TEST WAS WRITTEN FOR. The count and the fingerprint are
  // deliberately asserted BESIDE it: they are the two fields that make the
  // state indistinguishable from a fresh study, so the flag has to be what
  // separates them rather than a difference in either of those.
  assert.equal(identity.hasUnopenedCompartment, true, 'a compartment this console could not open must be reported');
  assert.equal(identity.generationCount, 0, 'the empty keyring is exactly what makes this state look ordinary');
  assert.equal(identity.fingerprint, null);

  // AND THE COHORT READ REFUSES rather than blaming the contributors. Handing
  // `study.ts` an empty keyring reports every row as `unopenableCount`.
  const cohortFailure = await pullCohort().then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(cohortFailure instanceof Error, 'a console with no readable keyring must not report a cohort at all');
  assert.match(cohortFailure.message, /could not open/i, 'the refusal must name the console, not the contributions');

  // NON-VACUITY 1: the compartment on the service is REAL and READABLE — by
  // the passphrase it was sealed under. This console's `0` is a reading
  // failure, not an empty account.
  const { http, dek } = await readStudyAccountFromOutside(study);
  const onTheService = await pullStudyBlob({ transport: http, accountId: study.accountId, dek });
  assert.ok(onTheService.sealed !== null, 'the planted compartment must still be on the blob');
  assert.equal(planted.studyKeyring.length, 1, 'the plant must have carried a generation');

  // NON-VACUITY 2: the same call on a console that CAN open its compartment
  // answers `false`. Without this the flag could be hard-wired.
  closeStudyConsole();
  const readable = await createStudy('opened-study');
  await generateStudyKey();
  const healthy = await loadStudyIdentity();
  assert.equal(healthy.hasUnopenedCompartment, false, 'a console that opened its compartment must not report this');
  assert.equal(healthy.generationCount, 1);
  assert.equal((await pullCohort()).status, 'available', 'and its cohort read must go through');
  assert.equal(readable.accountId > 0, true);
});

/**
 * A GENERATION THE SERVER REJECTED IS NOT THIS STUDY'S KEY (M164/07).
 *
 * `generateStudyKey` committed `open.region` inside `reseal`, which runs once
 * per CAS round and is followed by a request that can fail for reasons that
 * have nothing to do with the keyring. After a failed push the console was
 * left holding — and REPORTING — a generation the study account does not have:
 * a fingerprint no contributor could ever seal to, printed into a consent
 * document that afternoon.
 *
 * ── Why the fingerprint is read back through a SECOND call ──────────────
 *
 * `generateStudyKey` throws here, so its return value is unreachable and
 * cannot be the observation. The phantom lives in the vault, and
 * `loadStudyIdentity` is what a researcher's screen shows next — a pull that
 * carries no compartment leaves `open.region` alone, so whatever the failed
 * mint put there is what she reads.
 */
test('a failed push leaves no phantom generation in the console’s vault', async () => {
  let refusePush = false;
  const refusingFetch: typeof fetch = async (input, init) => {
    // Both sync clients call their `fetchImpl` with a string URL.
    if (refusePush && init?.method === 'POST' && String(input).endsWith(`${SYNC_API_PREFIX}/blob`)) {
      // What a dropped connection looks like to `fetch` — the ordinary
      // failure, and the one that arrives AFTER the seal has been computed.
      throw new TypeError('fetch failed');
    }
    return fetch(input, init);
  };

  const study = await createStudy('phantom-study', refusingFetch);
  refusePush = true;
  const failure = await generateStudyKey().then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(failure instanceof Error, 'the push must actually have failed, or this test proves nothing');
  refusePush = false;

  // THE ASSERTION THIS TEST WAS WRITTEN FOR: the screen after the failure.
  const afterFailure = await loadStudyIdentity();
  assert.equal(afterFailure.generationCount, 0, 'a generation the server rejected must not be in the vault');
  assert.equal(afterFailure.fingerprint, null, 'and no fingerprint of it may be reported to be printed');

  // And the service agrees, which is what makes the two consistent rather than
  // merely both empty.
  const { http, dek } = await readStudyAccountFromOutside(study);
  const onTheService = await pullStudyBlob({ transport: http, accountId: study.accountId, dek });
  assert.equal(onTheService.sealed, null, 'the refused push must have written no compartment');

  // NON-VACUITY: the SAME console mints successfully the moment the push is
  // allowed through, so the zero above is about the failed push and not about
  // a console left broken by it.
  const minted = await generateStudyKey();
  assert.equal(minted.generationCount, 1);
  assert.ok(minted.fingerprint !== null);
  assert.equal((await keyringOnTheService(study)).studyKeyring.length, 1, 'and the service holds that one generation');
});
