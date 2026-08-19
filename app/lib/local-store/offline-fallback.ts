/**
 * Shared predicate for `clientLoader`s that fall back to the local layer when
 * the network path fails. A route's `serverLoader()` call is a same-origin
 * single-fetch `.data` request; offline, the browser's `fetch` rejects with a
 * `TypeError` before any HTTP status exists. Used by every route with an
 * offline read fallback (diary, add) so the classification stays identical.
 */

/** True when a failed `serverLoader()` call should fall back to the local layer rather than surface as an error. */
export function shouldFallbackOffline(cause: unknown): boolean {
  if (globalThis.navigator !== undefined && !navigator.onLine) return true;
  // A network-level fetch failure throws a TypeError; a real app error (a thrown
  // Response, a redirect) should propagate to the router untouched.
  return cause instanceof TypeError;
}
