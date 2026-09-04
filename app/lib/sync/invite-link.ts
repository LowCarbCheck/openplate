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
 * ── One slot, for the whole join ─────────────────────────────────────────
 *
 * Since M181/05 a link may carry TWO capabilities: a sync signup invite and a
 * gateway invite, plus the gateway's address (`app/lib/join-link.ts`). They are
 * redeemed against different services, minutes apart, with a navigation and
 * possibly a reload in between, so they need the same durability the sync
 * invite already had. This slot was generalised to hold them rather than
 * growing a second mechanism beside it: two mechanisms for "keep the token
 * across the reload" is how one of them ends up missing the reload.
 *
 * Each field has its own storage key and its own mirror, and is consumed on its
 * own — spending the sync invite must not throw away the gateway half.
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

/**
 * The shape every sync signup invite carries, and the client's half of the
 * service binding minted in `openplate-sync/src/lib/tokens.ts`.
 *
 * Checked here so the ordinary accident is caught before it becomes a network
 * call: a gateway invite (`gi_`) pasted into the sync field, a link built with
 * the two halves swapped, a copy of the wrong line of an operator's output. The
 * server runs the same gate, and that is the one that matters; this one only
 * turns a remote refusal nobody can explain into a local message.
 */
export const SYNC_INVITE_PREFIX = 'si_';

/** Whether a string could be a sync signup invite at all. A shape gate, never a validity check. */
export function isSyncInviteToken(token: string): boolean {
  return token.startsWith(SYNC_INVITE_PREFIX);
}

/**
 * The parts of a pending join this slot can hold.
 *
 * Two tokens and one address: the gateway's URL is parked beside its token
 * because a token without the address it belongs to is unredeemable, and the
 * reload this slot exists for would otherwise strand it.
 *
 * `gatewayRedeemed` is the fourth, and it holds something the other three do
 * not: a SPENT invite's answer. The gateway burns the invite the instant it
 * answers, and the two local writes that answer feeds happen afterwards, so
 * between them there is a moment where the server has moved on and this device
 * has nothing. Parking the answer closes that moment — see
 * `app/lib/join-link.ts`'s `parkGatewayRedemption`.
 */
export type PendingJoinField = 'syncInvite' | 'gatewayInvite' | 'gatewayUrl' | 'gatewayRedeemed';

/** The module-level mirror behind the storage slot: every field, parked or not. */
type PendingJoinMirror = { [Field in PendingJoinField]: string | null };

/** The `sessionStorage` key the sync half of the pending slot occupies. */
export const PENDING_INVITE_STORAGE_KEY = 'openplate.sync.pending-invite';

const PENDING_STORAGE_KEYS = {
  // Unchanged since M166: an invite parked by an older build of this app must
  // still be found by this one.
  syncInvite: PENDING_INVITE_STORAGE_KEY,
  gatewayInvite: 'openplate.gateway.pending-invite',
  gatewayUrl: 'openplate.gateway.pending-url',
  gatewayRedeemed: 'openplate.gateway.pending-redeemed',
} satisfies Record<PendingJoinField, string>;

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
const mirroredPendingJoin: PendingJoinMirror = {
  syncInvite: null,
  gatewayInvite: null,
  gatewayUrl: null,
  gatewayRedeemed: null,
};

/** Parks one field of a pending join. A storage failure leaves the mirror, which is still better than nothing. */
export function rememberPendingJoinField({
  field,
  value,
  storage,
}: {
  field: PendingJoinField;
  value: string;
  storage: PendingInviteStorage | null;
}): void {
  mirroredPendingJoin[field] = value;
  if (storage === null) return;
  try {
    storage.setItem(PENDING_STORAGE_KEYS[field], value);
  } catch {
    // Private-mode or quota. The value survives this mount either way; it just
    // will not survive a reload.
  }
}

/** @returns the parked value of one field, or `null` if none is waiting. */
export function readPendingJoinField({
  field,
  storage,
}: {
  field: PendingJoinField;
  storage: PendingInviteStorage | null;
}): string | null {
  const mirrored = mirroredPendingJoin[field];
  if (mirrored !== null) return mirrored;
  if (storage === null) return null;
  try {
    const stored = storage.getItem(PENDING_STORAGE_KEYS[field]);
    if (stored === null || stored === '') return null;
    // Re-seed the mirror so a storage that starts throwing mid-session does not
    // lose a value this session already read successfully.
    mirroredPendingJoin[field] = stored;
    return stored;
  } catch {
    return null;
  }
}

/** Empties one field. Total: a storage failure still clears the mirror. */
export function clearPendingJoinField({
  field,
  storage,
}: {
  field: PendingJoinField;
  storage: PendingInviteStorage | null;
}): void {
  mirroredPendingJoin[field] = null;
  if (storage === null) return;
  try {
    storage.removeItem(PENDING_STORAGE_KEYS[field]);
  } catch {
    // Nothing to do: the mirror is cleared, and a slot we cannot write to is a
    // slot we could not have written the value into either.
  }
}

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
  if (token === null || token === '') return null;
  // And a token of the wrong SERVICE is absent too, rather than prefilled into
  // a form that would post a gateway credential to the sync service.
  return isSyncInviteToken(token) ? token : null;
}

/** Parks a sync invite. The named view of the slot's `syncInvite` field. */
export function rememberPendingInvite(token: string, storage: PendingInviteStorage | null): void {
  rememberPendingJoinField({ field: 'syncInvite', value: token, storage });
}

/** @returns the sync invite parked in the pending slot, or `null` if none is waiting. */
export function readPendingInvite(storage: PendingInviteStorage | null): string | null {
  return readPendingJoinField({ field: 'syncInvite', storage });
}

/** Empties the sync half of the pending slot, and only that half. */
export function clearPendingInvite(storage: PendingInviteStorage | null): void {
  clearPendingJoinField({ field: 'syncInvite', storage });
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
