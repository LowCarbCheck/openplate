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
  /** A genuinely new (or genuinely mid-flow) device: the first-run wizard. */
  | { kind: 'onboarding' };

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
 * 4. **Otherwise the wizard**, unchanged, for a device with no marker at all.
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
  return { kind: 'onboarding' };
}
