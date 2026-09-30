/**
 * A ROUTED REQUEST THE PAGE LET GO OF IS NOT A FAILURE, AND NOTHING ELSE IS
 * SWALLOWED.
 *
 * `tests/e2e/route-fetch.ts` guards the stubs that rewrite a real answer. A
 * spec that loads a new document mid-request makes Playwright dispose the
 * fetched response, and the throw inside the route handler failed
 * `synced-diary-location-copy.spec.ts` in four of five CI runs. The guard must
 * read that case as "nobody is waiting" and must still throw for every other
 * failure, or a stub that cannot reach its server would pass in silence.
 *
 * Each case carries its control: the abandoned case against an ordinary
 * error, and the success case against a body that fails to read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchRouteText, fulfilUnlessAbandoned, isAbandonedRouteMessage } from '../e2e/route-fetch';

/** The one method of a fetched response the guard reads. */
interface TextOnlyResponse {
  text(): Promise<string>;
}

/** The one method of Playwright's `Route` the guard calls. */
interface FakeRoute {
  fetch(): Promise<TextOnlyResponse>;
}

/** A route whose fetched response reads as `readText` does. */
function routeWithBody(readText: () => Promise<string>): FakeRoute {
  return { fetch: async () => ({ text: readText }) };
}

/** A route whose `fetch()` itself rejects with `reason`. */
function routeWhoseFetchRejects(reason: Error | string): FakeRoute {
  return {
    fetch: async () => {
      // A string reason stands for a library that rejects with something other than an Error.
      throw reason;
    },
  };
}

describe('fetchRouteText', () => {
  it('returns the real answer and its text', async () => {
    const fetched = await fetchRouteText(routeWithBody(async () => '{"ok":true}'));
    assert.equal(fetched?.text, '{"ok":true}');
  });

  it('reads a response disposed by a navigation as abandoned, not as a failure', async () => {
    const fetched = await fetchRouteText(
      routeWithBody(async () => {
        throw new Error('apiResponse.text: Response has been disposed');
      }),
    );
    assert.equal(fetched, null);
  });

  it('reads a closed page during the fetch as abandoned', async () => {
    const fetched = await fetchRouteText(
      routeWhoseFetchRejects(new Error('route.fetch: Target page, context or browser has been closed')),
    );
    assert.equal(fetched, null);
  });

  it('CONTROL: a body that fails to read for any other reason still throws', async () => {
    await assert.rejects(
      fetchRouteText(
        routeWithBody(async () => {
          throw new Error('apiResponse.text: unexpected end of stream');
        }),
      ),
      /unexpected end of stream/u,
    );
  });

  it('CONTROL: a fetch that cannot reach the server still throws', async () => {
    await assert.rejects(
      fetchRouteText(routeWhoseFetchRejects(new Error('route.fetch: connect ECONNREFUSED 127.0.0.1:5299'))),
      /ECONNREFUSED/u,
    );
  });
});

describe('fulfilUnlessAbandoned', () => {
  it('ignores a fulfil on a route the page already let go of', async () => {
    await fulfilUnlessAbandoned(async () => {
      throw new Error('route.fulfill: Route is already handled!');
    });
  });

  it('CONTROL: a fulfil that fails for another reason still throws', async () => {
    await assert.rejects(
      fulfilUnlessAbandoned(async () => {
        throw new Error('route.fulfill: Invalid status code');
      }),
      /Invalid status code/u,
    );
  });
});

describe('a rejection that is not an Error', () => {
  it('is rethrown, even when it carries the words', async () => {
    await assert.rejects(fetchRouteText(routeWhoseFetchRejects('Response has been disposed')));
  });

  it('CONTROL: the same words in an Error are read as abandoned', async () => {
    assert.equal(isAbandonedRouteMessage('Response has been disposed'), true);
    assert.equal(await fetchRouteText(routeWhoseFetchRejects(new Error('Response has been disposed'))), null);
  });
});
