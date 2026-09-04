/**
 * WHICH AI this device may use — the rule, and the thing it must never do.
 *
 * ── Why this rule gets its own file ──────────────────────────────────────
 *
 * It is the fourth attempt at one question. M187/02 answered it by STORING the
 * answer: a gateway join wrote an ordinary settings row carrying a member
 * token, and that row then had to be kept in step with the account across
 * devices — synced inside the owner-private compartment, reconciled on drift,
 * cleared on a disconnect, tombstoned so a second device would not hand it
 * back. Four mechanisms for one derived fact, and the drift reconciliation
 * existed because they did not hold.
 *
 * M192 derives it instead. A derived value cannot drift, so what is left to
 * test is the RULE, and every branch of it is a decision somebody could get
 * wrong in a way nothing else would catch:
 *
 *  - BYOK is refused on a managed instance, even when a row exists. Such a row
 *    is a leftover, and honouring it would send plate photos to a provider the
 *    organization did not choose while its own allowance sat unused.
 *  - An allowance of ZERO is the default for a new account, so "signed in, no
 *    AI" is an ordinary standing rather than an error — and it must not fall
 *    back to BYOK either.
 *  - Nothing is written anywhere. The absence of a write is the property, so
 *    it is asserted against the module's own source: there is no store to
 *    observe an absent write in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MANAGED_AI_API_PREFIX,
  resolveEffectiveAiSettings,
  type ManagedInstanceFacts,
} from '../../app/lib/ai/managed-ai-settings';
import type { LocalAiSettings } from '../../app/lib/local-store/ai-settings';
import type { SyncSessionSnapshot } from '../../app/lib/sync/sync-session';

const SERVER_URL = 'https://sync.example.test';

const MANAGED: ManagedInstanceFacts = { managed: true, syncServerUrl: SERVER_URL, model: 'fake/vision-1' };
const OPEN: ManagedInstanceFacts = { managed: false, syncServerUrl: null, model: null };

const SIGNED_OUT: SyncSessionSnapshot = {
  account: null,
  isResuming: false,
  phase: 'idle',
  lastSyncedAt: null,
  hasPendingChanges: false,
  error: null,
};

function signedIn(overrides: { dailyAiLimit?: number } = {}): SyncSessionSnapshot {
  return {
    ...SIGNED_OUT,
    account: {
      id: 7,
      email: 'anna@example.org',
      displayName: null,
      role: 'member',
      dailyAiLimit: overrides.dailyAiLimit ?? 200,
      aiUsedToday: 3,
    },
  };
}

const BYOK: LocalAiSettings = {
  provider: 'openrouter',
  model: 'openai/gpt-5.6-luna',
  baseUrl: null,
  apiKey: 'sk-or-v1-a-key-this-person-brought',
  connectedVia: 'manual',
  updatedAt: 1,
};

// ---------------------------------------------------------------------------
// A managed instance
// ---------------------------------------------------------------------------

test('a signed-in account with an allowance scans through its own server', () => {
  const effective = resolveEffectiveAiSettings({ instance: MANAGED, session: signedIn(), storedSettings: null });

  assert.deepEqual(effective, {
    source: 'managed',
    provider: 'managed',
    baseUrl: `${SERVER_URL}${MANAGED_AI_API_PREFIX}`,
    model: 'fake/vision-1',
  });
});

test('the model comes from the instance, and a null one stays null', () => {
  // NULLABLE ON PURPOSE. The proxy passes the request body through untouched,
  // so a scan needs a real model id; an instance with an upstream key and no
  // advertised model is a misconfiguration its operator has to fix, and
  // `createVisionProvider` requires a `string` so no caller can send `''`.
  const effective = resolveEffectiveAiSettings({
    instance: { ...MANAGED, model: null },
    session: signedIn(),
    storedSettings: null,
  });

  assert.equal(effective?.source, 'managed');
  assert.equal(effective?.source === 'managed' && effective.model, null);
});

test('signed OUT on a managed instance is no AI at all — not a fallback to a stored key', () => {
  // The row would be a leftover from before the instance was managed, or from
  // a device that was once on an open one. Honouring it would send this
  // person's plate photos to a provider their organization did not choose.
  assert.equal(resolveEffectiveAiSettings({ instance: MANAGED, session: SIGNED_OUT, storedSettings: BYOK }), null);
});

test('an allowance of zero is no AI, and still not a fallback to a stored key', () => {
  // Zero is the DEFAULT for a new account, so this is an ordinary standing an
  // admin decides — "ask your administrator", not "something went wrong".
  assert.equal(
    resolveEffectiveAiSettings({
      instance: MANAGED,
      session: signedIn({ dailyAiLimit: 0 }),
      storedSettings: BYOK,
    }),
    null,
  );
});

test('a managed instance with no server address answers null rather than throwing', () => {
  // Unreachable in production — `isManagedInstance` stops the boot — so this
  // is the belt to that braces. A screen must not crash on a configuration it
  // did not make.
  assert.equal(
    resolveEffectiveAiSettings({
      instance: { managed: true, syncServerUrl: null, model: 'fake/vision-1' },
      session: signedIn(),
      storedSettings: BYOK,
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// An open instance
// ---------------------------------------------------------------------------

test('an open instance uses the device’s own BYOK row, signed in or not', () => {
  for (const session of [SIGNED_OUT, signedIn()]) {
    assert.deepEqual(resolveEffectiveAiSettings({ instance: OPEN, session, storedSettings: BYOK }), {
      source: 'stored',
      settings: BYOK,
    });
  }
});

test('an open instance with no row is no AI', () => {
  assert.equal(resolveEffectiveAiSettings({ instance: OPEN, session: SIGNED_OUT, storedSettings: null }), null);
});

test('an open instance never derives managed settings, even for an account with an allowance', () => {
  // The mirror of the BYOK refusal above: an open instance's server proxies
  // nothing, so deriving a base URL for it would produce a scan that dies with
  // a 404 nobody could explain.
  const effective = resolveEffectiveAiSettings({
    instance: { managed: false, syncServerUrl: SERVER_URL, model: 'fake/vision-1' },
    session: signedIn(),
    storedSettings: BYOK,
  });

  assert.equal(effective?.source, 'stored');
});

// ---------------------------------------------------------------------------
// Derived, never stored
// ---------------------------------------------------------------------------

test('the rule writes nothing, and its source carries no writer to accidentally call', () => {
  // THE PROPERTY IS AN ABSENCE, and there is no store to observe an absence
  // in: this module never opens one. So it is asserted against the source,
  // which is where a future edit would introduce the write.
  //
  // The names are the local store's own writers. `putLocalAiSettings` is the
  // one M187/02 called; the others are here so the grep does not have to be
  // re-derived if the settings writer is ever renamed.
  const source = readFileSync(new URL('../../app/lib/ai/managed-ai-settings.ts', import.meta.url), 'utf8');
  for (const writer of ['putLocalAiSettings', 'deleteLocalAiSettings', 'getAiStore', 'setRow']) {
    assert.doesNotMatch(source, new RegExp(writer), `the derivation must not ${writer}`);
  }
});

test('the managed settings carry no key material for anything to persist', () => {
  const effective = resolveEffectiveAiSettings({ instance: MANAGED, session: signedIn(), storedSettings: null });
  assert.ok(effective !== null);
  // No `apiKey`, and no bearer: the credential is the account's access token,
  // fetched from the vault one frame before the request
  // (`managedAiCredential`). A settings object carrying one would be a
  // credential a screen could put in React state.
  assert.equal('apiKey' in effective, false);
  assert.equal(JSON.stringify(effective).includes('Bearer'), false);
});
