/**
 * Moved mode's routing table (`app/lib/moved/moved-request.ts`): what each path is answered
 * with, and the same-origin guard on every path it sends back.
 *
 * THE RULE BEHIND THE TABLE is that no app page may reach a browser in moved mode, because the
 * app registers `/sw.js` as it starts and there it is the kill switch, which reloads the tab. So
 * the cases below pin the one pass-through (`/healthcheck`) and show its near neighbours are NOT
 * passed through: `/health` renders the not-found PAGE on this server, and would loop.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyMovedRequest, pageOfRouteData, toSameOriginPath } from '../../app/lib/moved/moved-request';

describe('classifyMovedRequest', () => {
  const cases: { path: string; expected: ReturnType<typeof classifyMovedRequest> }[] = [
    { path: '/healthcheck', expected: 'health' },
    { path: '/health', expected: 'page' },
    { path: '/healthcheck/x', expected: 'page' },
    { path: '/sw.js', expected: 'worker' },
    { path: '/sw-push-decision.js', expected: 'page' },
    { path: '/api/update-status', expected: 'api' },
    { path: '/api/food-matches', expected: 'api' },
    { path: '/api', expected: 'api' },
    { path: '/apiary', expected: 'page' },
    { path: '/diary.data', expected: 'route-data' },
    { path: '/_.data', expected: 'route-data' },
    { path: '/__manifest', expected: 'route-discovery' },
    { path: '/assets/root-abc.css', expected: 'asset' },
    { path: '/diary', expected: 'page' },
    { path: '/', expected: 'page' },
    { path: '/share-target', expected: 'page' },
    { path: '/imprint', expected: 'page' },
  ];

  for (const testCase of cases) {
    it(`sorts ${testCase.path} as ${testCase.expected}`, () => {
      assert.equal(classifyMovedRequest(testCase.path), testCase.expected);
    });
  }
});

describe('pageOfRouteData', () => {
  it('drops the data suffix', () => {
    assert.equal(pageOfRouteData('/diary.data'), '/diary');
    assert.equal(pageOfRouteData('/diary/entry/abc.data'), '/diary/entry/abc');
  });

  it('reads the slash form back to its slash, the root included', () => {
    assert.equal(pageOfRouteData('/_.data'), '/');
    assert.equal(pageOfRouteData('/settings/_.data'), '/settings/');
  });

  it('never names another host', () => {
    assert.equal(pageOfRouteData('//evil.example/x.data'), '/evil.example/x');
  });
});

describe('toSameOriginPath', () => {
  it('keeps an ordinary path as it is', () => {
    assert.equal(toSameOriginPath('/share-target'), '/share-target');
  });

  it('collapses leading slashes, which a browser would read as another host', () => {
    assert.equal(toSameOriginPath('//evil.example/x'), '/evil.example/x');
    assert.equal(toSameOriginPath('///evil.example'), '/evil.example');
  });

  it('control: the collapsed form resolves on this origin, the raw form does not', () => {
    const origin = 'https://beta.openplate.example';
    assert.notEqual(new URL('//evil.example/x', origin).origin, origin);
    assert.equal(new URL(toSameOriginPath('//evil.example/x'), origin).origin, origin);
  });

  /**
   * CodeQL alert 28 (`js/server-side-unvalidated-url-redirection`). `new URL` in Node follows the
   * WHATWG URL rules a browser follows, so it is the judge here: each raw path below resolves to
   * another host when a browser follows it, which is the control, and none may after the guard.
   */
  const OFF_ORIGIN_PATHS = [
    '//evil.example/x',
    '///evil.example',
    '/\\evil.example',
    '/\\\\evil.example/x',
    '\\/evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r\n/evil.example',
  ];

  it('control: every raw path in the list leaves the origin when a browser follows it', () => {
    const origin = 'https://beta.openplate.example';
    for (const path of OFF_ORIGIN_PATHS) {
      assert.notEqual(new URL(path, origin).origin, origin, JSON.stringify(path));
    }
  });

  it('keeps protocol-relative, backslash and tab or line-break paths on this origin', () => {
    const origin = 'https://beta.openplate.example';
    for (const path of OFF_ORIGIN_PATHS) {
      const guarded = toSameOriginPath(path);
      assert.equal(
        new URL(guarded, origin).origin,
        origin,
        `${JSON.stringify(path)} became ${JSON.stringify(guarded)}`,
      );
    }
    assert.equal(toSameOriginPath('/\\evil.example'), '/evil.example');
  });

  it('turns an absolute URL into a path on this origin', () => {
    const origin = 'https://beta.openplate.example';
    for (const path of ['http://evil.example/x', 'https:evil.example', 'javascript:alert(1)']) {
      const guarded = toSameOriginPath(path);
      assert.ok(guarded.startsWith('/'), JSON.stringify(guarded));
      assert.equal(new URL(guarded, origin).origin, origin, JSON.stringify(path));
    }
    assert.equal(toSameOriginPath('http://evil.example/x'), '/http://evil.example/x');
  });

  it('carries the separator guard into the route-data answer', () => {
    assert.equal(pageOfRouteData('/\\evil.example/x.data'), '/evil.example/x');
  });
});
