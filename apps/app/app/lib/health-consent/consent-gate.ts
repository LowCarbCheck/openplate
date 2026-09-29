/**
 * THE CONSENT GATE, as a pure decision (owner decision, 2026-09-28).
 *
 * An instance whose operator holds the escrowed recovery code names explicit
 * consent (Art. 9(2)(a) GDPR) as the legal basis for the diary, and its core
 * publishes the version of the wording it asks for (`PROTOCOL.md` §5.6). A
 * new account agrees on `/join`. An account created before the instance
 * asked, or one that agreed to an older wording, is asked ONCE: every screen
 * of the app sends it to `/consent` until it agrees.
 *
 * It is shaped like `resolvePlanGate` (`#app/lib/plans/plan-gate`) and for the
 * same reason: the order below is the whole policy, and a pure function is
 * where a test can hold all of it without a router, a session or a network.
 * It runs BEFORE the plan gate, so a locked account is asked for its consent
 * first and shown the plan page second.
 *
 * ── UNKNOWN NEVER ASKS ───────────────────────────────────────────────────
 *
 * A handshake not answered, an instance older than the field, an account view
 * not yet read and a device with no session all answer open. The caller
 * (`consent-gate-facts.ts`) fails open on a timeout and offline for the same
 * reason. Failing open costs nothing the operator must show: the core REQUIRES
 * the consent on every data route (2026-09-29), so an account the gate let
 * through by mistake stores nothing, and the `403 health-consent-required` its
 * next sync or scan meets makes the layout ask this gate again with fresh
 * facts (`_personal.tsx`, `ConsentGateWatcher`).
 *
 * ── ADMINISTRATORS TOO ───────────────────────────────────────────────────
 *
 * Unlike the plan gate, nothing here reads the role. An administrator's diary
 * is health data like anybody's, and the operator must be able to show a
 * consent for it too.
 */

/** The consent screen, and the one place the gate sends a person. */
export const CONSENT_PAGE_PATH = '/consent';

/** Where the consent screen continues to when it was given no page, or one it may not go to. */
export const DEFAULT_CONSENT_NEXT = '/dashboard';

/** What the gate decided. `consent` names where the caller sends the person. */
export type ConsentGateOutcome = { kind: 'open' } | { kind: 'consent'; destination: string };

/** The account facts the gate reads, from a view the service has answered. */
export interface ConsentGateAccount {
  /** The version on record, or `null` when the account never agreed. */
  consentedVersion: string | null;
}

/** Everything the gate looks at. */
export interface ConsentGateInput {
  /** The version the instance asks for, or `null` when it asks for none or is not known yet. */
  requiredVersion: string | null;
  /** The signed-in account, or `null` with no session or before its view has been read. */
  account: ConsentGateAccount | null;
  /** The pathname the person is going to, e.g. `/dashboard`. */
  pathname: string;
  /** Its query string, `''` or starting with `?`, carried to the consent screen so nothing is lost. */
  search: string;
}

/** The single open answer, so no caller builds a second one. */
const OPEN: ConsentGateOutcome = { kind: 'open' };

/**
 * The pages somebody who has not agreed can still open, exactly as written.
 *
 * - `/consent`, the page the gate sends them to. Without it the redirect
 *   would loop.
 * - `/settings/data`, the export. Taking the diary out never waits on a
 *   consent to keeping it. The core agrees: it serves an account its own blob
 *   without the consent, so on a new device the pull that fills the export
 *   still works (openplate-core `PROTOCOL.md` §5.15.1).
 * - `/settings/account`, delete the account and sign out. Deleting the
 *   account is how a consent is withdrawn (`PROTOCOL.md` §5.15.1), so it is
 *   also how somebody declines. `/settings/sync` is the old address of that
 *   page and only redirects to it, so it is open too, or the redirect would
 *   be swallowed by this gate first.
 * - `/settings/preferences`, the language and the "Count my visits" switch.
 *   The privacy notice (section 13) links that switch at
 *   `/settings/preferences#visit-counting` as the way to object to visit
 *   counting, and an objection under Art. 21 GDPR must not wait on a consent
 *   to health data under Art. 9. The plan gate keeps it open for the same
 *   reason.
 *
 * Everything outside the `_personal` layout (the legal pages, the privacy
 * notice the box links to, sign-in, join, welcome) never reaches this gate at
 * all, because the layout's loader is where it runs.
 *
 * EXACT PATHS, never a prefix.
 */
export const CONSENT_GATE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  CONSENT_PAGE_PATH,
  '/settings/data',
  '/settings/account',
  '/settings/sync',
  '/settings/preferences',
]);

/**
 * A pathname the way the router matches it: without trailing slashes, and
 * without regard to case (route matching is case insensitive by default).
 */
function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '').toLowerCase() || '/';
}

/**
 * Is this path reachable before the person has agreed?
 *
 * @param pathname - the request's pathname, e.g. `/settings/data`.
 */
export function isConsentGateExempt(pathname: string): boolean {
  return CONSENT_GATE_EXEMPT_PATHS.has(normalisePath(pathname));
}

/**
 * The consent screen's address, with the page to continue to.
 *
 * The slashes of the page are left as they are, so the address reads
 * `/consent?next=/dashboard`: a slash is allowed in a query string, and
 * `URLSearchParams` reads it back either way. Everything else is encoded.
 *
 * @param next - a same-origin path and query, e.g. `/diary?date=2026-09-28`.
 */
export function consentPageHref(next: string): string {
  return `${CONSENT_PAGE_PATH}?next=${encodeURIComponent(next).replaceAll('%2F', '/')}`;
}

/** The base a `next` value is resolved against. Never dialled: it only has to be an origin nothing else has. */
const SAME_ORIGIN_PROBE = 'https://openplate.invalid';

/**
 * The page the consent screen may continue to, or {@link DEFAULT_CONSENT_NEXT}.
 *
 * `next` arrives in the address bar, so anybody can write it, and a consent
 * screen that sent a person to whatever it named would be an open redirect on
 * the one page an operator asks people to trust. Only a path on THIS origin
 * passes:
 *
 * - it starts with one `/`, never `//` (a scheme-relative URL) or `/\` (which
 *   a browser reads as `//`);
 * - it has no backslash and no control character anywhere, because a browser
 *   drops a tab or a newline before it parses, and `/\t/evil.example` would
 *   become `//evil.example`;
 * - resolved against a probe origin, it is still on that origin;
 * - it is not the consent screen itself, which would ask again for ever.
 *
 * @param raw - the `next` query parameter, or `null` when there is none.
 * @returns the path, query and fragment to navigate to.
 */
export function safeConsentNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_CONSENT_NEXT;
  // oxlint-disable-next-line no-control-regex -- the control characters ARE what this refuses.
  if (/[\\\u0000-\u001f\u007f]/u.test(raw)) return DEFAULT_CONSENT_NEXT;
  let url: URL;
  try {
    url = new URL(raw, SAME_ORIGIN_PROBE);
  } catch {
    return DEFAULT_CONSENT_NEXT;
  }
  if (url.origin !== SAME_ORIGIN_PROBE) return DEFAULT_CONSENT_NEXT;
  if (normalisePath(url.pathname) === CONSENT_PAGE_PATH) return DEFAULT_CONSENT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Decides whether this navigation goes through or goes to the consent screen.
 *
 * 1. **An instance that asks for no consent never asks.** Self-hosted
 *    instances and every core older than the field answer `null`.
 * 2. **No known account, no question.** A device with no session, and a
 *    session whose account view has not been read, are open.
 * 3. **An exempt page stays open**, see {@link CONSENT_GATE_EXEMPT_PATHS}.
 * 4. **The version on record decides.** The same version is open; none, or
 *    another one, is asked, byte for byte as the service compares it.
 *
 * @param input - the instance's version, the account, and where it is going.
 * @returns `open`, or `consent` with the consent screen and the page to continue to.
 */
export function resolveConsentGate({
  requiredVersion,
  account,
  pathname,
  search,
}: ConsentGateInput): ConsentGateOutcome {
  if (requiredVersion === null) return OPEN;
  if (account === null) return OPEN;
  if (isConsentGateExempt(pathname)) return OPEN;
  if (account.consentedVersion === requiredVersion) return OPEN;
  return { kind: 'consent', destination: consentPageHref(`${pathname}${search}`) };
}
