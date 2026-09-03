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

/** Every path a finished sign-in can send somebody to. */
export type SignInDestination = '/diary' | '/onboarding' | '/recover' | '/join';

/**
 * Turns the gate's verdict, plus one fact about this device, into a path.
 *
 * The order is load-bearing:
 *
 * 1. **`recover` wins outright.** A device whose tables were wiped while its
 *    `firstDataAt` marker survived is a possible data loss, and that question
 *    outranks both the diary and a half-finished invite. The gateway half is
 *    parked in `sessionStorage` and `/settings/sync` still links to it, so
 *    nothing is destroyed by postponing it.
 * 2. **A parked gateway half returns to `/join`.** The person followed one
 *    link carrying two capabilities and spent only the sync half by signing in
 *    to the account they already had. Sending them to the diary here drops the
 *    other half on the floor with no way back to it (owner decision, recorded
 *    in worklog thread `01M1KMSJXNVZFV1JFYVV`).
 * 3. **`pass` and `self-heal` mean there is a diary.** `self-heal` is stamped
 *    by the `_personal` gate on arrival, so `/diary` is the right door for it
 *    too — that layout runs the stamp and then lets the request through.
 * 4. **Otherwise the questionnaire.** The pull happened and brought back no
 *    onboarded profile, so this really is somebody's first diary.
 *
 * @returns the path to navigate to.
 */
export function resolveSignInDestination({
  gate,
  hasPendingGatewayJoin,
}: {
  gate: OnboardingGateOutcome['kind'];
  hasPendingGatewayJoin: boolean;
}): SignInDestination {
  if (gate === 'recover') return '/recover';
  if (hasPendingGatewayJoin) return '/join';
  if (gate === 'pass' || gate === 'self-heal') return '/diary';
  return '/onboarding';
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
    return { status: 'pull-failed', cause };
  }
  return { status: 'navigate', path: await readDestination() };
}
