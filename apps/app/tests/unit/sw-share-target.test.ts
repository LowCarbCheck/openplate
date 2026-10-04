/**
 * The service worker's half of the shared-photo expiry (M3/05, 2026-10-04),
 * tested on the file the phone runs.
 *
 * `public/sw.js` is a classic script: it cannot be imported and it is never
 * type-checked. So it is evaluated in a `vm` context whose only globals are
 * the handful a worker has (`self`, `caches`, `importScripts`, the Fetch API
 * classes and a clock this test owns), and its own `activate` and `fetch`
 * handlers are called the way the browser calls them.
 *
 * THE CONTROLS. A share stores a stamp (so the sweep can tell old from new),
 * and an activate with a FRESH entry keeps it while an activate with an AGED
 * entry removes it. A sweep that removed everything fails the first, one that
 * removed nothing fails the second. `app/lib/shared-photo.ts` holds the
 * same constants and the app-start sweep; its own test is `shared-photo.test.ts`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { SHARED_AT_HEADER, SHARED_PHOTO_KEY, SHARED_PHOTO_MAX_AGE_MS } from '../../app/lib/shared-photo';

const SW_PATH = fileURLToPath(new URL('../../public/sw.js', import.meta.url));
const ORIGIN = 'https://app.example';
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

/** The event a handler is given: `waitUntil` and `respondWith` collect the promise it hands over. */
interface CapturedEvent {
  request?: Request;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<Response>): void;
}

type Listener = (event: CapturedEvent) => void;

/** A fake Cache Storage and the maps behind it. */
interface FakeCaches {
  caches: unknown;
  entries: Map<string, Map<string, Response>>;
}

/** A Cache Storage with named caches, each a map from request key to response. */
function fakeCaches(): FakeCaches {
  const entries = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    const cache = entries.get(name) ?? new Map<string, Response>();
    entries.set(name, cache);
    return Promise.resolve({
      match: (request: string) => Promise.resolve(cache.get(request)),
      put: (request: string, response: Response) => {
        cache.set(request, response);
        return Promise.resolve();
      },
      delete: (request: string) => Promise.resolve(cache.delete(request)),
    });
  };
  return {
    caches: { keys: () => Promise.resolve([...entries.keys()]), open, delete: () => Promise.resolve(true) },
    entries,
  };
}

/** The evaluated worker: its listeners, the caches behind it, and the clock it reads. */
interface LoadedWorker {
  listeners: Map<string, Listener>;
  entries: Map<string, Map<string, Response>>;
  setNow(ms: number): void;
}

/** Evaluates the worker and returns what its listeners did. */
function loadWorker(): LoadedWorker {
  const listeners = new Map<string, Listener>();
  const { caches, entries } = fakeCaches();
  let nowMs = NOW;
  const sandbox = {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      clients: { claim: () => Promise.resolve() },
      skipWaiting: () => Promise.resolve(),
    },
    caches,
    importScripts: () => undefined,
    Date: { now: () => nowMs },
    URL,
    Response,
    Request,
    File,
    FormData,
    Headers,
    Promise,
    Number,
    Math,
    encodeURIComponent,
    decodeURIComponent,
  };
  runInNewContext(readFileSync(SW_PATH, 'utf8'), sandbox, { filename: SW_PATH });
  return { listeners, entries, setNow: (ms) => (nowMs = ms) };
}

/** Fires one worker event and waits for the promise the worker handed to it. */
async function fire(listeners: Map<string, Listener>, type: string, request?: Request): Promise<Response | undefined> {
  const listener = listeners.get(type);
  assert.ok(listener, `the worker has no ${type} listener`);
  let pending: Promise<unknown> = Promise.resolve();
  const event: CapturedEvent = {
    request,
    waitUntil: (promise) => void (pending = promise),
    respondWith: (promise) => void (pending = promise),
  };
  listener(event);
  const settled = await pending;
  return settled instanceof Response ? settled : undefined;
}

/** A multipart share-target POST carrying one photo. */
function shareRequest(): Request {
  const body = new FormData();
  body.append('photo', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1])], 'IMG_0001.jpg', { type: 'image/jpeg' }));
  const request = new Request(`${ORIGIN}/share-target`, { method: 'POST', body });
  return request;
}

/** Puts a shared photo into the share cache with the stamp named, or none. */
function storePhoto(entries: Map<string, Map<string, Response>>, stamp: number | null): void {
  const headers = new Headers({ 'X-Shared-Filename': 'plate.jpg' });
  if (stamp !== null) headers.set(SHARED_AT_HEADER, String(stamp));
  const cache = entries.get('share-target') ?? new Map<string, Response>();
  cache.set(SHARED_PHOTO_KEY, new Response('bytes', { headers }));
  entries.set('share-target', cache);
}

function isStored(entries: Map<string, Map<string, Response>>): boolean {
  return entries.get('share-target')?.has(SHARED_PHOTO_KEY) === true;
}

describe('the share target in public/sw.js', () => {
  it('stamps the stored photo with the instant it arrived', async () => {
    const worker = loadWorker();
    const redirect = await fire(worker.listeners, 'fetch', shareRequest());
    assert.equal(redirect?.status, 303);
    const stored = worker.entries.get('share-target')?.get(SHARED_PHOTO_KEY);
    assert.ok(stored, 'the shared photo was not stored');
    assert.equal(stored.headers.get(SHARED_AT_HEADER), String(NOW));
  });

  it('keeps a fresh shared photo at activate', async () => {
    const worker = loadWorker();
    storePhoto(worker.entries, NOW - 60_000);
    await fire(worker.listeners, 'activate');
    assert.equal(isStored(worker.entries), true);
  });

  it('removes an aged shared photo at activate', async () => {
    const worker = loadWorker();
    storePhoto(worker.entries, NOW - SHARED_PHOTO_MAX_AGE_MS - 1);
    await fire(worker.listeners, 'activate');
    assert.equal(isStored(worker.entries), false);
  });

  it('removes a shared photo with no stamp at activate', async () => {
    const worker = loadWorker();
    storePhoto(worker.entries, null);
    await fire(worker.listeners, 'activate');
    assert.equal(isStored(worker.entries), false);
  });

  it('removes a photo it stamped itself once a day has passed', async () => {
    const worker = loadWorker();
    await fire(worker.listeners, 'fetch', shareRequest());
    worker.setNow(NOW + SHARED_PHOTO_MAX_AGE_MS + 1);
    await fire(worker.listeners, 'activate');
    assert.equal(isStored(worker.entries), false);
  });
});
