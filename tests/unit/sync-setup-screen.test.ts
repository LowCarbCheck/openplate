/**
 * The `/settings/sync` screen-selection rule, and the ceremony it protects.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * The route decided its screen with `session.account === null ? setup :
 * connected`. `createSyncAccount` opens the session as PART of provisioning,
 * so the instant the key records landed the route re-rendered, and the setup
 * subtree — including a wizard that was one dispatch away from displaying the
 * recovery code — was unmounted. The code is shown exactly once and is the
 * only data-preserving recovery path there is. Nobody ever saw it.
 *
 * ── Why the existing tests did not catch it ─────────────────────────────
 *
 * `sync-setup-flow.test.ts` covers the wizard, and it is correct: the reducer
 * genuinely cannot reach `complete` without the acknowledgment. The session
 * store is correct too. What was wrong was the COMPOSITION — one correct piece
 * unmounting another — and nothing tested that, because the wizard's tests
 * render it where no session exists to flip underneath it.
 *
 * ── What this file does about it, and what it honestly does not ─────────
 *
 * This repo's unit suite is `node:test` with no DOM and no renderer, so this
 * cannot mount the route. Instead the composition rule was given a name and
 * made pure (`resolveSyncScreen`), and the last test below drives the real
 * reducer through the real sequence — including the session appearing
 * mid-flight, at exactly the point production flips it — asserting the screen
 * never leaves `setup` until the user has ticked "I've saved it".
 *
 * That is a faithful model of the failure, not a substitute for a render test:
 * it would catch this bug and any future re-ordering of the rule, but it
 * cannot catch a route that stops calling `resolveSyncScreen` altogether. The
 * route is one line, and the browser E2E covers the rest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSyncScreen } from '../../app/lib/sync/setup-screen';
import {
  INITIAL_SYNC_SETUP_STATE,
  initialSyncSetupState,
  isSyncSetupCeremonyActive,
  syncSetupReducer,
  type SyncSetupState,
} from '../../app/lib/sync/setup-flow';

test('THE REGRESSION: an account appearing mid-ceremony does NOT swap the screen', () => {
  // This exact input is what production produced the moment provisioning
  // finished, and the old ternary answered 'connected' for it.
  assert.equal(resolveSyncScreen({ hasAccount: true, isCeremonyActive: true }), 'setup');
});

test('with no ceremony in flight the session decides, as it always did', () => {
  assert.equal(resolveSyncScreen({ hasAccount: false, isCeremonyActive: false }), 'setup');
  assert.equal(resolveSyncScreen({ hasAccount: true, isCeremonyActive: false }), 'connected');
});

test('a ceremony without a session still shows setup — the ordinary first screen', () => {
  assert.equal(resolveSyncScreen({ hasAccount: false, isCeremonyActive: true }), 'setup');
});

test('the ceremony is active exactly while the wizard owes the user something', () => {
  const states: { state: SyncSetupState; active: boolean; why: string }[] = [
    {
      state: { kind: 'enter-passphrase', error: null },
      active: false,
      why: 'nothing shown yet, no session to swap to',
    },
    { state: { kind: 'generating' }, active: true, why: 'THE SESSION FLIPS DURING THIS STATE' },
    {
      state: { kind: 'show-recovery-code', recoveryCode: 'X', hasConfirmedSaved: false },
      active: true,
      why: 'the one and only display of the code',
    },
    {
      state: { kind: 'show-recovery-code', recoveryCode: 'X', hasConfirmedSaved: true },
      active: true,
      why: 'ticked but not yet finished — still on screen',
    },
    {
      state: { kind: 'error', message: 'boom' },
      active: false,
      why: 'nothing to protect; do not trap the user in a wizard for an account that may already exist',
    },
    { state: { kind: 'complete' }, active: false, why: 'acknowledged — handing over is correct' },
  ];

  for (const { state, active, why } of states) {
    assert.equal(isSyncSetupCeremonyActive(state), active, `${state.kind}: ${why}`);
  }
});

test('the full provisioning sequence keeps the setup screen until the code is acknowledged', () => {
  // Walks the REAL reducer through the REAL order of events, with the session
  // appearing exactly where `createSyncAccount` opens it.
  let state = INITIAL_SYNC_SETUP_STATE;
  let hasAccount = false;
  const screenNow = (): string => resolveSyncScreen({ hasAccount, isCeremonyActive: isSyncSetupCeremonyActive(state) });

  assert.equal(screenNow(), 'setup', 'passphrase entry');

  state = syncSetupReducer(state, { type: 'passphraseSubmitted' });
  assert.equal(screenNow(), 'setup', 'deriving keys');

  // ---- `createSyncAccount` resolves here: signup + both key records are
  // written, and the session is opened. THIS is the moment the old code broke.
  hasAccount = true;
  assert.equal(screenNow(), 'setup', 'a session now exists, but the wizard is mid-flight');

  state = syncSetupReducer(state, { type: 'setupSucceeded', recoveryCode: 'ABCDE-FGHJK' });
  assert.equal(state.kind, 'show-recovery-code');
  assert.equal(screenNow(), 'setup', 'THE RECOVERY CODE IS ON SCREEN — nothing may replace it');

  // The user reads it, but has not ticked the box yet.
  assert.equal(screenNow(), 'setup', 'still displayed while unacknowledged');

  state = syncSetupReducer(state, { type: 'confirmSavedToggled', checked: true });
  assert.equal(screenNow(), 'setup', 'ticked, but not yet dismissed');

  state = syncSetupReducer(state, { type: 'finishRequested' });
  assert.equal(state.kind, 'complete');
  assert.equal(screenNow(), 'connected', 'only now does the connected panel take over');
});

test('THE REPAIR CEREMONY IS PROTECTED TOO — and it is protected from render one', () => {
  // The setup-completion path (an account with no key records, finished from
  // the sign-in form) has a WORSE version of the original hazard: it starts
  // already provisioning, so there is no `enter-passphrase` render in which
  // the flag could be raised. If the rule only covered the first-time path,
  // the session would open, the route would swap in the connected panel, and
  // the repair's recovery code — just as unrecoverable as a first-time one —
  // would never be seen.
  let state = initialSyncSetupState({ resume: true });
  let hasAccount = false;
  const screenNow = (): string => resolveSyncScreen({ hasAccount, isCeremonyActive: isSyncSetupCeremonyActive(state) });

  assert.equal(state.kind, 'generating', 'the repair opens straight into provisioning');
  assert.equal(screenNow(), 'setup', 'protected before a single action is dispatched');

  // ---- `completeSetup` resolves: both key records are written and the vault
  // is opened. Same moment, same hazard, different entry point.
  hasAccount = true;
  assert.equal(screenNow(), 'setup', 'the session now exists, but the repair is mid-flight');

  state = syncSetupReducer(state, { type: 'setupSucceeded', recoveryCode: 'ABCDE-FGHJK' });
  assert.equal(screenNow(), 'setup', 'THE RECOVERY CODE IS ON SCREEN — nothing may replace it');

  state = syncSetupReducer(state, { type: 'confirmSavedToggled', checked: true });
  assert.equal(screenNow(), 'setup', 'ticked, but not yet dismissed');

  state = syncSetupReducer(state, { type: 'finishRequested' });
  assert.equal(state.kind, 'complete');
  assert.equal(screenNow(), 'connected', 'only now does the connected panel take over');
});

test('the pending email-verification screen stays on setup and never claims a connection', () => {
  // Nothing was written and no session was opened, so `hasAccount` is false
  // and the screen must keep showing the wizard's own explanation rather than
  // bouncing the user back to a choose-your-path card.
  const state = syncSetupReducer(
    syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'passphraseSubmitted' }),
    { type: 'verificationRequired', email: 'someone@example.test' },
  );

  assert.equal(state.kind, 'awaiting-email-verification');
  assert.equal(isSyncSetupCeremonyActive(state), false, 'there is no key material or session to protect');
  assert.equal(resolveSyncScreen({ hasAccount: false, isCeremonyActive: false }), 'setup');
});

test('a failed provision releases the screen instead of trapping the user', () => {
  // If signup succeeded but a later step threw, an account may exist. Holding
  // the wizard open would leave no route to it — the connected panel is the
  // more useful place to land.
  let state: SyncSetupState = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'passphraseSubmitted' });
  state = syncSetupReducer(state, { type: 'setupFailed', message: 'the sync server could not be reached' });

  assert.equal(isSyncSetupCeremonyActive(state), false);
  assert.equal(resolveSyncScreen({ hasAccount: true, isCeremonyActive: false }), 'connected');
});

test('the acknowledgment gate is what releases the screen — it cannot be skipped', () => {
  // Belt-and-braces with `sync-setup-flow.test.ts`: the ONLY transition out of
  // `show-recovery-code` into `complete` requires `hasConfirmedSaved`, so the
  // screen-release rule inherits that guarantee rather than restating it.
  const shown = syncSetupReducer(syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'passphraseSubmitted' }), {
    type: 'setupSucceeded',
    recoveryCode: 'ABCDE-FGHJK',
  });

  const skipped = syncSetupReducer(shown, { type: 'finishRequested' });
  assert.equal(skipped.kind, 'show-recovery-code', 'finishing without ticking must be a no-op');
  assert.equal(isSyncSetupCeremonyActive(skipped), true);
  assert.equal(resolveSyncScreen({ hasAccount: true, isCeremonyActive: true }), 'setup');
});
