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
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import { createSyncAccount, completeSyncReset, requestSyncReset, signInToSync } from '../../app/lib/sync/sync-actions';
import type { SyncSetupOutcome } from '../../app/lib/sync/setup-flow';
import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { classifySignInFailure } from '../../app/lib/sync/sign-in-error';
import { closeSyncSession, getSyncVault, type SyncVault } from '../../app/lib/sync/sync-session';
import { runSyncCycleUnlocked } from '../../app/lib/sync/orchestrator';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';
import { bytesToBase64 } from '../../app/lib/sync/engine/crypto/base64';
import { createMemoryStorage, createSyncStateStore } from '../../app/lib/sync/sync-state';
import { SCHEMA_VERSION, type LocalStoreSnapshot } from '../../app/lib/local-store';
import type { SyncedSnapshot } from '../../app/lib/sync/snapshot-partition';

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
});

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

/** Asserts the ordinary (no email verification) signup branch and hands back the recovery code. */
function expectReady(outcome: SyncSetupOutcome): string {
  assert.equal(outcome.status, 'ready', 'expected setup to complete without an email-verification step');
  return outcome.status === 'ready' ? outcome.recoveryCode : '';
}

test('signup → key records → push: the plaintext never reaches the service', async () => {
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
