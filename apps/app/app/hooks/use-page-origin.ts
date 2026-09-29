/**
 * The origin of the page as the browser shows it (`location.origin`), or
 * `null` in server-rendered markup and while React hydrates it.
 *
 * `useSyncExternalStore`, like `useHydrated`: the server snapshot is `null`, so
 * the server markup and the hydrating render are the same, and the browser's
 * answer arrives in the render after hydration. A component that mounts after
 * hydration, which is every admin result that carries a link, reads the
 * browser's answer in its FIRST render. So a line that depends on it is drawn
 * in the same commit as the link it describes, and nothing below moves later.
 *
 * Nothing changes while a page is open (a new origin is a new document), so the
 * subscription is a no-op.
 */
import { useSyncExternalStore } from 'react';

/** There is no store behind this: a document keeps its origin for as long as it lives. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The browser's answer. Only ever called in the browser, which is what `useSyncExternalStore` promises. */
function readBrowserOrigin(): string | null {
  return globalThis.window.location.origin;
}

function readServerOrigin(): string | null {
  return null;
}

export function usePageOrigin(): string | null {
  return useSyncExternalStore(subscribeToNothing, readBrowserOrigin, readServerOrigin);
}
