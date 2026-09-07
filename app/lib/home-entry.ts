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
 * SERVER, PURE: the redirect decision for `/`, from what a SERVER can see.
 *
 * The escape hatch beats the hint, unconditionally. That ordering is the whole
 * reason the marketing page stays reachable for a device that lives in the app.
 *
 * ── What the server is allowed to conclude (M201 spec 01) ────────────────
 *
 * Exactly one thing: that this browser has been in the app before. The cookie
 * is the only signal available while the first byte of HTML is produced, and
 * it says nothing about an account. The session lives in IndexedDB
 * (`app/lib/sync/session-cache.ts`), which the server cannot read at all, and
 * there is no second cookie standing in for it because there must not be: a
 * cookie the server could read would be a bearer credential for a diary this
 * server deliberately never holds.
 *
 * So where the cookie DOES prove what the redirect means, an open instance
 * where the diary belongs to the device, the server redirects and a returning
 * visitor never renders one frame of marketing. Where it does not
 * (`homeCookieProvesSession: false`, a managed instance, whose diary belongs
 * to an ACCOUNT), the server declines to decide and returns the landing page,
 * and {@link resolveClientLandingEntry} carries the rest in the browser, where
 * the session actually is. That costs a managed instance one frame of
 * marketing on a hard load, and it is the honest price of not pretending the
 * server knows who is holding the device.
 *
 * @returns `'/dashboard'` when this visit should be bounced into the app, else null.
 */
export function resolveLandingRedirect({
  hasHint,
  wantsLanding,
  homeCookieProvesSession,
}: {
  hasHint: boolean;
  wantsLanding: boolean;
  /** `InstancePolicy.homeCookieProvesSession`, false on a managed instance. */
  homeCookieProvesSession: boolean;
}): '/dashboard' | null {
  if (wantsLanding) return null;
  if (!homeCookieProvesSession) return null;
  return hasHint ? '/dashboard' : null;
}

/**
 * What `/` does in the BROWSER, where both the local diary and the session can
 * be read.
 *
 * `landing-clear-hint` is not a tidy-up: it is what stops the server loader
 * deciding wrongly on the NEXT hard load, on an instance where the cookie no
 * longer means what the server reads it as.
 */
export type ClientLandingEntry = 'dashboard' | 'landing-keep-hint' | 'landing-clear-hint';

/**
 * CLIENT, PURE: the decision behind `/`'s client loader AND its hard-load
 * repair effect (M201 spec 01).
 *
 * ONE function for both, deliberately. The two paths differ only in when they
 * run, and the reported symptom of this milestone was that one of the three
 * `/` paths had been fixed and the other two had not. A shared decision makes
 * "all three agree" a property rather than a review.
 *
 * The session term is a CONJUNCTION added on top of the local-row term, never
 * a replacement for it. That is what keeps this gate the opposite-polarity
 * mirror of `_personal`'s (see {@link hasEnteredApp}): a redirect to
 * `/dashboard` still implies `entered`, so `_personal` still cannot bounce
 * back, and the managed instance simply redirects strictly less often.
 * `tests/unit/home-entry.test.ts` asserts that as a property over the whole
 * matrix.
 *
 * @param entered - {@link hasEnteredApp} over this device's local store.
 * @param hasSession - is a sync session open or cached on THIS device?
 * @param homeCookieProvesSession - `InstancePolicy.homeCookieProvesSession`.
 */
export function resolveClientLandingEntry({
  wantsLanding,
  entered,
  hasSession,
  homeCookieProvesSession,
}: {
  wantsLanding: boolean;
  entered: boolean;
  hasSession: boolean;
  homeCookieProvesSession: boolean;
}): ClientLandingEntry {
  if (wantsLanding) return 'landing-keep-hint';
  if (!entered) return 'landing-clear-hint';
  if (homeCookieProvesSession || hasSession) return 'dashboard';
  // Local rows, no session, and an instance where local rows are somebody's
  // account rather than this device's diary. The hint goes with the decision:
  // leaving it would let the server loader wave the next hard load straight
  // through, which is the exact fault this spec exists for.
  return 'landing-clear-hint';
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
