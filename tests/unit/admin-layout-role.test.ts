/**
 * `/admin`'s view-state decision: the three loading states, and the one
 * deny (0.10.1 walk defect 2).
 *
 * `resolveAdminViewState` is exported and tested directly, not through a
 * render. `AdminLayout` reads `useSyncSession()`, which is a plain
 * `useSyncExternalStore` over the module-level snapshot in `sync-session.ts`
 * — but that hook's `getServerSnapshot` is a HARDCODED constant (`SIGNED_OUT`)
 * by design, so `renderToStaticMarkup` (the only render this repo's unit tier
 * has) can never see anything but the signed-out branch, whatever the module
 * state actually holds. The decision has to live somewhere a test can reach
 * it without a render, which is the whole reason it is a separate function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAdminViewState } from '../../app/routes/admin';

test('a resume in progress is the loading state, whatever the account says', () => {
  assert.equal(
    resolveAdminViewState({ isResuming: true, account: null }),
    'resuming',
    'isResuming wins over everything else — the account may simply not have arrived yet',
  );
});

test('a signed-in session with role: null is "unknown-role", never "denied"', () => {
  const state = resolveAdminViewState({
    isResuming: false,
    account: {
      id: 1,
      email: 'owner@example.org',
      displayName: null,
      role: null,
      dailyAiLimit: null,
      aiUsedToday: null,
    },
  });
  assert.equal(state, 'unknown-role', 'an unread role must never fall through to the deny card');
});

test('no session at all is "denied"', () => {
  assert.equal(resolveAdminViewState({ isResuming: false, account: null }), 'denied');
});

test('a known role of "member" is "denied"', () => {
  const state = resolveAdminViewState({
    isResuming: false,
    account: { id: 2, email: 'anna@example.org', displayName: null, role: 'member', dailyAiLimit: 200, aiUsedToday: 3 },
  });
  assert.equal(state, 'denied');
});

test('a known role of "admin" is "granted"', () => {
  const state = resolveAdminViewState({
    isResuming: false,
    account: { id: 1, email: 'owner@example.org', displayName: null, role: 'admin', dailyAiLimit: 500, aiUsedToday: 1 },
  });
  assert.equal(state, 'granted');
});
