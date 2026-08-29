/**
 * End-to-end sync, over real HTTP, against a protocol-faithful service
 * (`fake-sync-service.ts`).
 *
 * The client code exercised here is the production stack, unmodified:
 * `createSyncAccount` / `signInToSync` / `completeSyncReset` from
 * `sync-actions.ts`, the real `SyncAuthClient` and `SyncHttpClient`, the real
 * envelope and merge engine, and the real orchestrator loop. Only three things
 * are substituted, all of them at documented seams:
 *
 *  - Argon2id runs in-process with tiny parameters (`deriveHash`/`params`).
 *    This is a protocol test, not a KDF benchmark, and 64 MiB × 3 per
 *    derivation would add minutes for no coverage.
 *  - The store snapshot is a plain object rather than IndexedDB
 *    (`readSnapshot`/`applySnapshot`), which `node:test` does not have. What
 *    is under test is the sync algorithm, and `local-store-bridge.ts` is the
 *    only line between the two.
 *  - The reset "email" is read off the harness instead of an inbox.
 *
 * THE ZERO-KNOWLEDGE TEST IS THE POINT OF THIS FILE. "End-to-end encrypted" is
 * usually a claim defended by code review, which is to say defended until
 * someone adds a debug field. Here it is a regression-guarded invariant: a
 * marker string is planted in the plaintext, the whole flow is driven, and the
 * marker is then searched for across every byte the service ever saw or
 * stored.
 *
 * ── THAT SEARCH READS BYTES, NOT TEXT (M163/05) ─────────────────────────
 *
 * A substring search over the JSON transcript is not the same claim, and the
 * gap between the two is where an unencrypted blob would hide. Two ways it
 * passes while leaking, both closed here and both proved by injection:
 *
 *  - EVERYTHING ON THIS WIRE IS BASE64. A blob pushed in the clear is not
 *    readable in the JSON text at all. M163/04 found this on the research
 *    lane by deleting the seal and watching a raw search stay green; the same
 *    hole was latent here. Hence {@link base64DecodedView}.
 *  - THE ENVELOPE IS GZIP-THEN-ENCRYPT (`build-envelope.ts`, `PROTOCOL.md`
 *    §3.2), so a blob that is compressed but NOT encrypted is invisible
 *    twice over: base64 on the outside, DEFLATE on the inside. Neither the
 *    raw nor the base64 view can read it. Hence {@link gunzippedView}, which
 *    is the view that actually fires when `buildEnvelope`'s encryption step
 *    is removed — verified by doing exactly that.
 *
 * So each surface is searched in three views — raw, base64-decoded, and
 * gunzipped — and a view that cannot be built for a surface is skipped with
 * its reason ASSERTED rather than dropped. A silently-skipped view is how a
 * surface becomes decoration; M163/04 found two of those in its own first
 * version.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { constants as zlibConstants, gunzipSync } from 'node:zlib';
// The LAST test in this file drives `syncNow`, which reads the device store —
// see its header. Every other test here mirrors the two seam lines instead and
// never touches it.
import 'fake-indexeddb/auto';
import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import {
  createSyncAccount,
  completeSyncReset,
  markSyncPending,
  regenerateRecoveryCode,
  requestSyncReset,
  signInToSync,
  syncNow,
} from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { classifySignInFailure } from '../../app/lib/sync/sign-in-error';
import {
  closeSyncSession,
  getSyncSessionSnapshot,
  getSyncVault,
  type SyncVault,
} from '../../app/lib/sync/sync-session';
import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import { SCHEMA_VERSION, type LocalStoreSnapshot } from '../../app/lib/local-store';
import { readLocalSnapshot } from '../../app/lib/sync/local-store-bridge';
import {
  EMPTY_OWNER_PRIVATE_REGION,
  type OwnerPrivateRegion,
  type SyncedSnapshot,
} from '../../app/lib/sync/snapshot-partition';
import {
  assertOwnerPrivateCompartment,
  createPrivateStoreSession,
  hasUnopenedCompartment,
  openOwnerPrivateRegion,
  sealOwnerPrivateRegion,
} from '../../app/lib/sync/private-store';
import { establishPrivateStore, openPrivateStore, unwrapCdk } from '../../app/lib/sync/engine/crypto/private-store';
import { derivePrivateStoreRecoveryKek, parseRecoveryCode } from '../../app/lib/sync/engine/client/recovery-kek';
import { base64ToBytes } from '../../app/lib/sync/engine/crypto/base64';
import { openStudyRegion, sealStudyRegion } from '../../app/lib/sync/research/study-compartment';
import { WrongCompartmentKindError } from '../../app/lib/sync/compartment-kind';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
/** Tiny parameters, injected at the seam `setup-keys.ts` exposes for exactly this. */
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

/**
 * A string that could only reach the service if the encryption failed. Chosen
 * to be unmistakable in a haystack — no real payload byte can collide with it.
 */
const PLAINTEXT_MARKER = 'ZERO-KNOWLEDGE-CANARY-7f3a91c4-should-never-reach-the-server';
const PASSPHRASE = 'seventeen purple lanterns drifting';

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
  await openTheDeviceStore();
});

/**
 * Opens the REAL device store once, without letting its autoLoad poll hold the
 * test process open. Copied deliberately from `research-actions.test.ts`: the
 * reasoning is that file's, and the four must not drift.
 *
 * Only the last test in this file needs it — `syncNow` is the one verb here
 * that reads the device store rather than a mirrored seam line.
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
    await readLocalSnapshot();
  } finally {
    globalThis.setInterval = scheduleInterval;
  }
}

after(async () => {
  await service.close();
});

function foodLog(id: string, name: string): LocalStoreSnapshot['foodLogs'][number] {
  return {
    id,
    name,
    quantityGrams: 120,
    macros: { carbs: 4, fiber: 1, sugars: 1, polyols: 0, protein: 20, fat: 6, kcal: 160 },
    mealType: 'lunch',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    dayKey: '2026-08-04',
    loggedAt: 1_770_000_000_000,
    createdAt: 1_770_000_000_000,
    logBatchId: null,
  };
}

function snapshotOf(logs: LocalStoreSnapshot['foodLogs']): SyncedSnapshot {
  // `fasts`/`savedMeals` are required on the snapshot since v7/v11 but are
  // never merged by the sync engine (see `mergeSnapshots`) — an empty array is
  // the whole fixture for both.
  return {
    foods: [],
    foodLogs: logs,
    weightEntries: [],
    profile: null,
    fasts: [],
    savedMeals: [],
    // The owner-private compartment (M160/07); `null` is a device with no
    // share key, which is what every fixture here is.
    privateStore: null,
  };
}

/** Cycle dependencies for one simulated device, sharing the account's vault but keeping its own baseline. */
function deviceDeps({
  vault,
  deviceId,
  local,
  storage = createMemoryStorage(),
}: {
  vault: SyncVault;
  deviceId: string;
  local: { current: SyncedSnapshot };
  storage?: ReturnType<typeof createMemoryStorage>;
}) {
  return {
    accountId: vault.accountId,
    dek: vault.dek,
    http: vault.http,
    state: createSyncStateStore({ storage, accountId: vault.accountId }),
    deviceId,
    readSnapshot: async () => local.current,
    applySnapshot: async ({ merged }: { merged: SyncedSnapshot }) => {
      local.current = merged;
    },
    // These devices carry the snapshot verbatim and hold no compartment session
    // of their own, so there is nothing here for the veto to check against —
    // the two tests that DO hold one override this the way production wires it.
    // Named rather than defaulted, because `SyncCycleDeps` makes it required on
    // purpose (M164/06).
    assertPulledSnapshot: async () => {},
    // The real bridge validates through the backup schema; the substituted
    // snapshot here is already that exact shape.
    // SAFETY: the only snapshot the engine can hand back is the one `readSnapshot`
    // above supplied — `local.current`, which is a `SyncedSnapshot` by construction.
    parseRemoteSnapshot: ({ snapshot }: { snapshot: unknown }) => snapshot as SyncedSnapshot,
  };
}

function requireVault(): SyncVault {
  const vault = getSyncVault();
  assert.ok(vault !== null, 'expected an open sync session');
  return vault;
}

/**
 * Every base64-looking run in a serialized surface, decoded back to BYTES.
 *
 * The payloads this file is about — a blob's `ciphertext`, a wrapped DEK —
 * are base64 string values inside JSON, so each one is a single unbroken run
 * of the base64 alphabet between two quotes. Sixteen characters is long
 * enough that ordinary JSON words (`accountId`, `blobVersion`) are not picked
 * up as candidates.
 */
function base64Runs(serialized: string): Buffer[] {
  return [...serialized.matchAll(/[\d+/A-Za-z]{16,}={0,2}/g)].map((match) => Buffer.from(match[0], 'base64'));
}

/**
 * View 2: every base64 run rendered as text.
 *
 * Without this the search has a hole exactly where the payloads live —
 * a snapshot shipped unencrypted is unreadable in the JSON transcript, and a
 * substring search over that transcript passes. This turns "the marker is not
 * in the text" into "the marker is not in the bytes".
 */
function base64DecodedView(serialized: string): string {
  return base64Runs(serialized)
    .map((bytes) => bytes.toString('utf8'))
    .join('\n');
}

/**
 * Every offset in `bytes` carrying gzip's magic bytes and DEFLATE method.
 *
 * Detection is by FRAMING, never by a field name — a field called
 * `ciphertext` is exactly the field a regression would leave uncompressed
 * inside. Offsets other than zero matter because the envelope's ciphertext
 * field is `iv || body` (`packIvAndCiphertext`): drop only the AES step and
 * the gzip stream starts twelve bytes in, where a header check at offset zero
 * would miss it entirely.
 */
function gzipOffsets(bytes: Buffer): number[] {
  const offsets: number[] = [];
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x1f && bytes[index + 1] === 0x8b && bytes[index + 2] === 0x08) offsets.push(index);
  }
  return offsets;
}

/**
 * View 3: every base64 run that is a gzip stream, inflated.
 *
 * `buildEnvelope` compresses BEFORE it encrypts, so a blob that skipped only
 * the encryption step still arrives gzipped — DEFLATE-encoded binary that
 * neither of the other two views can read. This is the view that catches it.
 *
 * Returns `null` when the view does not exist for this surface, which is the
 * HEALTHY state: the only gzip in this protocol lives inside the AES
 * envelope, so correctly sealed ciphertext never carries the magic bytes. The
 * caller asserts that reason instead of skipping quietly.
 */
function gunzippedView(serialized: string): string | null {
  const inflated: string[] = [];
  for (const bytes of base64Runs(serialized)) {
    for (const offset of gzipOffsets(bytes)) {
      try {
        // `finishFlush` so a stream that runs into trailing frame bytes still
        // yields what it did decode, rather than throwing the whole view away.
        inflated.push(gunzipSync(bytes.subarray(offset), { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString('utf8'));
      } catch {
        // Magic bytes by coincidence, not an actual stream: not this view's.
      }
    }
  }
  return inflated.length === 0 ? null : inflated.join('\n');
}

/** The one permitted reason for a view to be missing. Anything else is a hole, not a skip. */
const NO_GZIP_STREAM = 'no captured run on this surface is a gzip stream';

/** The three views of one surface. `haystack === null` means the view could not be built. */
function decodedViews(serialized: string): { name: string; haystack: string | null; absentBecause: string }[] {
  return [
    { name: 'raw', haystack: serialized, absentBecause: '' },
    { name: 'base64-decoded', haystack: base64DecodedView(serialized), absentBecause: '' },
    { name: 'gunzipped', haystack: gunzippedView(serialized), absentBecause: NO_GZIP_STREAM },
  ];
}

/** Asserts the ordinary (no email verification) signup branch and hands back the recovery code. */
function expectReady(outcome: SyncSetupOutcome): string {
  assert.equal(outcome.status, 'ready', 'expected setup to complete without an email-verification step');
  return outcome.status === 'ready' ? outcome.recoveryCode : '';
}

test("signup → key records → push: the service never sees the diary's plaintext", async () => {
  const email = `canary-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vault = requireVault();

  const local = { current: snapshotOf([foodLog('log-1', PLAINTEXT_MARKER)]) };
  const result = await runSyncCycleUnlocked(deviceDeps({ vault, deviceId: 'device-1', local }));
  assert.equal(result.pushed, true);

  // NON-VACUITY FIRST, because everything below is an absence and an absence
  // passes trivially against nothing. A fresh device pulls the blob back down
  // and the marker comes out of it — so the marker really did travel inside
  // the ciphertext the searches below are about, rather than never having been
  // sent at all.
  const roundTripped = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault, deviceId: 'device-readback', local: roundTripped }));
  // Kept on ONE line deliberately: the spec's checklist greps for this
  // assertion, and prettier would wrap a longer message across three.
  const readBack = roundTripped.current.foodLogs.map((log) => log.name);
  assert.ok(readBack.includes(PLAINTEXT_MARKER), 'the marker must return from the blob, or the searches prove nothing');

  const observedWire = JSON.stringify(service.observed);
  const storedAtRest = service.dump();

  assert.equal(observedWire.includes(PLAINTEXT_MARKER), false, 'the marker reached the service in a request');
  assert.equal(storedAtRest.includes(PLAINTEXT_MARKER), false, 'the marker is readable in what the service stored');
  assert.equal(observedWire.includes(PASSPHRASE), false, 'the passphrase reached the service');
  assert.equal(storedAtRest.includes(PASSPHRASE), false, 'the passphrase is readable in what the service stored');

  // The encryption-branch key material specifically: the DEK is what actually
  // opens the blob, and it must be absent in every encoding it could take.
  const dekBase64 = bytesToBase64(vault.dek);
  const dekHex = [...vault.dek].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  for (const encoding of [dekBase64, dekHex]) {
    assert.equal(observedWire.includes(encoding), false, 'the data-encryption key was sent to the service');
    assert.equal(storedAtRest.includes(encoding), false, 'the data-encryption key is stored on the service');
  }

  // And the service really did receive a blob — otherwise the assertions above
  // would pass trivially on an empty account.
  assert.ok(
    service.observed.some((request) => request.method === 'POST' && request.path.endsWith('/blob')),
    'expected a blob push to have happened',
  );
  assert.ok(storedAtRest.includes('"blobVersion":1'), 'expected the service to be holding a blob');

  // THE SEARCH, in three views over the same bytes. The raw view repeats what
  // the four assertions above already say — deliberately, because the loop is
  // what the other two views hang off, and dropping the duplicate would make
  // the raw case depend on the loop's shape.
  const surfaces = {
    'everything the service saw and everything it served': observedWire,
    'everything the service stores': storedAtRest,
  };
  for (const [surface, serialized] of Object.entries(surfaces)) {
    assert.ok(serialized.length > 0, `${surface} is empty, so searching it proves nothing`);
    for (const view of decodedViews(serialized)) {
      if (view.haystack === null) {
        // AN EXPLICIT SKIP. The view is unbuildable only for the one stated
        // reason; anything else would mean the search quietly lost a surface.
        assert.equal(view.absentBecause, NO_GZIP_STREAM, `${surface}: the ${view.name} view went missing unexplained`);
        continue;
      }
      assert.equal(
        view.haystack.includes(PLAINTEXT_MARKER),
        false,
        `the diary's plaintext is readable in ${surface} (${view.name} view)`,
      );
      assert.equal(
        view.haystack.includes(PASSPHRASE),
        false,
        `the passphrase is readable in ${surface} (${view.name} view)`,
      );
    }
  }
});

test('a second device signs in with the passphrase alone and reads the first device’s data', async () => {
  const email = `二-device-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const first = requireVault();
  const deviceOne = { current: snapshotOf([foodLog('log-a', 'Roast chicken')]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: first, deviceId: 'device-1', local: deviceOne }));

  // A genuinely fresh device: nothing but the address and the passphrase.
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const second = requireVault();
  const deviceTwo = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: second, deviceId: 'device-2', local: deviceTwo }));

  assert.deepEqual(
    deviceTwo.current.foodLogs.map((log) => log.name),
    ['Roast chicken'],
  );
});

test('two devices pushing AT THE SAME TIME both survive — the 409 loop over real HTTP', async () => {
  const email = `race-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vaultOne = requireVault();
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const vaultTwo = requireVault();

  const deviceOne = { current: snapshotOf([foodLog('race-a', 'Baked cod')]) };
  const deviceTwo = { current: snapshotOf([foodLog('race-b', 'Bean stew')]) };

  // Both cycles pull before either pushes, so one of them is guaranteed to
  // lose the compare-and-swap. This is the exact situation `PROTOCOL.md` §5.1
  // says a client must survive: treating the 409 as fatal here would strand a
  // device out of sync permanently.
  const [resultOne, resultTwo] = await Promise.all([
    runSyncCycleUnlocked(deviceDeps({ vault: vaultOne, deviceId: 'device-1', local: deviceOne })),
    runSyncCycleUnlocked(deviceDeps({ vault: vaultTwo, deviceId: 'device-2', local: deviceTwo })),
  ]);

  assert.equal(
    Math.max(resultOne.attempts, resultTwo.attempts),
    2,
    'exactly one of the two must have lost the CAS and retried',
  );
  assert.equal(resultOne.pushed && resultTwo.pushed, true, 'both writes must eventually land');

  // Neither device's entry may have been clobbered by the other's push.
  const settled = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: vaultOne, deviceId: 'device-3', local: settled }));
  assert.deepEqual(settled.current.foodLogs.map((log) => log.name).toSorted(), ['Baked cod', 'Bean stew']);
});

test('two diverged devices converge on the union and then go quiet', async () => {
  const email = `converge-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vaultOne = requireVault();
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const vaultTwo = requireVault();

  const storageOne = createMemoryStorage();
  const storageTwo = createMemoryStorage();
  const deviceOne = { current: snapshotOf([foodLog('log-a', 'Roast chicken')]) };
  const deviceTwo = { current: snapshotOf([foodLog('log-b', 'Greek salad')]) };

  await runSyncCycleUnlocked(
    deviceDeps({ vault: vaultOne, deviceId: 'device-1', local: deviceOne, storage: storageOne }),
  );
  const secondCycle = await runSyncCycleUnlocked(
    deviceDeps({ vault: vaultTwo, deviceId: 'device-2', local: deviceTwo, storage: storageTwo }),
  );
  assert.equal(secondCycle.pushed, true);

  // Device one pulls the merged result back.
  await runSyncCycleUnlocked(
    deviceDeps({ vault: vaultOne, deviceId: 'device-1', local: deviceOne, storage: storageOne }),
  );

  const namesOne = deviceOne.current.foodLogs.map((log) => log.name).toSorted();
  const namesTwo = deviceTwo.current.foodLogs.map((log) => log.name).toSorted();
  assert.deepEqual(namesOne, ['Greek salad', 'Roast chicken']);
  assert.deepEqual(namesTwo, ['Greek salad', 'Roast chicken'], 'both devices must end on the same set');

  // A third cycle on each device must be a no-op — convergence, not oscillation.
  const settledOne = await runSyncCycleUnlocked(
    deviceDeps({ vault: vaultOne, deviceId: 'device-1', local: deviceOne, storage: storageOne }),
  );
  const settledTwo = await runSyncCycleUnlocked(
    deviceDeps({ vault: vaultTwo, deviceId: 'device-2', local: deviceTwo, storage: storageTwo }),
  );
  assert.equal(settledOne.pushed, false);
  assert.equal(settledTwo.pushed, false);
});

test('reset WITH the recovery code keeps the synced data readable', async () => {
  const email = `recover-${Date.now()}@example.test`;
  const recoveryCode = expectReady(
    await createSyncAccount({
      serverUrl: service.url,
      email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    }),
  );
  const vaultBefore = requireVault();
  const device = { current: snapshotOf([foodLog('log-keep', 'Lentil soup')]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: vaultBefore, deviceId: 'device-1', local: device }));

  await requestSyncReset({ serverUrl: service.url, email });
  const token = service.lastResetToken();
  assert.ok(token !== null, 'the service should have issued a reset token');

  const outcome = await completeSyncReset({
    serverUrl: service.url,
    token,
    newPassphrase: 'a completely different phrase entirely',
    recoveryCode,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  assert.equal(outcome.dataPreserved, true);
  assert.equal(outcome.recoveryCode, null, 'the existing recovery code stays valid and is not replaced');

  // The real proof: sign in with the NEW passphrase and read the OLD blob.
  await signInToSync({
    serverUrl: service.url,
    email,
    passphrase: 'a completely different phrase entirely',
    deriveHash: fastDeriver,
  });
  const restored = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: requireVault(), deviceId: 'device-restored', local: restored }));

  assert.deepEqual(
    restored.current.foodLogs.map((log) => log.name),
    ['Lentil soup'],
    'data written before the reset must still decrypt afterwards',
  );
});

test('reset WITHOUT the recovery code honours the data-loss fork', async () => {
  const email = `lost-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const vaultBefore = requireVault();
  const device = { current: snapshotOf([foodLog('log-gone', 'Something precious')]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: vaultBefore, deviceId: 'device-1', local: device }));
  const dekBeforeReset = bytesToBase64(vaultBefore.dek);

  await requestSyncReset({ serverUrl: service.url, email });
  const token = service.lastResetToken();
  assert.ok(token !== null);

  const outcome = await completeSyncReset({
    serverUrl: service.url,
    token,
    newPassphrase: 'an entirely new passphrase here',
    // The fork, taken explicitly. `reset-flow.ts` is what makes a real user
    // arrive at this `null` knowingly.
    recoveryCode: null,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  assert.equal(outcome.dataPreserved, false);
  assert.ok(outcome.recoveryCode !== null, 'a brand new recovery code must be issued for the new key');

  await signInToSync({
    serverUrl: service.url,
    email,
    passphrase: 'an entirely new passphrase here',
    deriveHash: fastDeriver,
  });
  const vaultAfter = requireVault();
  assert.notEqual(bytesToBase64(vaultAfter.dek), dekBeforeReset, 'the reset must mint a genuinely new key');

  // The old blob is still on the server and is now permanently unreadable —
  // the honest, documented consequence, asserted rather than assumed.
  const recovered = { current: snapshotOf([]) };
  await assert.rejects(
    () => runSyncCycleUnlocked(deviceDeps({ vault: vaultAfter, deviceId: 'device-2', local: recovered })),
    /could not be decrypted/,
    'the pre-reset blob must NOT decrypt under the new key',
  );
  assert.deepEqual(recovered.current.foodLogs, [], 'nothing from before the reset may be recovered');
});

/**
 * THE DEADLOCK, end to end.
 *
 * On an instance with `REQUIRE_EMAIL_VERIFICATION` (which is what
 * auth.lowcarbcheck.org runs), every door was shut: signup returned no session
 * and the client threw; signing up again answered `409`; and signing in after
 * confirming reached an account with no key records and threw there too. No
 * user could ever finish setup, and no test could see it, because the fake
 * service had no way to express the flag.
 *
 * This drives the whole designed path instead: pending → confirm → sign-in
 * repair → converge, with the failure modes asserted as *gone* rather than the
 * happy path merely working.
 */
test('REQUIRE_EMAIL_VERIFICATION: signup pends, verification unlocks, sign-in finishes setup', async () => {
  const strict = await startFakeSyncService({ requireEmailVerification: true });
  // The session store is a module singleton and earlier tests left one open;
  // "no session was opened" is only a meaningful assertion from a clean start.
  closeSyncSession();
  try {
    const email = `verify-${Date.now()}@example.test`;

    // 1. Signup returns a DESIGNED pending state, not a throw.
    const outcome = await createSyncAccount({
      serverUrl: strict.url,
      email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    });
    assert.equal(outcome.status, 'awaiting-email-verification', 'signup must not throw when a session is withheld');
    assert.equal(getSyncVault(), null, 'no session may be opened, and no key material kept, from the pending branch');
    assert.equal(
      strict.dump().includes('"keyRecords":[]'),
      true,
      'no key records can exist yet — writing them needs the session that was withheld',
    );

    // 2. Signing in BEFORE confirming is refused as unverified (403), which
    //    must never be reported as a wrong passphrase.
    await assert.rejects(
      () => signInToSync({ serverUrl: strict.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver }),
      (error) => {
        assert.equal(classifySignInFailure(error), 'email-unverified');
        return true;
      },
    );

    // 3. The link from the email.
    const verificationToken = strict.lastVerificationToken();
    assert.ok(verificationToken !== null, 'signup should have issued a verification token');
    const confirmed = await fetch(`${strict.url}${AUTH_API_PREFIX}/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken }),
    });
    assert.equal(confirmed.ok, true);
    // The token is single use — the client's replay guard exists precisely
    // because a second redemption looks like a forged one.
    const replayed = await fetch(`${strict.url}${AUTH_API_PREFIX}/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken }),
    });
    assert.equal(replayed.ok, false, 'a redeemed verification token must not be reusable');

    // 4. Sign in: the account has no key records, so this is the REPAIR path —
    //    and it must not be the "setup never finished" dead end it used to be.
    const signedIn = await signInToSync({
      serverUrl: strict.url,
      email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
    });
    assert.equal(signedIn.status, 'setup-incomplete');
    assert.equal(getSyncVault(), null, 'the vault stays shut until the ceremony has actually written the keys');

    assert.ok(signedIn.status === 'setup-incomplete');
    const repaired = await signedIn.completeSetup({ passphrase: PASSPHRASE });
    assert.equal(repaired.status, 'ready', 'the repair must produce a recovery code, shown by the same ceremony');
    const recoveryCode = expectReady(repaired);

    // 5. The account is now genuinely usable: push, then read it back on a
    //    fresh sign-in that takes the ORDINARY path.
    const vault = requireVault();
    const device = { current: snapshotOf([foodLog('log-verified', 'Baked aubergine')]) };
    await runSyncCycleUnlocked(deviceDeps({ vault, deviceId: 'device-verified', local: device }));

    const second = await signInToSync({
      serverUrl: strict.url,
      email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
    });
    assert.equal(second.status, 'connected', 'once the keys exist, sign-in is ordinary again');
    const restored = { current: snapshotOf([]) };
    await runSyncCycleUnlocked(deviceDeps({ vault: requireVault(), deviceId: 'device-2', local: restored }));
    assert.deepEqual(
      restored.current.foodLogs.map((log) => log.name),
      ['Baked aubergine'],
    );

    // 6. The recovery code minted by the repair really opens the account —
    //    otherwise the ceremony would have shown the user a useless string.
    await requestSyncReset({ serverUrl: strict.url, email });
    const resetToken = strict.lastResetToken();
    assert.ok(resetToken !== null);
    const reset = await completeSyncReset({
      serverUrl: strict.url,
      token: resetToken,
      newPassphrase: 'a different passphrase entirely',
      recoveryCode,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    });
    assert.equal(reset.dataPreserved, true, 'the repair-issued recovery code must unwrap the repair-issued DEK');
  } finally {
    await strict.close();
  }
});

test('the payload schema version travels through the AAD, not the wire', async () => {
  // The service stores the blob without ever learning what schema it holds —
  // it is bound into the AAD instead. Anything else would leak a version
  // number about the client's local store to a service that has no business
  // knowing it.
  const observedBodies = JSON.stringify(service.observed);
  assert.equal(observedBodies.includes('payloadSchemaVersion'), false);
  assert.equal(service.dump().includes('payloadSchemaVersion'), false);
  assert.ok(SCHEMA_VERSION > 0);
});

/**
 * M164/01, over the whole cycle: a compartment this session could not adopt
 * must still be on the blob after this session pushes.
 *
 * The loss is a TWO-CYCLE effect, which is why both are driven here. The first
 * cycle pulls the compartment and writes it into this device's baseline; the
 * second seals, gets nothing back, and `stampSnapshot` reads "the baseline had
 * this entity and the snapshot does not" as a DELETE — a tombstone that the
 * merge then applies to the server copy. Nothing throws anywhere along it.
 *
 * The compartment planted here is sealed under a key nobody in the signing-in
 * session holds. That is the ordinary post-passphrase-change state, not a
 * contrived one, and it is the shape `candidateCdks` documents as "the caller
 * keeps what the device already has" — true of the device, and false of the
 * blob until this spec.
 */
test('a compartment it could not adopt survives the next push', async () => {
  const email = `compartment-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const planterVault = requireVault();

  // A REAL compartment, sealed to a key this account's passphrase cannot
  // reach. Built through the production session so it is the same construction
  // a second device would have written.
  const strangerKek = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(23), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const strangerSession = createPrivateStoreSession({
    accountId: planterVault.accountId,
    passphraseKek: strangerKek,
    established: await establishPrivateStore({ passphraseKek: strangerKek, recoveryKek: strangerKek }),
  });
  const strangerRegion: OwnerPrivateRegion = {
    ...EMPTY_OWNER_PRIVATE_REGION,
    shareIdentity: { publicKeyRaw: 'public-key', privateKeyPkcs8: 'the-key-that-must-survive', createdAt: 7_000 },
  };
  const planted = await sealOwnerPrivateRegion({ session: strangerSession, region: strangerRegion });
  assert.ok(planted !== null, 'the fixture must carry a real compartment, or nothing below is a statement');

  const planter = { current: { ...snapshotOf([foodLog('log-p', 'Planted')]), privateStore: planted } };
  const planted1 = await runSyncCycleUnlocked(
    deviceDeps({ vault: planterVault, deviceId: 'device-planter', local: planter }),
  );
  assert.equal(planted1.pushed, true);

  // NON-VACUITY: the compartment really is on the blob before the device under
  // test touches it. Without this the assertion at the end could pass because
  // nothing was ever there.
  const beforeReadback = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: planterVault, deviceId: 'device-before', local: beforeReadback }));
  assert.deepEqual(beforeReadback.current.privateStore, planted);

  // A genuinely fresh sign-in: the account's passphrase, and no CDK. Its first
  // pull will fail to adopt the planted compartment.
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const victim = requireVault();

  /**
   * The device under test, wired the way `sync-actions.ts` wires production.
   *
   * `readSyncedSnapshot`/`applySyncedSnapshot` are module-private there and
   * read the device store through IndexedDB, which this file deliberately does
   * not have — so the two SEAM LINES are mirrored here and nothing else is.
   * What is under test is `sealOwnerPrivateRegion` and `openOwnerPrivateRegion`
   * against the real orchestrator, merge and stamping.
   */
  const local = { current: snapshotOf([]) };
  const victimDeps = (deviceId: string, storage: ReturnType<typeof createMemoryStorage>) => ({
    ...deviceDeps({ vault: victim, deviceId, local, storage }),
    // Production's pre-push veto (M164/06), and here it is also a BOUNDARY
    // assertion: this device cannot open the planted compartment, which is one
    // of the three ordinary states the veto must stay silent for. If it ever
    // starts refusing them, both cycles below fail instead of converging.
    assertPulledSnapshot: ({ pulled }: { pulled: SyncedSnapshot }) =>
      assertOwnerPrivateCompartment({ session: victim.privateStore, sealed: pulled.privateStore }),
    readSnapshot: async (): Promise<SyncedSnapshot> => ({
      ...local.current,
      privateStore: await sealOwnerPrivateRegion({
        session: victim.privateStore,
        region: EMPTY_OWNER_PRIVATE_REGION,
      }),
    }),
    applySnapshot: async ({ merged }: { merged: SyncedSnapshot }) => {
      await openOwnerPrivateRegion({ session: victim.privateStore, sealed: merged.privateStore });
      local.current = merged;
    },
  });

  // One storage for both cycles: the baseline the first cycle writes is what
  // makes the second one emit a tombstone, and a fresh store per cycle would
  // hide the defect entirely.
  const storage = createMemoryStorage();
  await runSyncCycleUnlocked(victimDeps('device-victim', storage));
  assert.equal(victim.privateStore.cdk, null, 'the adopt must have failed, or this test proves nothing');

  local.current = { ...local.current, foodLogs: [...local.current.foodLogs, foodLog('log-v', 'Victim')] };
  await runSyncCycleUnlocked(victimDeps('device-victim', storage));

  // THE ASSERTION THE SPEC EXISTS FOR, read back off the service through a
  // third device rather than off any in-memory copy.
  const afterReadback = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: planterVault, deviceId: 'device-after', local: afterReadback }));
  assert.deepEqual(afterReadback.current.privateStore, planted, 'the failed adopt blanked the account’s compartment');

  // POSITIVE: what came back still opens, and still holds the key material.
  const opened = await openOwnerPrivateRegion({
    session: createPrivateStoreSession({ accountId: victim.accountId, passphraseKek: strangerKek }),
    sealed: afterReadback.current.privateStore,
  });
  assert.deepEqual(opened, strangerRegion);

  // And the diary still converged, so the fix is not "stop syncing".
  assert.deepEqual(afterReadback.current.foodLogs.map((log) => log.name).toSorted(), ['Planted', 'Victim']);
});

/**
 * THE DIARY REFUSES A STUDY ACCOUNT BEFORE WRITING (M164/06).
 *
 * M164/02 made a wrong-kind compartment throw, and on the CONSOLE side the
 * throw lands at sign-in, before anything is pushed — `study-session.ts` proves
 * it with a byte-identical blob. The diary side had the throw and not the
 * ordering: `openOwnerPrivateRegion` runs inside `applySnapshot`, and the
 * orchestrator calls `applySnapshot` on the line AFTER `pushBlob`.
 *
 * So a person who typed a study address into the DIARY sign-in pushed this
 * device's whole diary into the study account's blob and then saw the refusal.
 * A study passphrase is normally held by more than one researcher, so those
 * bytes are readable by colleagues — this is a disclosure, not just a mess.
 *
 * ── WHY "IT THREW" IS NOT THE ASSERTION ─────────────────────────────────
 *
 * The throw already happened before this spec. The only claim worth making is
 * about the SERVICE: the account's blob is byte-identical after the refusal,
 * read back off the wire rather than off any in-memory copy. The non-vacuity
 * that makes it a statement is that the refused device was genuinely holding a
 * change to publish.
 */
async function blobOnTheService(vault: SyncVault) {
  const pulled = await vault.http.pullBlob();
  assert.ok(pulled !== null, 'the account must have a blob, or "unchanged" is a statement about nothing');
  return {
    blobVersion: pulled.blobVersion,
    envelopeVersion: pulled.envelopeVersion,
    ciphertext: bytesToBase64(pulled.ciphertext),
  };
}

/** A study's private key on the blob — the material a diary push would have sealed over. */
const STUDY_KEY_MARKER = 'the-study-private-key-that-must-survive';

test('the diary refuses a study account before writing, and the blob is unchanged', async () => {
  const email = `study-account-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const founderVault = requireVault();

  // A REAL study compartment, sealed under THIS ACCOUNT'S OWN `K_pp`. That is
  // what makes the hazard reachable rather than theoretical: the diary device
  // below holds the same passphrase, so slot 1 unwraps, the AAD binds the right
  // account, the ciphertext decrypts — and the only thing that can refuse it is
  // the tag inside the plaintext.
  const passphraseKek = founderVault.privateStore.passphraseKek;
  const established = await establishPrivateStore({ passphraseKek, recoveryKek: passphraseKek });
  const studyCompartment = await sealStudyRegion({
    session: {
      accountId: founderVault.accountId,
      passphraseKek,
      cdk: established.cdk,
      wraps: {
        cdkWrapPassphrase: established.cdkWrapPassphrase,
        cdkWrapRecovery: established.cdkWrapRecovery,
      },
      extras: {},
      pulled: null,
    },
    region: { studyKeyring: [{ publicKey: 'a-public-key', privateKey: STUDY_KEY_MARKER, createdAt: 1_000 }] },
  });
  assert.ok(studyCompartment !== null, 'the fixture must carry a real study compartment');

  const founder = { current: { ...snapshotOf([]), privateStore: studyCompartment } };
  await runSyncCycleUnlocked(deviceDeps({ vault: founderVault, deviceId: 'device-study', local: founder }));
  const blobBefore = await blobOnTheService(founderVault);

  // THE MISTAKE, exactly as a person makes it: the study's address and the
  // study's passphrase, typed into the ordinary diary sign-in.
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const diary = requireVault();

  // The device under test, wired the way `sync-actions.ts` wires production —
  // the same three seam lines, and nothing else.
  const local = { current: snapshotOf([foodLog('log-diary', 'A private diary entry')]) };
  const diaryDeps = {
    ...deviceDeps({ vault: diary, deviceId: 'device-diary', local }),
    readSnapshot: async (): Promise<SyncedSnapshot> => ({
      ...local.current,
      privateStore: await sealOwnerPrivateRegion({ session: diary.privateStore, region: EMPTY_OWNER_PRIVATE_REGION }),
    }),
    applySnapshot: async ({ merged }: { merged: SyncedSnapshot }) => {
      await openOwnerPrivateRegion({ session: diary.privateStore, sealed: merged.privateStore });
      local.current = merged;
    },
    // THE SEAM THIS TEST IS ABOUT. `sync-actions.ts` wires exactly this line,
    // and the orchestrator runs it after the pull and before the push.
    assertPulledSnapshot: ({ pulled }: { pulled: SyncedSnapshot }) =>
      assertOwnerPrivateCompartment({ session: diary.privateStore, sealed: pulled.privateStore }),
  };

  // NON-VACUITY, and the whole reason the blob assertion below is a statement:
  // this device is holding a diary entry the account has never seen. Without a
  // pending change there would be nothing to push and no ordering to test.
  assert.equal(local.current.foodLogs.length, 1, 'the refused device must have something to publish');

  const refusal = await runSyncCycleUnlocked(diaryDeps).then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(
    refusal instanceof WrongCompartmentKindError,
    'a study account must be refused, not read as an empty diary',
  );
  assert.deepEqual({ expected: refusal.expected, actual: refusal.actual }, { expected: 'diary', actual: 'study' });

  // THE ASSERTION THE SPEC EXISTS FOR. Not "it threw" — the throw predates this
  // spec — but that nothing reached the service before it did.
  assert.deepEqual(
    await blobOnTheService(founderVault),
    blobBefore,
    'the refusal must land before the push — the study account’s blob must be byte-identical',
  );

  // POSITIVE: what is on the blob is still a study compartment that opens, with
  // its keyring intact. An unchanged-bytes assertion says nothing about what
  // those bytes are.
  const readback = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: founderVault, deviceId: 'device-readback', local: readback }));
  assert.deepEqual(readback.current.foodLogs, [], 'the diary entry must never have reached the study account');
  const opened = await openStudyRegion({
    session: { accountId: founderVault.accountId, passphraseKek, cdk: null, wraps: null, extras: {}, pulled: null },
    sealed: readback.current.privateStore,
  });
  assert.equal(opened?.studyKeyring[0]?.privateKey, STUDY_KEY_MARKER);
});

/**
 * A COMPLETED SYNC CAN STILL BE CARRYING A LOSS, AND MUST SAY SO (M164/07).
 *
 * `sealOwnerPrivateRegion` re-emits a compartment this session could not open
 * (M164/01), which is strictly better than the destruction it replaced — and
 * it is still silent: this device's own owner-private changes are NOT
 * published. A share identity generated here is written to IndexedDB and
 * exists nowhere else. The diary itself synced perfectly, so the cycle reports
 * success, and a device looks healthy for a week with its share identity
 * stranded.
 *
 * ADR-0009's consequences say "a completed sync cycle can now report an
 * error". `hasUnopenedCompartment` is that report and `syncNow` is where it
 * reaches a person — and nothing under `tests/` asserted either. This is the
 * one behaviour change M164/02 made visible to a user.
 *
 * ── Why this test is the only one here that drives `syncNow` ─────────────
 *
 * Every other test in this file mirrors `sync-actions.ts`'s two seam lines and
 * runs the orchestrator directly, because `readSyncedSnapshot` and
 * `applySyncedSnapshot` are module-private and read the device store. The
 * report under test is not on the orchestrator at all — it is written by
 * `syncNow` after the cycle returns — so a mirrored cycle cannot see it, and
 * this file gained a real device store (see `openTheDeviceStore`) for exactly
 * this one case.
 */
test('a session carrying an unopened compartment reports an unopened compartment on a completed sync', async () => {
  const email = `unopened-report-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const planterVault = requireVault();

  // A REAL compartment under a key this account's passphrase cannot reach —
  // the ordinary post-passphrase-change state, planted through the production
  // seal exactly as the adopt-failure test above plants one.
  const strangerKek = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(31), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const planted = await sealOwnerPrivateRegion({
    session: createPrivateStoreSession({
      accountId: planterVault.accountId,
      passphraseKek: strangerKek,
      established: await establishPrivateStore({ passphraseKek: strangerKek, recoveryKek: strangerKek }),
    }),
    region: {
      ...EMPTY_OWNER_PRIVATE_REGION,
      shareIdentity: { publicKeyRaw: 'public-key', privateKeyPkcs8: 'the-key-this-device-cannot-read', createdAt: 7 },
    },
  });
  assert.ok(planted !== null, 'the fixture must carry a real compartment, or nothing below is a statement');
  const planter = { current: { ...snapshotOf([foodLog('log-report', 'Planted')]), privateStore: planted } };
  await runSyncCycleUnlocked(deviceDeps({ vault: planterVault, deviceId: 'device-planter', local: planter }));

  // A genuinely fresh sign-in, and then the production verb — no mirrored
  // seams, no substituted deps. This is the call the app makes on boot.
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const victim = requireVault();
  markSyncPending();
  await syncNow();

  // NON-VACUITY: the cycle really is the degraded one, and it really did
  // complete. Both halves matter — a failed cycle would report an error too,
  // and this report is precisely the one a SUCCESSFUL cycle carries.
  assert.equal(hasUnopenedCompartment(victim.privateStore), true, 'the adopt must have failed, or this proves nothing');
  const snapshot = getSyncSessionSnapshot();
  assert.equal(snapshot.phase, 'idle');
  assert.ok(snapshot.lastSyncedAt !== null, 'the cycle must have completed — this is not a failure report');
  assert.equal(snapshot.hasPendingChanges, false);

  // THE ASSERTION THIS TEST WAS WRITTEN FOR: the sentence a person reads.
  assert.ok(snapshot.error !== null, 'a completed cycle carrying an unopened compartment must not report a clean sync');
  assert.equal(snapshot.error.reason, 'failed');
  assert.match(snapshot.error.message, /in sync/i, 'the diary DID sync, and the message must not deny it');
  assert.match(snapshot.error.message, /could not open/i, 'the message must name what did not happen');
  // AND THE CAUSE IS OFFERED AS LIKELY, NOT STATED (M164/07). Three states
  // reach here — a passphrase this session does not hold, a failed tag check,
  // and a plaintext the region schema rejected — and the recovery code helps
  // only the first. The message that stood here named that one as the cause.
  assert.match(snapshot.error.message, /most often/i, 'the likely cause must be offered as likely, not as the cause');

  // NON-VACUITY 2: an account with no such compartment reports nothing. Without
  // this the report could be unconditional.
  await createSyncAccount({
    serverUrl: service.url,
    email: `clean-report-${Date.now()}@example.test`,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  markSyncPending();
  await syncNow();
  assert.equal(getSyncSessionSnapshot().error, null, 'an ordinary cycle must still report a clean sync');
});

/**
 * AN ESTABLISHED COMPARTMENT THAT IS NEVER PUBLISHED (M164/08).
 *
 * The upgrade path for an account whose data predates the partition is
 * `regenerateRecoveryCode`: it is the one routine operation where both
 * compartment doors exist in the same frame, so `rotateCompartmentRecoverySlot`
 * MINTS a compartment when the account has none. The user is shown a recovery
 * code for it that afternoon.
 *
 * M164/06 made `sealOwnerPrivateRegion` refuse to seal from a session that has
 * never read the compartment plaintext (`extras === null`), which is right —
 * and the establish branch never said that it HAD read one, because it minted
 * it. So the seal re-emitted `session.pulled`, which on this account is `null`,
 * and the compartment stayed on the one device that made it.
 *
 * It does not heal: `openOwnerPrivateRegion` returns early on a pull that
 * carried no compartment, so nothing ever writes `extras`, and every later
 * session starts in the same state.
 *
 * ── Why the recovery door is opened at the end ───────────────────────────
 *
 * "A compartment reached the service" is only half the claim. The other half
 * is that the code the user was just shown opens it — that is the promise the
 * ceremony makes, and slot 2 is the only place it can be checked.
 */
test('a freshly established compartment reaches the service', async () => {
  const email = `pre-partition-${Date.now()}@example.test`;
  await createSyncAccount({
    serverUrl: service.url,
    email,
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const founderVault = requireVault();

  // AN ACCOUNT WHOSE BLOB PREDATES THE PARTITION: a real snapshot with no
  // compartment on it at all. `snapshotOf` carries `privateStore: null`, which
  // is exactly what every client wrote before M160/07.
  const founder = { current: snapshotOf([foodLog('log-pre-partition', 'Written before the partition')]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: founderVault, deviceId: 'device-pre-partition', local: founder }));

  // The device that will do the upgrade — a genuinely fresh sign-in, so it
  // holds no CDK of its own and adopts nothing on its first pull.
  await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  const upgrading = requireVault();
  markSyncPending();
  await syncNow();

  // NON-VACUITY 1: the account really has no compartment, so everything below
  // is about one this device is about to mint rather than one it inherited.
  assert.equal(upgrading.privateStore.cdk, null, 'the fixture must be an account with no compartment');
  assert.equal(upgrading.privateStore.pulled, null, 'and no pull may have carried one');

  // THE TRIGGER, exactly as a person reaches it: settings → regenerate the
  // recovery code. `rewrapPrivateStoreOnServer` answers `no-compartment` and
  // the establish branch mints one.
  const { recoveryCode } = await regenerateRecoveryCode();

  // NON-VACUITY 2: the mint happened, and the session is holding the key.
  assert.notEqual(upgrading.privateStore.cdk, null, 'the establish branch must have minted a compartment');

  markSyncPending();
  await syncNow();

  // THE ASSERTION THIS TEST WAS WRITTEN FOR, read back off the wire by a third
  // device rather than out of any in-memory copy.
  const readback = { current: snapshotOf([]) };
  await runSyncCycleUnlocked(deviceDeps({ vault: upgrading, deviceId: 'device-readback-mint', local: readback }));
  const published = readback.current.privateStore;
  assert.ok(published !== null, 'the compartment the user was shown a recovery code for must reach the service');

  // POSITIVE 1: the passphrase door opens it, and it reads as this account's
  // own diary compartment. "Not null" says nothing about what the bytes are.
  const opened = await openOwnerPrivateRegion({
    session: createPrivateStoreSession({
      accountId: upgrading.accountId,
      passphraseKek: upgrading.privateStore.passphraseKek,
    }),
    sealed: published,
  });
  assert.ok(opened !== null, 'the account’s own passphrase must open what was published');

  // POSITIVE 2: and so does the code the user was handed. A compartment whose
  // recovery slot nobody can open is the failure this whole ceremony exists to
  // prevent — see `engine/crypto/private-store.ts`'s header.
  const raw = parseRecoveryCode(recoveryCode);
  assert.ok(raw !== null, 'the ceremony must have shown a well-formed code');
  const recoveryCdk = await unwrapCdk({
    wrappedCdk: base64ToBytes(published.cdkWrapRecovery),
    kek: await derivePrivateStoreRecoveryKek(raw),
  });
  const plaintext = await openPrivateStore({
    cdk: recoveryCdk,
    ciphertext: base64ToBytes(published.ciphertext),
    accountId: upgrading.accountId,
  });
  assert.equal(JSON.parse(new TextDecoder().decode(plaintext)).kind, 'diary');
});
