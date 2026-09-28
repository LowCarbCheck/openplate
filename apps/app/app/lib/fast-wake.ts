/**
 * Keeping the server's one-shot "your fast reached its target" in step with
 * the fast that is actually running (M240 counsel item 1).
 *
 * ── The two faults this closes, and both arrived with sync ───────────────
 *
 * `wake_at` is a SERVER-SIDE ONE SHOT held against THIS device's push
 * subscription (`push.ts`), and until M240/01 a fast could only be written by
 * the device that was looking at `/fasting`, so re-arming it from that
 * screen's own actions was complete. Fasts sync now, and two things broke at
 * once:
 *
 *  1. A fast STARTED on another device never armed the alert here, so the
 *     device the person is holding says nothing when their fast finishes.
 *  2. Worse, a fast ENDED or REMOVED on another device left this device's
 *     armed instant in place, so this device buzzes "target reached" for a
 *     fast that is over. A notification about something that did not happen is
 *     the kind of wrong that teaches people to switch notifications off.
 *
 * ── The rule, in one line ────────────────────────────────────────────────
 *
 * The wake instant is a function of the CURRENT fast, and the current fast is
 * a function of the list. So after anything that can change the list, work out
 * what instant the list implies and tell the server, ARMING when there is one
 * and CLEARING when there is not. `setFastWakeAt(null)` is the clear, and it
 * is the half that was missing.
 *
 * ── Why the comparison, and not just "always send" ───────────────────────
 *
 * {@link resolveFastWakeChange} compares the instant the list implied BEFORE
 * against the one it implies AFTER, and reports no change when they match.
 * Every sync cycle that pulls anything would otherwise patch the subscription,
 * which is a network request per cycle on every device, for a value that
 * almost never moves. Comparing the INSTANT rather than the list is what makes
 * that safe: a fast whose mood or note changed implies the same instant and is
 * correctly silent, while a fast that ended implies `null` and is not.
 *
 * `reconcileFastWakeAtAfterMerge` is the merge's caller and
 * `reconcileFastWakeAtOnBoot` is the launch's. Neither lives in the fasting
 * screen, on purpose: the screen is one of several writers now, and a rule
 * that lives in one writer is a rule the other writers do not have.
 */
import type { LocalFast } from '#app/lib/local-store/schema';
import { listLocalFasts } from '#app/lib/local-store';
import { selectCurrentFast } from '#app/models/fasting';
import { fastWakeAtIso, setFastWakeAt } from '#app/lib/push';

/**
 * The instant a fast list implies, or `null` when nothing open has a target.
 *
 * COMPOSED FROM THE TWO FUNCTIONS THAT ALREADY OWN THE QUESTION, deliberately:
 * `selectCurrentFast` decides which of several open fasts is the running one
 * (the latest effective start, see its own doc for the two open rows a restore
 * or a sync can leave), and `fastWakeAtIso` decides when that one reaches its
 * target. Re-deriving either here would let the screen and the notification
 * disagree about which fast the person is running.
 */
export function fastWakeAtFor(fasts: readonly LocalFast[]): string | null {
  return fastWakeAtIso(selectCurrentFast(fasts));
}

/** Whether the wake instant moved, and what it is now. */
export interface FastWakeChange {
  /** Did the instant the list implies actually move? `false` means send nothing. */
  hasChanged: boolean;
  /** The instant to arm, or `null` to clear. Read only when {@link FastWakeChange.hasChanged}. */
  wakeAt: string | null;
}

/**
 * What one change to the fast list means for the armed alert.
 *
 * PURE, and the whole decision is here so it can be driven from a test with no
 * browser, no push registration and no server: the three cases that matter are
 * a fast ended elsewhere (clear), a fast started elsewhere (arm) and a list
 * that did not move the instant (send nothing).
 *
 * @param before - the fasts this device held before the change.
 * @param after - the fasts it holds now.
 */
export function resolveFastWakeChange({
  before,
  after,
}: {
  before: readonly LocalFast[];
  after: readonly LocalFast[];
}): FastWakeChange {
  const wakeAt = fastWakeAtFor(after);
  return { hasChanged: fastWakeAtFor(before) !== wakeAt, wakeAt };
}

/**
 * Re-arms or clears the alert after a sync merge changed this device's fasts.
 *
 * NEVER THROWS AND IS NEVER AWAITED FOR ITS RESULT by the cycle: `setFastWakeAt`
 * already swallows its own failures, and a sync must not fail because a
 * notification could not be re-armed.
 *
 * @param before - the fasts the device held when the cycle read its snapshot.
 * @param after - the fasts the merge decided on.
 */
export async function reconcileFastWakeAtAfterMerge({
  before,
  after,
}: {
  before: readonly LocalFast[];
  after: readonly LocalFast[];
}): Promise<void> {
  const change = resolveFastWakeChange({ before, after });
  if (!change.hasChanged) return;
  await setFastWakeAt(change.wakeAt);
}

/**
 * Re-arms or clears the alert once, at launch.
 *
 * UNCONDITIONAL, unlike the merge path above, and it has to be: this device
 * may have been closed while another one ended the fast, so there is no
 * "before" to compare against and the armed instant on the server may be
 * anything at all. Asserting the current answer once per launch is cheap and
 * is the only thing that repairs a device that was offline for the cycle that
 * mattered.
 */
export async function reconcileFastWakeAtOnBoot(): Promise<void> {
  await setFastWakeAt(fastWakeAtFor(await listLocalFasts()));
}
