/**
 * WHICH CHROME THE `_personal` LAYOUT DRAWS, as a pure decision (M204 spec 09).
 *
 * ── Why it left the layout ───────────────────────────────────────────────
 *
 * The first version of this mapping was two conditions inline in
 * `_personal.tsx`, and it shipped a defect a browser walk found: on a cold
 * load of `/settings/preferences` a stranger saw the full sidebar and the
 * device chip for about 240 ms before the public chrome replaced them. The
 * cause was not the missing branch it looked like. `getSyncSessionSnapshot()`
 * reports `isResuming` on EVERY cold boot, because `SyncController` is
 * rendered by that layout and has not mounted when the loader runs, so the
 * first answer for everybody is `wait`, and `wait` was drawn as the app shell
 * around a loading logo. The exempt kind arrived only on the revalidation.
 *
 * So `wait` is a third answer here, not a variant of the app shell, and the
 * mapping is a function with a test rather than a condition inside a component
 * that no test could reach.
 */
import type { OnboardingGateOutcome } from '#app/lib/onboarding-gate';

/** The three chromes the layout can draw. */
export type PersonalShell =
  /** The tracker: sidebar, header with the device chip, back arrow. */
  | 'app'
  /** The public chrome, for a visitor with no diary on a gate-exempt page. */
  | 'public'
  /**
   * NEITHER, YET: the loading screen on its own.
   *
   * The loader has not decided who this is, and on an exempt path both shells
   * are a claim it cannot support. Drawing the app shell says "you are inside
   * the app" to somebody who may be a stranger; drawing the public one says
   * "you are not signed in" to somebody whose session is one tick from
   * reopening. The loading screen says only that the answer is coming.
   */
  | 'loading';

/** Everything the mapping reads. */
export interface PersonalShellInput {
  /** What `resolveOnboardingGate` answered for this request. */
  gateKind: OnboardingGateOutcome['kind'];
  /** Was the request on a `GATE_EXEMPT_PATHS` route? The same fact the gate used. */
  isExemptPath: boolean;
  /** `getInstancePolicy(...).strangerSeesThePublicShell` for this instance. */
  strangerSeesThePublicShell: boolean;
}

/**
 * The chrome for one gate answer, in a fixed order.
 *
 * 1. **`exempt` plus the policy is the public chrome.** This is the visitor
 *    the whole change is about.
 * 2. **`wait` on an exempt path, plus the policy, is the loading screen.** The
 *    cold-boot snapshot makes this the FIRST answer a stranger gets, so it is
 *    the one that decides whether a sidebar flashes.
 * 3. **Everything else is the app.** That includes `wait` on a guarded route,
 *    which is a device with a diary reopening its session, and every kind on
 *    an OPEN instance, where nothing about this changes: the policy answers
 *    `false` there and both branches above fall through.
 *
 * @param input - the gate answer, the path fact and the instance policy.
 * @returns which chrome to draw.
 */
export function shellForGate({
  gateKind,
  isExemptPath,
  strangerSeesThePublicShell,
}: PersonalShellInput): PersonalShell {
  if (!strangerSeesThePublicShell) return 'app';
  if (gateKind === 'exempt') return 'public';
  if (gateKind === 'wait' && isExemptPath) return 'loading';
  return 'app';
}
