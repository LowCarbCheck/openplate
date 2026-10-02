/**
 * A sign-out never waits longer than a bound for the server.
 *
 * ── The defect (sign-out, 2026-10-02) ────────────────────────────────────
 *
 * A running sign-out cannot be closed, so it has to END. Its network step, the
 * logout, was a `fetch` with no timeout: a connection that accepted the request
 * and went quiet held the dialog open for as long as the browser cared to wait.
 * `SyncAuthClient.logout()` and `revokeCachedSession` now give up after a bound
 * (4 s by default, injectable here so the test does not wait four).
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * Each "returns within the bound" test has a twin with a fetch that ANSWERS and
 * must have been called. A bound that was really "never send the request" would
 * pass the first and fail the second.
 *
 * The late-answer tests hold the request open past the bound, then let it
 * answer, and check the client wrote nothing: the cache stays cleared, the
 * session stays dropped.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { SyncAuthClient } from '../../app/lib/sync/engine/client/auth-client';
import { SIGN_OUT_REQUEST_BOUND_MS, waitAtMost } from '../../app/lib/sync/engine/client/bounded-wait';
import { clearSessionCache, readSessionCache, revokeCachedSession, writeSessionCache } from '../../app/lib/sync/session-cache';
import { deriveAesKeyViaHkdf, HKDF_INFO } from '../../app/lib/sync/engine/crypto/hkdf';
import { closeSyncSession } from '../../app/lib/sync/sync-session';

const SERVER_URL = 'https://sync.example.test';

/** Short enough to keep the file fast, long enough to tell "waited" from "did not wait". */
const BOUND_MS = 60;

/** A guard far past the bound, so a hang fails the test instead of hanging the run. */
const HANG_GUARD_MS = 3000;

const TOKENS = {
  accessToken: 'access-old',
  accessTokenExpiresAt: '2026-09-04T10:15:00.000Z',
  refreshToken: 'refresh-old',
  refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
};

/** What the stub service answers with: a rotated pair, or nothing in particular. */
type StubBody =
  | {
      tokens: {
        accessToken: string;
        accessTokenExpiresAt: string;
        refreshToken: string;
        refreshTokenExpiresAt: string;
      };
    }
  | Record<string, never>;

const json = (body: StubBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Where a test keeps the way to fail a request after the bound. */
interface LateRejection {
  reject: (error: Error) => void;
}

/** A request that is never answered, with the way to answer it late. */
function silentFetch() {
  const calls: string[] = [];
  const releasers: Array<() => void> = [];
  const fetchImpl: typeof fetch = (input) => {
    calls.push(new URL(String(input)).pathname);
    return new Promise<Response>((resolve) => {
      releasers.push(() => resolve(json({})));
    });
  };
  return { fetchImpl, calls, answerLate: () => releasers.forEach((release) => release()) };
}

/** A service that answers the refresh and the logout at once. */
function answeringFetch() {
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const authorization = new Headers(init?.headers).get('Authorization');
    calls.push({ path, authorization });
    if (path.endsWith('/auth/refresh')) {
      return json({
        tokens: {
          accessToken: 'access-new',
          accessTokenExpiresAt: '2026-09-04T10:30:00.000Z',
          refreshToken: 'refresh-new',
          refreshTokenExpiresAt: '2026-10-04T10:00:00.000Z',
        },
      });
    }
    return json({});
  };
  return { fetchImpl, calls };
}

/** Rejects if `work` has not settled within the guard, so a hang is a failure. */
async function mustSettle(work: Promise<unknown>): Promise<number> {
  const startedAt = Date.now();
  let guard: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<never>((_, reject) => {
    guard = setTimeout(() => reject(new Error(`still waiting after ${HANG_GUARD_MS} ms`)), HANG_GUARD_MS);
  });
  try {
    await Promise.race([work, hung]);
  } finally {
    clearTimeout(guard);
  }
  return Date.now() - startedAt;
}

function signedInClient(options: { fetchImpl: typeof fetch; logoutTimeoutMs?: number }): SyncAuthClient {
  const client = new SyncAuthClient({ baseUrl: SERVER_URL, ...options });
  client.restoreSession({ account: { id: 7, email: 'anna@example.org' }, tokens: TOKENS });
  return client;
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

function withFetch(impl: typeof fetch): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = previous;
  };
}

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
});

after(() => {
  closeSyncSession();
});

// ---------------------------------------------------------------------------
// SyncAuthClient.logout
// ---------------------------------------------------------------------------

test('logout resolves within the bound when the server never answers', async () => {
  const silent = silentFetch();
  const client = signedInClient({ fetchImpl: silent.fetchImpl, logoutTimeoutMs: BOUND_MS });

  const elapsed = await mustSettle(client.logout());

  assert.deepEqual(silent.calls.map((path) => path.endsWith('/auth/logout')), [true], 'the request was sent');
  assert.ok(elapsed >= BOUND_MS - 10, `it waited for the bound, not less (${elapsed} ms)`);
  assert.equal(client.getSession(), null, 'the local session was dropped before the request');
});

test('logout sends the revoke with the bearer when the server answers (control)', async () => {
  const service = answeringFetch();
  const client = signedInClient({ fetchImpl: service.fetchImpl, logoutTimeoutMs: BOUND_MS });

  const elapsed = await mustSettle(client.logout());

  assert.equal(service.calls.length, 1);
  assert.ok(service.calls[0]?.path.endsWith('/auth/logout'));
  assert.equal(service.calls[0]?.authorization, 'Bearer access-old');
  assert.ok(elapsed < BOUND_MS, `an answered logout does not wait for the bound (${elapsed} ms)`);
});

test('a logout answer that arrives after the bound writes nothing', async () => {
  const silent = silentFetch();
  const client = signedInClient({ fetchImpl: silent.fetchImpl, logoutTimeoutMs: BOUND_MS });
  await mustSettle(client.logout());

  silent.answerLate();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(client.getSession(), null, 'a late answer does not bring the session back');
});

test('the default bound is four seconds, inside the worst case the sign-out budgets for', () => {
  assert.equal(SIGN_OUT_REQUEST_BOUND_MS, 4000);
});

// ---------------------------------------------------------------------------
// waitAtMost
// ---------------------------------------------------------------------------

test('waitAtMost lets a failure before the bound reach the caller, and swallows one after it', async () => {
  await assert.rejects(
    waitAtMost({ work: () => Promise.reject(new Error('refused fast')), timeoutMs: BOUND_MS }),
    /refused fast/,
  );

  const late: LateRejection = { reject: () => undefined };
  const outcome = await waitAtMost({
    work: () =>
      new Promise<void>((_, reject) => {
        late.reject = reject;
      }),
    timeoutMs: BOUND_MS,
  });
  assert.equal(outcome, 'timed-out');
  // Would surface as an unhandled rejection and fail the run if it were not handled.
  late.reject(new Error('refused late'));
  await new Promise((resolve) => setTimeout(resolve, 20));
});

// ---------------------------------------------------------------------------
// revokeCachedSession
// ---------------------------------------------------------------------------

test('revokeCachedSession returns within the bound and still clears the cache when the server never answers', async () => {
  await writeSessionCache(await cachedRecord());
  const silent = silentFetch();
  const restore = withFetch(silent.fetchImpl);
  try {
    const elapsed = await mustSettle(revokeCachedSession({ serverUrl: SERVER_URL, timeoutMs: BOUND_MS }));

    assert.ok(silent.calls.length >= 1, 'the refresh was sent');
    assert.ok(elapsed >= BOUND_MS - 10, `it waited for the bound, not less (${elapsed} ms)`);
    assert.equal(await readSessionCache(), null, 'the cache is cleared whatever the server did');

    // The late answer: nothing may come back from it.
    silent.answerLate();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await readSessionCache(), null, 'a request that finishes late writes nothing');
  } finally {
    restore();
  }
});

test('revokeCachedSession refreshes, revokes and clears when the server answers (control)', async () => {
  await writeSessionCache(await cachedRecord());
  const service = answeringFetch();
  const restore = withFetch(service.fetchImpl);
  try {
    const elapsed = await mustSettle(revokeCachedSession({ serverUrl: SERVER_URL, timeoutMs: BOUND_MS }));

    assert.deepEqual(
      service.calls.map((call) => call.path.split('/').pop()),
      ['refresh', 'logout'],
    );
    // The logout goes out with the ROTATED access token: that is the point of refreshing first.
    assert.equal(service.calls[1]?.authorization, 'Bearer access-new');
    assert.ok(elapsed < BOUND_MS, `an answered revoke does not wait for the bound (${elapsed} ms)`);
    assert.equal(await readSessionCache(), null);
  } finally {
    restore();
  }
});
