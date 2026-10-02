/**
 * The session-opening flows on a device that holds another account's diary
 * (ADR-0023), against the in-repo fake core, with every request recorded.
 *
 * ── The one this file exists for: the reset ──────────────────────────────
 *
 * A reset that reached `openSyncVault` on a held device would be refused by
 * the guard there, AFTER `recover-rotate` had committed. The compartment's
 * rewrap runs after the vault, so it would never run, and the compartment's
 * two doors would stay on a passphrase and a code that no longer exist: the
 * share keys, the pinned peers and the research identity lost for good. So the
 * reset must stop BEFORE the rotation, and the tests below read that off the
 * wire: the recover may happen, `recover-rotate` and the key-record read may
 * not, and the old passphrase still signs in afterwards, which is the proof
 * that nothing rotated.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Every refusal has its twin for the owner, which goes all the way through
 * and is seen to reach the request the refusal never sent.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { z } from 'zod';

import { startFakeSyncService, type FakeSyncService } from './fake-sync-service';
import {
  createSyncAccount,
  recoverSyncAccount,
  resetSyncPassphrase,
  signInToSync,
} from '../../app/lib/sync/sync-actions';
import { clearSessionCache } from '../../app/lib/sync/session-cache';
import { closeSyncSession, getSyncVault } from '../../app/lib/sync/sync-session';
import {
  clearDeviceLockAfterErase,
  DeviceHeldByAnotherAccountError,
  lockDevice,
  type DeviceLockOwner,
} from '../../app/lib/sync/sync-state';
import { deriveArgon2idHash, type Argon2idParams } from '../../app/lib/sync/engine/crypto/argon2';

const FAST_PARAMS: Argon2idParams = { memorySizeKib: 8, iterations: 1, parallelism: 1 };
const fastDeriver = (input: { passphrase: string; salt: Uint8Array; params: Argon2idParams }) =>
  deriveArgon2idHash({ ...input, params: FAST_PARAMS });

const PASSPHRASE = 'seventeen purple lanterns drifting';
const NEW_PASSPHRASE = 'a completely different phrase entirely';

/** Somebody else, whose diary the device holds. Never an account on the fake service. */
const STRANGER: DeviceLockOwner = { accountId: 999_999, email: 'owner@example.org' };

const resetOpenBodySchema = z.object({ email: z.string(), recoveryCode: z.string().min(1) });

let service: FakeSyncService;

before(async () => {
  service = await startFakeSyncService();
});

after(async () => {
  await service.close();
});

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
  clearDeviceLockAfterErase();
});

/** A `fetch`, and the `METHOD /path` of every request it has made. */
interface RecordingFetch {
  fetchImpl: typeof fetch;
  seen: string[];
}

/** A `fetch` that writes `METHOD /path` for every request it makes. */
function recordingFetch(): RecordingFetch {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    seen.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
    return fetch(input, init);
  };
  return { fetchImpl, seen };
}

/** A fresh account on the fake service, its session closed again, and who it is. */
async function freshAccount(label: string): Promise<{ accountId: number; email: string }> {
  const email = `${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.org`;
  await createSyncAccount({
    serverUrl: service.url,
    inviteToken: service.createInvite({ email }),
    passphrase: PASSPHRASE,
    deriveHash: fastDeriver,
    params: FAST_PARAMS,
  });
  const accountId = getSyncVault()?.accountId;
  assert.ok(accountId !== undefined, 'the account did not open');
  closeSyncSession();
  await clearSessionCache();
  return { accountId, email };
}

/** A live reset token for `email`. */
function resetTokenFor(email: string): string {
  const token = service.createResetToken(email);
  assert.ok(token !== null, 'an existing account must have a reset link');
  return token;
}

/** Spends a reset token for the escrowed code, as the reset screen's first round trip does. */
async function openResetToken(resetToken: string): Promise<string> {
  const response = await fetch(`${service.url}/v1/auth/reset/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resetToken }),
  });
  assert.equal(response.status, 200);
  return resetOpenBodySchema.parse(await response.json()).recoveryCode;
}

/** Proves nothing rotated: the ORIGINAL passphrase still opens the account. */
async function oldPassphraseStillWorks(email: string): Promise<void> {
  clearDeviceLockAfterErase();
  const result = await signInToSync({ serverUrl: service.url, email, passphrase: PASSPHRASE, deriveHash: fastDeriver });
  assert.equal(result.status, 'connected', 'the old passphrase no longer opens the account, so something rotated');
  closeSyncSession();
}

describe('resetSyncPassphrase on a held device', () => {
  test('another address stops after the token is spent, before the recovery', async () => {
    const account = await freshAccount('reset-by-address');
    lockDevice({ owner: STRANGER });
    const wire = recordingFetch();

    const result = await resetSyncPassphrase({
      serverUrl: service.url,
      resetToken: resetTokenFor(account.email),
      newPassphrase: NEW_PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'device-held', owner: STRANGER, email: account.email });
    assert.ok(
      wire.seen.includes('POST /v1/auth/reset/open'),
      'the recorder saw nothing, so the absences prove nothing',
    );
    assert.equal(wire.seen.includes('POST /v1/auth/recover'), false, 'the recovery started');
    assert.equal(getSyncVault(), null);
    await oldPassphraseStillWorks(account.email);
  });

  test('an owner known only by id: the recover answers who it is, and nothing rotates', async () => {
    const account = await freshAccount('reset-by-id');
    lockDevice({ owner: { accountId: STRANGER.accountId, email: null } });
    const wire = recordingFetch();

    const result = await resetSyncPassphrase({
      serverUrl: service.url,
      resetToken: resetTokenFor(account.email),
      newPassphrase: NEW_PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, {
      status: 'device-held',
      owner: { accountId: STRANGER.accountId, email: null },
      email: account.email,
    });
    assert.ok(wire.seen.includes('POST /v1/auth/recover'));
    assert.ok(wire.seen.includes('POST /v1/auth/logout'), 'the recover session was not revoked');
    assert.equal(wire.seen.includes('POST /v1/auth/recover-rotate'), false, 'the passphrase rotated on a held device');
    assert.equal(wire.seen.includes('GET /v1/sync/key-records'), false, 'the key records were read on a held device');
    assert.equal(getSyncVault(), null);
    await oldPassphraseStillWorks(account.email);
  });

  test('CONTROL: on a device the account itself holds, the reset goes through and rotates', async () => {
    const account = await freshAccount('reset-owner');
    lockDevice({ owner: { accountId: account.accountId, email: account.email } });
    const wire = recordingFetch();

    const result = await resetSyncPassphrase({
      serverUrl: service.url,
      resetToken: resetTokenFor(account.email),
      newPassphrase: NEW_PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'ready', email: account.email });
    assert.ok(wire.seen.includes('POST /v1/auth/recover-rotate'));
    assert.equal(getSyncVault()?.accountId, account.accountId);
  });
});

describe('recoverSyncAccount on a held device', () => {
  test('calls the recover, answers device-held, and never reads the key records or rotates', async () => {
    const account = await freshAccount('recover-held');
    const recoveryCode = await openResetToken(resetTokenFor(account.email));
    lockDevice({ owner: STRANGER });
    const wire = recordingFetch();

    const result = await recoverSyncAccount({
      serverUrl: service.url,
      email: account.email,
      recoveryCode,
      newPassphrase: NEW_PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'device-held', owner: STRANGER });
    assert.ok(wire.seen.includes('POST /v1/auth/recover'));
    assert.equal(wire.seen.includes('GET /v1/sync/key-records'), false);
    assert.equal(wire.seen.includes('POST /v1/auth/recover-rotate'), false);
    await oldPassphraseStillWorks(account.email);
  });

  test('CONTROL: the owner own account reaches the rotation', async () => {
    const account = await freshAccount('recover-owner');
    const recoveryCode = await openResetToken(resetTokenFor(account.email));
    lockDevice({ owner: { accountId: account.accountId, email: null } });
    const wire = recordingFetch();

    const result = await recoverSyncAccount({
      serverUrl: service.url,
      email: account.email,
      recoveryCode,
      newPassphrase: NEW_PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'recovered' });
    assert.ok(wire.seen.includes('POST /v1/auth/recover-rotate'));
  });
});

describe('signInToSync on a held device', () => {
  test('another address is refused before a single request', async () => {
    const account = await freshAccount('signin-by-address');
    lockDevice({ owner: STRANGER });
    const wire = recordingFetch();

    const result = await signInToSync({
      serverUrl: service.url,
      email: account.email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'device-held', owner: STRANGER });
    assert.deepEqual(wire.seen, []);
  });

  test('an owner known only by id: refused after the login, logged out, key records unread', async () => {
    const account = await freshAccount('signin-by-id');
    lockDevice({ owner: { accountId: STRANGER.accountId, email: null } });
    const wire = recordingFetch();

    const result = await signInToSync({
      serverUrl: service.url,
      email: account.email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      fetchImpl: wire.fetchImpl,
    });

    assert.deepEqual(result, { status: 'device-held', owner: { accountId: STRANGER.accountId, email: null } });
    assert.ok(wire.seen.includes('POST /v1/auth/login'));
    assert.ok(wire.seen.includes('POST /v1/auth/logout'));
    assert.equal(wire.seen.includes('GET /v1/sync/key-records'), false);
    assert.equal(getSyncVault(), null);
  });

  test('CONTROL: the owner signs in, by address or by id', async () => {
    const account = await freshAccount('signin-owner');
    lockDevice({ owner: { accountId: account.accountId, email: account.email.toUpperCase() } });
    const byAddress = await signInToSync({
      serverUrl: service.url,
      email: account.email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
    });
    assert.equal(byAddress.status, 'connected');
    closeSyncSession();

    lockDevice({ owner: { accountId: account.accountId, email: null } });
    const byId = await signInToSync({
      serverUrl: service.url,
      email: account.email,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
    });
    assert.equal(byId.status, 'connected');
  });
});

describe('createSyncAccount on a held device', () => {
  test('an invitation to another address is refused before the invite is spent', async () => {
    lockDevice({ owner: STRANGER });
    const email = `invite-held-${Date.now()}@example.org`;
    const inviteToken = service.createInvite({ email });
    const wire = recordingFetch();

    await assert.rejects(
      () =>
        createSyncAccount({
          serverUrl: service.url,
          inviteToken,
          passphrase: PASSPHRASE,
          deriveHash: fastDeriver,
          params: FAST_PARAMS,
          fetchImpl: wire.fetchImpl,
        }),
      DeviceHeldByAnotherAccountError,
    );
    assert.ok(wire.seen.includes('POST /v1/auth/invite-lookup'));
    assert.equal(wire.seen.includes('POST /v1/auth/signup'), false, 'the invite was spent');

    // CONTROL: the invitation is still good once the device is handed over.
    clearDeviceLockAfterErase();
    const created = await createSyncAccount({
      serverUrl: service.url,
      inviteToken,
      passphrase: PASSPHRASE,
      deriveHash: fastDeriver,
      params: FAST_PARAMS,
    });
    assert.deepEqual(created, { status: 'ready', email });
  });

  test('an owner nobody can name refuses the invitation without a request', async () => {
    lockDevice({ owner: null });
    const wire = recordingFetch();
    await assert.rejects(
      () =>
        createSyncAccount({
          serverUrl: service.url,
          inviteToken: service.createInvite({ email: `invite-nobody-${Date.now()}@example.org` }),
          passphrase: PASSPHRASE,
          deriveHash: fastDeriver,
          params: FAST_PARAMS,
          fetchImpl: wire.fetchImpl,
        }),
      DeviceHeldByAnotherAccountError,
    );
    assert.deepEqual(wire.seen, []);
  });
});
