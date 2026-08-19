// openplate service worker — hand-rolled (no workbox), ported from the SHW
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
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const PAGES_CACHE = `pages-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

// Not version-suffixed: an in-flight shared photo must survive a worker update.
const SHARE_CACHE = 'share-target';
const SHARED_PHOTO_KEY = '/share-target/photo';

// Small cap so cached food/plate images can't grow without bound.
const MAX_IMAGE_ENTRIES = 60;

// Pages to precache on install so the app boots and navigates offline.
const APP_SHELL = ['/', '/dashboard', '/diary', '/add', '/offline'];

// ---------------------------------------------------------------------------
// Install — precache the app shell (resiliently)
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
        // Offline or blocked during install — fill on first visit instead.
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Activate — purge old-version caches, keep the share-target cache
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
// Fetch — share-target POST, then per-request-type GET strategies
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

  // Only same-origin GETs are cached — skip external images (avatars, etc.).
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
// Share target — stash the shared photo, redirect into the scan flow
// ---------------------------------------------------------------------------
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const photo = formData.get('photo');
    if (photo instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      // Store under a synthetic GET key the scan page reads once on mount.
      // Only stamp a type the sender actually provided — a hardcoded binary
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

// FIFO eviction so a cache stays under `maxEntries` — oldest keys drop first.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// ---------------------------------------------------------------------------
// Message handler — SKIP_WAITING (update flow) + CLEAR_CACHE
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
