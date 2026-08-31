/**
 * Unit tests for `#app/lib/matomo-url`.
 *
 * These exist because the obvious implementation — the one the sibling
 * SelfHostedWorld tracker uses — is a credential leak on this app. openplate
 * carries single-use tokens in the query string and account ids in the path,
 * so the tests below are written as "this string must NOT appear in the
 * output", which is the only shape that fails when someone reverts the
 * scrubber and reinstates `location.href`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeAnalyticsUrl } from '../../app/lib/matomo-url';

describe('sanitizeAnalyticsUrl — credentials never reach analytics', () => {
  it('drops an email-verification token', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/verify-email?token=abc123secret');
    assert.equal(out, 'https://openplate.de/verify-email');
    assert.doesNotMatch(out ?? '', /abc123secret/);
  });

  it('drops a password-reset token', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/reset-passphrase?token=r3set-me');
    assert.equal(out, 'https://openplate.de/reset-passphrase');
    assert.doesNotMatch(out ?? '', /r3set-me/);
  });

  it('drops an OAuth authorization code and its state', () => {
    const out = sanitizeAnalyticsUrl(
      'https://openplate.de/oauth/openrouter/callback?code=authcode99&state=csrfstate',
    );
    assert.equal(out, 'https://openplate.de/oauth/openrouter/callback');
    assert.doesNotMatch(out ?? '', /authcode99|csrfstate/);
  });

  it('drops the fragment too — a token in a hash is still a token', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/settings/sync#token=hashsecret');
    assert.equal(out, 'https://openplate.de/settings/sync');
    assert.doesNotMatch(out ?? '', /hashsecret/);
  });

  it('drops EVERY query parameter, not a known-bad list — the next token-bearing route must be safe by default', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/anything?whatever=x&utm_source=y');
    assert.equal(out, 'https://openplate.de/anything');
  });
});

describe('sanitizeAnalyticsUrl — identifiers never reach analytics', () => {
  it('replaces the grantor ACCOUNT id on a clinician share', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/shared/acct_7f3d9e1b');
    assert.equal(out, 'https://openplate.de/shared/:grantorAccountId');
    assert.doesNotMatch(out ?? '', /acct_7f3d9e1b/);
  });

  it('replaces a diary entry id', () => {
    const out = sanitizeAnalyticsUrl('https://openplate.de/diary/entry/01J8XKQ2');
    assert.equal(out, 'https://openplate.de/diary/entry/:id');
    assert.doesNotMatch(out ?? '', /01J8XKQ2/);
  });

  it('leaves the /shared index route alone — only the CHILD segment is an id', () => {
    assert.equal(sanitizeAnalyticsUrl('https://openplate.de/shared'), 'https://openplate.de/shared');
  });

  it('leaves ordinary paths untouched, so the pageview report stays readable', () => {
    for (const path of ['/', '/diary', '/scan', '/settings/sync', '/trends', '/imprint']) {
      assert.equal(
        sanitizeAnalyticsUrl(`https://openplate.de${path}`),
        `https://openplate.de${path}`,
        path,
      );
    }
  });
});

describe('sanitizeAnalyticsUrl — degrades safely', () => {
  it('returns null for an unparseable input rather than guessing a page', () => {
    assert.equal(sanitizeAnalyticsUrl('not a url'), null);
  });

  it('returns null for the empty referrer a direct visit produces', () => {
    assert.equal(sanitizeAnalyticsUrl(''), null);
  });

  it('preserves a non-default port, so a self-hoster on :3000 is not misreported', () => {
    assert.equal(
      sanitizeAnalyticsUrl('http://localhost:3000/diary/entry/abc'),
      'http://localhost:3000/diary/entry/:id',
    );
  });
});
