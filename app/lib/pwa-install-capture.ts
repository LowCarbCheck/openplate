/**
 * Global capture of the `beforeinstallprompt` event.
 *
 * The browser fires `beforeinstallprompt` once, early, the first time it
 * decides the app is installable — often before any particular route's
 * component has mounted. `#app/components/install-card.tsx` used to register
 * its own `window.addEventListener('beforeinstallprompt', ...)` from a
 * `useEffect`, but that component only renders on the settings hub: if the event
 * fired before the visitor ever navigated there, `event.preventDefault()`
 * never ran, the browser's own mini-infobar took over, and the deferred
 * prompt was gone by the time `InstallCard` (or any other UI wanting to
 * trigger it, e.g. the app-chrome nav drawer) finally mounted.
 *
 * This module registers the listener exactly ONCE, at app startup — wired
 * from the same root `useEffect` that calls `registerServiceWorker`
 * (`app/root.tsx`), so it runs regardless of which route the visitor lands
 * on first. It holds the captured event (and whether `appinstalled` has since
 * fired) in module-scope state and exposes a `useSyncExternalStore`-compatible
 * subscribe/snapshot pair so React components re-render when the prompt
 * arrives or is consumed.
 *
 * Kept deliberately free of React: `use-install-affordance.ts` is the hook
 * that wraps this for component consumption.
 */

/**
 * The `beforeinstallprompt` event, which isn't in the standard DOM lib types.
 * Only the two members callers need are declared.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let hasInstalledEventFired = false;
let hasRegistered = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/**
 * Registers the window-level `beforeinstallprompt`/`appinstalled` listeners.
 * Idempotent — safe to call from every route/component that wants the
 * capture guaranteed to be live; only the first call actually attaches
 * anything. No-op during SSR.
 */
export function startPwaInstallCapture(): void {
  if (globalThis.window === undefined) return;
  if (hasRegistered) return;
  hasRegistered = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    // Stop Chrome's mini-infobar so the app owns the install moment.
    event.preventDefault();
    // SAFETY: this listener is registered for `beforeinstallprompt` only, and
    // that event IS a `BeforeInstallPromptEvent` — lib.dom just types the
    // callback parameter as the base `Event` because the event is non-standard.
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    hasInstalledEventFired = true;
    deferredPrompt = null;
    // The one and only storage-persistence request in the app: once
    // installed, ask the browser not to evict our offline data. Best-effort —
    // a denial changes nothing the user can see. Lives here (not in a
    // component) so it fires regardless of which page happens to be mounted
    // when the user accepts the install.
    if ('storage' in navigator) {
      // The optional annotation restores what lib.dom hides: older browsers
      // expose `navigator.storage` without a `persist` method.
      const persist: typeof navigator.storage.persist | undefined = navigator.storage.persist;
      void persist?.call(navigator.storage).catch(() => {
        // Persistence denied or unavailable — offline still works, just evictable.
      });
    }
    notifyListeners();
  });
}

/** The captured deferred prompt, or `null` if none has arrived (or it was already consumed/installed). */
export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** True once this session's `appinstalled` event has fired. */
export function getHasInstalledEventFired(): boolean {
  return hasInstalledEventFired;
}

/**
 * Takes the captured prompt for one-time use and clears it — the browser's
 * `prompt()` is single-use regardless of the outcome. Returns `null` if none
 * was captured.
 */
export function consumeDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notifyListeners();
  return prompt;
}

/** `useSyncExternalStore`-compatible subscribe function. */
export function subscribeToInstallCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
