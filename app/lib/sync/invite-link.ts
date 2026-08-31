/**
 * Reads a signup invite out of the URL.
 *
 * ── The fragment, never the query string ──────────────────────────────────
 *
 * An invite is a live capability: whoever holds it can create an account on
 * this instance. A query string carries it into the browser's history, into
 * the `Referer` header of the next request, and into the access log of every
 * server the URL passes through on its way to the person invited. A fragment
 * is never sent to a server at all.
 *
 * The invite is single-use and expiring, which would make the query form
 * survivable rather than safe. The fragment costs nothing and leaks nothing,
 * so there is no trade to make.
 *
 * The fragment is CLEARED once read, so a token does not sit in the address
 * bar for a screen-share or a screenshot to carry.
 */

/** The fragment key the operator CLI writes (`sync-api invites create`). */
const INVITE_FRAGMENT_KEY = 'invite';

/**
 * Pulls the invite out of a fragment like `#invite=abc`, or returns `null`.
 *
 * Pure, and takes the fragment as a string rather than reading `location`, so
 * the parsing rule is testable without a browser.
 */
export function parseInviteFragment(hash: string): string | null {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (withoutHash === '') return null;

  const token = new URLSearchParams(withoutHash).get(INVITE_FRAGMENT_KEY);
  // An empty value is treated as absent: `#invite=` is a malformed link, not a
  // request to submit an empty token.
  return token === null || token === '' ? null : token;
}

/**
 * Reads the invite from the current URL and removes it from the address bar.
 *
 * Returns `null` during SSR, where there is no `location` — the same
 * `globalThis.window` idiom the rest of the sync client uses.
 */
export function takeInviteFromUrl(): string | null {
  if (globalThis.window === undefined) return null;

  const token = parseInviteFragment(globalThis.window.location.hash);
  if (token === null) return null;

  // `replaceState` rather than assigning `location.hash`: assigning would push
  // a history entry, so Back would put the token straight back in the bar.
  const { pathname, search } = globalThis.window.location;
  globalThis.window.history.replaceState(null, '', `${pathname}${search}`);
  return token;
}
