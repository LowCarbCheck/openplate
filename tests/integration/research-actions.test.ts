/**
 * The research lane's COMPOSITION ROOT, driven end to end over real HTTP
 * against the protocol-faithful fake (`fake-sync-service.ts`).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `app/lib/sync/research-actions.ts` is where the pure modules are wired to a
 * session, a device store and a transport. Every rule those modules enforce is
 * asserted in `tests/unit`, without a session — but the WIRING was untested,
 * and the gap had a measured shape: deleting `markSyncPending()` + `syncNow()`
 * from the `submitted` branch of `submitContributionAction` left the whole
 * unit suite green (M163/02's fifth injection, 2251 pass / 0 fail).
 *
 * What that deletion costs is not theoretical. The study pin and the window it
 * was last sent live in the OWNER-PRIVATE COMPARTMENT, which travels inside
 * the blob. A submission whose sync never runs is a window the account's other
 * devices do not have, and they will go on offering to send days that have
 * already gone.
 *
 * So every assertion below is about the OUTCOME, never the call. Nothing here
 * spies on `markSyncPending`: a spy is green when the sync is invoked and
 * broken. What is asserted instead is the compartment that ACTUALLY REACHED
 * THE SERVICE — pulled back out of the blob and opened with the session's own
 * compartment key. The discriminating question is "would this fail if the sync
 * were dropped?", and the answer was obtained by dropping it.
 *
 * ── The substitutions, and there are four ────────────────────────────────
 *
 * `sync-e2ee-roundtrip.test.ts` makes three, at documented seams; this file
 * inherits two of them and adds one, because the actions under test reach the
 * device store through its module singleton rather than through an injectable:
 *
 *  - Argon2id runs in-process with tiny parameters (`deriveHash`/`params`).
 *  - The reset "email" is not needed here at all.
 *  - THE DEVICE STORE IS REAL — `fake-indexeddb` behind the production
 *    `getPrimaryStore()` singleton, not a plain object. It has to be: these
 *    actions call `putLocalStudyEnrolment` and friends directly, and
 *    substituting them would substitute the very wiring under test.
 *  - {@link openTheDeviceStore} therefore also unrefs the store's autoLoad
 *    poll. See its own comment: a real interval is the correct production
 *    behaviour and would otherwise hold `node --test` open forever.
 *
 * ── The zero-knowledge assertion is STRONGER here than for the diary ─────
 *
 * A blob is sealed to a key the service does not hold. A contribution is
 * sealed to a STUDY key the service cannot hold — ADR-0003 prohibition 10 —
 * and it additionally leaves again through a second account's reads. So the
 * marker planted in a contribution's plaintext is searched across three
 * surfaces, not two: everything the service saw, everything it stores, and the
 * cohort document it SERVED. (`fake-sync-service.ts` records responses as well
 * as requests for that third one; a read-side leak is invisible in a log of
 * what the service was sent.)
 *
 * TWO WAYS THAT SEARCH CAN PASS WHILE LEAKING, both found by injection here
 * and both closed:
 *
 *  - Everything on this wire travels BASE64, so plaintext sent by mistake is
 *    not readable in the JSON transcript. Removing the seal entirely left a
 *    raw substring search green. Hence {@link base64DecodedView}.
 *  - The client decodes a cohort body to `Uint8Array`, which `JSON.stringify`
 *    renders as an object of decimal byte values — unsearchable. Hence the
 *    study read is taken off the harness as served, not as parsed.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount } from '../../app/lib/sync/sync-actions';
import {
  enrolInStudyAction,
  submitContributionAction,
  withdrawFromStudyAction,
} from '../../app/lib/sync/research-actions';
import { getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { openOwnerPrivateRegion } from '../../app/lib/sync/private-store';
import { readSealedPrivateStore, type OwnerPrivateRegion } from '../../app/lib/sync/snapshot-partition';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { SYNC_API_PREFIX } from '../../app/lib/sync/engine/protocol';
import { generateShareKeyPair, shareKeyFingerprint } from '../../app/lib/sync/engine/crypto/share-wrap';
import { openCohortContribution, type StudyKeyPair } from '../../app/lib/sync/research/study';
import { DAILY_INTAKE_V1 } from '../../app/lib/sync/research/tiers';
import { deleteLocalFoodLog, listLocalStudyEnrolments, putLocalFoodLog } from '../../app/lib/local-store';
import type { LocalFoodLog } from '../../app/lib/local-store';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
/** Tiny parameters, injected at the seam `setup-keys.ts` exposes for exactly this. */
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

const PASSPHRASE = 'seventeen purple lanterns drifting';

/**
 * A value that reaches a contribution's plaintext and could reach the service
 * only if the seal failed.
 *
 * A NUMBER, not a string, because `daily-intake:v1` has no string field — the
 * tier is seven numbers per calendar day, which is the whole point of it. It
 * is twelve digits so that finding it by chance inside a few kilobytes of
 * base64 is not a coin flip: base64's alphabet is a quarter digits, and a
 * six-digit marker would collide roughly every other run.
 */
const CONTRIBUTION_MARKER = 424_242_424_242;
/** The diary half of the same idea: a string that reaches the blob's plaintext and nothing else. */
const DIARY_MARKER = 'ZERO-KNOWLEDGE-CANARY-4b81de07-should-never-reach-the-server';

/**
 * One window per test, and they do not overlap.
 *
 * The device store is a real, PROCESS-WIDE singleton — that is the point of
 * this file — so a diary entry one test logs is in every later test's
 * snapshot. Separate days keep each reduction a statement about its own
 * fixture instead of about the order the tests happened to run in.
 */
const WINDOWS = {
  submission: { from: '2026-08-01', to: '2026-08-03' },
  cas: { from: '2026-08-11', to: '2026-08-13' },
  canary: { from: '2026-08-21', to: '2026-08-23' },
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
 * Opens the REAL device store once, without letting its autoLoad poll hold the
 * test process open.
 *
 * `persist.ts` starts a polling `setInterval` so a second tab's write is
 * reconciled into this one — correct production behaviour, and there is no
 * public handle to stop it. Unrefing the timers created while the store opens
 * leaves the poll running and stops it being a reason for node to stay alive,
 * which is exactly the distinction `node --test` needs and the browser does
 * not have.
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

function requireVault(): SyncVault {
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

/** Makes each generated address unique within one run, since the whole file shares a service. */
let accountCounter = 0;

/** Creates an account on the fake service and returns the session it opened. */
async function createAccount(label: string): Promise<SyncVault> {
  await createSyncAccount({
    serverUrl: service.url,
    email: `${label}-${Date.now()}-${accountCounter++}@example.test`,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  return requireVault();
}

/** A study: an account on the service (so contributions have somewhere to point) plus the key pair its consent document publishes. */
interface Study extends StudyKeyPair {
  accountId: number;
  vault: SyncVault;
  /** What the contributor types, from the study's printed consent materials. */
  fingerprint: string;
}

async function createStudy(): Promise<Study> {
  const vault = await createAccount('study');
  const keys = await generateShareKeyPair();
  return {
    accountId: vault.accountId,
    vault,
    publicKeyRaw: keys.publicKeyRaw,
    privateKeyPkcs8: keys.privateKeyPkcs8,
    fingerprint: await shareKeyFingerprint(keys.publicKeyRaw),
  };
}

/** Joins a study through the real action, asserting the ceremony passed. */
async function enrol(study: Study, label: string | null = null): Promise<void> {
  const result = await enrolInStudyAction({
    studyAccountId: study.accountId,
    publicKeyBase64: bytesToBase64(study.publicKeyRaw),
    typedFingerprint: study.fingerprint,
    label,
  });
  assert.equal(result.status, 'enrolled', 'the fingerprint typed in this test is the study key’s own');
}

/**
 * THE OBSERVATION POINT OF THIS FILE: the owner-private compartment as the
 * SERVICE holds it.
 *
 * Pulls the blob back over HTTP, decrypts it with the session's DEK, and opens
 * the compartment nested inside it. Nothing local is consulted — a test that
 * read the device store would pass with the sync deleted, which is the exact
 * defect this file exists to catch.
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
    session: vault.privateStore,
    sealed: readSealedPrivateStore({ snapshot: decrypted.payload.snapshot }),
  });
  assert.ok(region !== null, 'the blob carries no owner-private compartment');
  return region;
}

/** The pin for one study, as the service holds it — or `null` when the compartment on the service has none. */
async function pinnedStudyOnTheService(vault: SyncVault, studyAccountId: number) {
  const region = await compartmentOnTheService(vault);
  return region.studyEnrolments.find((enrolment) => enrolment.studyAccountId === studyAccountId) ?? null;
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

/**
 * One serialized surface with every base64-looking run DECODED.
 *
 * The search would otherwise have a hole exactly where this lane's payloads
 * live: a contribution's `body` and a blob's `ciphertext` both travel as
 * base64, so plaintext shipped by mistake is unreadable in the JSON text and a
 * substring search over it passes. Decoding costs nothing here and turns "the
 * marker is not in the transcript" into "the marker is not in the BYTES".
 */
function base64DecodedView(serialized: string): string {
  return [...serialized.matchAll(/[\d+/A-Za-z]{16,}={0,2}/g)]
    .map((match) => Buffer.from(match[0], 'base64').toString('utf8'))
    .join('\n');
}

test('a submitted window reaches the other devices', async () => {
  const study = await createStudy();
  const contributor = await createAccount('contributor');
  const window = WINDOWS.submission;
  await putLocalFoodLog(foodLog('submit-log', window.from, 'Roast chicken', 640));

  await enrol(study, 'Sleep trial');
  const afterEnrolment = await pinnedStudyOnTheService(contributor, study.accountId);
  assert.ok(afterEnrolment !== null, 'the enrolment ceremony’s own sync must carry the pin to the service');
  assert.equal(afterEnrolment.lastSubmission, null, 'nothing has been sent yet, and the pin must not claim otherwise');

  const result = await submitContributionAction({
    studyAccountId: study.accountId,
    fromDayKey: window.from,
    toDayKey: window.to,
  });
  assert.equal(result.status, 'submitted');

  // THE ASSERTION THIS FILE WAS WRITTEN FOR. The window is recorded on the pin
  // in the owner-private compartment; if the submission's sync is dropped, the
  // compartment the service holds still says `null` here and the account's
  // other devices will offer to send these days again.
  const afterSubmission = await pinnedStudyOnTheService(contributor, study.accountId);
  assert.ok(afterSubmission !== null, 'the pin must survive a submission');
  assert.deepEqual(
    { from: afterSubmission.lastSubmission?.fromDayKey, to: afterSubmission.lastSubmission?.toDayKey },
    { from: window.from, to: window.to },
    'the window that was sent must reach the service inside the compartment',
  );
});

test('a withdrawal reaches the other devices', async () => {
  const study = await createStudy();
  const contributor = await createAccount('withdrawer');

  await enrol(study);
  assert.ok(
    (await pinnedStudyOnTheService(contributor, study.accountId)) !== null,
    'the pin must be on the service before a withdrawal can be shown to remove it',
  );

  const result = await withdrawFromStudyAction(study.accountId);
  assert.equal(result.status, 'withdrawn');

  // Same shape as the submission's, one verb over: a pin dropped only on this
  // device is a study the account's other devices still believe they are in.
  assert.equal(
    await pinnedStudyOnTheService(contributor, study.accountId),
    null,
    'the dropped pin must reach the service, not just this device',
  );
});

test('contribution CAS: a second submission is accepted, and a stale version is refused', async () => {
  const study = await createStudy();
  const contributor = await createAccount('cas');
  const window = WINDOWS.cas;
  await putLocalFoodLog(foodLog('cas-log', window.from, 'Bean stew', 520));
  await enrol(study);

  const first = await submitContributionAction({
    studyAccountId: study.accountId,
    fromDayKey: window.from,
    toDayKey: window.to,
  });
  assert.deepEqual(first, { status: 'submitted', pseudonym: pseudonymOf(first), contributionVersion: 1 });

  // The client recomputes the whole projection and re-pushes it, choosing the
  // version from what the service reports — so a second submission is version
  // 2 and is ACCEPTED, not a conflict.
  const second = await submitContributionAction({
    studyAccountId: study.accountId,
    fromDayKey: window.from,
    toDayKey: window.to,
  });
  assert.equal(second.status, 'submitted');
  assert.equal(second.status === 'submitted' ? second.contributionVersion : null, 2);

  // §5.18's rule is STRICTLY GREATER. A body sealed under a version the
  // service already holds is a rollback attempt, and re-sending the current
  // one is the cheapest form of it.
  const body = new Uint8Array(65 + 12 + 16).fill(7);
  const pseudonym = pseudonymOf(second);
  for (const contributionVersion of [1, 2]) {
    const refused = await contributor.http.putContribution({
      studyAccountId: study.accountId,
      pseudonym,
      schemaTier: DAILY_INTAKE_V1,
      body,
      contributionVersion,
    });
    assert.deepEqual(
      refused,
      { status: 'conflict', currentVersion: 2 },
      `version ${contributionVersion} is not strictly greater than the stored 2 and must be refused`,
    );
  }

  // And the refusals really did leave the accepted row alone.
  const enrolments = await contributor.http.listMyContributions();
  assert.equal(enrolments.status, 'available');
  assert.deepEqual(
    enrolments.status === 'available' ?
      enrolments.value.map((row) => [row.studyAccountId, row.contributionVersion])
    : null,
    [[study.accountId, 2]],
  );
});

/** The pseudonym a submission reported. Narrows the union in one place so the assertions above read as assertions. */
function pseudonymOf(result: Awaited<ReturnType<typeof submitContributionAction>>): string {
  assert.equal(result.status, 'submitted');
  return result.status === 'submitted' ? result.pseudonym : '';
}

test("the service never sees a contribution's plaintext", async () => {
  const study = await createStudy();
  // The session this opens is what every action below reaches for; nothing in
  // this test looks at the contributor's OWN blob, only at what the study and
  // the service can see.
  await createAccount('canary');
  // The marker is a day's energy total, which is a field of the tier — so it
  // is genuinely IN the sealed payload rather than beside it.
  const window = WINDOWS.canary;
  await putLocalFoodLog(foodLog('canary-log', window.from, DIARY_MARKER, CONTRIBUTION_MARKER));
  await enrol(study);

  const submitted = await submitContributionAction({
    studyAccountId: study.accountId,
    fromDayKey: window.from,
    toDayKey: window.to,
  });
  assert.equal(submitted.status, 'submitted');

  const page = await study.vault.http.listStudyContributions();
  assert.equal(page.status, 'available');
  const cohort = page.status === 'available' ? page.value : { studyAccountId: 0, contributions: [] };

  // NON-VACUITY FIRST, because every assertion below is an absence and an
  // absence passes trivially against nothing. The marker must actually be in
  // the contribution — opened here with the study's own private key, which is
  // the only key in this test that can do it.
  const row = cohort.contributions.find((contribution) => contribution.pseudonym === pseudonymOf(submitted));
  assert.ok(row !== undefined, 'the study must be able to see that a contribution arrived');
  const opened = await openCohortContribution({
    contribution: row,
    studyAccountId: study.accountId,
    keys: [{ publicKeyRaw: study.publicKeyRaw, privateKeyPkcs8: study.privateKeyPkcs8 }],
  });
  assert.equal(opened.status, 'opened');
  assert.deepEqual(
    opened.status === 'opened' ? opened.rows.map((day) => day.energyKcal) : null,
    [CONTRIBUTION_MARKER, 0, 0],
    'the marker must be in the plaintext, or the searches below prove nothing',
  );

  // THE SEARCH — all three surfaces the service touches. A contribution is
  // sealed to a key this service never holds and cannot hold (ADR-0003
  // prohibition 10), so the marker must be absent from every one of them.
  // The study read is searched AS SERVED — the document the service put on the
  // wire, taken off the harness. Not the client's decoded `StudyContribution`:
  // its `body` is a `Uint8Array`, which stringifies to an object of decimal
  // byte values that no substring search can read, and an unsealed body was
  // invisible in that form when it was injected.
  const studyRead = service.observed.findLast((request) => request.path === `${SYNC_API_PREFIX}/study/contributions`);
  assert.ok(
    studyRead?.response !== undefined,
    'the study-side read must have been served, or there is nothing to search',
  );

  const marker = String(CONTRIBUTION_MARKER);
  const surfaces = {
    'everything the service saw and everything it served': JSON.stringify(service.observed),
    'everything the service stores': service.dump(),
    'the study-side cohort read': JSON.stringify(studyRead.response),
  };
  for (const [surface, serialized] of Object.entries(surfaces)) {
    assert.ok(serialized.length > 0, `${surface} is empty, so searching it proves nothing`);
    // BOTH VIEWS, and the second is not belt-and-braces. Every payload on this
    // wire travels base64, so a marker sent in the clear is invisible to a
    // search of the JSON text — verified by injection: removing the seal
    // entirely left a raw-text search green.
    for (const haystack of [serialized, base64DecodedView(serialized)]) {
      assert.equal(haystack.includes(marker), false, `a contribution's plaintext is readable in ${surface}`);
      assert.equal(haystack.includes(DIARY_MARKER), false, `the diary's plaintext is readable in ${surface}`);
      assert.equal(haystack.includes(PASSPHRASE), false, `the passphrase is readable in ${surface}`);
    }
  }

  // The diary marker would otherwise ride along in every later test's blob.
  await deleteLocalFoodLog('canary-log');
});
