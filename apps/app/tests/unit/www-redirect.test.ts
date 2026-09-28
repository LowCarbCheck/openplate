/**
 * Tests for the `www.` → apex canonical-host redirect, exercised through a
 * REAL Express app carrying the real middleware from
 * `#app/lib/www-redirect.server` — not just the pure decision underneath it.
 * The wiring is half the behaviour here: which value the middleware reads for
 * the host (proxy-aware or socket-level), and whether `/healthcheck` survives
 * it, are exactly the things a pure-function test cannot see.
 *
 * The app below sets `trust proxy` the way `server.ts` does in production, so
 * the requests can present themselves as Traefik does: an `X-Forwarded-Host`
 * and `X-Forwarded-Proto` naming the public origin, over a plain-http
 * loopback socket.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { createWwwRedirectMiddleware } from '../../app/lib/www-redirect.server';

/** What every request below sees once the middleware has let it through. */
const SERVED_BODY = 'served';

const app = express();
// Mirrors `server.ts`: one trusted proxy hop (Traefik), so `req.hostname` /
// `req.protocol` read the X-Forwarded-* headers rather than the socket.
app.set('trust proxy', 1);
app.use(createWwwRedirectMiddleware());
app.all('*', (_req, res) => {
  res.status(200).type('text/plain').send(SERVED_BODY);
});

let baseUrl = '';
let server: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  // SAFETY: `address()` is only `null`/a string for an unbound or a pipe/UDS
  // listener; this one is bound to a TCP port above, inside the callback.
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

/** Issues `path` as if Traefik had forwarded it for `host` over https. */
async function request(host: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: { 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' },
  });
}

describe('www redirect — the www. host is canonicalised', () => {
  it('301s to the apex host, preserving BOTH the path and the query string', async () => {
    const response = await request('www.openplate.de', '/some/path?a=1');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://openplate.de/some/path?a=1');
  });

  it('keeps a multi-parameter query intact, verbatim', async () => {
    const response = await request('www.openplate.de', '/diary?date=2026-08-26&meal=lunch');
    assert.equal(response.headers.get('location'), 'https://openplate.de/diary?date=2026-08-26&meal=lunch');
  });

  it('preserves the scheme rather than forcing https', async () => {
    const response = await fetch(`${baseUrl}/`, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Host': 'www.openplate.de', 'X-Forwarded-Proto': 'http' },
    });
    assert.equal(response.headers.get('location'), 'http://openplate.de/');
  });
});

describe('www redirect — every other host is left alone', () => {
  it('does NOT redirect the apex host itself', async () => {
    const response = await request('openplate.de', '/some/path?a=1');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), SERVED_BODY);
  });

  it('does NOT redirect openplate.lowcarbcheck.org — the original name stays live, unchanged', async () => {
    const response = await request('openplate.lowcarbcheck.org', '/diary?date=2026-08-26');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), SERVED_BODY);
  });

  it('does NOT redirect a host that merely CONTAINS www: prefix, not substring', async () => {
    for (const host of ['wwwx.example.com', 'mywww.example.com', 'www-openplate.de', 'openplate.de/www']) {
      const response = await request(host, '/');
      assert.equal(response.status, 200, `expected ${host} to be served, not redirected`);
    }
  });

  it('does NOT redirect a bare "www." host, which has no apex left to point at', async () => {
    const response = await request('www.', '/');
    assert.equal(response.status, 200);
  });
});

describe('www redirect — it is not hardcoded to openplate.de', () => {
  it('canonicalises a self-hoster’s own domain with no configuration', async () => {
    const response = await request('www.theirdomain.example', '/settings?tab=ai');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://theirdomain.example/settings?tab=ai');
  });

  it('canonicalises a deeper subdomain too, stripping only the www. label', async () => {
    const response = await request('www.app.theirdomain.example', '/');
    assert.equal(response.headers.get('location'), 'https://app.theirdomain.example/');
  });
});

describe('www redirect — the healthcheck probe is never redirected', () => {
  it('answers /healthcheck with 200 on a www. host', async () => {
    const response = await request('www.openplate.de', '/healthcheck');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), SERVED_BODY);
  });

  it('still answers /healthcheck with 200 on the apex host', async () => {
    const response = await request('openplate.de', '/healthcheck');
    assert.equal(response.status, 200);
  });
});
