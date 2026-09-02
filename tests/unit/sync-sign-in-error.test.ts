/**
 * Sign-in and recovery failure classification.
 *
 * The property under test is the same on both paths and is the reason the two
 * functions exist at all: the service answers ONE status for "wrong handle"
 * and "wrong secret", deliberately, so neither form can be used to find out
 * which accounts exist. What differs is the sentence each failure produces —
 * one sends the user back to their passphrase, the other to their recovery
 * code — and that is why the classifiers are separate rather than shared.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyRecoveryFailure, classifySignInFailure } from '../../app/lib/sync/sign-in-error';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';

describe('classifySignInFailure', () => {
  it('a rejected credential is a rejected credential', () => {
    const rejected = new SyncRequestError({
      kind: 'unauthorized',
      message: 'invalid handle or passphrase',
      status: 401,
    });
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

describe('classifyRecoveryFailure', () => {
  it('the one 401 covers an unknown handle, a missing code and a wrong code alike', () => {
    const rejected = new SyncRequestError({
      kind: 'unauthorized',
      message: 'invalid handle or recovery code',
      status: 401,
    });
    assert.equal(classifyRecoveryFailure(rejected), 'rejected');
  });

  it('a code that authenticates but does not decrypt is NOT a rejected code', () => {
    // `recoverSyncAccount` throws this one itself, and it needs its own
    // sentence: telling the user their code is wrong would send them to
    // retype something that already worked.
    const undecryptable = new SyncRequestError({
      kind: 'invalid',
      message: 'that recovery code does not open this account’s data',
    });
    assert.equal(classifyRecoveryFailure(undecryptable), 'other');
  });

  it('is total: a non-SyncRequestError throwable does not crash the form', () => {
    assert.equal(classifyRecoveryFailure(new Error('boom')), 'other');
    assert.equal(classifyRecoveryFailure(null), 'other');
  });
});
