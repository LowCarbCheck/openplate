/**
 * What the release check sends (ADR-0021), pinned byte for byte.
 *
 * The check is the only request a default instance makes, and the project site
 * counts the addresses that ask. That is acceptable because the request carries
 * nothing else: a GET, no body, no query string, and two headers. A third header
 * (an instance id, a cookie, a token) would turn the count into tracking, and no
 * other test in the repository would notice. So this file compares the WHOLE
 * header set, not "the headers we expect are there".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createUpdateChecker } from '../../app/lib/update-check.server';

interface Seen {
  url: string;
  init: RequestInit;
}

/** A `fetch` that answers with `latest.json` for the given version and records what it was asked. */
function recordingFetch(versions: readonly string[]) {
  const seen: Seen[] = [];
  const fetchImpl = (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const version = versions[Math.min(seen.length - 1, versions.length - 1)];
    return Promise.resolve(new Response(JSON.stringify({ app: { version } }), { status: 200 }));
  };
  return { seen, fetchImpl };
}

function checkerOver(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  return createUpdateChecker({
    enabled: true,
    currentVersion: '0.61.0',
    releaseUrlFor: (version) => `https://example.test/releases/tag/v${version}`,
    fetchImpl,
    now: () => 1000,
  });
}

describe('the release check request', () => {
  it('is a GET to openplate.de/latest.json with no body and no query string', async () => {
    const { seen, fetchImpl } = recordingFetch(['0.62.0']);
    await checkerOver(fetchImpl).refresh();

    assert.equal(seen.length, 1);
    const request = seen[0];
    assert.ok(request, 'the check made a request');
    assert.equal(request.url, 'https://openplate.de/latest.json');
    assert.equal(new URL(request.url).search, '');
    assert.equal(new URL(request.url).hash, '');
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.body, undefined);
  });

  it('sends exactly accept and user-agent, so an added header fails here', async () => {
    const { seen, fetchImpl } = recordingFetch(['0.62.0']);
    await checkerOver(fetchImpl).refresh();

    const headers = new Headers(seen[0]?.init.headers);
    assert.deepEqual([...headers.keys()].toSorted(), ['accept', 'user-agent']);
    assert.equal(headers.get('accept'), 'application/json');
    // No cookie jar and no credentials mode either: the request cannot grow an identity by itself.
    assert.equal(seen[0]?.init.credentials, undefined);
  });

  it('names the version, platform and arch in the user-agent, and nothing else', async () => {
    const { seen, fetchImpl } = recordingFetch(['0.62.0']);
    await checkerOver(fetchImpl).refresh();

    const agent = new Headers(seen[0]?.init.headers).get('user-agent') ?? '';
    assert.match(agent, /^openplate\/\d+\.\d+\.\d+ \((\w+); (\w+)\)$/);
    assert.equal(agent, `openplate/0.61.0 (${process.platform}; ${process.arch})`);
  });

  it('control: the header comparison fails when a third header is present', () => {
    const headers = new Headers({ Accept: 'application/json', 'User-Agent': 'openplate/0.61.0 (linux; arm64)' });
    headers.set('X-Instance-Id', 'abc');
    assert.notDeepEqual([...headers.keys()].toSorted(), ['accept', 'user-agent']);
  });

  it('control: a prerelease answer is rejected and the previous answer is kept', async () => {
    const { seen, fetchImpl } = recordingFetch(['0.62.0', '0.63.0-rc.1']);
    const checker = checkerOver(fetchImpl);

    const first = await checker.refresh();
    assert.equal(first.latest, '0.62.0');

    const second = await checker.refresh();
    assert.equal(seen.length, 2, 'the second check did ask');
    assert.equal(second.latest, '0.62.0', 'the prerelease was not believed');
    assert.equal(second.checkedAt, first.checkedAt, 'and the failed check did not claim it looked just now');
  });
});
