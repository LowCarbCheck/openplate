/**
 * Classifying a failed account creation.
 *
 * The property that matters: the service answers the SAME `403` whether it is
 * closed or merely wants an invite, and deliberately will not distinguish a
 * missing invite from an expired or already-spent one. So the status alone
 * cannot choose the message, and the instance's advertised mode is what makes
 * it readable. When that mode is unknown the honest answer is the generic
 * refusal — never a guess that sends somebody looking for an invitation that
 * was never required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import { SyncRequestError } from '#app/lib/sync/engine/client/sync-error';

function thrown(kind: 'forbidden' | 'conflict' | 'unauthorized', status: number): SyncRequestError {
  return new SyncRequestError({ kind, message: 'whatever the service said', status });
}

test('a 403 on an invite-only instance asks for an invite', () => {
  assert.equal(classifySignupFailure(thrown('forbidden', 403), 'invite'), 'invite-required');
});

test('a 403 on a closed instance says the door is shut', () => {
  assert.equal(classifySignupFailure(thrown('forbidden', 403), 'closed'), 'signups-closed');
});

test('a 403 with an UNKNOWN mode falls back to the generic refusal', () => {
  // An older service, or one that could not be reached for the handshake.
  // Promising that an invite would help here would be a guess.
  assert.equal(classifySignupFailure(thrown('forbidden', 403), null), 'signups-closed');
});

test('a 409 is the taken address, whatever the mode', () => {
  for (const mode of ['open', 'invite', 'closed', null] as const) {
    assert.equal(classifySignupFailure(thrown('conflict', 409), mode), 'email-taken');
  }
});

test('anything that is not a sync request error is left alone', () => {
  assert.equal(classifySignupFailure(new Error('network died'), 'invite'), 'other');
  assert.equal(classifySignupFailure('a thrown string', 'invite'), 'other');
  assert.equal(classifySignupFailure(thrown('unauthorized', 401), 'invite'), 'other');
});
