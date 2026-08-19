/**
 * Unit test for `#app/routes/scan`'s `getFailureAlertTitle` — the cause-specific
 * alert headline that replaced the one-size-fits-all "No luck with that photo"
 * (which was actively wrong for a wrong key, an empty balance, a rate limit, an
 * unrecognized model, or a transient outage — none of those are fixed by
 * retrying with a different photo).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getFailureAlertTitle } from '../../app/routes/scan';

/**
 * Identity translator: returns the key it is given, so each assertion below
 * pins the KEY the headline resolves to. That is what these tests were always
 * about — which of the seven causes gets its own copy and which fall back to
 * the photo-quality framing — and it keeps them independent of the catalog's
 * current wording (and of the active language).
 */
const t = (key: string): string => key;

describe('getFailureAlertTitle', () => {
  it('keeps the photo-quality framing when there is no typed cause at all', () => {
    assert.equal(getFailureAlertTitle(undefined, t), 'scan.errors.titles.noLuck');
  });

  it('keeps the photo-quality framing for genuinely-no-food', () => {
    assert.equal(getFailureAlertTitle('genuinely-no-food', t), 'scan.errors.titles.noLuck');
  });

  it('never suggests retrying a photo for a rejected key', () => {
    assert.equal(getFailureAlertTitle('auth', t), 'scan.errors.titles.auth');
  });

  it('never suggests retrying a photo for an empty provider balance', () => {
    assert.equal(getFailureAlertTitle('credit', t), 'scan.errors.titles.credit');
  });

  it('never suggests retrying a photo for a rate limit', () => {
    assert.equal(getFailureAlertTitle('rate-limit', t), 'scan.errors.titles.rateLimit');
  });
});
