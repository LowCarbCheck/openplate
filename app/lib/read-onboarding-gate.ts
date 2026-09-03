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
  return resolveOnboardingGate({
    hasProfile,
    hasCompletedOnboarding,
    logCount,
    hasEverHadData: await hasEverHadData(),
  }).kind;
}
