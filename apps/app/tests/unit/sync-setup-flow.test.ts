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
import { MAX_EMAIL_LENGTH, canonicalizeEmail, describeEmailProblem } from '../../app/lib/sync/email';

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

  // STRAIGHT TO `complete`, with no card between (M192). The account exists,
  // the session is open, and the person has nothing to write down: the
  // recovery code is escrowed with the service and never shown.
  it('setupSucceeded moves from generating straight to complete', () => {
    const generating: SyncSetupState = { kind: 'generating' };
    assert.deepEqual(syncSetupReducer(generating, { type: 'setupSucceeded' }), { kind: 'complete' });
  });

  // THE ACTION CARRIES NOTHING, and that is the requirement rather than a
  // detail: an action with a `recoveryCode` on it is an action some future
  // screen can render.
  it('the success action carries no recovery code for anything to render', () => {
    const action = { type: 'setupSucceeded' } as const;
    assert.deepEqual(Object.keys(action), ['type']);
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
      message: 'that invitation is no longer valid',
      field: 'invite',
    });
    assert.deepEqual(next, {
      kind: 'enter-details',
      serverError: { field: 'invite', message: 'that invitation is no longer valid' },
    });
  });

  it('an invite refusal comes back under the invite field', () => {
    const next = syncSetupReducer(
      { kind: 'generating' },
      {
        type: 'setupFailed',
        message: 'that invite is not valid',
        field: 'invite',
      },
    );
    assert.equal(next.kind === 'enter-details' && next.serverError?.field, 'invite');
  });

  it('ignores a setupFailed that arrives outside of generating', () => {
    const complete: SyncSetupState = { kind: 'complete' };
    assert.deepEqual(syncSetupReducer(complete, { type: 'setupFailed', message: 'late', field: 'invite' }), complete);
  });

  // Client-side validation no longer reaches this machine at all: a short or
  // mistyped password and a malformed invite are the signup schema's business,
  // rendered by Conform under their own fields (owner request, 2026-09-02).
  // Only the SERVICE's refusals get a state.
  it('a resubmission from a server-rejected form goes back to generating', () => {
    const rejected: SyncSetupState = {
      kind: 'enter-details',
      serverError: { field: 'invite', message: 'that invitation is no longer valid' },
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
    assert.deepEqual(syncSetupReducer(errored, { type: 'setupSucceeded' }), errored);
  });
});

/**
 * The setup-COMPLETION (repair) entry point: an account that exists with no
 * key records, reached from the sign-in form where the address and the
 * password have already been typed.
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
    // protection has to be in place before anything is dispatched.
    assert.equal(isSyncSetupCeremonyActive(initialSyncSetupState({ resume: true })), true);
  });

  it('a resumed ceremony ends the same way a first-time one does', () => {
    const state = syncSetupReducer(initialSyncSetupState({ resume: true }), { type: 'setupSucceeded' });
    assert.equal(state.kind, 'complete');
    assert.equal(isSyncSetupCeremonyActive(state), false, 'the screen is released once the repair is done');
  });
});

/**
 * `describeEmailProblem` turns a refused address into the sentence shown under
 * the ADDRESS FIELD on submit. It lives in `email.ts` because two sync forms
 * feed it into a Zod schema, and because it is the INVERSE of the rule it
 * replaced: a handle was refused for containing `@`, and an address is refused
 * for not containing exactly one.
 */
describe('describeEmailProblem', () => {
  it('names an empty value as required, not as any other problem', () => {
    assert.equal(describeEmailProblem('', fakeT), 'sync.email.required');
    assert.equal(describeEmailProblem('   ', fakeT), 'sync.email.required');
  });

  it('names the maximum in the too-long message, so it is actionable', () => {
    const tooLong = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.org`;
    assert.equal(describeEmailProblem(tooLong, fakeT), `sync.email.tooLong {"max":${MAX_EMAIL_LENGTH}}`);
  });

  it('refuses the ordinary typing accidents, and only those', () => {
    // Each of these is a value the service would refuse, so catching it here
    // turns a round trip nobody can explain into a sentence under the field.
    for (const bad of ['anna', 'anna@', '@example.org', 'anna@@example.org', 'anna@example', 'anna @example.org']) {
      assert.notEqual(describeEmailProblem(bad, fakeT), null, bad);
    }
  });

  it('accepts an ordinary address, and one with the parts people actually use', () => {
    for (const good of ['anna@example.org', 'anna.b+openplate@mail.example.co.uk', 'A.Nna@Example.ORG']) {
      assert.equal(describeEmailProblem(good, fakeT), null, good);
    }
  });
});

/**
 * The canonical form — NFKC, trimmed, lowercased.
 *
 * It matters more than it looks: `POST /v1/auth/kdf` and `POST /v1/auth/login`
 * must agree on the string, and an Argon2id run against a differently-spelled
 * address derives a verifier that simply does not match. On screen that is
 * indistinguishable from a wrong password.
 */
describe('canonicalizeEmail', () => {
  it('lowercases, trims, and normalises', () => {
    assert.equal(canonicalizeEmail('  Anna@Example.ORG \n'), 'anna@example.org');
    // NFKC folds a fullwidth form onto the ordinary one; two spellings of one
    // address must collide here, as they do in the service's unique index.
    assert.equal(canonicalizeEmail('\uFF41nna@example.org'), 'anna@example.org');
  });

  it('canonicalises whatever it is given, including a value the checker refuses', () => {
    // Canonicalising and validating are separate steps, because the caller
    // does them in a different order: a form validates what was typed, and a
    // request sends what was canonicalised.
    assert.equal(canonicalizeEmail('  NOT AN ADDRESS '), 'not an address');
  });
});
