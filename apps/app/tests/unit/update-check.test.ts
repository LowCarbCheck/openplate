/**
 * The release check (M203) in `app/lib/update-check.server.ts`.
 *
 * Four properties, each of which fails invisibly in production:
 *
 * 1. **Ordering.** A version comparison that gets prereleases wrong tells an
 *    instance on `0.19.0` that `0.19.0-rc.1` is newer, and a whole instance is
 *    then nagged to move onto an unfinished build.
 * 2. **The feed's shape.** The file must be `{ app: { version: "x.y.z" } }` and
 *    nothing else is believed. A prerelease or a malformed file is a failed check.
 * 3. **Fail soft.** The site is down or slow far more often than it is broken. Every one of those must keep the previous answer rather
 *    than blanking the banner, and none of them may throw at a caller.
 * 4. **The throttle.** The manual button is unauthenticated. Without a cooldown
 *    a loop on that endpoint turns one visitor into a request generator pointed
 *    at the project site from the instance's own IP.
 * 5. **The same-origin rule.** The manual endpoint is a plain Express route, so
 *    React Router's CSRF check never sees it. A wrong answer here is invisible:
 *    the accepting cases are what an operator exercises by hand, and the
 *    REFUSING case is the one nobody tries and the one that matters.
 *
 * The checker takes its `fetch` and its clock as parameters, so all of this runs
 * with no network and no waiting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareSemver,
  createUpdateChecker,
  isSameOriginRequest,
  MANUAL_CHECK_COOLDOWN_MS,
  parseVersion,
  releaseCheckUserAgent,
} from '../../app/lib/update-check.server';

/**
 * A `fetch` that answers with the given release version, as the site's
 * `latest.json` spells it, and records every call (url and init).
 */
function stubFetch(version: string) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const fetchImpl = (url: string, init: RequestInit) => {
    calls.push(url);
    inits.push(init);
    return Promise.resolve(
      new Response(JSON.stringify({ app: { version } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { calls, inits, fetchImpl };
}

/** A `fetch` that always fails, standing in for every remote problem there is. */
function failingFetch() {
  const calls: string[] = [];
  const fetchImpl = (url: string) => {
    calls.push(url);
    return Promise.reject(new Error('network down'));
  };
  return { calls, fetchImpl };
}

function checkerOver({
  latest,
  currentVersion,
  clock,
}: {
  latest: string;
  currentVersion: string;
  clock: () => number;
}) {
  const stub = stubFetch(latest);
  return {
    stub,
    checker: createUpdateChecker({
      enabled: true,
      currentVersion,
      releaseUrlFor: (version) => `https://example.test/releases/tag/v${version}`,
      fetchImpl: stub.fetchImpl,
      now: clock,
    }),
  };
}

describe('parseVersion', () => {
  it('reads the triple and the prerelease tail', () => {
    assert.deepEqual(parseVersion('0.18.3'), { major: 0, minor: 18, patch: 3, prerelease: null });
    assert.deepEqual(parseVersion('1.0.0-rc.2'), { major: 1, minor: 0, patch: 0, prerelease: 'rc.2' });
  });

  it('refuses anything that is not a version', () => {
    assert.equal(parseVersion('v1.0.0'), null);
    assert.equal(parseVersion('nightly'), null);
    assert.equal(parseVersion('1.0'), null);
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch', () => {
    assert.ok(compareSemver('1.0.0', '0.99.99') > 0);
    assert.ok(compareSemver('0.18.3', '0.19.0') < 0);
    assert.ok(compareSemver('0.18.3', '0.18.4') < 0);
    assert.equal(compareSemver('0.18.3', '0.18.3'), 0);
  });

  it('sorts a prerelease below the release it leads to', () => {
    assert.ok(compareSemver('1.0.0-rc.1', '1.0.0') < 0);
    assert.ok(compareSemver('1.0.0', '1.0.0-rc.1') > 0);
  });

  it('orders prerelease tails by semver clause 11', () => {
    assert.ok(compareSemver('1.0.0-beta.2', '1.0.0-beta.10') < 0);
    assert.ok(compareSemver('1.0.0-alpha', '1.0.0-beta') < 0);
    assert.ok(compareSemver('1.0.0-alpha', '1.0.0-alpha.1') < 0);
    assert.ok(compareSemver('1.0.0-1', '1.0.0-alpha') < 0);
  });

  it('sorts an unparseable string below everything', () => {
    assert.ok(compareSemver('nightly', '0.0.1') < 0);
    assert.ok(compareSemver('0.0.1', 'nightly') > 0);
  });
});

describe('the checker', () => {
  it('reports an available update, with a link', async () => {
    const { checker } = checkerOver({ latest: '0.19.0', currentVersion: '0.18.3', clock: () => 1000 });
    const state = await checker.refresh();
    assert.equal(state.latest, '0.19.0');
    assert.equal(state.updateAvailable, true);
    assert.equal(state.releaseUrl, 'https://example.test/releases/tag/v0.19.0');
    assert.equal(state.checkedAt, new Date(1000).toISOString());
  });

  it('reports no update when the instance is already on the newest tag', async () => {
    const { checker } = checkerOver({ latest: '0.18.3', currentVersion: '0.18.3', clock: () => 1000 });
    const state = await checker.refresh();
    assert.equal(state.updateAvailable, false);
  });

  it("asks the project site's release feed, and only that", async () => {
    // The URL is pinned in full in `release-check-request.test.ts`; this case keeps the checker
    // honest about asking exactly once, at the feed, with no GitHub address anywhere.
    const { checker, stub } = checkerOver({ latest: '0.19.0', currentVersion: '0.18.3', clock: () => 0 });
    await checker.refresh();
    assert.deepEqual(stub.calls, ['https://openplate.de/latest.json']);
  });

  it('sends the version, platform and arch in the User-Agent', async () => {
    const { checker, stub } = checkerOver({ latest: '0.19.0', currentVersion: '0.18.3', clock: () => 0 });
    await checker.refresh();
    const headers = new Headers(stub.inits[0]?.headers);
    assert.equal(headers.get('user-agent'), `openplate/0.18.3 (${process.platform}; ${process.arch})`);
    assert.equal(headers.get('user-agent'), releaseCheckUserAgent('0.18.3'));
    assert.equal(headers.get('accept'), 'application/json');
  });

  it('does not offer a prerelease, and keeps the previous answer', async () => {
    const stable = stubFetch('0.19.0');
    const prerelease = stubFetch('0.20.0-rc.1');
    let call = 0;
    const checker = createUpdateChecker({
      enabled: true,
      currentVersion: '0.18.3',
      releaseUrlFor: (version) => `https://example.test/v${version}`,
      fetchImpl: (url, init) => (call++ === 0 ? stable.fetchImpl(url, init) : prerelease.fetchImpl(url, init)),
      now: () => 1000,
    });
    const first = await checker.refresh();
    assert.equal(first.latest, '0.19.0');
    const second = await checker.refresh();
    assert.equal(second.latest, '0.19.0', 'a prerelease string is a failed check, not a newer version');
  });

  it('treats an unreadable file as a failure, whatever it is', async () => {
    const bodies = ['{}', '{"app":{}}', '{"app":{"version":42}}', '[]', '"0.19.0"'];
    for (const body of bodies) {
      const checker = createUpdateChecker({
        enabled: true,
        currentVersion: '0.18.3',
        releaseUrlFor: (version) => `https://example.test/v${version}`,
        fetchImpl: () => Promise.resolve(new Response(body, { status: 200 })),
        now: () => 1000,
      });
      const state = await checker.refresh();
      assert.equal(state.latest, null, body);
      assert.equal(state.checkedAt, null, body);
    }
  });

  it('control: the same shape with a stable version IS believed', async () => {
    const { checker } = checkerOver({ latest: '9.9.9', currentVersion: '0.18.3', clock: () => 0 });
    const state = await checker.refresh();
    assert.equal(state.latest, '9.9.9');
  });

  it('keeps the previous answer when the fetch fails, and does not throw', async () => {
    let answer = 0;
    const failing = failingFetch();
    const good = stubFetch('0.19.0');
    const checker = createUpdateChecker({
      enabled: true,
      currentVersion: '0.18.3',
      releaseUrlFor: (version) => `https://example.test/v${version}`,
      // First call succeeds, every later one fails.
      fetchImpl: (url, init) => (answer++ === 0 ? good.fetchImpl(url, init) : failing.fetchImpl(url)),
      now: () => 1000,
    });

    const first = await checker.refresh();
    assert.equal(first.latest, '0.19.0');

    const second = await checker.refresh();
    assert.equal(second.latest, '0.19.0', 'a failed check must not blank the previous result');
    assert.equal(second.checkedAt, first.checkedAt, 'and must not claim it looked just now');
  });

  it('treats a non-2xx answer as a failure', async () => {
    const checker = createUpdateChecker({
      enabled: true,
      currentVersion: '0.18.3',
      releaseUrlFor: (version) => `https://example.test/v${version}`,
      fetchImpl: () => Promise.resolve(new Response('not found', { status: 404 })),
      now: () => 1000,
    });
    const state = await checker.refresh();
    assert.equal(state.latest, null);
    assert.equal(state.checkedAt, null);
  });

  it('makes one request for two overlapping calls', async () => {
    const { checker, stub } = checkerOver({ latest: '0.19.0', currentVersion: '0.18.3', clock: () => 0 });
    await Promise.all([checker.refresh(), checker.refresh(), checker.refresh()]);
    assert.equal(stub.calls.length, 1);
  });

  it('never fetches at all when the operator turned checks off', async () => {
    const stub = stubFetch('0.19.0');
    const checker = createUpdateChecker({
      enabled: false,
      currentVersion: '0.18.3',
      releaseUrlFor: (version) => `https://example.test/v${version}`,
      fetchImpl: stub.fetchImpl,
      now: () => 0,
    });
    await checker.refresh();
    await checker.checkNow();
    assert.deepEqual(stub.calls, []);
  });
});

describe('the manual check throttle', () => {
  it('runs the first check and refuses a second one inside the cooldown', async () => {
    let now = 10_000;
    const { checker, stub } = checkerOver({
      latest: '0.19.0',
      currentVersion: '0.18.3',
      clock: () => now,
    });

    const first = await checker.checkNow();
    assert.equal(first.throttled, false);
    assert.equal(stub.calls.length, 1);

    now += MANUAL_CHECK_COOLDOWN_MS - 1;
    const second = await checker.checkNow();
    assert.equal(second.throttled, true, 'a second manual check inside the cooldown is refused');
    assert.equal(stub.calls.length, 1, 'and no request leaves the box');
    assert.equal(second.state.latest, '0.19.0', 'the cached answer is still returned');
    assert.equal(second.nextCheckAllowedAt, new Date(10_000 + MANUAL_CHECK_COOLDOWN_MS).toISOString());
  });

  it('allows the next one once the cooldown has elapsed', async () => {
    let now = 10_000;
    const { checker, stub } = checkerOver({ latest: '0.19.0', currentVersion: '0.18.3', clock: () => now });

    await checker.checkNow();
    now += MANUAL_CHECK_COOLDOWN_MS;
    const later = await checker.checkNow();
    assert.equal(later.throttled, false);
    assert.equal(stub.calls.length, 2);
  });
});

describe('isSameOriginRequest', () => {
  const OWN = 'https://openplate.example';

  it("accepts the app's own fetch", () => {
    assert.equal(isSameOriginRequest({ secFetchSite: 'same-origin', origin: OWN, requestOrigin: OWN }), true);
  });

  it('accepts a user-initiated load with no initiator', () => {
    // `none` is an address-bar navigation or a bookmark: there is no other site
    // involved, so there is nothing to protect against.
    assert.equal(isSameOriginRequest({ secFetchSite: 'none', origin: null, requestOrigin: OWN }), true);
  });

  it('REFUSES a cross-site POST, the attack this guard exists for', () => {
    // evil.example runs `fetch('https://openplate.example/api/update-status/check',
    // {method:'POST'})`. The browser sets `Sec-Fetch-Site: cross-site` and the
    // script cannot change it.
    assert.equal(
      isSameOriginRequest({
        secFetchSite: 'cross-site',
        origin: 'https://evil.example',
        requestOrigin: OWN,
      }),
      false,
    );
  });

  it('refuses same-site too, because a sibling subdomain is not this app', () => {
    assert.equal(
      isSameOriginRequest({
        secFetchSite: 'same-site',
        origin: 'https://other.example.com',
        requestOrigin: OWN,
      }),
      false,
    );
  });

  it('ignores Origin entirely when Sec-Fetch-Site is present', () => {
    // A forged `Origin` must not buy anything: the browser-set header wins, and
    // a script cannot set `Sec-Fetch-Site` at all.
    assert.equal(isSameOriginRequest({ secFetchSite: 'cross-site', origin: OWN, requestOrigin: OWN }), false);
  });

  it('falls back to a MATCHING Origin when Sec-Fetch-Site is absent', () => {
    assert.equal(isSameOriginRequest({ secFetchSite: null, origin: OWN, requestOrigin: OWN }), true);
  });

  it('refuses a mismatched Origin on the fallback path', () => {
    assert.equal(
      isSameOriginRequest({ secFetchSite: null, origin: 'https://evil.example', requestOrigin: OWN }),
      false,
    );
  });

  it('refuses when neither header is present, so a bare curl POST cannot drive a check', () => {
    // Deliberate. Accepting "no headers at all" would re-open the hole for every
    // non-browser caller, which is the population easiest to imitate. `GET
    // /api/update-status` stays open and answers the same body.
    assert.equal(isSameOriginRequest({ secFetchSite: null, origin: null, requestOrigin: OWN }), false);
  });
});
