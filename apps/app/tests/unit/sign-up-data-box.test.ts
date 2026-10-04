/**
 * Where `/sign-up` draws the "what happens to your data" box (M3/07).
 *
 * The box names OpenRouter, Google, a recovery key and a retention period, so
 * it is drawn only where all of that is true of the instance AND the privacy
 * notice it points at exists. The four combinations are the whole policy, and
 * the instance modes are the real ones, not stand-ins.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { instancePolicyForMode } from '../../app/config/instance-policy';
import { PHOTO_PROXY_SOURCE_URL, showsSignUpDataBox } from '../../app/lib/sign-up-data-box';

const MANAGED = instancePolicyForMode('managed');
const OPEN = instancePolicyForMode('open');

describe('showsSignUpDataBox', () => {
  it('is drawn on a managed instance that publishes its legal pages', () => {
    assert.equal(showsSignUpDataBox({ policy: MANAGED, hasLegalPages: true }), true);
  });

  it('is not drawn on an open instance, even one that publishes an imprint', () => {
    assert.equal(showsSignUpDataBox({ policy: OPEN, hasLegalPages: true }), false);
  });

  it('is not drawn on a managed instance with no privacy notice to point at', () => {
    assert.equal(showsSignUpDataBox({ policy: MANAGED, hasLegalPages: false }), false);
  });

  it('is not drawn on an open instance with no legal pages', () => {
    assert.equal(showsSignUpDataBox({ policy: OPEN, hasLegalPages: false }), false);
  });
});

describe('the proof link', () => {
  it('names the proxy file in the public repository', () => {
    assert.equal(
      PHOTO_PROXY_SOURCE_URL,
      'https://github.com/LowCarbCheck/openplate/blob/main/apps/core/src/ai/proxy.ts',
    );
  });
});
