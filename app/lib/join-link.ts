/**
 * ONE join link: the fragment `/join` reads, and the fragment an operator's CLI
 * writes.
 *
 * A person joining is handed one address. It may admit them to a sync account,
 * to a household gateway, or to both, and it looks like this:
 *
 *   https://app.example/join#sync=https%3A%2F%2Fsync.example&invite=si_…
 *                           &gateway=https%3A%2F%2Fgw.example&ginvite=gi_…
 *
 * Any of the four keys may be absent. A sync-only link, a gateway-only link and
 * a both link are all ordinary; a link with neither capability is the one
 * invalid case, and it lands on an explanation rather than an error.
 *
 * ── The fragment, never the query string ──────────────────────────────────
 *
 * Inherited from `sync/invite-link.ts`, and non-negotiable for the same reason:
 * both tokens are LIVE CAPABILITIES. A query string carries them into the
 * browser's history, into the `Referer` of the next request, and into the
 * access log of every server the link passes on its way to the person invited.
 * A fragment is never sent to any server at all. That is also why nothing here
 * reads the page's query string: by construction there is nothing in it.
 *
 * ── Two services, two prefixes ───────────────────────────────────────────
 *
 * `invite` is a sync signup invite and wears `si_`; `ginvite` is a gateway
 * invite and wears `gi_`. The parse applies each service's shape gate, so a
 * link built with the two halves swapped yields no token rather than a token
 * this app would post to the wrong service. Both servers run the same gate,
 * and theirs are the ones that matter — see `openplate-sync/src/lib/tokens.ts`
 * and `openplate-gateway/src/invite-store.ts`.
 *
 * ── Read once, park, strip ───────────────────────────────────────────────
 *
 * `takeJoinLinkFromUrl` clears the fragment with `replaceState` the moment it
 * is read, so the tokens do not sit in the address bar for a screenshot or a
 * screen share, and parks what it found in the pending slot so a remount or the
 * service worker's first-visit document reload cannot destroy the only copy.
 */
import {
  GATEWAY_INVITE_PREFIX,
  isGatewayInviteToken,
  normalizeGatewayUrl,
  normalizeInviteToken,
} from '#app/lib/gateway-invite';
import {
  SYNC_INVITE_PREFIX,
  clearPendingJoinField,
  isSyncInviteToken,
  readPendingJoinField,
  rememberPendingJoinField,
  sessionInviteStorage,
  type PendingInviteStorage,
} from '#app/lib/sync/invite-link';

/** The sync service's address. A CHECK, not an instruction — see {@link isForeignSyncServer}. */
const SYNC_URL_KEY = 'sync';
/** The sync signup invite, spelled the same as the M166 `#invite=` link, which still works. */
const SYNC_INVITE_KEY = 'invite';
/** The gateway's address. */
const GATEWAY_URL_KEY = 'gateway';
/** The gateway invite. Named apart from `invite` so the two can never be confused positionally. */
const GATEWAY_INVITE_KEY = 'ginvite';

/** What one join link offers. Every field is independently optional. */
export interface JoinLink {
  syncUrl: string | null;
  syncInvite: string | null;
  gatewayUrl: string | null;
  gatewayInvite: string | null;
}

const EMPTY_JOIN_LINK: JoinLink = { syncUrl: null, syncInvite: null, gatewayUrl: null, gatewayInvite: null };

/**
 * Parses a join fragment. Pure, and takes the fragment as a string rather than
 * reading `location`, so every rule below is testable without a browser.
 *
 * Unusable values become `null` rather than a throw: this string arrives from a
 * link in somebody's chat, so a mangled one is an ordinary user-facing outcome.
 */
export function parseJoinFragment(hash: string): JoinLink {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (withoutHash === '') return { ...EMPTY_JOIN_LINK };

  const params = new URLSearchParams(withoutHash);
  return {
    // Both addresses take the gateway rule: `https:` anywhere, `http:` only for
    // loopback. It is the browser's own mixed-content and CSP behaviour written
    // down, and it does not become more permissive because the service on the
    // other end is a different one.
    syncUrl: normalizeGatewayUrl(params.get(SYNC_URL_KEY)),
    syncInvite: normalizeSyncInviteToken(params.get(SYNC_INVITE_KEY)),
    gatewayUrl: normalizeGatewayUrl(params.get(GATEWAY_URL_KEY)),
    gatewayInvite: normalizeInviteToken(params.get(GATEWAY_INVITE_KEY)),
  };
}

/**
 * Parses a link a person PASTED rather than opened (M187 spec 03).
 *
 * A managed instance's welcome screen offers a box for the link, because a
 * link opened in a mail app's own browser, or copied out of a chat, does not
 * always arrive at this app as a navigation. The box has to lead to exactly
 * the same place the navigation would, so this reads the fragment out of what
 * was pasted and hands it to {@link parseJoinFragment} — the one grammar.
 *
 * Accepts the whole URL, and also a bare fragment, because "copy the link"
 * produces both in the wild. Everything before the first `#` is discarded
 * unread: the host in a pasted link decides nothing here, exactly as the
 * `sync=` field decides nothing (see {@link isForeignSyncServer}).
 */
export function parseJoinLinkInput(raw: string): JoinLink {
  const trimmed = raw.trim();
  if (trimmed === '') return { ...EMPTY_JOIN_LINK };
  const hashAt = trimmed.indexOf('#');
  return parseJoinFragment(hashAt === -1 ? trimmed : trimmed.slice(hashAt + 1));
}

/** The sync token, trimmed, or `null` when absent, blank or minted by the gateway. */
export function normalizeSyncInviteToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return isSyncInviteToken(trimmed) ? trimmed : null;
}

/**
 * Builds the fragment, including the leading `#`.
 *
 * The one place a join link is written, so the operator CLI (spec 06), the
 * `/connect-gateway` redirect and any test all produce the same grammar. Absent
 * fields are omitted rather than written empty: `#ginvite=` is a link that
 * looks like it carries a gateway and does not.
 */
export function buildJoinFragment(link: Partial<JoinLink>): string {
  const params = new URLSearchParams();
  if (link.syncUrl != null && link.syncUrl !== '') params.set(SYNC_URL_KEY, link.syncUrl);
  if (link.syncInvite != null && link.syncInvite !== '') params.set(SYNC_INVITE_KEY, link.syncInvite);
  if (link.gatewayUrl != null && link.gatewayUrl !== '') params.set(GATEWAY_URL_KEY, link.gatewayUrl);
  if (link.gatewayInvite != null && link.gatewayInvite !== '') params.set(GATEWAY_INVITE_KEY, link.gatewayInvite);
  const encoded = params.toString();
  return encoded === '' ? '' : `#${encoded}`;
}

/** Whether this link admits anyone to anything. A link that does not is the one invalid case. */
export function isJoinLinkEmpty(link: JoinLink): boolean {
  return link.syncInvite === null && !hasGatewayHalf(link);
}

/** A gateway can only be joined with BOTH its address and its invite. */
export function hasGatewayHalf(link: JoinLink): boolean {
  return link.gatewayUrl !== null && link.gatewayInvite !== null;
}

/**
 * Whether the link names a DIFFERENT sync service than this app is configured
 * for.
 *
 * The address in the link is a check, never an instruction. This client posts a
 * passphrase-derived verifier to the sync server its own operator configured
 * (`SYNC_SERVER_URL`); letting a link redirect that would let anyone who can
 * send a link choose where those credentials go. So a mismatch is reported to
 * the person, and nothing is dialled.
 *
 * Compared by ORIGIN: a trailing slash or a path suffix is not a different
 * service, and the origin is the part a browser enforces anything about.
 */
export function isForeignSyncServer({
  linkSyncUrl,
  configuredSyncUrl,
}: {
  linkSyncUrl: string | null;
  configuredSyncUrl: string | null;
}): boolean {
  if (linkSyncUrl === null) return false;
  if (configuredSyncUrl === null) return true;
  return safeOrigin(linkSyncUrl) !== safeOrigin(configuredSyncUrl);
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Reads the join link from the current URL, strips the fragment, and parks what
 * it found and this app can actually use — or, when the URL carries none, returns what is still parked.
 *
 * Calling this twice is safe and is the normal case: the second call comes from
 * the remount, or from the mount after the service worker's first-visit reload,
 * and it gets the same link back. `consumeSyncInvite` / `consumeGatewayInvite`
 * are what end that, each for its own half.
 *
 * Returns an empty link during SSR, where there is no `location`.
 */
export function takeJoinLinkFromUrl({ configuredSyncUrl }: { configuredSyncUrl: string | null }): JoinLink {
  if (globalThis.window === undefined) return { ...EMPTY_JOIN_LINK };
  const storage = sessionInviteStorage();

  const fromUrl = parseJoinFragment(globalThis.window.location.hash);
  if (globalThis.window.location.hash !== '') {
    // Unconditionally, and before anything is dialled: even a link this app
    // rejects carries tokens that are just as sensitive. `replaceState` rather
    // than assigning `location.hash`, which would push a history entry and put
    // the tokens straight back in the bar on Back.
    const { pathname, search } = globalThis.window.location;
    globalThis.window.history.replaceState(null, '', `${pathname}${search}`);
  }
  park({
    link: fromUrl,
    storage,
    // A link for ANOTHER sync service parks nothing of its sync half. Parking
    // it would leave a token this app can never spend sitting in the slot,
    // where the next link read picks it up and offers a signup that belongs to
    // somebody else's server.
    keepSyncInvite: !isForeignSyncServer({ linkSyncUrl: fromUrl.syncUrl, configuredSyncUrl }),
  });

  return {
    syncUrl: fromUrl.syncUrl,
    syncInvite: readPendingJoinField({ field: 'syncInvite', storage }),
    gatewayUrl: readPendingJoinField({ field: 'gatewayUrl', storage }),
    gatewayInvite: readPendingJoinField({ field: 'gatewayInvite', storage }),
  };
}

/**
 * Parks the capabilities of a freshly read link.
 *
 * The sync ADDRESS is deliberately not parked: it is a check run against this
 * app's own configuration at the moment of arrival, not something a later mount
 * needs. The gateway address is, because a gateway token without the address it
 * belongs to cannot be redeemed at all.
 */
function park({
  link,
  storage,
  keepSyncInvite,
}: {
  link: JoinLink;
  storage: PendingInviteStorage | null;
  keepSyncInvite: boolean;
}): void {
  if (link.syncInvite !== null && keepSyncInvite) {
    rememberPendingJoinField({ field: 'syncInvite', value: link.syncInvite, storage });
  }
  if (link.gatewayUrl !== null && link.gatewayInvite !== null) {
    rememberPendingJoinField({ field: 'gatewayUrl', value: link.gatewayUrl, storage });
    rememberPendingJoinField({ field: 'gatewayInvite', value: link.gatewayInvite, storage });
  }
}

/**
 * Ends the sync invite's stay in the pending slot, leaving the gateway half
 * alone.
 *
 * Called when the person acts on the prefilled form, not when it merely
 * renders: until then a reload has to be able to bring the token back.
 */
export function consumeSyncInvite(): void {
  clearPendingJoinField({ field: 'syncInvite', storage: sessionInviteStorage() });
}

/** Ends the gateway half's stay, both the token and the address it belongs to. */
export function consumeGatewayInvite(): void {
  const storage = sessionInviteStorage();
  clearPendingJoinField({ field: 'gatewayInvite', storage });
  clearPendingJoinField({ field: 'gatewayUrl', storage });
}

/** @returns the parked gateway half, or `null` when there is nothing left to join. */
export function readPendingGatewayJoin(): { gatewayUrl: string; gatewayInvite: string } | null {
  const storage = sessionInviteStorage();
  const gatewayUrl = readPendingJoinField({ field: 'gatewayUrl', storage });
  const gatewayInvite = readPendingJoinField({ field: 'gatewayInvite', storage });
  if (gatewayUrl === null || gatewayInvite === null) return null;
  return { gatewayUrl, gatewayInvite };
}

/** Re-exported so a caller checking a pasted token needs one import, not three. */
export { GATEWAY_INVITE_PREFIX, SYNC_INVITE_PREFIX, isGatewayInviteToken, isSyncInviteToken };
