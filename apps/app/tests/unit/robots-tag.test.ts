/**
 * Tests for the site-wide "do not index this app" rule (release 0.10.2).
 *
 * Three things are pinned here, because each fails differently and silently:
 *
 *  1. **The pure value.** `robotsTagHeader()` is the one place the header name
 *     and the directives are spelled. A crawler reads them literally, so a
 *     typo (`no-index`, a missing comma) is simply ignored by the crawler and
 *     looks exactly like a working rule from the inside.
 *  2. **The wiring.** The middleware is exercised through a REAL Express app
 *     carrying the real handler, because the interesting question is not what
 *     the function returns but WHICH responses carry it. A header set inside a
 *     route handler would miss the static files, the redirects and the 404s,
 *     and those are pages a crawler can reach.
 *  3. **`public/robots.txt`.** The header only reaches a crawler that fetched
 *     the page; the file is what stops the fetch. Half the rule shipping alone
 *     still leaves the app indexable, so the file is asserted as bytes here
 *     rather than trusted to survive a future tidy-up of `public/`.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { robotsTagHeader } from '../../app/lib/robots-tag';
import { createRobotsTagMiddleware } from '../../app/lib/robots-tag.server';
import { createWwwRedirectMiddleware } from '../../app/lib/www-redirect.server';

/** What every request below sees once the middleware has let it through. */
const SERVED_BODY = 'served';

const app = express();
// Mirrors `server.ts`: the indexing header is mounted ABOVE everything that
// serves content, the canonical-host redirect below it, so a 301 carries the
// header too.
app.use(createRobotsTagMiddleware());
app.set('trust proxy', 1);
app.use(createWwwRedirectMiddleware());
app.get('/served', (_req, res) => {
  res.status(200).type('text/plain').send(SERVED_BODY);
});
app.get('/boom', () => {
  throw new Error('deliberate');
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

describe('robots tag, the value a crawler reads', () => {
  it('is X-Robots-Tag: noindex, nofollow, spelled exactly', () => {
    assert.deepEqual(robotsTagHeader(), { name: 'X-Robots-Tag', value: 'noindex, nofollow' });
  });

  it('keeps noindex, which is the directive that removes an already-linked URL', () => {
    assert.match(robotsTagHeader().value, /\bnoindex\b/);
  });

  it('keeps nofollow, so a crawler does not walk the application shell', () => {
    assert.match(robotsTagHeader().value, /\bnofollow\b/);
  });
});

describe('robots tag, every response carries it', () => {
  it('sets it on a served page', async () => {
    const response = await request('beta.openplate.de', '/served');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  it('sets it on a 404, which is a URL a crawler can reach from a stale link', async () => {
    const response = await request('beta.openplate.de', '/no-such-page');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  it('sets it on a 500, so an error page cannot be indexed either', async () => {
    const response = await request('beta.openplate.de', '/boom');
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  it('sets it on the canonical-host 301, which is mounted below it', async () => {
    const response = await request('www.openplate.de', '/served');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  it('sets it on the healthcheck path, which the redirect exempts but this does not', async () => {
    const response = await request('beta.openplate.de', '/healthcheck');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});

describe('robots tag, it is not tied to one hostname', () => {
  it('applies on a self-hoster’s own domain, with no configuration', async () => {
    for (const host of ['beta.openplate.de', 'openplate.lowcarbcheck.org', 'theirdomain.example', 'localhost:3000']) {
      const response = await request(host, '/served');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', `expected the header on ${host}`);
    }
  });
});

describe('robots.txt, the other half of the rule', () => {
  it('disallows the whole app for every crawler', () => {
    const path = fileURLToPath(new URL('../../public/robots.txt', import.meta.url));
    assert.equal(readFileSync(path, 'utf8'), 'User-agent: *\nDisallow: /\n');
  });
});
