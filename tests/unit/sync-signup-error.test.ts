/**
 * Classifying a failed account creation.
 *
 * The property that matters: the service answers the SAME `403` for an invite
 * that is missing, unknown, expired, revoked or already spent, and it will not
 * distinguish them — telling them apart would let a caller probe which tokens
 * exist. All four are one outcome here, because the person's next step is the
 * same for all four: ask whoever invited them for a new link.
 *
 * ── What M192 removed from this signature ────────────────────────────────
 *
 * A `signupMode` parameter. It was needed while the same `403` also covered
 * "this instance is closed", and the status alone could not say which. There
 * is one way in now, so there is one meaning.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import { SyncRequestError } from '#app/lib/sync/engine/client/sync-error';

function thrown(kind: 'forbidden' | 'conflict' | 'suspended' | 'unauthorized', status: number): SyncRequestError {
  return new SyncRequestError({ kind, message: 'whatever the service said', status });
}

test('a 403 is an invite problem, and there is only one of those', () => {
  assert.equal(classifySignupFailure(thrown('forbidden', 403)), 'invite-required');
});

test('a 409 is an account that already exists at the invited address', () => {
  assert.equal(classifySignupFailure(thrown('conflict', 409)), 'account-exists');
});

test('a suspended account is its own outcome, not an invite problem', () => {
  // It reaches this form when somebody redeems an invite for an address whose
  // account an admin has since suspended. "Ask for a new invitation" would
  // send them to the wrong person.
  assert.equal(classifySignupFailure(thrown('suspended', 403)), 'suspended');
});

test('anything that is not a sync request error is left alone', () => {
  assert.equal(classifySignupFailure(new Error('network died')), 'other');
  assert.equal(classifySignupFailure('a thrown string'), 'other');
  assert.equal(classifySignupFailure(thrown('unauthorized', 401)), 'other');
});
