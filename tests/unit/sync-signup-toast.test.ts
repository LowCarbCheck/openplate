/**
 * Unit tests for `#app/lib/sync/signup-toast` — what the user is TOLD when a
 * signup succeeds on an instance that requires email verification.
 *
 * The outcome has no session and no recovery code, so the only thing that
 * happens on screen is that a form is replaced by a paragraph. This copy is
 * the announcement that an account now exists, and it has to carry the one
 * next action (open the mail) and the address it went to — a "success" that
 * does not say what to do next reads as nothing having happened, which is
 * exactly how the flow was reported.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import { syncSignupPendingToastCopy, type Translate } from '../../app/lib/sync/signup-toast';

/**
 * The REAL catalog, not a stub: the point of the assertions below is that
 * these keys resolve to sentences. A stubbed `t` returning its own key would
 * pass with the keys deleted from the bundle.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

describe('syncSignupPendingToastCopy', () => {
  it('reports that the account exists', () => {
    const copy = syncSignupPendingToastCopy(t, 'sam@example.com');
    assert.equal(copy.title, 'Account created');
  });

  it('names the address the confirmation was sent to', () => {
    const copy = syncSignupPendingToastCopy(t, 'sam@example.com');
    assert.match(copy.description, /sam@example\.com/);
  });

  it('says the mail comes before the first sign-in', () => {
    const copy = syncSignupPendingToastCopy(t, 'sam@example.com');
    assert.equal(copy.description, 'Open the link we sent to sam@example.com before you sign in for the first time.');
  });

  it('resolves both strings, never a raw key', () => {
    const copy = syncSignupPendingToastCopy(t, 'sam@example.com');
    for (const line of [copy.title, copy.description]) {
      assert.doesNotMatch(line, /^sync\./, line);
      assert.notEqual(line, '');
    }
  });
});
