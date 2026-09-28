/**
 * The consent to health data on the wire (2026-09-28): the handshake's
 * `instance.healthConsent`, `AccountView.healthConsent`, and the one refusal
 * of both consent paths.
 *
 * TRANSCRIBED FROM `apps/core/PROTOCOL.md` §5.6, §5.15 and §5.15.1, like
 * every shape in the protocol tests: the two repositories cannot import each
 * other, so these are the literals a conforming service sends. Every reading
 * of a present value has a twin for the absent one, because "absent means
 * none" is the compatibility rule an older core relies on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeHealthConsent,
  isHealthConsentRefusal,
  isHealthConsentRouteAbsent,
  requiredHealthConsentVersion,
} from '../../app/lib/health-consent/health-consent';
import { HEALTH_CONSENT_REQUIRED } from '../../app/lib/sync/engine/client/auth-wire';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import { readHandshakeInstance } from '../../app/lib/sync/engine/protocol';
import { classifySignupFailure } from '../../app/lib/sync/signup-error';

const BASE = { protocolVersion: 2, envelopeVersion: 1, serviceVersion: '0.30.0' };
const INSTANCE = { name: 'openplate', language: 'en', mail: true, ai: null };

describe('instance.healthConsent on /health', () => {
  it('reads the version an instance asks for', () => {
    const asking = { ...BASE, instance: { ...INSTANCE, healthConsent: { version: '2026-09-28' } } };
    assert.deepEqual(readHandshakeInstance(asking)?.healthConsent, { version: '2026-09-28' });
    assert.equal(requiredHealthConsentVersion(readHandshakeInstance(asking)), '2026-09-28');
  });

  it('reads `null` as an instance that asks for none', () => {
    const notAsking = { ...BASE, instance: { ...INSTANCE, healthConsent: null } };
    assert.equal(readHandshakeInstance(notAsking)?.healthConsent, null);
    assert.equal(requiredHealthConsentVersion(readHandshakeInstance(notAsking)), null);
  });

  it('reads a missing key, every core older than the field, as asking for none', () => {
    const older = { ...BASE, instance: INSTANCE };
    assert.equal(readHandshakeInstance(older)?.healthConsent, null);
    assert.equal(requiredHealthConsentVersion(readHandshakeInstance(older)), null);
  });

  it('drops a nonsense value rather than failing the descriptor and taking the rest with it', () => {
    for (const healthConsent of [{ version: '' }, { version: 7 }, 'yes', true]) {
      const broken = { ...BASE, instance: { ...INSTANCE, ai: { model: 'x' }, healthConsent } };
      assert.equal(readHandshakeInstance(broken)?.healthConsent, null, JSON.stringify(healthConsent));
      assert.deepEqual(readHandshakeInstance(broken)?.ai, { model: 'x' });
    }
  });

  it('knows no version when there is no descriptor at all', () => {
    assert.equal(requiredHealthConsentVersion(null), null);
  });
});

describe('AccountView.healthConsent', () => {
  it('reads a consent on record', () => {
    assert.deepEqual(decodeHealthConsent({ version: '2026-09-28', at: '2026-09-04T10:11:12.000Z' }), {
      version: '2026-09-28',
      at: '2026-09-04T10:11:12.000Z',
    });
  });

  it('reads `null`, a missing key and a broken value alike as no consent', () => {
    assert.equal(decodeHealthConsent(null), null);
    assert.equal(decodeHealthConsent(undefined), null);
    // An empty version is no consent anybody agreed to: the service never
    // writes one, so a view that carries one is broken, not a wording.
    assert.equal(decodeHealthConsent({ version: '', at: 'x' }), null);
  });
});

describe('the refusal: 400 health-consent-required', () => {
  const refusal = new SyncRequestError({ kind: 'invalid', message: 'x', status: 400, code: HEALTH_CONSENT_REQUIRED });

  it('is the documented code, transcribed', () => {
    assert.equal(HEALTH_CONSENT_REQUIRED, 'health-consent-required');
  });

  it('is told apart from every other 400, and from a transport failure', () => {
    assert.equal(isHealthConsentRefusal(refusal), true);
    assert.equal(
      isHealthConsentRefusal(new SyncRequestError({ kind: 'invalid', message: 'x', status: 400, code: 'other' })),
      false,
    );
    assert.equal(isHealthConsentRefusal(new SyncRequestError({ kind: 'transport', message: 'x' })), false);
    assert.equal(isHealthConsentRefusal(new Error('health-consent-required')), false);
  });

  it('is its own signup failure, and a spent invite is still the invite one', () => {
    assert.equal(classifySignupFailure(refusal), 'health-consent-required');
    assert.equal(
      classifySignupFailure(
        new SyncRequestError({ kind: 'forbidden', message: 'x', status: 403, code: 'invite-invalid' }),
      ),
      'invite-required',
    );
    assert.equal(
      classifySignupFailure(new SyncRequestError({ kind: 'invalid', message: 'x', status: 400, code: 'other' })),
      'other',
    );
  });

  it('is not the 404 an instance that asks for no consent answers the route with', () => {
    const absent = new SyncRequestError({ kind: 'not-found', message: 'x', status: 404 });
    assert.equal(isHealthConsentRouteAbsent(absent), true);
    assert.equal(isHealthConsentRouteAbsent(refusal), false);
    assert.equal(isHealthConsentRefusal(absent), false);
  });
});
