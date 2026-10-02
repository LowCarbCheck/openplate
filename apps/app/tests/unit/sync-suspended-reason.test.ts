/**
 * A session the SERVER ended carries the real reason, and a suspension is not a revocation.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `/welcome` told a suspended person to sign in again, and that sign-in cannot
 * work. Two things lost the reason on the way: `describeSyncFailure` mapped a
 * suspension to `reauth-required`, and the resume path (`endStaleAttempt`)
 * published `reauth-required` as a constant, because the refresh that was
 * refused came back from the auth client as a bare `null` for both a revoked
 * family and a suspended account.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Every suspension test has a revoked-token twin that must still say
 * `reauth-required`, so a path that answered `suspended` for every refusal
 * would pass the first and fail the second.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { clearSessionCache, resumeSyncSession, writeSessionCache } from '../../app/lib/sync/session-cache';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { closeSyncSession, getSyncSessionSnapshot } from '../../app/lib/sync/sync-session';
import { clearDeviceLockAfterErase, setLockDeviceWhenSessionEnds } from '../../app/lib/sync/sync-state';

const SERVER_URL = 'https://sync.example.test';

const TOKENS = {
  accessToken: 'access-old',
  accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
  refreshToken: 'refresh-old',
  refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
};

/** The refusals the core can answer a refresh with. */
type Refusal = 'revoked' | 'suspended';

const refusal = (kind: Refusal) =>
  kind === 'suspended' ?
    new Response(JSON.stringify({ error: 'account-suspended' }), { status: 403 })
  : new Response(JSON.stringify({ error: 'invalid refresh token' }), { status: 401 });

function refusingFetch(kind: Refusal): typeof fetch {
  return async () => refusal(kind);
}

function withFetch(impl: typeof fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = previous;
  };
}

async function cachedRecord() {
  const passphraseKek = await deriveAesKeyViaHkdf({
    inputKeyMaterial: new Uint8Array(32).fill(9),
    salt: new Uint8Array(16),
    info: HKDF_INFO.PRIVATE_STORE_KEK,
  });
  return {
    accountId: 7,
    email: 'anna@example.org',
    ...TOKENS,
    serverUrl: SERVER_URL,
    dek: new Uint8Array(32).fill(4),
    compartment: { passphraseKek },
    savedAt: Date.now(),
  };
}

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
  setLockDeviceWhenSessionEnds(false);
  clearDeviceLockAfterErase();
});

after(() => {
  closeSyncSession();
});

test('a resume refused because the account is suspended publishes suspended', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(refusingFetch('suspended'));
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null, 'the session is over');
    assert.equal(snapshot.error?.reason, 'suspended');
  } finally {
    restore();
  }
});

test('a resume refused because the token family was revoked still publishes reauth-required (control)', async () => {
  await writeSessionCache(await cachedRecord());
  const restore = withFetch(refusingFetch('revoked'));
  try {
    const snapshot = await resumeSyncSession({ serverUrl: SERVER_URL });
    assert.equal(snapshot.account, null);
    assert.equal(snapshot.error?.reason, 'reauth-required');
    assert.equal(getSyncSessionSnapshot().error?.reason, 'reauth-required');
  } finally {
    restore();
  }
});

test('the auth client remembers why its last refresh was refused', async () => {
  const outcomes: Array<{ kind: Refusal; remembered: string | null }> = [];
  for (const kind of ['suspended', 'revoked'] as const) {
    const client = new SyncAuthClient({ baseUrl: SERVER_URL, fetchImpl: refusingFetch(kind) });
    client.restoreSession({ account: { id: 7, email: 'anna@example.org' }, tokens: TOKENS });
    assert.equal(await client.refreshAccessToken(), null);
    outcomes.push({ kind, remembered: client.getLastRefusal() });
  }
  assert.deepEqual(outcomes, [
    { kind: 'suspended', remembered: 'suspended' },
    { kind: 'revoked', remembered: 'unauthorized' },
  ]);

  // CONTROL: a refresh that succeeds remembers nothing, so a stale refusal
  // from an earlier attempt cannot colour a later one.
  const ok: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        tokens: { ...TOKENS, accessToken: 'access-new', refreshToken: 'refresh-new' },
      }),
      { status: 200 },
    );
  const healthy = new SyncAuthClient({ baseUrl: SERVER_URL, fetchImpl: ok });
  healthy.restoreSession({ account: { id: 7, email: 'anna@example.org' }, tokens: TOKENS });
  assert.equal(await healthy.refreshAccessToken(), 'access-new');
  assert.equal(healthy.getLastRefusal(), null);
});
