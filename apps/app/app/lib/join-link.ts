/**
 * THE TWO MAILED LINKS: the fragment `/join` reads, and the fragment `/reset`
 * reads. One grammar, one strip, one pending slot.
 *
 * A person invited to an organization's instance is handed one address:
 *
 *   https://app.example/join#server=https%3A%2F%2Fsync.example&invite=si_…
 *
 * and a person who forgot their password is handed the other:
 *
 *   https://app.example/reset#server=https%3A%2F%2Fsync.example&token=sr_…
 *
 * They are in ONE module because every rule below applies to both, and a
 * second copy of "read the fragment, strip it, park what it carried" is how
 * one of the two ends up missing the service worker's first-visit reload.
 * Both keys may be absent, and a link with no capability is the one invalid
 * case — it lands on an explanation rather than an error.
 *
 * ── WHAT M192 DELETED ────────────────────────────────────────────────────
 *
 * The gateway half: `gateway=`, `ginvite=`, the `gi_` prefix, the redeemed
 * answer parked beside them, and the two-token grammar that existed because a
 * person had to join two services in one sitting. There is one service now, so
 * there is one token, and the `sync=` key is spelled `server=` to say so.
 *
 * A link minted before this build carries `sync=` and `invite=`; the invite is
 * still read, and the address it names is still only a CHECK (see
 * {@link isForeignSyncServer}), so such a link keeps working on the instance it
 * was minted for.
 *
 * ── The fragment, never the query string ──────────────────────────────────
 *
 * The invite is a LIVE CAPABILITY: whoever holds it can create an account on
 * this instance, at an address somebody else chose. A query string carries it
 * into the browser's history, into the `Referer` of the next request, and into
 * the access log of every server the link passes on its way to the person
 * invited. A fragment is never sent to any server at all. That is also why
 * nothing here reads the page's query string: by construction there is nothing
 * in it.
 *
 * ── Read once, park, strip ───────────────────────────────────────────────
 *
 * `takeJoinLinkFromUrl` clears the fragment with `replaceState` the moment it
 * is read, so the token does not sit in the address bar for a screenshot or a
 * screen share, and parks what it found in the pending slot so a remount or the
 * service worker's first-visit document reload cannot destroy the only copy.
 */
import {
  SYNC_INVITE_PREFIX,
  SYNC_RESET_PREFIX,
  clearPendingJoinField,
  isSyncInviteToken,
  isSyncResetToken,
  readPendingJoinField,
  rememberPendingJoinField,
  sessionInviteStorage,
} from '#app/lib/sync/invite-link';

/**
 * The service's address. A CHECK, not an instruction — see
 * {@link isForeignSyncServer}.
 *
 * `sync` is read as well, unchanged, because links minted before M192 spell it
 * that way and they are already in people's mailboxes.
 */
const SERVER_URL_KEY = 'server';
const LEGACY_SERVER_URL_KEY = 'sync';
/** The signup invite, spelled the same as the M166 `#invite=` link, which still works. */
const INVITE_KEY = 'invite';
/** The password-reset token. Named apart from `invite` so the two can never be confused positionally. */
const RESET_TOKEN_KEY = 'token';

/** What one join link offers. Both fields are independently optional. */
export interface JoinLink {
  serverUrl: string | null;
  invite: string | null;
}

const EMPTY_JOIN_LINK: JoinLink = { serverUrl: null, invite: null };

/** Hostnames a plain `http:` address is accepted for — the CSP's own loopback carve-out, written down. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/**
 * Normalizes the `server=` value, or `null` when it is not a usable address.
 *
 * `null` rather than a throw: this value arrives from a link in someone's
 * inbox, so a mangled one is an ordinary user-facing outcome ("this link
 * doesn't look right"), not an exceptional condition. Contrast
 * `parseSyncServerUrl`, which throws — that one is an OPERATOR's own
 * environment variable, where failing loudly at boot is the cheap option.
 *
 * The rules:
 * - `https:` anywhere;
 * - `http:` ONLY for loopback, matching the CSP's standing carve-out. A plain
 *   `http://` address on a LAN is blocked by the browser's mixed-content rule
 *   regardless of what this function returns, so accepting it here would only
 *   move the failure later and make it harder to explain;
 * - trailing slashes trimmed, so `${serverUrl}${AUTH_API_PREFIX}` can never
 *   produce a double slash;
 * - any query string or fragment dropped — a service address has neither, and
 *   silently carrying one into every request URL is a debugging trap.
 */
export function normalizeServerUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  const isLoopback = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) return null;

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

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
    serverUrl: normalizeServerUrl(params.get(SERVER_URL_KEY) ?? params.get(LEGACY_SERVER_URL_KEY)),
    invite: normalizeInviteToken(params.get(INVITE_KEY)),
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
 * `server=` field decides nothing (see {@link isForeignSyncServer}).
 */
export function parseJoinLinkInput(raw: string): JoinLink {
  const trimmed = raw.trim();
  if (trimmed === '') return { ...EMPTY_JOIN_LINK };
  const hashAt = trimmed.indexOf('#');
  return parseJoinFragment(hashAt === -1 ? trimmed : trimmed.slice(hashAt + 1));
}

/** The invite, trimmed, or `null` when absent, blank, or not shaped like one. */
export function normalizeInviteToken(raw: string | null | undefined): string | null {
  return normalizeToken(raw, isSyncInviteToken);
}

/** The reset token, trimmed, or `null` when absent, blank, or not shaped like one. */
export function normalizeResetToken(raw: string | null | undefined): string | null {
  return normalizeToken(raw, isSyncResetToken);
}

/**
 * The shape gate both tokens share.
 *
 * An empty value is treated as ABSENT: `#invite=` is a malformed link, not a
 * request to submit an empty token. A value of the wrong SHAPE is absent too,
 * rather than prefilled into a form that would post it and get a refusal
 * nobody can explain.
 */
function normalizeToken(raw: string | null | undefined, belongsToService: (token: string) => boolean): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return belongsToService(trimmed) ? trimmed : null;
}

/**
 * Builds the fragment, including the leading `#`.
 *
 * The one place a join link is written, so the admin page, the operator CLI and
 * any test all produce the same grammar. Absent fields are omitted rather than
 * written empty: `#invite=` is a link that looks like it carries an invitation
 * and does not.
 */
export function buildJoinFragment(link: Partial<JoinLink>): string {
  const params = new URLSearchParams();
  if (link.serverUrl != null && link.serverUrl !== '') params.set(SERVER_URL_KEY, link.serverUrl);
  if (link.invite != null && link.invite !== '') params.set(INVITE_KEY, link.invite);
  const encoded = params.toString();
  return encoded === '' ? '' : `#${encoded}`;
}

/** Whether this link admits anyone to anything. A link that does not is the one invalid case. */
export function isJoinLinkEmpty(link: JoinLink): boolean {
  return link.invite === null;
}

/**
 * Whether the link names a DIFFERENT service than this app is configured for.
 *
 * The address in the link is a check, never an instruction. This client posts a
 * passphrase-derived verifier to the server its own operator configured
 * (`SYNC_SERVER_URL`); letting a link redirect that would let anyone who can
 * send a link choose where those credentials go. So a mismatch is reported to
 * the person, and nothing is dialled.
 *
 * Compared by ORIGIN: a trailing slash or a path suffix is not a different
 * service, and the origin is the part a browser enforces anything about.
 */
export function isForeignSyncServer({
  linkServerUrl,
  configuredSyncUrl,
}: {
  linkServerUrl: string | null;
  configuredSyncUrl: string | null;
}): boolean {
  if (linkServerUrl === null) return false;
  if (configuredSyncUrl === null) return true;
  return safeOrigin(linkServerUrl) !== safeOrigin(configuredSyncUrl);
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Reads the join link from the current URL, strips the fragment, and parks the
 * invite — or, when the URL carries none, returns what is still parked.
 *
 * Calling this twice is safe and is the normal case: the second call comes from
 * the remount, or from the mount after the service worker's first-visit reload,
 * and it gets the same link back. {@link consumeSyncInvite} is what ends that.
 *
 * Returns an empty link during SSR, where there is no `location`.
 */
export function takeJoinLinkFromUrl({ configuredSyncUrl }: { configuredSyncUrl: string | null }): JoinLink {
  if (globalThis.window === undefined) return { ...EMPTY_JOIN_LINK };
  const storage = sessionInviteStorage();

  const fromUrl = parseJoinFragment(globalThis.window.location.hash);
  if (globalThis.window.location.hash !== '') {
    // Unconditionally, and before anything is dialled: even a link this app
    // rejects carries a token that is just as sensitive. `replaceState` rather
    // than assigning `location.hash`, which would push a history entry and put
    // the token straight back in the bar on Back.
    const { pathname, search } = globalThis.window.location;
    globalThis.window.history.replaceState(null, '', `${pathname}${search}`);
  }
  // A link for ANOTHER service parks nothing. Parking it would leave a token
  // this app can never spend sitting in the slot, where the next link read
  // picks it up and offers a signup that belongs to somebody else's server.
  const isForeign = isForeignSyncServer({ linkServerUrl: fromUrl.serverUrl, configuredSyncUrl });
  if (fromUrl.invite !== null && !isForeign) {
    rememberPendingJoinField({ field: 'invite', value: fromUrl.invite, storage });
  }

  return {
    // The ADDRESS is deliberately not parked: it is a check run against this
    // app's own configuration at the moment of arrival, not something a later
    // mount needs.
    serverUrl: fromUrl.serverUrl,
    invite: readPendingJoinField({ field: 'invite', storage }),
  };
}

/**
 * Ends the invite's stay in the pending slot.
 *
 * Called when the person acts on the prefilled form, not when it merely
 * renders: until then a reload has to be able to bring the token back.
 */
export function consumeSyncInvite(): void {
  clearPendingJoinField({ field: 'invite', storage: sessionInviteStorage() });
}

/**
 * The reset link, read exactly the way the join link is: the fragment is
 * stripped as it is read, and the token is parked so a remount or the service
 * worker's first-visit document reload cannot destroy the only copy.
 *
 * A SEPARATE FUNCTION rather than a flag on {@link takeJoinLinkFromUrl},
 * because the two are read by different screens and each must park only its
 * own capability: `/reset` reading a join fragment would leave an invite in
 * the slot that `/join` then offers, for a person who came to change a
 * password.
 */
export function takeResetLinkFromUrl({ configuredSyncUrl }: { configuredSyncUrl: string | null }): ResetLink {
  if (globalThis.window === undefined) return { serverUrl: null, resetToken: null };
  const storage = sessionInviteStorage();

  const hash = globalThis.window.location.hash;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const serverUrl = normalizeServerUrl(params.get(SERVER_URL_KEY) ?? params.get(LEGACY_SERVER_URL_KEY));
  const fromUrl = normalizeResetToken(params.get(RESET_TOKEN_KEY));
  if (hash !== '') {
    const { pathname, search } = globalThis.window.location;
    globalThis.window.history.replaceState(null, '', `${pathname}${search}`);
  }
  // A link for ANOTHER service parks nothing, for the reason
  // `takeJoinLinkFromUrl` gives: a token this app can never spend would sit in
  // the slot and be offered on the next visit.
  const isForeign = isForeignSyncServer({ linkServerUrl: serverUrl, configuredSyncUrl });
  if (fromUrl !== null && !isForeign) rememberPendingJoinField({ field: 'reset', value: fromUrl, storage });

  return { serverUrl, resetToken: readPendingJoinField({ field: 'reset', storage }) };
}

/** What one reset link offers. Both fields are independently optional. */
export interface ResetLink {
  serverUrl: string | null;
  resetToken: string | null;
}

/**
 * Ends the reset token's stay in the pending slot.
 *
 * Called when the person SUBMITS, not when the form renders: until then a
 * reload has to be able to bring the token back, and after it a later visit
 * must not resurrect a token the service has already spent.
 */
export function consumeResetToken(): void {
  clearPendingJoinField({ field: 'reset', storage: sessionInviteStorage() });
}

/** Builds a reset fragment, so the service's mail and any test produce one grammar. */
export function buildResetFragment(link: Partial<ResetLink>): string {
  const params = new URLSearchParams();
  if (link.serverUrl != null && link.serverUrl !== '') params.set(SERVER_URL_KEY, link.serverUrl);
  if (link.resetToken != null && link.resetToken !== '') params.set(RESET_TOKEN_KEY, link.resetToken);
  const encoded = params.toString();
  return encoded === '' ? '' : `#${encoded}`;
}

/** Re-exported so a caller checking a pasted token needs one import, not three. */
export { SYNC_INVITE_PREFIX, SYNC_RESET_PREFIX, isSyncInviteToken, isSyncResetToken };
