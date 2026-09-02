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
import { MAX_HANDLE_LENGTH, describeHandleProblem } from '../../app/lib/sync/handle';

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
  it('starts on enter-details with no server error', () => {
    assert.deepEqual(INITIAL_SYNC_SETUP_STATE, { kind: 'enter-details', serverError: null });
  });

  it('detailsSubmitted moves from enter-details to generating', () => {
    const next = syncSetupReducer(INITIAL_SYNC_SETUP_STATE, { type: 'detailsSubmitted' });
    assert.deepEqual(next, { kind: 'generating' });
  });

  it('setupSucceeded moves from generating to the account card, unconfirmed', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    const next = syncSetupReducer(generating, {
      type: 'setupSucceeded',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
    });
    assert.deepEqual(next, {
      kind: 'show-account-card',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
      hasConfirmedSaved: false,
    });
  });

  // THE CARD CARRIES BOTH, and that is the requirement rather than a detail:
  // a user who saves the code and never registers that the handle is equally
  // required to get back in has saved half a credential.
  it('the account card holds the handle beside the code, on one state', () => {
    const shown = syncSetupReducer({ kind: 'generating' }, {
      type: 'setupSucceeded',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
    });
    assert.equal(shown.kind === 'show-account-card' && shown.handle, 'k7m2q3xr9t');
    assert.equal(shown.kind === 'show-account-card' && shown.recoveryCode, 'ABCDE-FGHJK');
  });

  it('setupFailed with no field moves from generating to the retry screen', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    const next = syncSetupReducer(generating, { type: 'setupFailed', message: 'network error', field: null });
    assert.deepEqual(next, { kind: 'error', message: 'network error' });
  });

  // A refusal the person can act on is answered by editing a field, so it goes
  // BACK TO THE FORM rather than to a dead-end screen whose retry button would
  // fail identically (owner request, 2026-09-02).
  it('setupFailed with a field returns to the form, carrying the server error', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    const next = syncSetupReducer(generating, {
      type: 'setupFailed',
      message: 'that name is taken',
      field: 'handle',
    });
    assert.deepEqual(next, {
      kind: 'enter-details',
      serverError: { field: 'handle', message: 'that name is taken' },
    });
  });

  it('an invite refusal comes back under the invite field', () => {
    const next = syncSetupReducer({ kind: 'generating' }, {
      type: 'setupFailed',
      message: 'that invite is not valid',
      field: 'invite',
    });
    assert.equal(next.kind === 'enter-details' && next.serverError?.field, 'invite');
  });

  it('ignores a setupFailed that arrives outside of generating', () => {
    const complete: SyncSetupState = { kind: 'complete' };
    assert.deepEqual(syncSetupReducer(complete, { type: 'setupFailed', message: 'late', field: 'handle' }), complete);
  });

  it('confirmSavedToggled flips hasConfirmedSaved without losing the card', () => {
    const shown: SyncSetupState = {
      kind: 'show-account-card',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
      hasConfirmedSaved: false,
    };
    const checked = syncSetupReducer(shown, { type: 'confirmSavedToggled', checked: true });
    assert.deepEqual(checked, { ...shown, hasConfirmedSaved: true });
    const unchecked = syncSetupReducer(checked, { type: 'confirmSavedToggled', checked: false });
    assert.deepEqual(unchecked, shown);
  });

  it('finishRequested completes setup ONLY when hasConfirmedSaved is true', () => {
    const unconfirmed: SyncSetupState = {
      kind: 'show-account-card',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
      hasConfirmedSaved: false,
    };
    const stillShown = syncSetupReducer(unconfirmed, { type: 'finishRequested' });
    assert.deepEqual(stillShown, unconfirmed, 'finishRequested must be a no-op without confirmation');

    const complete = syncSetupReducer({ ...unconfirmed, hasConfirmedSaved: true }, { type: 'finishRequested' });
    assert.deepEqual(complete, { kind: 'complete' });
  });

  // Client-side validation no longer reaches this machine at all: an empty
  // name, an `@`, a short or mistyped passphrase and a malformed invite are
  // the signup schema's business, rendered by Conform under their own fields
  // (owner request, 2026-09-02). Only the SERVICE's refusals get a state.
  it('a resubmission from a server-rejected form goes back to generating', () => {
    const rejected: SyncSetupState = {
      kind: 'enter-details',
      serverError: { field: 'handle', message: 'that name is taken' },
    };
    assert.deepEqual(syncSetupReducer(rejected, { type: 'detailsSubmitted' }), { kind: 'generating' });
  });

  it('retried moves from error back to a clean enter-details', () => {
    const errored: SyncSetupState = { kind: 'error', message: 'network error' };
    const next = syncSetupReducer(errored, { type: 'retried' });
    assert.deepEqual(next, { kind: 'enter-details', serverError: null });
  });

  it('ignores an action that does not apply to the current state (no-op, no throw)', () => {
    const complete: SyncSetupState = { kind: 'complete' };
    const next = syncSetupReducer(complete, { type: 'detailsSubmitted' });
    assert.deepEqual(next, complete);
  });

  it('ignores a stray setupSucceeded that arrives outside of generating', () => {
    const errored: SyncSetupState = { kind: 'error', message: 'network error' };
    const next = syncSetupReducer(errored, {
      type: 'setupSucceeded',
      handle: 'k7m2q3xr9t',
      recoveryCode: 'ABCDE-FGHJK',
    });
    assert.deepEqual(next, errored);
  });
});

/**
 * The setup-COMPLETION (repair) entry point: an account that exists with no
 * key records, reached from the sign-in form where the handle and passphrase
 * have already been typed.
 */
describe('initialSyncSetupState', () => {
  it('starts on the details form by default, exactly as before', () => {
    assert.deepEqual(initialSyncSetupState(), INITIAL_SYNC_SETUP_STATE);
    assert.deepEqual(initialSyncSetupState({ resume: false }), INITIAL_SYNC_SETUP_STATE);
  });

  it('resuming skips straight to generating — the details were already collected', () => {
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
    state = syncSetupReducer(state, { type: 'setupSucceeded', handle: 'k7m2q3xr9t', recoveryCode: 'ABCDE-FGHJK' });
    assert.equal(state.kind, 'show-account-card');

    const skipped = syncSetupReducer(state, { type: 'finishRequested' });
    assert.equal(skipped.kind, 'show-account-card', 'the repair must not be able to bypass the confirm-saved gate');

    const acknowledged = syncSetupReducer(
      syncSetupReducer(state, { type: 'confirmSavedToggled', checked: true }),
      { type: 'finishRequested' },
    );
    assert.equal(acknowledged.kind, 'complete');
  });
});

/**
 * `describeHandleProblem` turns a refused candidate into the sentence shown
 * under the HANDLE FIELD on submit — three cases, three sentences, and the
 * field starts empty (owner decision, 2026-09-02) so "required" is the one a
 * first-time submit is most likely to hit. It lives in `handle.ts` because all
 * three sync forms feed it into a Zod schema.
 */
describe('describeHandleProblem', () => {
  it('names an empty candidate as required, not as any other problem', () => {
    assert.equal(describeHandleProblem('', fakeT), 'sync.setup.handleRequired');
    assert.equal(describeHandleProblem('   ', fakeT), 'sync.setup.handleRequired');
  });

  it('names an email-shaped candidate as not an email address', () => {
    assert.equal(describeHandleProblem('a@b', fakeT), 'sync.setup.handleNotAnEmail');
  });

  it('names an over-length candidate as too long', () => {
    assert.equal(describeHandleProblem('a'.repeat(MAX_HANDLE_LENGTH + 1), fakeT), 'sync.setup.handleTooLong');
  });

  it('accepts an ordinary handle with no problem', () => {
    assert.equal(describeHandleProblem('kitchen-sink', fakeT), null);
  });
});
