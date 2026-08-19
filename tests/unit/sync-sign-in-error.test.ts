/**
 * Sign-in failure classification.
 *
 * The distinction under test is the one the deadlock hid: on an instance with
 * `REQUIRE_EMAIL_VERIFICATION`, login answers `403` for an unconfirmed address
 * and `401` for a wrong passphrase. Both used to reach the same "check the
 * address and passphrase" message, which is actively wrong in the `403` case —
 * the credentials were correct and retyping them can never help.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifySignInFailure } from '../../app/lib/sync/sign-in-error';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';

describe('classifySignInFailure', () => {
  it('THE REGRESSION: an unverified address is NOT reported as a bad passphrase', () => {
    const unverified = new SyncRequestError({
      kind: 'forbidden',
      message: 'email address is not verified',
      status: 403,
    });
    assert.equal(classifySignInFailure(unverified), 'email-unverified');
    assert.notEqual(classifySignInFailure(unverified), 'rejected');
  });

  it('a rejected credential stays a rejected credential', () => {
    const rejected = new SyncRequestError({ kind: 'unauthorized', message: 'invalid email or passphrase', status: 401 });
    assert.equal(classifySignInFailure(rejected), 'rejected');
  });

  it('everything else keeps its own message rather than being mislabelled', () => {
    const unreachable = new SyncRequestError({ kind: 'transport', message: 'the server could not be reached' });
    const incompatible = new SyncRequestError({ kind: 'invalid', message: 'protocol mismatch' });
    assert.equal(classifySignInFailure(unreachable), 'other');
    assert.equal(classifySignInFailure(incompatible), 'other');
  });

  it('is total: a non-SyncRequestError throwable does not crash the form', () => {
    assert.equal(classifySignInFailure(new Error('boom')), 'other');
    assert.equal(classifySignInFailure('a thrown string'), 'other');
    assert.equal(classifySignInFailure(null), 'other');
    assert.equal(classifySignInFailure(undefined), 'other');
  });
});
