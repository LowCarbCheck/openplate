import { useSyncExternalStore } from 'react';

export type ResolvedTheme = 'light' | 'dark';

declare global {
  interface WindowEventMap {
    themechange: CustomEvent<ResolvedTheme>;
  }
}

/**
 * Subscribes to the `themechange` CustomEvent dispatched by root.tsx's inline
 * theme script whenever the resolved (post system-resolution) theme flips.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('themechange', onChange);
  return () => window.removeEventListener('themechange', onChange);
}

/** Reads the live resolved theme straight off the `<html class="dark">` flag. */
function getSnapshot(): ResolvedTheme {
  if (globalThis.document === undefined) return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** SSR default — the inline script resolves the real theme before hydration. */
function getServerSnapshot(): ResolvedTheme {
  return 'light';
}

/**
 * Returns the active resolved theme (`'light' | 'dark'`), tracking the
 * hand-rolled theme toggle. SSR-safe: defaults to `'light'` until hydration,
 * then syncs to the class already applied on `<html>`.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
