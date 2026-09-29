/**
 * Where a person lands after signing in, as a pure decision (M183 spec 03).
 *
 * Signing in is only half of getting back in. The profile row — including the
 * `onboardingCompletedAt` stamp that the gate reads — travels INSIDE the
 * encrypted sync snapshot, so until the first pull has finished this device
 * still looks exactly like a fresh install. Deciding the destination before
 * that pull is the "returning user meets the questionnaire" bug the whole
 * milestone exists to kill, which is why the order below is pull first, ask
 * the gate second.
 *
 * Both halves live here rather than in the route so they can be tested without
 * a browser, a router or IndexedDB.
 */
import type { OnboardingGateOutcome } from '#app/lib/onboarding-gate';
import type { PlanKey } from '#app/lib/sync/engine/client/plans-wire';
import { isConsentRequiredRefusal } from '#app/lib/health-consent/health-consent';

/** Every path a finished sign-in can send somebody to. */
export type SignInDestination = '/diary' | '/onboarding' | '/recover';

/**
 * The order page, with the plan the person chose named in its query, the one
 * way that page takes a pick it did not make itself (`readPlanParam`).
 */
export type PlanOrderDestination = `/settings/plan?plan=${PlanKey}`;

/** Every path a finished `/join` can send somebody to. */
export type JoinDestination = SignInDestination | PlanOrderDestination;

/**
 * Turns the gate's verdict, plus one fact about this device, into a path.
 *
 * The order is load-bearing:
 *
 * 1. **`recover` wins outright.** A device whose tables were wiped while its
 *    `firstDataAt` marker survived is a possible data loss, and that question
 *    outranks the diary.
 * 2. **`pass` and `self-heal` mean there is a diary.** `self-heal` is stamped
 *    by the `_personal` gate on arrival, so `/diary` is the right door for it
 *    too — that layout runs the stamp and then lets the request through.
 * 3. **Otherwise the questionnaire.** The pull happened and brought back no
 *    onboarded profile, so this really is somebody's first diary.
 *
 * WHAT USED TO SIT BETWEEN 1 AND 2: a parked GATEWAY half sent the person back
 * to `/join`, because one link carried two capabilities and signing in spent
 * only one of them. M192 deleted the second capability — one link, one token,
 * one service — so there is no half left to strand and `/join` is no longer a
 * destination this function can reach.
 *
 * @returns the path to navigate to.
 */
export function resolveSignInDestination({ gate }: { gate: OnboardingGateOutcome['kind'] }): SignInDestination {
  if (gate === 'recover') return '/recover';
  if (gate === 'pass' || gate === 'self-heal') return '/diary';
  return '/onboarding';
}

/**
 * Where a finished `/join` lands (2026-09-28).
 *
 * Exactly where a finished sign-in lands, with one door in front: somebody
 * who chose a plan on the pricing page before they had an account goes to the
 * order page with that plan picked, because paying for it is what they came
 * to do. The onboarding gate exempts the plan page (the paywall change of
 * 2026-09-28 adds it to `GATE_EXEMPT_PATHS`), so a brand-new account reaches
 * it before the questionnaire, and nothing stands between the chosen price and
 * Stripe. The questionnaire comes AFTER the payment (M265/03): the return
 * screen links to it, and the gate asks again on the first navigation out of
 * the plan page, so a buyer who leaves Stripe without paying meets it too.
 *
 * TWO THINGS OUTRANK THE PLAN:
 *
 * 1. **`recover`.** A device that may have lost a diary is asked about it
 *    first, for the reason {@link resolveSignInDestination} gives.
 * 2. **An instance that sells nothing.** `sellsPlans` is `hasPlansDoor` of the
 *    handshake. A choice made on one instance's pricing page and carried to
 *    another must not land somebody on a 404.
 *
 * @param input.intendedPlan - `readIntendedPlan()`, or `null`.
 * @param input.sellsPlans - whether this instance's handshake says it sells plans.
 */
export function resolveJoinDestination({
  gate,
  intendedPlan,
  sellsPlans,
}: {
  gate: OnboardingGateOutcome['kind'];
  intendedPlan: PlanKey | null;
  sellsPlans: boolean;
}): JoinDestination {
  if (gate === 'recover') return '/recover';
  if (intendedPlan !== null && sellsPlans) return `/settings/plan?plan=${intendedPlan}`;
  return resolveSignInDestination({ gate });
}

/** What a finished sign-in leaves the screen with: somewhere to go, or a pull to retry. */
export type SignInOutcome =
  | { status: 'navigate'; path: SignInDestination }
  /** The credential worked and the session is OPEN. Only the snapshot did not arrive. */
  | { status: 'pull-failed'; cause: unknown };

/**
 * Runs the first pull, then reads the destination — and reports a failed pull
 * rather than throwing it.
 *
 * The failure is a RESULT and not an exception because the caller's response to
 * it is not an error screen: the sign-in worked, the session stays open, and
 * the only thing on offer is repeating the pull. Never signing out and never
 * falling through to `/onboarding` is the point.
 *
 * ONE REFUSAL IS NOT A FAILED PULL: `403 health-consent-required` (2026-09-29).
 * openplate-core serves the account its own blob without the consent and
 * refuses only the push that follows, and the cycle lands the pulled copy
 * before that refusal leaves (`orchestrator.ts`, `pushOrHeal`). The store is
 * therefore the account's, the destination read from it is the right one, and
 * the consent gate on that page sends the person to the consent screen. A
 * retry screen here could never succeed: the pull already did.
 *
 * @param pull - one sync cycle; rejects when the snapshot did not arrive.
 * @param readDestination - reads the freshly pulled store and asks the gate.
 */
export async function completeSignIn({
  pull,
  readDestination,
}: {
  pull: () => Promise<void>;
  readDestination: () => Promise<SignInDestination>;
}): Promise<SignInOutcome> {
  try {
    await pull();
  } catch (cause) {
    if (!isConsentRequiredRefusal(cause)) return { status: 'pull-failed', cause };
  }
  return { status: 'navigate', path: await readDestination() };
}
