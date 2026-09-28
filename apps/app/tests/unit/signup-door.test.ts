/**
 * The sign-up door (M253/02): `hasOpenSignup`, the descriptor fields it reads,
 * and what a failed sign-up request asks the person to do.
 *
 * Every "no door" case is paired with the one field that opens it, so a
 * function that answered `false` for everything fails the `true` case, and one
 * that answered `true` fails the rest.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hasOpenSignup, offeredTrialScans, signupCaptchaOf } from '../../app/lib/plans/signup-door';
import { readHandshakeInstance, type InstanceDescriptor, type JsonValue } from '../../app/lib/sync/engine/protocol';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import { describeSignupFailure } from '../../app/lib/sync/signup-request-schema';

/** A `/health` body with the instance block the test names, the rest a valid protocol 2 handshake. */
function health(instance: Record<string, JsonValue>): JsonValue {
  return {
    protocolVersion: 2,
    envelopeVersion: 1,
    serviceVersion: 'test',
    instance: {
      name: 'Example',
      language: 'de',
      mail: true,
      memberInvites: false,
      plans: true,
      ai: { model: null },
      ...instance,
    },
  };
}

/** The descriptor the app would hold for that body. Fails the test when the body is refused outright. */
function decode(instance: Record<string, JsonValue>): InstanceDescriptor {
  const descriptor = readHandshakeInstance(health(instance));
  assert.ok(descriptor !== null, 'the descriptor was refused as a whole');
  return descriptor;
}

describe('hasOpenSignup', () => {
  it('is false when the field is missing, which is every core older than M253', () => {
    assert.equal(hasOpenSignup(decode({})), false);
  });

  it('is false when the core says false', () => {
    assert.equal(hasOpenSignup(decode({ openSignup: false })), false);
  });

  it('is true when the core says true, the control for every false above', () => {
    assert.equal(hasOpenSignup(decode({ openSignup: true })), true);
  });

  it('is false for a malformed value, and the descriptor survives it', () => {
    const descriptor = decode({ openSignup: 'yes' });
    assert.equal(hasOpenSignup(descriptor), false);
    // The AI model is the reason one bad field must not refuse the whole block.
    assert.deepEqual(descriptor.ai, { model: null });
  });

  it('is false with no descriptor at all', () => {
    assert.equal(hasOpenSignup(null), false);
  });
});

describe('the scan trial a new account is promised', () => {
  it('reads the number the core sends', () => {
    assert.equal(offeredTrialScans(decode({ trial: { scans: 10 } })), 10);
  });

  it('states none when the key is absent, the control for the number above', () => {
    assert.equal(offeredTrialScans(decode({})), null);
  });

  it('drops a count that is not a positive whole number rather than refusing the descriptor', () => {
    assert.equal(offeredTrialScans(decode({ trial: { scans: 0 } })), null);
    assert.equal(offeredTrialScans(decode({ trial: { scans: 2.5 } })), null);
  });
});

describe('the sign-up challenge', () => {
  const turnstile = { provider: 'turnstile', siteKey: '0x4AAAAAAA-test' };

  it('is read on an open instance', () => {
    assert.deepEqual(signupCaptchaOf(decode({ openSignup: true, signupCaptcha: turnstile })), turnstile);
  });

  it('is ignored on an invite-only instance, where there is no form to carry it', () => {
    assert.equal(signupCaptchaOf(decode({ openSignup: false, signupCaptcha: turnstile })), null);
  });

  it('drops a provider this build cannot render', () => {
    assert.equal(signupCaptchaOf(decode({ openSignup: true, signupCaptcha: { provider: 'hcaptcha', siteKey: 'k' } })), null);
  });
});

describe('describeSignupFailure', () => {
  it('turns a throttle into a wait in whole minutes, rounded up', () => {
    const throttled = new SyncRequestError({ kind: 'throttled', message: 'x', status: 429, retryAfterSeconds: 61 });
    assert.deepEqual(describeSignupFailure(throttled), { kind: 'wait', minutes: 2 });
  });

  it('says "later" for a throttle that gave no advice', () => {
    const throttled = new SyncRequestError({ kind: 'throttled', message: 'x', status: 429 });
    assert.deepEqual(describeSignupFailure(throttled), { kind: 'wait', minutes: null });
  });

  it('reads the challenge and the domain refusals from their codes', () => {
    const captcha = new SyncRequestError({ kind: 'server', message: 'x', status: 400, code: 'captcha-failed' });
    const domain = new SyncRequestError({ kind: 'server', message: 'x', status: 400, code: 'email-domain-refused' });
    assert.deepEqual(describeSignupFailure(captcha), { kind: 'captcha' });
    assert.deepEqual(describeSignupFailure(domain), { kind: 'domain' });
  });

  it('reads the refused address and the unreachable challenge from their codes', () => {
    const email = new SyncRequestError({ kind: 'server', message: 'x', status: 400, code: 'email-invalid' });
    const unavailable = new SyncRequestError({ kind: 'server', message: 'x', status: 503, code: 'captcha-unavailable' });
    assert.deepEqual(describeSignupFailure(email), { kind: 'email' });
    assert.deepEqual(describeSignupFailure(unavailable), { kind: 'captcha-unavailable' });
  });

  it('answers "failed" for an unknown code and a transport failure, the control for both codes above', () => {
    const other = new SyncRequestError({ kind: 'server', message: 'x', status: 400, code: 'something-else' });
    assert.deepEqual(describeSignupFailure(other), { kind: 'failed' });
    assert.deepEqual(describeSignupFailure(new Error('offline')), { kind: 'failed' });
  });
});
