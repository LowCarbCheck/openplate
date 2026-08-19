/**
 * Client-side counterpart to `#app/utils/toast.server`'s `redirectWithToast`.
 *
 * The server version flashes a toast into a signed cookie session so it
 * survives a real network round-trip and renders on the NEXT page load. A
 * `clientAction` (M117/03 local-first routes) never leaves the browser — the
 * toast and the redirect happen in the same JS turn — so there is no session
 * to flash through. Firing the toast immediately, synchronously, before
 * returning the `redirect()`, is the exact client-side equivalent: sonner's
 * toast queue is a global singleton, safe to call from anywhere (already done
 * imperatively elsewhere in this codebase, e.g. inside fetcher `.then()`
 * callbacks).
 */
import { redirect } from 'react-router';
import { toast as showToast } from 'sonner';

/** Mirrors `#app/utils/toast.server`'s `Toast.type` (sonner's per-variant method names). */
export type ClientToastType = 'message' | 'success' | 'error' | 'warning';

export interface ClientToastInput {
  type?: ClientToastType;
  title?: string;
  description: string;
}

/**
 * Shows a toast immediately, then returns a client-side redirect to `url`.
 *
 * @param url - the in-app path to redirect to.
 * @param toast - the toast to show (defaults to the neutral `message` variant).
 * @returns a `redirect()` Response for a `clientAction`/`clientLoader` to return.
 */
export function redirectWithLocalToast(url: string, toast: ClientToastInput): Response {
  showToast[toast.type ?? 'message'](toast.title, { description: toast.description });
  return redirect(url);
}
