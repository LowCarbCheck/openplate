/**
 * The instance-wide pulse, read AFTER first paint and never before it.
 *
 * No loader anywhere in the app awaits this (M222 spec 04 greps for that), and
 * this hook is why it does not have to: it returns `null` on the first render,
 * fires one fetch in an effect and re-renders when an answer arrives. Both
 * surfaces render nothing for `null`, so the page a person sees at 0 ms is the
 * page they would have seen without the pulse at all.
 *
 * ── The read waits for the session, it does not race it ──────────────────
 *
 * A reload does not have a session yet. `SyncController` resumes one from the
 * device cache a moment after hydration, and until it has, `getSyncVault()` is
 * null and a read would answer null without making a request. This hook
 * therefore watches the session snapshot and keys its effect on
 * `pulseReadKey`, which changes when the account arrives. Keying on `enabled`
 * alone was the 0.28 defect: the tile and the fasting line never fetched at
 * all, and only the header chip worked, because its `enabled` happens to flip
 * after the resume.
 *
 * The five minute cache, the "a signed out device never fetches" rule and the
 * toggle are `fetchPulseToday`'s, not this file's: two hooks mounted on one
 * page make two calls and one request.
 */
import { useEffect, useState } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import {
  isPulseSettled,
  pulseReadKey,
  startPulseRead,
  PULSE_SETTLE_DEADLINE_MS,
  type PulseToday,
} from '#app/lib/pulse';

/** What {@link usePulseRead} reports. */
export interface PulseRead {
  /** The last read, or null when it has not arrived, failed, or this device has no account. */
  today: PulseToday | null;
  /**
   * True once the tile's fate is known: its figures are in, or it will not
   * come. Something drawn under the tile waits for this, so the tile cannot
   * arrive beneath it and push it down. See {@link isPulseSettled}.
   */
  isSettled: boolean;
}

/**
 * Today's instance-wide figures, and whether they are settled.
 *
 * `enabled` exists because one caller, the header's fasting chip, must ask
 * nothing at all when no fast is open: that is most of the app's life, on every
 * route, and a read the surface could not render is a request nobody asked for.
 * It is an option rather than a conditional hook call, because a hook that is
 * sometimes called is not a hook.
 *
 * @param enabled - false to hold the fetch back entirely; the hook then always answers null.
 * @returns the last read, and whether the first one has finished (or the wait ran out).
 */
export function usePulseRead({ enabled = true }: { enabled?: boolean } = {}): PulseRead {
  const session = useSyncSession();
  const [today, setToday] = useState<PulseToday | null>(null);
  // Both are KEYS and not booleans, so a new account starts unsettled without a reset effect.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [overdueKey, setOverdueKey] = useState<string | null>(null);
  const key = pulseReadKey({ enabled, accountId: session.account?.id ?? null });

  useEffect(() => {
    // Signing out, or a caller that no longer wants a read, takes the figures
    // away with it. Nothing else does: see `startPulseRead`.
    if (key === null) {
      setToday(null);
      return;
    }
    const deadline = setTimeout(() => setOverdueKey(key), PULSE_SETTLE_DEADLINE_MS);
    const stop = startPulseRead({ onValue: setToday, onFirstRead: () => setSettledKey(key) });
    return () => {
      clearTimeout(deadline);
      stop();
    };
  }, [key]);

  const isSettled = isPulseSettled({
    isResuming: session.isResuming,
    readKey: key,
    settledKey,
    isOverdue: overdueKey === key,
  });
  return { today, isSettled };
}

/**
 * Today's instance-wide figures, or `null` until (and unless) there are any.
 *
 * For a surface that only draws the figures. One that sits under the tile and
 * must not be pushed by it asks {@link usePulseRead} instead.
 *
 * @param enabled - false to hold the fetch back entirely; the hook then always answers null.
 * @returns the last read, or null when it has not arrived, failed, or this device has no account.
 */
export function usePulseToday({ enabled = true }: { enabled?: boolean } = {}): PulseToday | null {
  return usePulseRead({ enabled }).today;
}
