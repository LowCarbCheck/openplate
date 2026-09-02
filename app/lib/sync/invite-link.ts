/**
 * Reads a signup invite out of the URL, and HOLDS it until a form consumes it.
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
 *
 * ── Why the token is then PARKED, and not just returned ───────────────────
 *
 * Clearing the fragment destroys the only copy. Whatever reads it has to keep
 * it, and a React `useState` is not a durable enough place to keep it: the
 * component can remount, and on a production first visit the whole DOCUMENT
 * reloads (the service worker takes control and the page reloads once, see
 * `app/lib/service-worker.ts`). Either way the state is gone, the fragment is
 * already gone too, and the person who followed the invite lands on a plain
 * "sign in or create an account" screen with their one capability lost.
 *
 * So reading the fragment parks the token in a PENDING SLOT that outlives both
 * a remount and a reload, and a second read returns the still-pending token
 * instead of `null`. The slot is `sessionStorage`, which is tab-scoped and dies
 * with the tab — the same lifetime the invite flow has — with a module-level
 * mirror behind it so the mechanism still works in a Safari private window and
 * anywhere web storage throws. The form CONSUMES the slot when the person acts
 * on it, so a spent token is not resurrected on a later visit to this page.
 */

/** The fragment key the operator CLI writes (`sync-api invites create`). */
const INVITE_FRAGMENT_KEY = 'invite';

/** The `sessionStorage` key the pending slot occupies. */
export const PENDING_INVITE_STORAGE_KEY = 'openplate.sync.pending-invite';

/** The subset of `Storage` the pending slot needs — so tests pass a plain object and never touch a global. */
export interface PendingInviteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The mirror behind the storage slot.
 *
 * It is what makes the slot work where `sessionStorage` throws or is absent,
 * and it is also the faster of the two reads — but it does NOT survive a
 * document reload, which is exactly the case the storage slot exists for.
 * Neither is redundant.
 */
let mirroredPendingInvite: string | null = null;

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

/** Parks a token in the pending slot. A storage failure leaves the mirror, which is still better than nothing. */
export function rememberPendingInvite(token: string, storage: PendingInviteStorage | null): void {
  mirroredPendingInvite = token;
  if (storage === null) return;
  try {
    storage.setItem(PENDING_INVITE_STORAGE_KEY, token);
  } catch {
    // Private-mode or quota. The token survives this mount either way; it just
    // will not survive a reload.
  }
}

/** @returns the token parked in the pending slot, or `null` if none is waiting. */
export function readPendingInvite(storage: PendingInviteStorage | null): string | null {
  if (mirroredPendingInvite !== null) return mirroredPendingInvite;
  if (storage === null) return null;
  try {
    const stored = storage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (stored === null || stored === '') return null;
    // Re-seed the mirror so a storage that starts throwing mid-session does not
    // lose a token this session already read successfully.
    mirroredPendingInvite = stored;
    return stored;
  } catch {
    return null;
  }
}

/** Empties the pending slot. Total: a storage failure still clears the mirror. */
export function clearPendingInvite(storage: PendingInviteStorage | null): void {
  mirroredPendingInvite = null;
  if (storage === null) return;
  try {
    storage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // Nothing to do: the mirror is cleared, and a slot we cannot write to is a
    // slot we could not have written the token into either.
  }
}

/** `sessionStorage`, or `null` during SSR and wherever it is blocked outright. */
export function sessionInviteStorage(): PendingInviteStorage | null {
  try {
    return globalThis.sessionStorage === undefined ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the invite from the current URL, removes it from the address bar, and
 * parks it — or, when the URL carries none, returns whatever is still parked.
 *
 * Calling this twice is therefore safe and is the normal case: the second call
 * comes from the remount (or the post-reload mount) that this slot exists for,
 * and it gets the same token back. `consumePendingInvite` is what ends that.
 *
 * Returns `null` during SSR, where there is no `location` — the same
 * `globalThis.window` idiom the rest of the sync client uses.
 */
export function takeInviteFromUrl(): string | null {
  if (globalThis.window === undefined) return null;

  const storage = sessionInviteStorage();
  const token = parseInviteFragment(globalThis.window.location.hash);
  if (token === null) return readPendingInvite(storage);

  // `replaceState` rather than assigning `location.hash`: assigning would push
  // a history entry, so Back would put the token straight back in the bar.
  const { pathname, search } = globalThis.window.location;
  globalThis.window.history.replaceState(null, '', `${pathname}${search}`);
  rememberPendingInvite(token, storage);
  return token;
}

/**
 * Ends the invite's stay in the pending slot.
 *
 * Called when the person acts on the prefilled form, not when the form merely
 * renders: until they do, a reload has to be able to bring the token back.
 */
export function consumePendingInvite(): void {
  clearPendingInvite(sessionInviteStorage());
}
