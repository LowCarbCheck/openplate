/**
 * Whether an account ceremony can run on this page: `false` on a plain-http
 * page that is not on this computer, where the browser has no `crypto.subtle`.
 *
 * Every page that signs in, creates an account or sets a password asks this
 * before it draws its form, and draws `AccountsNeedHttps` instead when the
 * answer is no. The reasons, and the rules, are in `#app/lib/secure-context`.
 *
 * ── Two snapshots, and why the server has one ────────────────────────────
 *
 * `useSyncExternalStore`, like `useHydrated`: the server snapshot is what the
 * page was rendered with, and React uses it again while it hydrates, so the
 * first client render matches the markup. The server snapshot is the root
 * loader's `isSecureOrigin`, the guess made from the address the request came
 * in on. Right in the common cases (a LAN address, `localhost`, https behind a
 * proxy), so the notice is on the first paint and nothing is swapped in. The
 * client snapshot is the browser's own answer, and it wins the render after
 * hydration whenever the two differ.
 *
 * Where the root loader has not run (an error boundary), the guess is `true`:
 * the page then behaves as it always did, and the browser's answer corrects it.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useRouteLoaderData } from 'react-router';

import type { loader as rootLoader } from '#app/root';
import { canRunAccountCrypto } from '#app/lib/secure-context';

/** There is no store behind this: a page never changes its secure-context status. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The browser's answer. Only ever called in the browser, which is what `useSyncExternalStore` promises. */
function readBrowserAnswer(): boolean {
  return canRunAccountCrypto({
    isSecureContext: globalThis.window.isSecureContext,
    hasSubtleCrypto: globalThis.crypto?.subtle !== undefined,
  });
}

export function useCanRunAccounts(): boolean {
  const serverGuess = useRouteLoaderData<typeof rootLoader>('root')?.isSecureOrigin ?? true;
  const readServerGuess = useCallback((): boolean => serverGuess, [serverGuess]);
  return useSyncExternalStore(subscribeToNothing, readBrowserAnswer, readServerGuess);
}
