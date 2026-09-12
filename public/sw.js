// openplate service worker, hand-rolled (no workbox), ported from the SHW
// reference. Versioned named caches with an activate-time purge of stale
// versions, an app-shell precache with a dedicated /offline fallback, and
// per-request-type fetch strategies. It also backs the Web Share Target v2 flow
// by stashing a shared photo for the scan page to pick up.
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
// The push decision (what a push shows, where a tap lands) lives apart from
// this file so it can be unit tested without a service worker. This worker is
// registered as a classic script, so it loads that copy with `importScripts`
// rather than a static `import`. It attaches `self.openplatePushDecision`.
importScripts('/sw-push-decision.js');

const CACHE_VERSION = 'v4';
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
const APP_SHELL = ['/', '/dashboard', '/diary', '/add', '/offline', '/recover', '/onboarding'];

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

  if (isStaticAsset(url, request)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (isImage(url, request)) {
    event.respondWith(cacheFirstWithCap(request, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
  } else {
    // Serve the /offline HTML fallback only for document navigations, never for
    // background data fetches.
    const fallback = request.mode === 'navigate' ? '/offline' : undefined;
    event.respondWith(networkFirst(request, PAGES_CACHE, fallback));
  }
});

// ---------------------------------------------------------------------------
// Share target, stash the shared photo, redirect into the scan flow
// ---------------------------------------------------------------------------
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const photo = formData.get('photo');
    if (photo instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      // Store under a synthetic GET key the scan page reads once on mount.
      // Only stamp a type the sender actually provided, a hardcoded binary
      // fallback here would defeat the image/jpeg default applied on read-back
      // and fail photo validation.
      const headers = { 'X-Shared-Filename': encodeURIComponent(photo.name || 'shared-photo') };
      if (photo.type) headers['Content-Type'] = photo.type;
      await cache.put(SHARED_PHOTO_KEY, new Response(photo, { headers }));
      return Response.redirect(new URL('/scan?shared=1', self.location.origin).toString(), 303);
    }
  } catch {
    // Fall through to the plain redirect below.
  }
  return Response.redirect(new URL('/scan', self.location.origin).toString(), 303);
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

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    // `!response.redirected` mirrors the guard `precacheAppShell` already has:
    // `/` redirects into the app for a device carrying the home hint, and
    // caching the followed response would store `/dashboard`'s HTML under `/`.
    if (response.ok && !response.redirected) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
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
// Message handler, SKIP_WAITING (update flow) + CLEAR_CACHE
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
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

// The 192px app icon serves as both the art and the badge. It is the icon the
// manifest already ships, so nothing new is added or resized here: icons come
// from openplate-brand through the sync script, never from this repo by hand.
// A proper monochrome badge (Android derives the badge shape from the alpha
// channel) would have to be added there first.
const NOTIFICATION_ICON = '/icons/icon-192.png';
const NOTIFICATION_BADGE = '/icons/icon-192.png';

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
