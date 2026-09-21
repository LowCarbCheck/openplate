/**
 * The one redirect ADR-0019 says must keep working indefinitely.
 *
 * `/scan?shared=1` is the PWA share target's landing address, and an installed
 * app keeps running its OLD service worker (which still sends exactly that
 * URL) until it next updates, regardless of what this build ships. Per the
 * ADR's own stated risk tolerance, the bar here is narrow and explicit: the
 * redirect exists and forwards its query string. No broader service-worker
 * migration suite is built on top of it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loader } from '../../app/routes/redirects/legacy-scan';

/** Runs the loader and returns the thrown redirect Response, or fails the test if it didn't throw one. */
async function redirectFrom(url: string): Promise<Response> {
  const request = new Request(url);
  try {
    await loader({ request } as Parameters<typeof loader>[0]);
  } catch (thrown) {
    assert.ok(thrown instanceof Response, 'expected the loader to throw a Response');
    return thrown;
  }
  throw new Error('expected the loader to throw a redirect, it returned instead');
}

describe('the /scan legacy redirect', () => {
  it('forwards ?shared=1 and every other query param to /add/photo', async () => {
    const response = await redirectFrom('https://openplate.example/scan?shared=1&date=2026-09-21');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/add/photo?shared=1&date=2026-09-21');
  });

  it('redirects a bare /scan to a bare /add/photo, with no stray query mark', async () => {
    const response = await redirectFrom('https://openplate.example/scan');
    assert.equal(response.headers.get('Location'), '/add/photo');
  });
});
