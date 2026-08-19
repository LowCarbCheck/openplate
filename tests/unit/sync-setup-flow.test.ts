/**
 * Unit tests for `#app/lib/sync/setup-flow` — the pure sync-setup wizard
 * state machine (M117/08 item 5).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_SYNC_SETUP_STATE,
  MIN_SYNC_PASSPHRASE_LENGTH,
  initialSyncSetupState,
  isSyncSetupCeremonyActive,
  syncSetupReducer,
  validateSyncPassphrase,
} from '../../app/lib/sync/setup-flow';
import type { SyncSetupState, Translate } from '../../app/lib/sync/setup-flow';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

describe('validateSyncPassphrase', () => {
  it('rejects a passphrase shorter than the minimum', () => {
    assert.notEqual(validateSyncPassphrase('short', fakeT), null);
  });

  it('rejects a passphrase that is only whitespace padding to length', () => {
    assert.notEqual(validateSyncPassphrase('   short   ', fakeT), null);
  });

  it('names the minimum length in the rejection message', () => {
    assert.equal(
      validateSyncPassphrase('short', fakeT),
      `sync.setup.passphraseTooShort {"min":${MIN_SYNC_PASSPHRASE_LENGTH}}`,
    );
  });

  it('accepts a passphrase at exactly the minimum length', () => {
    assert.equal(validateSyncPassphrase('a'.repeat(MIN_SYNC_PASSPHRASE_LENGTH), fakeT), null);
  });

  it('accepts a passphrase well above the minimum', () => {
    assert.equal(validateSyncPassphrase('a correct horse battery staple', fakeT), null);
  });
});

describe('syncSetupReducer', () => {
  it('starts on enter-passphrase with no error', () => {
    assert.deepEqual(INITIAL_SYNC_SETUP_STATE, { kind: 'enter-passphrase', error: null });
  });

  it('passphraseRejected sets the error and stays on enter-passphrase', () => {
    const next = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'passphraseRejected', message: 'too short' });
    assert.deepEqual(next, { kind: 'enter-passphrase', error: 'too short' });
  });

  it('passphraseSubmitted moves from enter-passphrase to generating', () => {
    const next = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'passphraseSubmitted' });
    assert.deepEqual(next, { kind: 'generating' });
  });

  it('setupSucceeded moves from generating to show-recovery-code, unconfirmed', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    const next = syncSetupReducer(generating, { type: 'setupSucceeded', recoveryCode: 'ABCDE-FGHJK' });
    assert.deepEqual(next, { kind: 'show-recovery-code', recoveryCode: 'ABCDE-FGHJK', hasConfirmedSaved: false });
  });

  it('setupFailed moves from generating to error', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    const next = syncSetupReducer(generating, { type: 'setupFailed', message: 'network error' });
    assert.deepEqual(next, { kind: 'error', message: 'network error' });
  });

  it('confirmSavedToggled flips hasConfirmedSaved without losing the recovery code', () => {
    const shown: SyncSetupState = { kind: 'show-recovery-code', recoveryCode: 'ABCDE-FGHJK', hasConfirmedSaved: false };
    const checked = syncSetupReducer(shown, { type: 'confirmSavedToggled', checked: true });
    assert.deepEqual(checked, { kind: 'show-recovery-code', recoveryCode: 'ABCDE-FGHJK', hasConfirmedSaved: true });
    const unchecked = syncSetupReducer(checked, { type: 'confirmSavedToggled', checked: false });
    assert.deepEqual(unchecked, { kind: 'show-recovery-code', recoveryCode: 'ABCDE-FGHJK', hasConfirmedSaved: false });
  });

  it('finishRequested completes setup ONLY when hasConfirmedSaved is true', () => {
    const unconfirmed: SyncSetupState = {
      kind: 'show-recovery-code',
      recoveryCode: 'ABCDE-FGHJK',
      hasConfirmedSaved: false,
    };
    const stillShown = syncSetupReducer(unconfirmed, { type: 'finishRequested' });
    assert.deepEqual(stillShown, unconfirmed, 'finishRequested must be a no-op without confirmation');

    const confirmed: SyncSetupState = {
      kind: 'show-recovery-code',
      recoveryCode: 'ABCDE-FGHJK',
      hasConfirmedSaved: true,
    };
    const complete = syncSetupReducer(confirmed, { type: 'finishRequested' });
    assert.deepEqual(complete, { kind: 'complete' });
  });

  it('retried moves from error back to a clean enter-passphrase', () => {
    const errored: SyncSetupState = { kind: 'error', message: 'network error' };
    const next = syncSetupReducer(errored, { type: 'retried' });
    assert.deepEqual(next, { kind: 'enter-passphrase', error: null });
  });

  it('ignores an action that does not apply to the current state (no-op, no throw)', () => {
    const complete: SyncSetupState = { kind: 'complete' };
    const next = syncSetupReducer(complete, { type: 'passphraseSubmitted' });
    assert.deepEqual(next, complete);
  });

  it('ignores a stray setupSucceeded that arrives outside of generating', () => {
    const errored: SyncSetupState = { kind: 'error', message: 'network error' };
    const next = syncSetupReducer(errored, { type: 'setupSucceeded', recoveryCode: 'ABCDE-FGHJK' });
    assert.deepEqual(next, errored);
  });
});

/**
 * The email-verification pending state.
 *
 * On an instance running with `REQUIRE_EMAIL_VERIFICATION`, signup creates the
 * account and withholds the session, so no key records can be written yet.
 * That used to throw, which put a red error in front of a user whose account
 * had just been created correctly and left them with nowhere to go — signing
 * up again answers `409` forever.
 */
describe('syncSetupReducer: awaiting email verification', () => {
  const generating: SyncSetupState = { kind: 'generating' };

  it('THE REGRESSION: a withheld session is a pending state, not the error state', () => {
    const next = syncSetupReducer(generating, { type: 'verificationRequired', email: 'someone@example.test' });

    assert.deepEqual(next, { kind: 'awaiting-email-verification', email: 'someone@example.test' });
    assert.notEqual(next.kind, 'error', 'a designed outcome must never render as a failure');
  });

  it('holds no recovery code — none was minted, because no keys could be written', () => {
    const next = syncSetupReducer(generating, { type: 'verificationRequired', email: 'someone@example.test' });
    assert.equal('recoveryCode' in next, false);
  });

  it('does not hold the screen: there is no session to protect against', () => {
    const next = syncSetupReducer(generating, { type: 'verificationRequired', email: 'someone@example.test' });
    assert.equal(isSyncSetupCeremonyActive(next), false);
  });

  it('is only reachable from generating', () => {
    const shown: SyncSetupState = { kind: 'show-recovery-code', recoveryCode: 'ABCDE-FGHJK', hasConfirmedSaved: false };
    const next = syncSetupReducer(shown, { type: 'verificationRequired', email: 'someone@example.test' });
    assert.deepEqual(next, shown, 'a late verificationRequired must never displace a displayed recovery code');
  });
});

/**
 * The setup-COMPLETION (repair) entry point: an account that exists with no
 * key records, reached from the sign-in form where the passphrase has already
 * been typed.
 */
describe('initialSyncSetupState', () => {
  it('starts on passphrase entry by default, exactly as before', () => {
    assert.deepEqual(initialSyncSetupState(), INITIAL_SYNC_SETUP_STATE);
    assert.deepEqual(initialSyncSetupState({ resume: false }), INITIAL_SYNC_SETUP_STATE);
  });

  it('resuming skips straight to generating — the passphrase was already collected', () => {
    assert.deepEqual(initialSyncSetupState({ resume: true }), { kind: 'generating' });
  });

  it('a resumed ceremony holds the screen from its very first render', () => {
    // `completeSetup` opens the session while this state is showing, so the
    // protection has to be in place before anything is dispatched — not from
    // the moment the code appears.
    assert.equal(isSyncSetupCeremonyActive(initialSyncSetupState({ resume: true })), true);
  });

  it('a resumed ceremony reaches the SAME un-skippable acknowledgment gate', () => {
    let state = initialSyncSetupState({ resume: true });
    state = syncSetupReducer(state, { type: 'setupSucceeded', recoveryCode: 'ABCDE-FGHJK' });
    assert.equal(state.kind, 'show-recovery-code');

    const skipped = syncSetupReducer(state, { type: 'finishRequested' });
    assert.equal(skipped.kind, 'show-recovery-code', 'the repair must not be able to bypass the confirm-saved gate');

    const acknowledged = syncSetupReducer(
      syncSetupReducer(state, { type: 'confirmSavedToggled', checked: true }),
      { type: 'finishRequested' },
    );
    assert.equal(acknowledged.kind, 'complete');
  });
});
