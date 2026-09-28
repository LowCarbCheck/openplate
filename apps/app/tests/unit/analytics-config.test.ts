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
    assert.equal(parseAnalyticsConfig({ matomoUrl: undefined, siteId: undefined, eventLevel: undefined }), null);
    assert.equal(parseAnalyticsConfig({ matomoUrl: '  ', siteId: '', eventLevel: undefined }), null);
  });

  it('THROWS on a half-configured pair rather than degrading', () => {
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'https://m.example/', siteId: undefined, eventLevel: undefined }), /MATOMO_SITE_ID/);
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: undefined, siteId: '18', eventLevel: undefined }), /MATOMO_URL/);
  });

  it('parses a configured pair and normalises the URL to one trailing slash', () => {
    for (const input of ['https://matomo.sprqvntrs.com', 'https://matomo.sprqvntrs.com/', 'https://matomo.sprqvntrs.com///']) {
      assert.deepEqual(parseAnalyticsConfig({ matomoUrl: input, siteId: '18', eventLevel: undefined }), {
        matomoUrl: 'https://matomo.sprqvntrs.com/',
        siteId: 18,
        eventLevel: 'product',
      });
    }
  });

  it('rejects a site id that is not a plain positive integer', () => {
    // `parseInt('18abc')` is 18 — a typo must not silently become a real,
    // different site's id.
    for (const bad of ['18abc', 'abc', '-1', '1.5', '0', ' ']) {
      assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'https://m.example/', siteId: bad, eventLevel: undefined }), /MATOMO_SITE_ID|MATOMO_URL/, bad);
    }
  });

  it('rejects a non-http(s) URL', () => {
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'ftp://m.example/', siteId: '18', eventLevel: undefined }), /http\(s\)/);
    assert.throws(() => parseAnalyticsConfig({ matomoUrl: 'not-a-url', siteId: '18', eventLevel: undefined }), /valid absolute URL/);
  });
});

describe('parseAnalyticsConfig event level', () => {
  const configured = { matomoUrl: 'https://m.example/', siteId: '18' };

  it('defaults to product when the level is unset, so turning analytics on counts software only', () => {
    for (const level of [undefined, '', '   ']) {
      assert.equal(parseAnalyticsConfig({ ...configured, eventLevel: level })?.eventLevel, 'product', String(level));
    }
  });

  it('accepts each of the three values, trimmed and case-insensitively', () => {
    assert.equal(parseAnalyticsConfig({ ...configured, eventLevel: 'pageviews' })?.eventLevel, 'pageviews');
    assert.equal(parseAnalyticsConfig({ ...configured, eventLevel: 'product' })?.eventLevel, 'product');
    assert.equal(parseAnalyticsConfig({ ...configured, eventLevel: 'research' })?.eventLevel, 'research');
    assert.equal(parseAnalyticsConfig({ ...configured, eventLevel: '  Research  ' })?.eventLevel, 'research');
  });

  it('THROWS on an unrecognised level, naming the three, rather than falling back', () => {
    // A typo'd `reserach` must not silently downgrade the one instance whose
    // operator asked for more.
    for (const bad of ['reserach', 'all', 'none', 'full', 'true']) {
      assert.throws(
        () => parseAnalyticsConfig({ ...configured, eventLevel: bad }),
        /MATOMO_EVENT_LEVEL must be one of pageviews, product, research/,
        bad,
      );
    }
  });

  it('THROWS on a level with no analytics configured, which is an operator who misunderstood', () => {
    assert.throws(
      () => parseAnalyticsConfig({ matomoUrl: undefined, siteId: undefined, eventLevel: 'research' }),
      /MATOMO_EVENT_LEVEL is set but MATOMO_URL and MATOMO_SITE_ID are not/,
    );
  });
});

describe('analyticsCspOrigin', () => {
  it('is null when analytics are off, so the CSP is byte-for-byte unchanged', () => {
    assert.equal(analyticsCspOrigin(null), null);
  });

  it('is the ORIGIN only — CSP source lists ignore a path, so including one would mislead', () => {
    const config = parseAnalyticsConfig({ matomoUrl: 'https://matomo.sprqvntrs.com/sub/path/', siteId: '18', eventLevel: undefined });
    assert.equal(analyticsCspOrigin(config), 'https://matomo.sprqvntrs.com');
  });
});
