import { useEffect, useState } from 'react';

/**
 * Service-worker registration + online-status hook, ported from the SHW
 * reference. `registerServiceWorker` is SSR-safe (guards on `navigator`, defers
 * to the load event when the document isn't `complete` yet), checks for updates
 * every 60s, and silently activates a new worker (`SKIP_WAITING`) then reloads
 * exactly once on `controllerchange` — but only when the page was already
 * controlled, i.e. on an UPDATE and never on a first install.
 *
 * Registration is production-only (see `healDevBrowser` below for why dev never
 * registers the worker at all).
 */

const UPDATE_CHECK_INTERVAL_MS = 60_000;

/**
 * How long `adoptNewestBundle` waits for a fresh worker to reach `activated`
 * before it reloads anyway.
 *
 * Generous on purpose: the reload is what the person just asked for, so the
 * failure mode to avoid is a button that appears to do nothing, not a slow one.
 */
const ACTIVATION_TIMEOUT_MS = 8_000;

/**
 * The live registration, kept so the manual "reload to update" path does not
 * register a second time. Null in dev, and until the load event has fired.
 */
let currentRegistration: ServiceWorkerRegistration | null = null;

/**
 * Reloads at most once per page life, shared by the automatic
 * `controllerchange` path and the manual one.
 *
 * Both can fire for the same update: posting `SKIP_WAITING` makes the new worker
 * take control, which is exactly what the automatic listener is watching for. Two
 * reloads in a row is a visible flash and, on a slow connection, a second one
 * landing mid-load.
 */
let isRefreshing = false;

function reloadOnce(): void {
  if (isRefreshing) return;
  isRefreshing = true;
  window.location.reload();
}

/**
 * Cache name prefixes owned by the openplate service worker (`public/sw.js`).
 * Kept in sync by hand — `sw.js` can't import this module (it's a separate,
 * non-bundled script) — deliberately excludes the unversioned `share-target`
 * cache, which isn't SW-version-suffixed and only ever holds one in-flight
 * shared photo.
 */
const SW_OWNED_CACHE_PREFIXES = ['static-', 'pages-', 'images-'];

/**
 * Dev-only cleanup, run instead of registering the service worker. Vite's dev
 * server serves module scripts from unhashed URLs (e.g. a route file as
 * `request.destination === 'script'`), and `sw.js`'s static-asset strategy is
 * cache-first on that same `destination === 'script'` match — so in dev, after
 * any code change, a full reload can keep serving a stale cached module instead
 * of the new one. Production assets are content-hashed under `/assets/`, so
 * cache-first there is safe and this problem can't occur — which is why the
 * worker must never run in dev at all, only be actively uninstalled.
 *
 * Unregisters any service worker and clears its version-suffixed caches so a
 * browser that previously loaded a production build (or an earlier dev session)
 * can't keep serving stale cache-first responses. Fire-and-forget, matching this
 * module's error-swallowing style: a failure here just means the cleanup is
 * retried next load, not a broken app.
 */
function healDevBrowser(): void {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => {
      // Best-effort cleanup; nothing actionable to recover here.
    });

  if (globalThis.caches === undefined) return;
  caches
    .keys()
    .then((names) =>
      Promise.all(
        names
          .filter((name) => SW_OWNED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
          .map((name) => caches.delete(name)),
      ),
    )
    .catch(() => {
      // Best-effort cleanup; nothing actionable to recover here.
    });
}

/**
 * Registers the production worker and keeps it checked for updates, silently
 * activating a new one. Swallows every failure: the app works without the
 * worker, it just loses offline support.
 */
async function registerAndWatchForUpdates(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    currentRegistration = registration;

    // Check for updates every 60 seconds.
    setInterval(() => {
      registration.update().catch(() => {
        // Ignore update-check failures (e.g. offline).
      });
    }, UPDATE_CHECK_INTERVAL_MS);

    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content is available — activate it silently.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- `ServiceWorker.postMessage` has no target-origin parameter; its second argument is a transfer list.
          installingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  } catch {
    // Registration failed; the app continues to work without offline support.
  }
}

export function registerServiceWorker(): void {
  if (globalThis.navigator === undefined || !('serviceWorker' in navigator)) return;

  // Dev builds actively heal any prior SW contamination instead of registering —
  // see `healDevBrowser` for why the worker must never run against dev module URLs.
  if (!import.meta.env.PROD) {
    healDevBrowser();
    return;
  }

  const doRegister = (): void => {
    // Whether this page is ALREADY controlled, sampled before registering.
    //
    // `controllerchange` fires for two very different reasons. The one this
    // reload is for is an UPDATE: a newer worker skipped waiting and replaced
    // the one that has been serving this page, so the page is now running
    // against a mixture of old and new and a reload settles it.
    //
    // The other is a FIRST INSTALL. `sw.js` calls `clients.claim()` on
    // activate, so the very first production visit in a fresh browser profile
    // goes from uncontrolled to controlled — and reloading there threw away a
    // perfectly good page that was already serving the newest assets there are.
    // It cost every first-time visitor a flash, and it cost more than that on
    // `/settings/sync`, where an emailed invite's single-use token had been
    // read out of the URL fragment by the page the reload discarded.
    //
    // An uncontrolled page has no stale worker to settle with, so it never
    // needs the reload. (The token now also survives one anyway — see
    // `app/lib/sync/invite-link.ts` — because an update reload can still land
    // at any moment.)
    const wasAlreadyControlled = navigator.serviceWorker.controller !== null;

    void registerAndWatchForUpdates();

    // Reload once the NEW service worker takes control (guarded so it fires once).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wasAlreadyControlled) return;
      reloadOnce();
    });
  };

  // In SSR apps the load event may already have fired before React hydrates, so
  // check readyState to avoid missing it.
  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister);
  }
}

/** Resolves when the given worker reaches `activated`, or immediately if it already has. */
function whenActivated(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve();
    });
  });
}

/** A promise that resolves after `ms`, used as the losing half of a race. */
function afterDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Adopt the newest bundle this server is serving, then reload onto it.
 *
 * ── WHAT "UPDATE NOW" CAN AND CANNOT MEAN HERE ──────────────────────────────
 *
 * openplate ships as one stateless container. The server cannot upgrade itself,
 * and nothing in the browser can upgrade it either: a self-hoster pulls a new
 * image, and the hosted instance is deployed by an operator. So the only update
 * a button in this app can perform is the client-side one, adopting assets the
 * server is ALREADY serving. A newer release on GitHub is reported as
 * information with a link, never as a button that pretends to install it.
 *
 * ── THE SEQUENCE ───────────────────────────────────────────────────────────
 *
 * `update()` refetches `sw.js`. `public/sw.js` calls `skipWaiting()` in its own
 * install handler, so a fresh worker usually goes straight from `installing` to
 * `activated` and never sits in `waiting`; the message below is for the case
 * where it does sit there anyway (an install that raced the previous worker).
 * Both are watched, and the reload happens once either reaches `activated` or
 * the timeout elapses.
 *
 * Reloading on the timeout rather than giving up is deliberate. Nothing here can
 * distinguish "no new worker exists" from "the network is slow", and the plain
 * reload is correct for the first and harmless for the second. The stuck case
 * gets one extra step: unregistering first, so the reload bypasses a precache
 * that is wedged on old assets rather than being served the same page again.
 */
export async function adoptNewestBundle(): Promise<void> {
  if (globalThis.navigator === undefined || !('serviceWorker' in navigator)) {
    // Dev, or a browser with no worker: there is no cache layer to get past.
    reloadOnce();
    return;
  }

  const registration = currentRegistration ?? (await navigator.serviceWorker.getRegistration()) ?? null;
  if (registration === null) {
    reloadOnce();
    return;
  }

  try {
    await registration.update();
  } catch {
    // A thrown `update()` is a network failure, not a wedged worker. Keep the
    // precache, which is what an offline install has instead of a server.
    reloadOnce();
    return;
  }

  const waiting = registration.waiting;
  if (waiting !== null) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- `ServiceWorker.postMessage` has no target-origin parameter; its second argument is a transfer list.
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  const fresh = registration.installing ?? registration.waiting;
  if (fresh === null) {
    // `update()` succeeded and there was nothing to install, yet the caller was
    // told this page is behind. The active worker is serving stale assets and
    // will not replace itself, so drop it and reload past it.
    await unregisterAll();
    reloadOnce();
    return;
  }

  await Promise.race([whenActivated(fresh), afterDelay(ACTIVATION_TIMEOUT_MS)]);
  reloadOnce();
}

/** Drops every registration for this origin. Best effort, like the rest of this module. */
async function unregisterAll(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Nothing actionable: the reload below still refetches the document.
  }
}

export function useOnlineStatus(): boolean {
  // Always initialize to `true` for SSR hydration consistency; the real value is
  // set in the effect after mount.
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
