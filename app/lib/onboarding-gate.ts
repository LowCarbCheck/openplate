/**
 * The `_personal` layout's onboarding gate, as a pure decision (M123 spec 01).
 *
 * The gate used to be three inline branches inside `_personal.tsx`'s
 * `clientLoader`, ending in an unconditional `redirect('/onboarding')`. That
 * last branch was the bug this module exists to close: a device whose primary
 * store's TABLES partition was wiped by the load/autosave race reads back as
 * "no profile, no logs" — exactly like a phone opening openplate for the first
 * time — and was shown the first-run wizard with no hint that weeks of data
 * had just gone missing. The `values` partition survives that wipe, and the
 * `firstDataAt` marker lives there (`local-store/had-data.ts`), so the two
 * states ARE distinguishable; this function is where they get distinguished.
 *
 * It is pure so the ordering below can be tested exhaustively without a store,
 * a router or IndexedDB. The order is load-bearing — see each branch.
 */

/** What the gate decided. The caller turns each of these into a redirect, or into passage. */
export type OnboardingGateOutcome =
  /** Onboarding is done: let the request through. */
  | { kind: 'pass' }
  /** A pre-stamp device with logs: stamp completion, then let it through. */
  | { kind: 'self-heal' }
  /** Probable data loss: block, and offer a restore. NEVER the onboarding wizard. */
  | { kind: 'recover' }
  /** A device with nothing on it: the welcome screen, which offers both doors. */
  | { kind: 'welcome' };

/** Everything the gate looks at. All three come from the on-device store. */
export interface OnboardingGateInput {
  /** Is there a profile-goals row at all? `false` means the tables partition holds nothing. */
  hasProfile: boolean;
  /** Is `onboardingCompletedAt` stamped on that row? */
  hasCompletedOnboarding: boolean;
  /** How many food logs the in-memory tables hold right now. */
  logCount: number;
  /** The `firstDataAt` marker, read from the values partition — survives a tables wipe. */
  hasEverHadData: boolean;
}

/**
 * Decides what the gate does, in a fixed order.
 *
 * 1. **Completed onboarding wins outright.** This is what keeps a legitimate
 *    day-one user — onboarded this morning, nothing logged yet — out of the
 *    recovery screen: their profile write stamped the marker, so they satisfy
 *    "marker set, zero logs" too. Reordering these checks shows a brand-new
 *    user a data-loss warning on their first empty diary.
 * 2. **Any food log self-heals**, as before: a device that pre-dates the local
 *    `onboardingCompletedAt` stamp is never trapped in the wizard.
 * 3. **Marker set AND nothing at all in the tables → probable data loss.** The
 *    absent PROFILE is part of this test, not just the absent logs. The failure
 *    empties the whole tables partition in one `setContent`, so a real wipe
 *    takes the profile row with it; a profile row that is still there is
 *    positive evidence the tables were NOT wiped. Without that condition, every
 *    user part-way through onboarding — the wizard writes timezone, focus and
 *    weight to the profile before it stamps completion, and each of those
 *    writes sets the marker — would be told their data was lost the moment they
 *    navigated into an app route mid-flow. That false positive is both far more
 *    common than the fault and far more alarming, so the narrower test wins.
 * 4. **Otherwise the welcome screen**, for a device with no marker at all.
 *    This branch used to go straight to the first-run wizard (M183 spec 02).
 *    It does not any more, because "no local profile" is not the same as "new
 *    person": a returning user's profile row travels inside the encrypted sync
 *    snapshot and arrives only AFTER they sign in, so a device that has never
 *    pulled one looks exactly like a fresh install. The welcome screen is the
 *    place that asks which of the two this is, rather than assuming.
 */
export function resolveOnboardingGate({
  hasProfile,
  hasCompletedOnboarding,
  logCount,
  hasEverHadData,
}: OnboardingGateInput): OnboardingGateOutcome {
  if (hasProfile && hasCompletedOnboarding) return { kind: 'pass' };
  if (logCount > 0) return { kind: 'self-heal' };
  if (!hasProfile && hasEverHadData) return { kind: 'recover' };
  return { kind: 'welcome' };
}

/**
 * Routes under `_personal` that the gate must NOT redirect away from.
 *
 * `/settings/preferences` is the documented way out of the instance's default
 * language, and this instance defaults to German. A first-time visitor who
 * does not read German therefore has to reach that page BEFORE onboarding —
 * otherwise the only screen they can see is a wizard they cannot read, and the
 * one control that would fix it sits behind that wizard. Nothing on the page
 * reads onboarding data (theme and language are both device preferences), so
 * it renders identically with an empty store.
 *
 * `/settings/account` is where `/settings/sync` went (M192/05), and it is
 * exempt for the reason that address was: somebody who followed a mail has not
 * necessarily used the app on that device, so the gate would fire and the
 * redirect to `/onboarding` would drop the URL FRAGMENT a token rides in. The
 * page itself reads nothing from onboarding: it renders from the sync session
 * and one loader string, both independent of any profile or goals.
 *
 * `/settings/sync` stays in the set as well, because it is still a live
 * address: it redirects, and a gate that bounced it to `/onboarding` first
 * would swallow the redirect.
 *
 * `/welcome` and `/sign-in` are the gate's own destinations (M183 spec 02),
 * and `/forgot` and `/reset` are where a mailed link lands (M192/05). All four
 * are registered outside this layout, so the exemptions are belt and braces
 * rather than load-bearing today — but a redirect target that the gate would
 * itself redirect away from is a loop, and the set is where that is stated.
 *
 * Exact paths, never a prefix: exempting `/settings` wholesale would open the
 * whole hub, and the gate has to keep holding for every other route.
 */
const GATE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/settings/preferences',
  '/settings/account',
  '/settings/sync',
  '/welcome',
  '/sign-in',
  '/forgot',
  '/reset',
]);

/**
 * Is this path reachable before onboarding?
 *
 * @param pathname - the request's pathname, e.g. `/settings/preferences`.
 * @returns `true` when the gate must let it through untested.
 */
export function isOnboardingGateExempt(pathname: string): boolean {
  return GATE_EXEMPT_PATHS.has(pathname.replace(/\/+$/, '') || '/');
}

/**
 * May this device open the first-run questionnaire at all (M187 spec 03)?
 *
 * The gate above decides where a device with no diary is SENT. This decides
 * something narrower and one step earlier: whether `/onboarding` is a page on
 * this instance for this device, or an address that redirects to `/welcome`.
 *
 * On an OPEN instance the answer is always yes, and that is today's app: a
 * local-only diary needs nobody's permission, which is the whole point of a
 * local-first tracker.
 *
 * On a MANAGED instance the anonymous path leads nowhere — there is no AI
 * without the gateway invite and no diary that outlives the device without the
 * account the same link creates — so it is CLOSED rather than merely hidden.
 * Hiding "Start" on the welcome screen would leave the wizard one typed URL
 * away, and somebody who found it would spend ten minutes answering questions
 * into a diary they cannot keep.
 *
 * Two exits keep that from locking anybody out:
 *
 * 1. **A profile row on the device.** Anything already answered here means
 *    this is a person part-way through, not a stranger at the door. That
 *    includes a device that onboarded before the instance became managed.
 * 2. **An open sync session.** This is the create-account flow's own path:
 *    the ceremony finishes, the account exists, and the questionnaire is the
 *    very next screen. Without this exit the flow would redirect itself back
 *    to `/welcome` at the last step.
 */
export function isAnonymousStartAllowed({
  managed,
  hasProfile,
  hasSyncAccount,
}: {
  /** `PublicConfig.managed` — `false` is the self-host default and the whole open branch. */
  managed: boolean;
  /** Is there a profile-goals row at all? Mid-onboarding counts. */
  hasProfile: boolean;
  /** Is a sync session open on this device right now? */
  hasSyncAccount: boolean;
}): boolean {
  if (!managed) return true;
  return hasProfile || hasSyncAccount;
}
