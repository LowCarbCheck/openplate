/**
 * How long the sign-out dialog waits for the device read before it stops
 * waiting.
 *
 * ── The defect this exists for ───────────────────────────────────────────
 *
 * The dialog counts what an erase would lose by reading the diary under the
 * sync orchestrator's Web Lock (`readUnsentOnDevice`). That lock is shared by
 * every tab of the device, and another tab's hung sync cycle can hold it for
 * good. The read then never settles, the notice stays on "checking", and the
 * erase box, which waits for an answer, stays disabled for as long as the
 * dialog is open: a person could sign out but could not even choose to erase.
 *
 * ── What a missed deadline means ─────────────────────────────────────────
 *
 * That the device COULD NOT BE CHECKED, the same line a read that threw gets.
 * It is the allowed direction: the dialog may over-warn, and it must never give
 * the all-clear for a device nobody looked at. A read that answers after the
 * deadline still wins, because a real answer beats the absence of one.
 *
 * The deadline runs from the moment the dialog opens and not from the moment a
 * read starts, because the read can be held back for the same reason it can
 * hang: the dialog does not read while this tab's own cycle is running, and a
 * cycle waiting on the same lock would hold it back for good.
 *
 * Both halves are small and pure so a unit test can drive them with a deadline
 * of a few milliseconds (`tests/unit/unsent-read-deadline.test.ts`).
 */
import type { UnsentRead } from './erase-notice';

/** Five seconds: far longer than a read of the local diary takes, short enough that nobody waits it out blind. */
export const UNSENT_READ_DEADLINE_MS = 5_000;

/** Runs a callback after a delay and returns the way to cancel it. A test passes a fake. */
export type ScheduleDeadline = (callback: () => void, ms: number) => () => void;

const scheduleWithTimeout: ScheduleDeadline = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

/**
 * Calls `onElapsed` once, `deadlineMs` from now, unless the returned function
 * is called first.
 *
 * @returns the cancel function, shaped to be an effect's cleanup.
 */
export function startUnsentReadDeadline({
  deadlineMs,
  onElapsed,
  schedule = scheduleWithTimeout,
}: {
  deadlineMs: number;
  onElapsed: () => void;
  schedule?: ScheduleDeadline;
}): () => void {
  return schedule(onElapsed, deadlineMs);
}

/**
 * What the dialog treats the read as, once the deadline may have passed.
 *
 * Only a read that has not answered is changed: a finished read and a failed
 * one stand as they are, before the deadline and after it.
 */
export function applyUnsentReadDeadline({
  read,
  hasDeadlinePassed,
}: {
  read: UnsentRead;
  hasDeadlinePassed: boolean;
}): UnsentRead {
  if (read.status === 'pending' && hasDeadlinePassed) return { status: 'failed' };
  return read;
}
