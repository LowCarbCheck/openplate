/**
 * Unit tests for `#app/config/analytics`.
 *
 * The load-bearing case is the FIRST one: an instance with neither variable
 * set must get `null`, because that is what keeps the "no third-party script
 * on an unconfigured instance" claim in `content-security-policy.ts` true for
 * every self-hoster.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyticsCspOrigin, parseAnalyticsConfig } from '../../app/config/analytics';

describe('parseAnalyticsConfig', () => {
  it('is OFF when neither variable is set — the self-host default', () => {
    assert.equal(parseAnalyticsConfig({ matomoUrl: undefined, siteId: undefined }), null);
    assert.equal(parseAnalyticsConfig({ matomoUrl: '  ', siteId: '' }), null);
  });

  it('THROWS on a half-configured pair rather than degrading', () => {
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'https://m.example/', siteId: undefined }), /MATOMO_SITE_ID/);
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: undefined, siteId: '18' }), /MATOMO_URL/);
  });

  it('parses a configured pair and normalises the URL to one trailing slash', () => {
    for (const input of ['https://matomo.sprqvntrs.com', 'https://matomo.sprqvntrs.com/', 'https://matomo.sprqvntrs.com///']) {
      assert.deepEqual(parseAnalyticsConfig({ matomoUrl: input, siteId: '18' }), {
        matomoUrl: 'https://matomo.sprqvntrs.com/',
        siteId: 18,
      });
    }
  });

  it('rejects a site id that is not a plain positive integer', () => {
    // `parseInt('18abc')` is 18 — a typo must not silently become a real,
    // different site's id.
    for (const bad of ['18abc', 'abc', '-1', '1.5', '0', ' ']) {
      assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'https://m.example/', siteId: bad }), /MATOMO_SITE_ID|MATOMO_URL/, bad);
    }
  });

  it('rejects a non-http(s) URL', () => {
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'ftp://m.example/', siteId: '18' }), /http\(s\)/);
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'not-a-url', siteId: '18' }), /valid absolute URL/);
  });
});

describe('analyticsCspOrigin', () => {
  it('is null when analytics are off, so the CSP is byte-for-byte unchanged', () => {
    assert.equal(analyticsCspOrigin(null), null);
  });

  it('is the ORIGIN only — CSP source lists ignore a path, so including one would mislead', () => {
    const config = parseAnalyticsConfig({ matomoUrl: 'https://matomo.sprqvntrs.com/sub/path/', siteId: '18' });
    assert.equal(analyticsCspOrigin(config), 'https://matomo.sprqvntrs.com');
  });
});
