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
  /**
   * DECIDE NOTHING YET: this device is still reopening a session it already
   * had, and the diary that answers every question below is inside it.
   *
   * The caller renders the app's loading screen and asks again once the resume
   * has settled. Before M192 there was no such state, because a session did
   * not survive a reload and an empty store really did mean an empty device.
   * Now it does survive, and a gate that read `account === null` as "signed
   * out" showed the sign-in door to somebody who was signed in, once per
   * reload.
   */
  | { kind: 'wait' }
  /**
   * Signed in, settled, and no diary here: the first-run questionnaire.
   *
   * DISTINCT FROM `welcome`, which offers a door to somebody who has not come
   * through one. Offering it to an account holder is the same defect from the
   * other side: they have signed in, and the screen asks them to sign in.
   */
  | { kind: 'onboard' }
  /** A device with nothing on it: the welcome screen, which offers both doors. */
  | { kind: 'welcome' }
  /**
   * A STRANGER ON A PAGE THE GATE DOES NOT GUARD (M204 spec 09).
   *
   * The path is in `GATE_EXEMPT_PATHS`, so nothing is redirected; and this
   * device holds no diary, no session and no evidence it ever did, so there is
   * nothing for the app shell to be about. The caller renders the PUBLIC
   * chrome around the page instead of the sidebar, the account chip and the
   * back arrow, which together read as a signed-in app to somebody who is not
   * signed in.
   *
   * DISTINCT FROM `pass`, which is the same three pages seen by a person who
   * does have a diary here, and who keeps the full shell.
   */
  | { kind: 'exempt' };

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
  /**
   * Does this device hold a non-empty SYNC BASELINE for the account it is
   * signed into (M224)?
   *
   * THE MARKER ALONE WAS NOT ENOUGH. `hasEverHadData` lives in the values
   * partition of `openplate-primary`, the same database an eviction takes,
   * so the two states this module exists to tell apart are once again
   * identical when the whole database goes, and the gate offered the wizard. A
   * profile written by that wizard stamps at `previous + 1` and OUTRANKS the
   * server's real profile in the merge, so the offer is not merely wrong, it
   * destroys the copy that would have fixed it.
   *
   * The baseline lives in `localStorage` and survives, and it is positive
   * evidence of the only kind that matters here: this device has synced
   * entities for this account before, so it is not a new person.
   */
  hasSyncBaseline: boolean;
  /**
   * Is a session open on this device right now?
   *
   * Read from the session SNAPSHOT, never from the vault: this decision is
   * made in a loader and rendered by React, and neither may touch key
   * material.
   */
  hasSyncAccount: boolean;
  /** Is this device still reopening a cached session? `SyncSessionSnapshot.isResuming`. */
  isResumingSession: boolean;
  /**
   * Has this device been signed out of an account whose diary it must stop
   * showing? `isDeviceLocked()` in `sync/sync-state.ts` (M201 spec 02).
   *
   * Only ever `true` on an instance whose policy says
   * `signOutErasesDevice`, because that is the only place the marker is
   * written. On an open instance signing out of sync takes nothing away, so
   * this is `false` there by construction and the gate below is unchanged.
   */
  isDeviceLocked: boolean;
  /**
   * Is the requested path one of `GATE_EXEMPT_PATHS` (`isOnboardingGateExempt`)?
   *
   * A PATH FACT, not a device fact, and the only one this module reads. It is
   * an input rather than a branch at the call site because the exempt order
   * below is part of the same decision: an exempt path never redirects, and
   * which chrome it wears depends on the very same device facts.
   */
  isExemptPath: boolean;
}

/**
 * Decides what the gate does, in a fixed order.
 *
 * 0. **A locked device decides nothing else.** Signing out on an instance where
 *    the diary belongs to the account has to close the diary, and the rows are
 *    still on the device (a wipe is opt-in, spec 02). So the lock is tested
 *    FIRST, ahead of the branch that would otherwise wave a stamped profile
 *    through, and it answers `welcome`, the screen with the door on it.
 *    `isResumingSession` still wins over it, or every reload of a device that
 *    is about to reopen its session would flash the sign-in screen; and an
 *    OPEN session beats it outright, because signing in is what lifts the lock
 *    and a lock left behind by a failed write must not outrank the session in
 *    front of it.
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
 * 3.2 **A non-empty sync baseline is the same evidence, one storage layer up.**
 *    The marker lives in the values partition of the same database the tables
 *    are in, so a whole-database eviction takes both and the device reads as
 *    brand new. The baseline is in `localStorage` and survives it.
 * 3.5 **Still resuming → decide nothing.** Inserted BEFORE the recovery check
 *    and not after it, because a resume can bring back the very tables that
 *    check is about: warning somebody about data loss while their data is on
 *    its way is the false positive branch 3 already exists to avoid, one layer
 *    up. It sits AFTER the two branches that prove a diary is present, because
 *    those two are already true and no resume can make them falser.
 * 3.6 **Signed in, settled, no diary → the questionnaire, not the door.** The
 *    welcome screen's whole content is two doors, and this person has already
 *    come through one. This is what a freshly joined account hits on its first
 *    full navigation.
 * 4. **Otherwise the welcome screen**, for a device with no marker at all.
 *    This branch used to go straight to the first-run wizard (M183 spec 02).
 *    It does not any more, because "no local profile" is not the same as "new
 *    person": a returning user's profile row travels inside the encrypted sync
 *    snapshot and arrives only AFTER they sign in, so a device that has never
 *    pulled one looks exactly like a fresh install. The welcome screen is the
 *    place that asks which of the two this is, rather than assuming.
 *
 * AN EXEMPT PATH TAKES A DIFFERENT ORDER (M204 spec 09), written out in
 * `resolveForExemptPath` below. The order above is about where a device is
 * SENT, and an exempt path sends nobody anywhere; the exempt order is about
 * which chrome the page wears, and it answers only `exempt`, `wait` or `pass`.
 */
export function resolveOnboardingGate(input: OnboardingGateInput): OnboardingGateOutcome {
  if (input.isExemptPath) return resolveForExemptPath(input);
  return resolveForGatedPath(input);
}

/**
 * The gate on a path it must not redirect away from (M204 spec 09).
 *
 * THE ORDER, WRITTEN DOWN, and it is the whole content of this function:
 *
 * (a) **A stranger gets `exempt`.** Not resuming, no session, and either the
 *     device is LOCKED (its diary belongs to an account that signed out, so
 *     this page has no diary behind it either) or there is nothing on this
 *     device at all: no profile row, no log, and no `firstDataAt` marker. The
 *     lock is tested here for the same reason it is tested first in the gated
 *     order: a locked device with a stamped profile still must not read as a
 *     signed-in app.
 * (b) **A resuming session gets `wait`.** After (a) and not before it only in
 *     writing: (a) already requires `!isResumingSession`, so the two cannot
 *     both fire. Stated as its own branch because it is the case that matters
 *     most, a signed-in person mid-resume who must never be shown the public
 *     shell for the frame it takes their session to reopen.
 * (c) **Everything else gets `pass`**, and wears the full shell: an open
 *     session, a profile row, a log, or the marker. An OPEN instance with a
 *     local diary lands here, never in (a), which is the point of testing the
 *     device rather than the instance mode.
 *
 * The three kinds above are the only ones an exempt path can produce. That is
 * the second half of the exemption and the reason it lives here rather than at
 * the call site: `recover`, `onboard` and `self-heal` are redirects (or a
 * write), and an exempt path that redirected would swallow the invite fragment
 * and hide the language switch, which is what the exemption exists to prevent.
 */
function resolveForExemptPath({
  hasProfile,
  logCount,
  hasEverHadData,
  hasSyncBaseline,
  hasSyncAccount,
  isResumingSession,
  isDeviceLocked,
}: OnboardingGateInput): OnboardingGateOutcome {
  // The baseline joins the other three for the same reason it joins the gated
  // order: a device that has synced entities for an account is not a stranger,
  // whatever its IndexedDB currently says.
  const holdsNothing = !hasProfile && logCount === 0 && !hasEverHadData && !hasSyncBaseline;
  if (!isResumingSession && !hasSyncAccount && (isDeviceLocked || holdsNothing)) return { kind: 'exempt' };
  if (isResumingSession) return { kind: 'wait' };
  return { kind: 'pass' };
}

/** The gate on every other route under `_personal`: the order the header describes. */
function resolveForGatedPath({
  hasProfile,
  hasCompletedOnboarding,
  logCount,
  hasEverHadData,
  hasSyncBaseline,
  hasSyncAccount,
  isResumingSession,
  isDeviceLocked,
}: OnboardingGateInput): OnboardingGateOutcome {
  if (isDeviceLocked && !hasSyncAccount) {
    return isResumingSession ? { kind: 'wait' } : { kind: 'welcome' };
  }
  if (hasProfile && hasCompletedOnboarding) return { kind: 'pass' };
  if (logCount > 0) return { kind: 'self-heal' };
  if (isResumingSession) return { kind: 'wait' };
  // A NON-EMPTY BASELINE MEANS RECOVER OR WAIT, NEVER ONBOARD (M224). It sits
  // beside the marker rather than replacing it because the two survive
  // different failures: the marker survives a TABLES wipe, and the baseline
  // survives the whole database going. Either one is enough to know that this
  // device is not a new person's.
  if (!hasProfile && (hasEverHadData || hasSyncBaseline)) return { kind: 'recover' };
  if (hasSyncAccount) return { kind: 'onboard' };
  return { kind: 'welcome' };
}

/**
 * Routes under `_personal` that the gate must NOT redirect away from, AND the
 * routes whose chrome a stranger's visit changes.
 *
 * TWO JOBS, not one (M204 spec 09). Membership here used to mean only "skip
 * the redirect", and a reader could safely treat it as an access list. It is
 * now also the input `resolveForExemptPath` reads to answer `exempt`, which is
 * what makes `_personal.tsx` draw the PUBLIC shell instead of the sidebar for
 * a visitor with no diary. So adding a path here does two things: it opens the
 * page to somebody who has not onboarded, and it declares that the page is
 * legible to a stranger without the app around it. A page that is only the
 * first is not a candidate for this set.
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
 * `/settings/about` is linked from the landing page footer, which is a public
 * page: a visitor following that link was bounced to `/welcome` and never saw
 * the page the link named. It reads nothing from onboarding either, and it is
 * the one exempt page that is pure reading matter.
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
  '/settings/about',
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
