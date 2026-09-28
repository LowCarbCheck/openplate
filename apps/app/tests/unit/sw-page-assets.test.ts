/**
 * `public/sw-page-assets.js`, the service worker's reader for the files a saved page starts on.
 *
 * WHY IT MATTERS. The worker keeps a page for offline use only together with every file this
 * reader lists, and serves a saved page only while they are all still kept (`public/sw.js`, v6).
 * A file it misses is a file a saved page asks for offline and gets a 503: the endless boot
 * screen of 2026-09-27. A file it invents is a file the save waits on for nothing.
 *
 * THE FIXTURE is the shape React Router's production HTML has: `modulepreload` and `stylesheet`
 * links, a font `preload`, the inline module script's `import` lines, the boot screen's logo as
 * an `<img>` with its cache-busting query, and the streamed route data, whose strings are
 * JSON-escaped inside a script.
 *
 * THE CONTROLS. A reader that returned every quoted string would list the external address and
 * the in-app link; one that returned nothing would miss the logo. Both are asserted against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const SOURCE_PATH = fileURLToPath(new URL('../../public/sw-page-assets.js', import.meta.url));

/** What the worker copy attaches to `self`. */
interface PageAssetsModule {
  listPageAssets(html: string): string[];
}

/** The vm context the copy is evaluated in: a scope object and nothing else. */
interface WorkerSandbox {
  self: { openplatePageAssets?: PageAssetsModule };
}

/** Evaluates the classic script with a bare `self`, the narrowest stand-in for the worker scope. */
function loadPageAssets(): PageAssetsModule {
  const sandbox: WorkerSandbox = { self: {} };
  runInNewContext(readFileSync(SOURCE_PATH, 'utf8'), sandbox, { filename: SOURCE_PATH });
  const attached = sandbox.self.openplatePageAssets;
  if (!attached) throw new Error(`${SOURCE_PATH} did not attach self.openplatePageAssets`);
  // Copied into this realm: an array made inside the vm context has the context's own
  // `Array.prototype`, and `deepStrictEqual` tells the two apart.
  return { listPageAssets: (html) => [...attached.listPageAssets(html)] };
}

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charSet="utf-8"/>
<link rel="preload" as="image" href="/icons/icon-192.png?v=2"/>
<link rel="preload" href="/assets/victor-mono-latin-wght-normal-DLAw12qW.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>
<link rel="manifest" href="/site.webmanifest"/>
<link rel="icon" href="/favicon.ico?v=2" sizes="48x48"/>
<link rel="stylesheet" href="/assets/app-d2zGnnH_.css"/>
<link rel="modulepreload" href="/assets/manifest-98a5cd75.js"/>
<link rel="modulepreload" href="/assets/entry.client-C60uhkSD.js"/>
<link rel="preconnect" href="https://example.org/assets/elsewhere.js"/>
</head><body>
<output aria-label="Loading"><img src="/icons/icon-192.png?v=2" alt="" class="h-16 w-16"/></output>
<a href="/diary">Diary</a>
<script type="module" async="">import "/assets/manifest-98a5cd75.js";
import * as route0 from "/assets/root-DwNUh2f8.js";
import("/assets/entry.client-C60uhkSD.js");</script>
<script>window.__reactRouterContext.streamController.enqueue("[\\"note\\",\\"/assets/not-a-tag.js\\"]");</script>
</body></html>`;

test('lists every start-up file the page names, once each, in the order it first names them', () => {
  assert.deepEqual(loadPageAssets().listPageAssets(PAGE), [
    '/icons/icon-192.png?v=2',
    '/assets/victor-mono-latin-wght-normal-DLAw12qW.woff2',
    '/assets/app-d2zGnnH_.css',
    '/assets/manifest-98a5cd75.js',
    '/assets/entry.client-C60uhkSD.js',
    '/assets/root-DwNUh2f8.js',
  ]);
});

test('keeps the logo, the picture the boot screen draws before any script runs', () => {
  assert.ok(loadPageAssets().listPageAssets(PAGE).includes('/icons/icon-192.png?v=2'));
});

test('leaves out other origins, in-app links, the web manifest and escaped strings inside route data', () => {
  const listed = loadPageAssets().listPageAssets(PAGE);
  for (const outside of ['/diary', '/site.webmanifest', '/favicon.ico?v=2', '/assets/not-a-tag.js', '/assets/elsewhere.js']) {
    assert.ok(!listed.includes(outside), `did not expect ${outside}`);
  }
});

test('lists nothing for a page that names no start-up file', () => {
  assert.deepEqual(loadPageAssets().listPageAssets('<html><body><p>Offline</p></body></html>'), []);
});
