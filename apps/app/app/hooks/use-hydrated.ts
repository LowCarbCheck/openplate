/**
 * `false` in server-rendered markup, `true` once this component has mounted in
 * the browser.
 *
 * THE THREAT. Submit a credential form before the page hydrates and there is
 * no JavaScript to stop the browser, so it performs a NATIVE submit; these
 * forms carry no `method`, so that is a GET, and the passphrase lands in the
 * address bar, in history, in every log on the path and in the next request's
 * `Referer`. Server-rendered markup is the only thing that can prevent it, and
 * this hook is what tells that markup apart from the hydrated page. See
 * `#app/components/credential-submit-button` for the full statement, and use
 * that component rather than this hook wherever a credential form submits.
 *
 * `useSyncExternalStore` rather than a `useEffect` that flips state: the two
 * snapshots ARE the two renders, so the rule is stated once, in the call,
 * instead of spread over an initial value and an effect. Nothing ever changes
 * after the first client render, so the subscription is a no-op.
 */
import { useSyncExternalStore } from 'react';

/** There is no store behind this: the value flips once, at hydration, and never again. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

function getHydratedSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, getHydratedSnapshot, getServerSnapshot);
}
