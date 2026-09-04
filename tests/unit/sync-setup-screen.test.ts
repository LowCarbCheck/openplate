/**
 * The `/settings/sync` screen-selection rule, and the ceremony it protects.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * The route decided its screen with `session.account === null ? setup :
 * connected`. `createSyncAccount` opens the session as PART of provisioning,
 * so the instant the account landed the route re-rendered and the setup
 * subtree was unmounted mid-flight. When there was still a recovery code to
 * show — shown exactly once, the only data-preserving recovery path there was
 * — nobody ever saw it. M192 escrows the code and shows nothing, so the same
 * bug is now "the screen changed under me halfway through", which is smaller
 * and still wrong.
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
 * made pure (`resolveSyncScreen`), and the tests below drive the real reducer
 * through the real sequence — including the session appearing mid-flight, at
 * exactly the point production flips it — asserting the screen never leaves
 * `setup` while the wizard is still working.
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
      state: { kind: 'enter-details', serverError: null },
      active: false,
      why: 'nothing shown yet, no session to swap to',
    },
    { state: { kind: 'generating' }, active: true, why: 'THE SESSION FLIPS DURING THIS STATE' },
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

test('the full provisioning sequence keeps the setup screen until the wizard releases it', () => {
  // Walks the REAL reducer through the REAL order of events, with the session
  // appearing exactly where `createSyncAccount` opens it.
  let state = INITIAL_SYNC_SETUP_STATE;
  let hasAccount = false;
  const screenNow = (): string => resolveSyncScreen({ hasAccount, isCeremonyActive: isSyncSetupCeremonyActive(state) });

  assert.equal(screenNow(), 'setup', 'invite and password entry');

  state = syncSetupReducer(state, { type: 'detailsSubmitted' });
  assert.equal(screenNow(), 'setup', 'deriving keys');

  // ---- `createSyncAccount` resolves here: signup + both key records are
  // written, and the session is opened. THIS is the moment the old code broke.
  hasAccount = true;
  assert.equal(screenNow(), 'setup', 'a session now exists, but the wizard is mid-flight');

  state = syncSetupReducer(state, { type: 'setupSucceeded' });
  assert.equal(state.kind, 'complete');
  assert.equal(screenNow(), 'connected', 'only now does the connected panel take over');
});

test('THE REPAIR CEREMONY IS PROTECTED TOO — and it is protected from render one', () => {
  // The setup-completion path (an account with no key records, finished from
  // the sign-in form) has a WORSE version of the original hazard: it starts
  // already provisioning, so there is no `enter-details` render in which the
  // flag could be raised. If the rule only covered the first-time path, the
  // session would open and the route would swap in the connected panel while
  // the repair was still writing key records.
  let state = initialSyncSetupState({ resume: true });
  let hasAccount = false;
  const screenNow = (): string => resolveSyncScreen({ hasAccount, isCeremonyActive: isSyncSetupCeremonyActive(state) });

  assert.equal(state.kind, 'generating', 'the repair opens straight into provisioning');
  assert.equal(screenNow(), 'setup', 'protected before a single action is dispatched');

  // ---- `completeSetup` resolves: both key records are written and the vault
  // is opened. Same moment, same hazard, different entry point.
  hasAccount = true;
  assert.equal(screenNow(), 'setup', 'the session now exists, but the repair is mid-flight');

  state = syncSetupReducer(state, { type: 'setupSucceeded' });
  assert.equal(state.kind, 'complete');
  assert.equal(screenNow(), 'connected', 'only now does the connected panel take over');
});

test('a failed provision releases the screen instead of trapping the user', () => {
  // If signup succeeded but a later step threw, an account may exist. Holding
  // the wizard open would leave no route to it — the connected panel is the
  // more useful place to land.
  let state: SyncSetupState = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'detailsSubmitted' });
  state = syncSetupReducer(state, {
    type: 'setupFailed',
    message: 'the sync server could not be reached',
    field: null,
  });

  assert.equal(isSyncSetupCeremonyActive(state), false);
  assert.equal(resolveSyncScreen({ hasAccount: true, isCeremonyActive: false }), 'connected');
});

test('WHAT M192 DELETED HERE: the acknowledgment gate', () => {
  // There used to be a test asserting that `finishRequested` without
  // `hasConfirmedSaved` left the account card on screen. Both the action and
  // the state are gone: the recovery code is escrowed with the service and
  // never shown, so there is nothing for a person to acknowledge.
  //
  // The SCREEN rule survives it, and this is what is left of the guarantee:
  // `generating` is still protected, so the connected panel cannot take over
  // while provisioning is in flight.
  const generating = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'detailsSubmitted' });
  assert.equal(generating.kind, 'generating');
  assert.equal(
    resolveSyncScreen({ hasAccount: true, isCeremonyActive: isSyncSetupCeremonyActive(generating) }),
    'setup',
  );
});
