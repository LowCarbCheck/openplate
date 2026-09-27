// openplate service worker, hand-rolled (no workbox), ported from the SHW
// reference. Versioned named caches with an activate-time purge of stale
// versions, an app-shell precache with a dedicated /offline fallback, and
// per-request-type fetch strategies. It also backs the Web Share Target v2 flow
// by stashing a shared photo for the /add/photo page to pick up.
//
// It deliberately never caches route data or endpoint responses: the single
// source of offline data is the client-side store, not this worker. Requests
// for route data (the single-fetch `.data` suffix) are bypassed entirely.

// v2 (M134): `/` now 302s to `/dashboard` for a device carrying the home hint,
// so any `pages-v1` entry for `/` is marketing HTML that must not outlive the
// change. Bumping the version is what evicts it.
// v3 (M123/11): `/recover` and `/onboarding` joined APP_SHELL. Without the
// bump, an install that already ran the old shell keeps its old pages-v2 cache
// forever, nothing ever re-adds the two new entries to it.
// v4 (M223/03, 2026-09-12): the worker gained `push` and `notificationclick`
// and now loads `/sw-push-decision.js` at startup. The bump is not about a
// cache entry this time: it is what makes every installed device fetch this
// file again and pick up the two new handlers, instead of a device that took
// the old worker staying pushable-but-silent forever.
// v5 (ADR-0019): `/add` in APP_SHELL became `/add/search`, the database
// search's real address now that `/add` itself is a redirect. Without the
// bump, a device that already ran the old shell keeps its stale `/add` entry
// forever in the same-named cache, and the redirected fetch during precache
// would never have populated it anyway (`!response.redirected`, same guard
// `/` uses). The share-target redirect target also moved, from `/scan?shared=1`
// to `/add/photo?shared=1`; see `handleShareTarget` below.
// v6 (2026-09-27, the endless boot screen): a saved page is now saved WITH
// the files it loads to start, and served only while they are all still
// saved; a page that cannot be served that way sends the navigation to
// `/offline` instead. `/welcome` joined APP_SHELL. The bump is what throws
// away every pages-v5 entry, because those were saved as bare HTML: the
// install fetched the page and never its scripts or its logo, and the first
// visit had fetched those before this worker controlled the page, so offline
// a v5 page answered with a boot screen whose every script was a 503.
// The push decision (what a push shows, where a tap lands) lives apart from
// this file so it can be unit tested without a service worker. This worker is
// registered as a classic script, so it loads that copy with `importScripts`
// rather than a static `import`. It attaches `self.openplatePushDecision`.
// `/sw-page-assets.js` is the same kind of copy, for the same reason: it reads
// a page's HTML for the files it loads to start, and attaches
// `self.openplatePageAssets`.
importScripts('/sw-push-decision.js', '/sw-page-assets.js');

const CACHE_VERSION = 'v6';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const PAGES_CACHE = `pages-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

// Not version-suffixed: an in-flight shared photo must survive a worker update.
const SHARE_CACHE = 'share-target';
const SHARED_PHOTO_KEY = '/share-target/photo';

// Small cap so cached food/plate images can't grow without bound.
const MAX_IMAGE_ENTRIES = 60;

// Pages to precache on install so the app boots and navigates offline.
//
// `/recover` and `/onboarding` (M123/11) are here for the same reason: both
// are destinations the `_personal` gate itself redirects to (never something
// the user typed), so whichever device lands on one needs it already cached ,
// there is no earlier visit to that path to have populated it on demand.
// Neither redirects when fetched directly (verified against the route source,
// not assumed): `/recover` is a plain top-level page and `/onboarding`'s
// server `loader` returns `{}` unconditionally, so both cache cleanly here.
//
// `/welcome` (2026-09-27) for the same reason again: it is where the gate
// sends a device that holds no profile, which is every device after its first
// visit until it finishes onboarding. Without it, the saved `/dashboard` of
// such a device booted offline and then had no screen to hand over to.
const APP_SHELL = ['/', '/dashboard', '/diary', '/add/search', '/offline', '/recover', '/onboarding', '/welcome'];

// Where a navigation goes when this worker has no page it can serve whole.
const OFFLINE_PATH = '/offline';

// ---------------------------------------------------------------------------
// Install, precache the app shell (resiliently)
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

async function precacheAppShell() {
  const cache = await caches.open(PAGES_CACHE);
  // Per-URL and tolerant (unlike a single atomic addAll): a route that
  // redirects at install time (e.g. the onboarding gate) or a transient network
  // blip must not abort the whole install. The runtime network-first handler
  // backfills any entry skipped here on the first successful visit.
  //
  // THE PAGES ONLY, and that is deliberate (v6). These pages are not served
  // offline until their start-up files are saved too (`offlineDocument`), and
  // that happens in `saveShellWithAssets`, after the app has started. NOT
  // HERE: a script put into Cache Storage during the install event is one
  // Chromium prepares for its code cache, and pages that later loaded those
  // scripts through this worker had some of their module requests aborted, a
  // boot screen that never ended, in 4 to 6 of 30 walks through
  // `strip-photo-button.spec.ts`'s six languages. The same saves, run once per
  // launch from a message after the start, failed 0 of 30.
  await Promise.all(
    APP_SHELL.map(async (path) => {
      try {
        const response = await fetch(path, { credentials: 'same-origin' });
        if (response.ok && !response.redirected) {
          await cache.put(path, response);
        }
      } catch {
        // Offline or blocked during install, fill on first visit instead.
      }
    }),
  );
}

// Makes every shell page whole: a saved page whose start-up files are not all
// saved is fetched again and saved with them (`savePageWithAssets`). Run on
// `SAVE_SHELL`, which `app/lib/service-worker.ts` posts once the app has
// started, so it never competes with a page that is still loading, and cheap
// once done: a whole page is read from the cache and left alone.
//
// One page at a time, and a page that cannot be made whole (offline, a deploy
// that retired a file) is skipped: it stays unservable offline, and the next
// start tries again.
async function saveShellWithAssets() {
  for (const path of APP_SHELL) {
    try {
      const saved = await caches.match(path);
      if (saved && (await isServableWhole(saved))) continue;
      const response = await fetch(path, { credentials: 'same-origin' });
      if (response.ok && !response.redirected && isHtml(response)) {
        await savePageWithAssets(path, response);
      }
    } catch {
      // Offline, or a file that would not come: the next start tries again.
    }
  }
}

// ---------------------------------------------------------------------------
// Activate, purge old-version caches, keep the share-target cache
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (n) =>
                (n.startsWith('static-') || n.startsWith('pages-') || n.startsWith('images-')) &&
                !n.includes(CACHE_VERSION),
            )
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Fetch, share-target POST, then per-request-type GET strategies
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Web Share Target v2: a multipart POST from the OS share sheet. Handle it
  // before the GET-only guard below.
  if (request.method === 'POST' && isSameOrigin && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // Only same-origin GETs are cached, skip external images (avatars, etc.).
  if (!isSameOrigin) return;

  // Never touch route data requests (the single-fetch `.data` suffix, with or
  // without a `_routes` search param). Offline data comes from the client-side
  // store, not this cache, so these must always reach the network untouched.
  if (isRouteDataRequest(url)) return;

  if (isStaticAsset(url, request) || isBrandPicture(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (isImage(url, request)) {
    event.respondWith(cacheFirstWithCap(request, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event));
  } else {
    event.respondWith(networkFirst(request, PAGES_CACHE));
  }
});

// ---------------------------------------------------------------------------
// Share target, stash the shared photo, redirect into the photo flow
// ---------------------------------------------------------------------------
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const photo = formData.get('photo');
    if (photo instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      // Store under a synthetic GET key the /add/photo page reads once on
      // mount. Only stamp a type the sender actually provided, a hardcoded
      // binary fallback here would defeat the image/jpeg default applied on
      // read-back and fail photo validation.
      const headers = { 'X-Shared-Filename': encodeURIComponent(photo.name || 'shared-photo') };
      if (photo.type) headers['Content-Type'] = photo.type;
      await cache.put(SHARED_PHOTO_KEY, new Response(photo, { headers }));
      return Response.redirect(new URL('/add/photo?shared=1', self.location.origin).toString(), 303);
    }
  } catch {
    // Fall through to the plain redirect below.
  }
  return Response.redirect(new URL('/add/photo', self.location.origin).toString(), 303);
}

// ---------------------------------------------------------------------------
// Request classifiers
// ---------------------------------------------------------------------------
function isRouteDataRequest(url) {
  return url.pathname.endsWith('.data');
}

function isStaticAsset(url, request) {
  return (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|ttf|eot)$/i.test(url.pathname)
  );
}

// The synced brand pictures (the boot screen's logo, the icons). They go to the
// static cache, uncapped, and not to the image cache below: a start-up file a
// saved page needs must not be the entry a sixty-first food photo evicts.
function isBrandPicture(url) {
  return url.pathname.startsWith('/icons/');
}

function isImage(url, request) {
  return request.destination === 'image' || /\.(jpg|jpeg|png|gif|webp|svg|ico|avif)$/i.test(url.pathname);
}

// ---------------------------------------------------------------------------
// Caching strategies
// ---------------------------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirstWithCap(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      await trimCache(cache, maxEntries);
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// A same-origin GET that is not a document: kept for offline, served from the
// cache when the network fails. Documents take `networkFirstPage` below.
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ---------------------------------------------------------------------------
// Documents, a page is kept and served together with the files it starts on
// ---------------------------------------------------------------------------
// THE RULE (v6, 2026-09-27): this worker never serves a saved page whose
// start-up files it cannot also serve. The boot screen that hung forever was a
// page saved on its own, its scripts never kept, so offline every one of them
// was a 503 and nothing ever replaced the wordmark.
//
// TWO HALVES. Once the app has started, `saveShellWithAssets` saves each shell
// page with its files, because the first visit loaded them before this worker
// was there to keep them. A page visited later loads its files through this
// worker, and `cacheFirst` keeps each one as it arrives, so the page itself is
// stored as it always was. Serving is where the rule is enforced for both:
// `offlineDocument` hands out a saved page only while every file it names is
// in the static cache, and sends the navigation to `/offline` otherwise.
//
// A visited page is not checked or completed in the background of its own
// navigation: its own requests store the same files a moment later, and work
// beside a page that is still loading is what this worker keeps away from.

// A document navigation: the network first, and a saved page after it.
async function networkFirstPage(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    // `!response.redirected` mirrors the guard `precacheAppShell` already has:
    // `/` redirects into the app for a device carrying the home hint, and
    // caching the followed response would store `/dashboard`'s HTML under `/`.
    if (response.ok && !response.redirected && isHtml(response)) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineDocument(request);
  }
}

// What a navigation gets when the network failed.
//
// 1. The saved page for this address, if every file it starts on is saved.
// 2. Otherwise a redirect to `/offline`, so the address and the document agree
//    and nothing hydrates one route's markup as another.
// 3. `/offline` itself is served even with its files gone: it is server
//    rendered text that reads with no script at all, which is the one page
//    where that holds.
async function offlineDocument(request) {
  const cached = await caches.match(request);
  if (cached && (await isServableWhole(cached))) return cached;

  const isOfflinePage = new URL(request.url).pathname === OFFLINE_PATH;
  if (isOfflinePage && cached) return cached;
  if (!isOfflinePage && (await caches.match(OFFLINE_PATH))) {
    return Response.redirect(new URL(OFFLINE_PATH, self.location.origin).toString(), 302);
  }

  return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

// Whether every start-up file a saved page names is saved too.
async function isServableWhole(page) {
  const html = await page.clone().text();
  const assets = self.openplatePageAssets.listPageAssets(html);
  const stored = await storedAddresses(await caches.open(STATIC_CACHE));
  return assets.every((asset) => stored.has(absoluteAddress(asset)));
}

// Stores a page under `key`, but only after every start-up file it names is
// stored in the static cache. Rejects, storing nothing, when one cannot be
// fetched, so a half-kept page never replaces a whole one.
// `saveShellWithAssets` is its caller. A page names about 150 files, so the
// cache is asked once for its keys rather than once per file, and only the
// files still missing are fetched, a few at a time (`ASSET_SAVES_AT_ONCE`).
async function savePageWithAssets(key, response) {
  const html = await response.clone().text();
  const assets = self.openplatePageAssets.listPageAssets(html);
  const staticCache = await caches.open(STATIC_CACHE);
  const stored = await storedAddresses(staticCache);
  const missing = assets.filter((asset) => !stored.has(absoluteAddress(asset)));
  await Promise.all(missing.map((asset) => saveAsset(staticCache, asset)));
  const pages = await caches.open(PAGES_CACHE);
  await pages.put(key, response);
}

// Every address a cache holds, as absolute URLs.
async function storedAddresses(cache) {
  const requests = await cache.keys();
  return new Set(requests.map((request) => request.url));
}

function absoluteAddress(asset) {
  return new URL(asset, self.location.origin).toString();
}

// How many start-up files this worker fetches at once. The first shell save
// fetches about 150 files, so without a cap it would open every request in one
// burst, beside the requests of any page this worker controls.
const ASSET_SAVES_AT_ONCE = 4;
let assetSavesRunning = 0;
const assetSavesWaiting = [];

// Runs `task` once fewer than ASSET_SAVES_AT_ONCE saves are running.
function inAssetSaveSlot(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      assetSavesRunning += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          assetSavesRunning -= 1;
          const next = assetSavesWaiting.shift();
          if (next) next();
        });
    };
    if (assetSavesRunning < ASSET_SAVES_AT_ONCE) run();
    else assetSavesWaiting.push(run);
  });
}

// One start-up file into the static cache, fetched once however many saves
// ask for it at the same moment (two starts in two tabs share every file).
const assetsInFlight = new Map();

function saveAsset(cache, asset) {
  const running = assetsInFlight.get(asset);
  if (running) return running;
  const saving = inAssetSaveSlot(async () => {
    // The static cache, not any cache: a picture the capped image cache holds
    // today can be evicted from it tomorrow, and this copy has to stay. Asked
    // again here because another page's save may have stored it meanwhile.
    if (await cache.match(asset)) return;
    const response = await fetch(asset, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${asset} answered ${response.status}`);
    await cache.put(asset, response);
  }).finally(() => assetsInFlight.delete(asset));
  assetsInFlight.set(asset, saving);
  return saving;
}

function isHtml(response) {
  return (response.headers.get('Content-Type') || '').includes('text/html');
}

// FIFO eviction so a cache stays under `maxEntries`, oldest keys drop first.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// ---------------------------------------------------------------------------
// Message handler, SKIP_WAITING (update flow), SAVE_SHELL + CLEAR_CACHE
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'SAVE_SHELL') {
    event.waitUntil(saveShellWithAssets());
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

// ---------------------------------------------------------------------------
// Web push, plus the tap that follows it
// ---------------------------------------------------------------------------
// The server sends a kind and nothing else (M223): every word shown here is
// written on this device. The rule the whole section is built around is that a
// user visible push MUST show a notification. A push handler that resolves
// without calling `showNotification` makes the browser show its own "this site
// was updated in the background" line instead, and a few of those cost the
// permission for good. So every failure below, an unreadable payload, a
// missing record, a slow database, a thrown error, ends at the generic line
// rather than at nothing.
//
// The decision itself is not here: `self.openplatePushDecision` comes from
// `/sw-push-decision.js`, loaded at the top of this file, and is unit tested
// under node. This section only does the I/O around it.

// The catch-up store, mirrored as literals from `app/lib/notify-store.ts`,
// which is the only writer. A worker cannot import an app module, so these
// three strings are the seam; change them there first.
const NOTIFY_DB_NAME = 'openplate-notify';
const NOTIFY_STORE_NAME = 'catchUp';
const NOTIFY_RECORD_KEY = 'latest';

// The record has its own tiny database, separate from the app's own stores,
// and this read is bounded at three seconds. Both halves matter: a push handler
// that blocks on a database another tab holds open never resolves, and the
// browser then kills the worker with nothing shown. Three seconds is well
// inside the time a push handler is given, and a read that has not finished by
// then is treated exactly like a missing record.
const NOTIFY_READ_TIMEOUT_MS = 3000;

// The art and the badge are two different pictures, and they have to be.
// The art is the 192px app icon, drawn as it is. The badge is a SILHOUETTE:
// Android does not draw a badge's colours, it reads the alpha channel and
// fills every opaque pixel with its own tint. The app icon is a solid disc on
// transparency, so it arrived in the status bar as a plain white circle with
// the glyph inside it gone (reported 2026-09-14). `badge-96.png` is the
// cut-out openplate-brand ships for this, white on transparency, and like
// every other picture here it comes through `pnpm sync:brand`, never from
// this repo by hand. `tests/e2e/notification-badge.spec.ts` reads its pixels.
const NOTIFICATION_ICON = '/icons/icon-192.png';
const NOTIFICATION_BADGE = '/icons/badge-96.png';

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick', (event) => {
  const path = self.openplatePushDecision.notificationPath(event.notification.data || null);
  event.waitUntil(
    (async () => {
      const opened = await openNotificationTarget(path);
      // Closed only AFTER the window is up. Closing first loses the tap
      // entirely when `openWindow` is refused: the notification is gone and
      // there is nothing left to tap a second time.
      if (opened) event.notification.close();
    })(),
  );
});

async function handlePush(event) {
  const kind = readPushKind(event);
  let record = null;
  if (kind !== 'fast-target') {
    record = await readLatestCatchUp();
  }

  let decision;
  try {
    decision = self.openplatePushDecision.decidePush(kind, record, Date.now(), workerLanguage());
  } catch {
    // The decision is pure and should not throw, but a notification is owed
    // either way, so a garbage record falls back to the generic line.
    decision = self.openplatePushDecision.decidePush(kind, null, Date.now(), workerLanguage());
  }

  await self.registration.showNotification(decision.title, {
    body: decision.body,
    data: { url: decision.url },
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    // A tag replaces rather than stacks: a device that was offline through
    // three pushes wakes up to one line, not three.
    tag: decision.tag,
  });
}

// The payload carries `{ kind }` and nothing else. Anything unreadable is
// treated as a catch-up, which is the harmless one to show by mistake.
function readPushKind(event) {
  try {
    const payload = event.data ? event.data.json() : null;
    const kind = payload && payload.kind ? String(payload.kind) : '';
    return kind === 'fast-target' ? 'fast-target' : 'catch-up';
  } catch {
    return 'catch-up';
  }
}

function workerLanguage() {
  return (self.navigator && self.navigator.language) || 'en';
}

// Read the stored catch-up, or null. Never rejects, and never waits longer
// than NOTIFY_READ_TIMEOUT_MS: the read is RACED against a timer, so a database
// another tab holds open cannot leave the push handler hanging with nothing
// shown. The loser of the race is left to finish and close on its own.
function readLatestCatchUp() {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NOTIFY_READ_TIMEOUT_MS);
  });
  return Promise.race([readNotifyRecord(), timeout]).then((record) => {
    clearTimeout(timer);
    return record;
  });
}

// Open the small notify database and read the one record out of it. Every
// failure, a refused open, a database this device has never written, a store
// that is not there, a read error, resolves null rather than rejecting: the
// caller has exactly one thing to handle, and it is "no record".
function readNotifyRecord() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(NOTIFY_DB_NAME);
      open.addEventListener('error', () => resolve(null));
      open.addEventListener('blocked', () => resolve(null));
      open.addEventListener('upgradeneeded', () => {
        // The app has never written a catch-up on this device. Abort, so the
        // worker never creates a database the app then has to migrate.
        open.transaction.abort();
      });
      open.addEventListener('success', () => {
        const db = open.result;
        try {
          if (!db.objectStoreNames.contains(NOTIFY_STORE_NAME)) {
            db.close();
            resolve(null);
            return;
          }
          const store = db.transaction(NOTIFY_STORE_NAME, 'readonly').objectStore(NOTIFY_STORE_NAME);
          const request = store.get(NOTIFY_RECORD_KEY);
          request.addEventListener('success', () => {
            const record = request.result || null;
            db.close();
            resolve(record);
          });
          request.addEventListener('error', () => {
            db.close();
            resolve(null);
          });
        } catch {
          db.close();
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

// Raise a window on `path`, returning whether anything came up.
//
// The order is deliberate. A visible client is alive, so navigating it is both
// correct and cheap. When nothing is visible, `openWindow` runs FIRST: on
// Android the installed app's window is usually discarded while the phone
// sleeps, and awaiting such a client's `navigate()` burns the transient user
// activation the tap granted, after which `openWindow` is refused and the tap
// does nothing at all. The leftovers are navigated only as a fallback.
async function openNotificationTarget(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.find((client) => client.visibilityState === 'visible' || client.focused);

  if (visible) {
    if (visible.url === url) {
      const focused = await visible.focus().then(() => true, () => false);
      if (focused) return true;
    } else {
      const navigated = await visible.navigate(url).catch(() => null);
      if (navigated) {
        await visible.focus().catch(() => {});
        return true;
      }
    }
  }

  const opened = await self.clients.openWindow(url).catch(() => null);
  if (opened) return true;

  for (const client of windows) {
    const navigated = await client.navigate(url).catch(() => null);
    if (navigated) return true;
  }
  return false;
}
