/**
 * The managed scan says what is true (2026-09-27 install rehearsal).
 *
 * Three pure pieces of `add.photo.tsx` and `managed-ai-settings.ts`:
 *
 *  - The form carries "this is a managed instance" even when the handshake
 *    named no model. It used to drop everything, and the action then told a
 *    managed member to connect a provider of their own.
 *  - The base URL gives back the sync server it was built from, which the
 *    action uses to ask the handshake once more.
 *  - A provider refusal on a managed instance is the operator's, and is worded
 *    that way; the same refusal on an open instance keeps the "your key" copy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeFailureBody,
  getFailureAlertTitle,
  isOperatorProviderRefusal,
  readManagedAiFields,
  writeManagedAiFields,
} from '../../app/routes/add.photo';
import { MANAGED_AI_API_PREFIX, syncServerUrlOfManagedBase } from '../../app/lib/ai/managed-ai-settings';

/** Echoes the key, so a test pins which message, never its wording. */
function fakeT(key: string): string {
  return key;
}

const SYNC = 'https://sync.example.org';
const BASE = `${SYNC}${MANAGED_AI_API_PREFIX}`;

describe('the managed form fields', () => {
  it('say "managed" with no model, and read back with a null model', () => {
    const formData = new FormData();
    writeManagedAiFields(formData, { source: 'managed', provider: 'managed', baseUrl: BASE, model: null });
    assert.deepEqual(readManagedAiFields(formData), {
      source: 'managed',
      provider: 'managed',
      baseUrl: BASE,
      model: null,
    });
  });

  it('carry the model when there is one', () => {
    const formData = new FormData();
    writeManagedAiFields(formData, { source: 'managed', provider: 'managed', baseUrl: BASE, model: 'vendor/model' });
    assert.equal(readManagedAiFields(formData)?.model, 'vendor/model');
  });

  it('control: an ordinary BYOK submission carries none of them', () => {
    const formData = new FormData();
    writeManagedAiFields(formData, null);
    assert.equal(readManagedAiFields(formData), null);
  });
});

describe('syncServerUrlOfManagedBase', () => {
  it('reads back the sync server a managed base was built from', () => {
    assert.equal(syncServerUrlOfManagedBase(BASE), SYNC);
  });

  it('refuses a base it did not build', () => {
    assert.equal(syncServerUrlOfManagedBase('https://openrouter.ai/api'), null);
  });
});

describe('a provider refusal on a managed instance', () => {
  for (const cause of ['auth', 'credit', 'model-not-found'] as const) {
    it(`words ${cause} as the operator's provider`, () => {
      assert.equal(isOperatorProviderRefusal({ failureCause: cause, provider: 'managed' }), true);
      assert.equal(getFailureAlertTitle(cause, fakeT, null, 'managed'), 'scan.errors.titles.managedUpstream');
      assert.equal(
        describeFailureBody({ failureCause: cause, provider: 'managed', language: 'en' }, fakeT),
        'scan.errors.provider.managedUpstream',
      );
    });
  }

  it('control: the same refusal on an open instance keeps the person-key copy', () => {
    assert.equal(isOperatorProviderRefusal({ failureCause: 'auth', provider: 'openrouter' }), false);
    assert.equal(getFailureAlertTitle('auth', fakeT, null, 'openrouter'), 'scan.errors.titles.auth');
    assert.equal(
      describeFailureBody({ failureCause: 'auth', provider: 'openrouter', language: 'en' }, fakeT),
      'scan.errors.provider.auth',
    );
  });

  it('control: a managed refusal that is about the account keeps its own copy', () => {
    assert.equal(isOperatorProviderRefusal({ failureCause: 'ai-not-allowed', provider: 'managed' }), false);
    assert.equal(getFailureAlertTitle('ai-not-allowed', fakeT, null, 'managed'), 'scan.errors.titles.aiNotAllowed');
  });
});
