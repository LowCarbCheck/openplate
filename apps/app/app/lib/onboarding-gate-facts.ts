/**
 * What the `_personal` onboarding gate found on its last run, for the one
 * reader that cannot ask it: the layout's `shouldRevalidate` (M265/03).
 *
 * `shouldRevalidate` answers synchronously, and the gate's inputs are
 * IndexedDB reads. So the layout's loader leaves one fact here on every run,
 * whether the gated order has let this device through, and `shouldRevalidate`
 * reads it to decide whether a plain navigation runs the loader again. The
 * rule itself is pure and lives in `onboarding-gate.ts`, beside the gate.
 *
 * A MODULE OF ITS OWN, not a variable in the route file. The build emits the
 * layout's `clientLoader` as a chunk of its own (`_personal-client-loader-*`)
 * and `shouldRevalidate` in the main one, so a module level `let` in the route
 * would be two variables, one per chunk, and the writer and the reader would
 * never meet.
 *
 * `false` BEFORE THE FIRST RUN, and that costs nothing: `shouldRevalidate` is
 * only asked about a layout that is already mounted, so a loader run has
 * always written this first.
 */
import { hasPassedOnboardingGate, shouldAskOnboardingGate, type OnboardingGateInput } from '#app/lib/onboarding-gate';

/** The last run's {@link hasPassedOnboardingGate}. */
let hasPassedAtLastRun = false;

/**
 * Records what one run of the layout's loader read. Called on EVERY run, so a
 * sign-out, an erase or a sync pull that changes the answer is recorded by the
 * very run that sees it.
 *
 * @param input - the input the loader handed `resolveOnboardingGate`.
 */
export function noteOnboardingGateRun(input: OnboardingGateInput): void {
  hasPassedAtLastRun = hasPassedOnboardingGate(input);
}

/**
 * Must a plain navigation to this path run the layout's loader, so the
 * onboarding gate is asked again? For `shouldRevalidate`.
 *
 * @param input.pathname - where the navigation goes.
 */
export function shouldAskOnboardingGateAt({ pathname }: { pathname: string }): boolean {
  return shouldAskOnboardingGate({ pathname, hasPassed: hasPassedAtLastRun });
}
