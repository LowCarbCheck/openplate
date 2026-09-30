/**
 * The service worker `/sw.js` answers in moved mode: it ends the app's worker on this origin.
 *
 * ── Why the old worker needs ending ──────────────────────────────────────
 *
 * The app's worker (`public/sw.js`) keeps whole pages and their scripts in Cache Storage, so an
 * installed copy can open with no server at all. A closed instance cannot reach it by any other
 * route: a browser does not follow a redirect when it checks `/sw.js` for an update, and a server
 * that answers nothing leaves the worker serving its saved pages for good. What does reach it is
 * a new `/sw.js`. The browser checks the worker on every visit to a page here and every time the
 * running app calls `registration.update()`, which it does once a minute, and a script that
 * differs by one byte is installed as the new worker.
 *
 * ── What this one does, in order ─────────────────────────────────────────
 *
 * 1. On install it skips waiting, so it takes over from the app's worker at once instead of after
 *    every tab has closed.
 * 2. On activate it deletes every cache this origin holds. That is the app's own caches and the
 *    shared photo, not the diary: the diary lives in IndexedDB, which this never touches.
 * 3. It claims every tab in scope, including one the app's worker never controlled, because
 *    `navigate` below only works on a tab this worker controls.
 * 4. It unregisters itself, so the next navigation has no worker to go through.
 * 5. It navigates every open tab to its own address, so the next paint comes from the server,
 *    which answers the moved page. A tab that refuses is left alone: it is already gone.
 *
 * It has no `fetch` listener, so while it runs every request goes straight to the network.
 * Nothing registers it: it only replaces a worker a browser already has.
 *
 * `tests/unit/moved-kill-switch.test.ts` runs this source against a recording `self` and holds it
 * to that order; `tests/e2e/moved-instance.spec.ts` proves it against the real app worker.
 *
 * A string rather than a file in `public/`, because `public/sw.js` is the app's worker and this
 * one is served only in moved mode, by `moved-mode.server.ts`.
 */
export const KILL_SWITCH_WORKER = `// openplate has moved. This worker replaces the app's worker on this address and removes it.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(tabs.map((tab) => tab.navigate(tab.url).catch(() => null)));
    })(),
  );
});
`;
