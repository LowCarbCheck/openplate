/**
 * A session the SERVER ends must be as visible as one the person ends.
 *
 * ── The incident (0.10.3, beta.openplate.de) ─────────────────────────────
 *
 * A managed instance signed people out and said nothing. The diary kept
 * rendering, because it is device data and needs no session, so the app looked
 * signed in until they opened /scan and were told their account was not
 * switched on for photo estimates and to ask their administrator. The account
 * had an allowance of 200 and had never been suspended.
 *
 * The silence had one mechanical cause. `closeSyncSession` publishes the
 * SIGNED_OUT constant, whose `error` is `null` by construction, and both paths
 * that end a refused session went through it, `syncNow` even set
 * `reauth-required` one line before `closeAndForgetSyncSession` wiped it. So
 * `sync.status.error.reauth-required` had been written, translated and shipped
 * without ever being reachable.
 *
 * ── Why this file reads source as well as behaviour ──────────────────────
 *
 * `syncNow` needs an open vault, a device store and a merge cycle; driving one
 * here would be an integration test wearing a unit test's clothes. What can be
 * checked without any of that is the two halves that actually matter: that
 * `endSessionRefused` publishes the reason (behaviour, below), and that the
 * refused-cycle branch calls IT rather than the function that wipes the error
 * (source, below). The second is a one-line claim about a file, and it is the
 * line the incident turned on.
 */
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';

import { clearSessionCache, endSessionRefused, readSessionCache } from '../../app/lib/sync/session-cache';
import { closeSyncSession, getSyncSessionSnapshot, updateSyncSession } from '../../app/lib/sync/sync-session';
import { isDeviceLocked, setLockDeviceWhenSessionEnds, unlockDevice } from '../../app/lib/sync/sync-state';

const REFUSED = { reason: 'reauth-required', message: 'Your session ended.' } as const;

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

beforeEach(async () => {
  closeSyncSession();
  await clearSessionCache();
  setLockDeviceWhenSessionEnds(false);
  unlockDevice();
});

test('a refused cycle leaves the reason ON the snapshot, not wiped off it', async () => {
  // The shape `syncNow` is in when it reaches the branch: it has classified the
  // failure and published it, and the session end is what happens next.
  updateSyncSession({ error: { reason: 'reauth-required', message: 'Your session ended.' } });

  await endSessionRefused(REFUSED);

  const snapshot = getSyncSessionSnapshot();
  assert.equal(snapshot.account, null, 'the session is over');
  assert.equal(snapshot.isResuming, false, 'and settled, so no screen waits for it');
  assert.equal(snapshot.error?.reason, 'reauth-required', 'a sign-out nobody asked for has to say so');
});

test('it still drops the cached copy, or the next reload would resume a dead session', async () => {
  await endSessionRefused(REFUSED);
  assert.equal(await readSessionCache(), null);
});

test('it locks the device only where the instance asks for it', async () => {
  await endSessionRefused(REFUSED);
  assert.equal(isDeviceLocked(), false, 'on an open instance the diary belongs to the device');

  setLockDeviceWhenSessionEnds(true);
  await endSessionRefused(REFUSED);
  assert.equal(isDeviceLocked(), true, 'on a managed one it belongs to the account, so the diary closes');
});

test('the refused-cycle branch calls the visible ending, not the silent one', () => {
  const source = readSource('app/lib/sync/sync-actions.ts');

  assert.match(
    source,
    /failure\.reason === 'reauth-required'\) await endSessionRefused\(failure\)/,
    'the branch must pass the failure on, so the reason survives the sign-out',
  );
  // `closeAndForgetSyncSession` is still the right call for the two DELIBERATE
  // endings, sign-out and account deletion. What it must never be again is the
  // answer to a refusal.
  assert.equal(
    [...source.matchAll(/await closeAndForgetSyncSession\(\)/g)].length,
    2,
    'exactly the two deliberate endings: sign-out and account deletion',
  );
});

test('the welcome screen renders the reason the refusal published', () => {
  const source = readSource('app/routes/welcome.tsx');

  // The copy existed and was unreachable. This is the one place a person sent
  // here by a refused session can read why they are being asked to sign in.
  assert.match(source, /session\.error\?\.reason === 'reauth-required'/);
  assert.match(source, /t\('sync\.status\.error\.reauth-required'\)/);
});
