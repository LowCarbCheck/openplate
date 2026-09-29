/**
 * `403 health-consent-required`: the core refusing a data route to an account
 * that does not hold the instance's current consent (openplate-core
 * `PROTOCOL.md` §4, owner decision 2026-09-29).
 *
 * THREE READERS, and each must turn the refusal into the consent screen rather
 * than into the message it used to become:
 *
 *  - the sync client, which read it as a plain `forbidden` and showed "Sync
 *    failed" with the protocol token as the sentence;
 *  - the vision adapter, which read every unknown 403 as `auth` and told the
 *    person to check an API key they never had;
 *  - the first pull after a sign-in, which read it as a failed pull and held
 *    the person on a retry screen that can never succeed.
 *
 * EVERY CASE HAS A CONTROL that differs in one fact, the status or the code,
 * so a reader that turned every 403 into a consent refusal fails the controls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { errorKindForStatus, SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import { toRequestError } from '../../app/lib/sync/engine/client/auth-client';
import { classifyVisionHttpFailure } from '../../app/services/vision/failure-cause';
import { completeSignIn } from '../../app/lib/sign-in-flow';

const CODE = 'health-consent-required';

/** The error envelope both services answer with. */
interface ErrorBody {
  error: string;
}

function jsonResponse(status: number, body: ErrorBody): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the sync client reads the refusal as its own kind', () => {
  it('maps 403 health-consent-required to consent-required', () => {
    assert.equal(errorKindForStatus(403, CODE), 'consent-required');
  });

  it('control: any other 403 is still forbidden, and a suspension is still suspended', () => {
    assert.equal(errorKindForStatus(403, 'sync not enabled for this account'), 'forbidden');
    assert.equal(errorKindForStatus(403), 'forbidden');
    assert.equal(errorKindForStatus(403, 'account-suspended'), 'suspended');
  });

  it('control: the 400 of the consent route and of signup stays invalid, the box is shown again there', () => {
    assert.equal(errorKindForStatus(400, CODE), 'invalid');
  });

  it('reads the code off a real response body, and keeps it on the error', async () => {
    const error = await toRequestError(jsonResponse(403, { error: CODE }));
    assert.equal(error.kind, 'consent-required');
    assert.equal(error.status, 403);
    assert.equal(error.code, CODE);
  });

  it('control: the same body on another status is not the refusal', async () => {
    const error = await toRequestError(jsonResponse(400, { error: CODE }));
    assert.equal(error.kind, 'invalid');
  });
});

describe('the vision adapter reads the refusal as its own cause', () => {
  it('classifies 403 health-consent-required as consent-required, and names no key', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(403, { error: CODE }));
    assert.equal(result.cause, 'consent-required');
    assert.doesNotMatch(result.message, /key/i);
  });

  it('control: a 403 with another code is still the key refusal of an open instance', async () => {
    const result = await classifyVisionHttpFailure(jsonResponse(403, { error: 'some-other-code' }));
    assert.equal(result.cause, 'auth');
  });
});

describe('the first pull after a sign-in', () => {
  it('goes on to the destination when the only refusal is the consent, so the consent gate can ask', async () => {
    let didRead = false;
    const outcome = await completeSignIn({
      pull: () =>
        Promise.reject(new SyncRequestError({ kind: 'consent-required', status: 403, message: CODE, code: CODE })),
      readDestination: async () => {
        didRead = true;
        return '/diary';
      },
    });
    assert.equal(didRead, true, 'the destination was never read');
    assert.deepEqual(outcome, { status: 'navigate', path: '/diary' });
  });

  it('control: any other refusal is still a failed pull, and no destination is read', async () => {
    let didRead = false;
    const cause = new SyncRequestError({ kind: 'forbidden', status: 403, message: 'forbidden', code: 'forbidden' });
    const outcome = await completeSignIn({
      pull: () => Promise.reject(cause),
      readDestination: async () => {
        didRead = true;
        return '/onboarding';
      },
    });
    assert.equal(didRead, false);
    assert.deepEqual(outcome, { status: 'pull-failed', cause });
  });
});
