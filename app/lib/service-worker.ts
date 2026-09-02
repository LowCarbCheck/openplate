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
    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wasAlreadyControlled) return;
      if (isRefreshing) return;
      isRefreshing = true;
      window.location.reload();
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
