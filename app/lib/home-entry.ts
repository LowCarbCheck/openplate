/**
 * home-entry.ts — the device-local hint that this browser has already entered
 * the app, and the pure decision `/` makes from it.
 *
 * Modelled directly on `app/i18n/language-prefs.ts`, for the same reason: a
 * cookie is the ONLY signal the server can read synchronously while producing
 * the very first byte of HTML. `/`'s server loader reads it and issues a real
 * 302 to `/dashboard`, so a returning device never renders one frame of the
 * marketing page.
 *
 * **It is a HINT, never truth.** Local truth lives in IndexedDB, which the
 * server cannot see. Both directions can go wrong, and both self-heal:
 *
 * 1. **False negative (the common one).** WebKit caps `document.cookie`-set
 *    cookies at 7 days, so a Safari user who opens openplate less than weekly
 *    loses the hint and gets the marketing page on a hard load. `/`'s component
 *    effect reads the local store, finds real data, rewrites the hint and
 *    navigates on — one frame of marketing, then the app. The hint is refreshed
 *    on every `_personal` visit, which keeps regular users inside the window.
 * 2. **False positive.** Cookies kept, IndexedDB cleared. `/` → 302
 *    `/dashboard` → `_personal`'s onboarding gate → `/onboarding`, which clears
 *    the hint. Two redirects, then correct forever. It cannot loop, because
 *    `hasEnteredApp` below is `_personal`'s own gate predicate with the
 *    opposite polarity — see that function's doc.
 *
 * There is deliberately NO `localStorage` mirror (unlike the language
 * preference): the server cannot read one, so it would buy nothing the effect
 * does not already do.
 *
 * Client- and server-safe: plain TS, no server-only imports, no `document`
 * access at module scope; the client helpers guard `document` themselves.
 */

export const HOME_HINT_COOKIE = 'openplate-home';
export const HOME_HINT_VALUE = 'app';

/** 1 year — a durable per-device hint, like the language cookie. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Query param that forces the marketing page for a device that carries the
 * hint. Deliberately NOT linked from any UI (that would be a second "About
 * openplate" destination nobody asked for) — it is a documented URL.
 */
export const LANDING_ESCAPE_PARAM = 'landing';

/** Reads one cookie out of a raw `Cookie` header. Whitespace-tolerant, exact name match. */
function readCookieFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * SERVER: is the hint present and well-formed?
 *
 * Exact value match, never a prefix — the cookie is not httpOnly, so a
 * tampered or truncated value must read as "no hint" rather than as a hint.
 * Never throws.
 *
 * @param cookieHeader - the request's raw `Cookie` header, or null.
 * @returns true only for exactly `openplate-home=app`.
 */
export function parseHomeHintCookie(cookieHeader: string | null): boolean {
  return readCookieFromHeader(cookieHeader, HOME_HINT_COOKIE) === HOME_HINT_VALUE;
}

/**
 * PURE: does this URL ask for the marketing page explicitly?
 *
 * PRESENCE, not truthiness — `?landing=0` still shows the landing page. The
 * param is an escape hatch a human types, and making it interpret its own value
 * would mean `?landing=0` silently redirects the one person who most obviously
 * wanted to stay.
 *
 * @param search - a `location.search` string (with or without the `?`) or a `URLSearchParams`.
 */
export function wantsLandingPage(search: string | URLSearchParams): boolean {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  return params.has(LANDING_ESCAPE_PARAM);
}

/**
 * SERVER + CLIENT, PURE: the redirect decision for `/`.
 *
 * The escape hatch beats the hint, unconditionally. That ordering is the whole
 * reason the marketing page stays reachable for a device that lives in the app.
 *
 * @returns `'/dashboard'` when this visit should be bounced into the app, else null.
 */
export function resolveLandingRedirect({
  hasHint,
  wantsLanding,
}: {
  hasHint: boolean;
  wantsLanding: boolean;
}): '/dashboard' | null {
  if (wantsLanding) return null;
  return hasHint ? '/dashboard' : null;
}

/** The two local facts that decide whether this device is already "in the app". */
export interface LocalEntrySnapshot {
  /** `LocalProfileGoals.onboardingCompletedAt`, or null when there is no profile row at all. */
  onboardingCompletedAt: number | null;
  foodLogCount: number;
}

/**
 * PURE: does this device's local state mean "already in the app"?
 *
 * Deliberately IDENTICAL to `_personal.tsx`'s own onboarding gate, with the
 * opposite polarity: that gate redirects to `/onboarding` exactly when
 * onboarding is unstamped AND there are no food logs to self-heal from. So
 * `hasEnteredApp(s) === !(the gate fires)` BY CONSTRUCTION — which is what
 * makes it impossible for `/` to hand `/dashboard` someone `_personal` would
 * bounce straight back out. `tests/unit/home-entry.test.ts` pins that as a
 * property; do not "simplify" either side without the other.
 *
 * Note `onboardingCompletedAt !== null`, never a truthiness test: epoch 0 is a
 * real stamp.
 */
export function hasEnteredApp({ onboardingCompletedAt, foodLogCount }: LocalEntrySnapshot): boolean {
  return onboardingCompletedAt !== null || foodLogCount > 0;
}

/** CLIENT: is the hint on this device? SSR-safe (returns false). */
export function readHomeHint(): boolean {
  if (globalThis.document === undefined) return false;
  return parseHomeHintCookie(document.cookie);
}

/** CLIENT: write the hint (1 year, `path=/`, `SameSite=Lax`). No-op on the server. */
export function writeHomeHint(): void {
  if (globalThis.document === undefined) return;
  document.cookie = `${HOME_HINT_COOKIE}=${HOME_HINT_VALUE}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** CLIENT: drop the hint. No-op on the server. */
export function clearHomeHint(): void {
  if (globalThis.document === undefined) return;
  document.cookie = `${HOME_HINT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
