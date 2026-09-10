/**
 * Client-side counterpart to `#app/utils/toast.server`'s `redirectWithToast`.
 *
 * The server version flashes a message into a signed cookie session so it
 * survives a real network round-trip and renders on the NEXT page load. A
 * `clientAction` (M117/03 local-first routes) never leaves the browser — the
 * message and the redirect happen in the same JS turn, so there is no session
 * to flash through. Publishing it immediately, synchronously, before returning
 * the `redirect()`, is the exact client-side equivalent: `#app/lib/status` is a
 * module-scoped global, safe to call from anywhere, and the header's
 * `HeaderStatus` survives the navigation because it lives in the layout above
 * the route.
 */
import { redirect } from 'react-router';
import { publishStatus, type StatusTone } from '#app/lib/status';

/** Mirrors `#app/utils/toast.server`'s `Toast.type`, which is the wire the server flash still speaks. */
export type ClientToastType = 'message' | 'success' | 'error' | 'warning';

export interface ClientToastInput {
  type?: ClientToastType;
  title?: string;
  description: string;
}

/** The server's four variant names, mapped onto the status channel's four tones. */
const TONE_BY_TYPE = {
  message: 'info',
  success: 'success',
  error: 'error',
  warning: 'warning',
} satisfies Record<ClientToastType, StatusTone>;

/**
 * Publishes a status immediately, then returns a client-side redirect to `url`.
 *
 * A caller with no `title` gets its `description` as the one line, which is how
 * the toast layer rendered a title-less message too.
 *
 * @param url - the in-app path to redirect to.
 * @param toast - the message to show (defaults to the neutral `message` variant).
 * @returns a `redirect()` Response for a `clientAction`/`clientLoader` to return.
 */
export function redirectWithLocalToast(url: string, toast: ClientToastInput): Response {
  publishStatus({
    text: toast.title ?? toast.description,
    description: toast.title === undefined ? undefined : toast.description,
    tone: TONE_BY_TYPE[toast.type ?? 'message'],
  });
  return redirect(url);
}
