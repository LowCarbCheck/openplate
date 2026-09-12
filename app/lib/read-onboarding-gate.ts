/**
 * The impure half of the onboarding gate: read the device, then ask the pure
 * resolver.
 *
 * Extracted from `/sign-in` (M187 spec 03) because a second screen now needs
 * the same answer. `/join` finishes a managed ceremony by redeeming the
 * gateway half and then has to land the person somewhere — the diary if this
 * account already holds one, the questionnaire if it does not — which is the
 * identical question `/sign-in` asks after its first pull. Two readers would
 * be two chances to read a different set of facts.
 *
 * The pure decision stays in `onboarding-gate.ts` and `sign-in-flow.ts`. This
 * module only performs the three reads, including `_personal.tsx`'s own
 * shortcut: the resolver returns before it looks at the log count once
 * onboarding is stamped, so the expensive listing is skipped there.
 */
import { getLocalProfileGoals, hasEverHadData, listLocalFoodLogs } from '#app/lib/local-store';
import { resolveOnboardingGate, type OnboardingGateOutcome } from '#app/lib/onboarding-gate';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { hasSyncBaselineEntities, isDeviceLocked } from '#app/lib/sync/sync-state';

/**
 * Reads the on-device store and returns the gate's verdict.
 *
 * @returns the outcome kind, ready for `resolveSignInDestination`.
 */
export async function readOnboardingGateKind(): Promise<OnboardingGateOutcome['kind']> {
  const profile = await getLocalProfileGoals();
  const hasProfile = profile !== null;
  const hasCompletedOnboarding = profile?.onboardingCompletedAt != null;
  const logCount = hasProfile && hasCompletedOnboarding ? 0 : (await listLocalFoodLogs()).length;
  // The SNAPSHOT, not the vault. Both callers of this function have just
  // finished signing in, so the session is open and settled and neither of the
  // two session branches can fire for them; reading it anyway is what keeps
  // this the single reader (M192/06 fix).
  const session = getSyncSessionSnapshot();
  return resolveOnboardingGate({
    hasProfile,
    hasCompletedOnboarding,
    logCount,
    hasEverHadData: await hasEverHadData(),
    // The baseline is keyed BY ACCOUNT, so there is nothing to read without a
    // session, and a device with no session cannot be told apart from a new
    // one by this input anyway. `false` there is the honest answer, not a
    // default (M224).
    hasSyncBaseline: session.account !== null && hasSyncBaselineEntities({ accountId: session.account.id }),
    hasSyncAccount: session.account !== null,
    isResumingSession: session.isResuming,
    // Both callers have just signed in, and opening a session lifts the lock
    // (`openSyncSession`), so this is `false` for them. Read anyway, because
    // this is the single reader and a gate input it silently defaulted would
    // be the one place the two readers could disagree.
    isDeviceLocked: isDeviceLocked(),
    // NOT the path this runs on. Both callers ask a different question from
    // the layout's: not "which chrome does this page wear" but "where does
    // this person go now that they are signed in", and that question is the
    // gated order for every one of them (M204 spec 09).
    isExemptPath: false,
  }).kind;
}
