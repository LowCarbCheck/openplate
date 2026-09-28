/**
 * The trial recap's count, read from this device's diary (M250/05).
 *
 * The rules are `trial-recap.ts`'s; this hook only reads the food logs when
 * there is a window to count in, and says when it has an answer, so a screen
 * can hold its layout until the line is known rather than drawing without it
 * and pushing everything down when it arrives (DESIGN.md section 7).
 */
import { useEffect, useState } from 'react';

import { listLocalFoodLogs } from '#app/lib/local-store';
import type { PlanStanding } from '#app/lib/plans/plan-standing';
import { countTrialAiMeals, trialRecapWindow } from '#app/lib/plans/trial-recap';

/**
 * Where the count is. `mealCount` is `null` when there is nothing to say: no
 * window, a disabled read, or a read that failed. Zero is a count, and the
 * screen draws no line for it.
 */
export type TrialRecapRead = { settled: false } | { settled: true; mealCount: number | null };

/** The one answer for every case with nothing to count. */
const NOTHING_TO_SAY: TrialRecapRead = { settled: true, mealCount: null };

/** A counted window: which window, so a changed one is not answered by an old count. */
interface Counted {
  key: string;
  mealCount: number | null;
}

/**
 * @param input.standing - where the person stands.
 * @param input.accountCreatedAt - the session account's creation instant.
 * @param input.isEnabled - `false` reads nothing and answers "nothing to say",
 *   for a placement that would not draw the line anyway.
 */
export function useTrialRecap({
  standing,
  accountCreatedAt,
  isEnabled,
}: {
  standing: PlanStanding;
  accountCreatedAt: string | null | undefined;
  isEnabled: boolean;
}): TrialRecapRead {
  const trialWindow = isEnabled ? trialRecapWindow({ standing, accountCreatedAt }) : null;
  // The window as two numbers, so the read runs again when the window
  // changes and not on every render that rebuilds the same object.
  const startsAtMs = trialWindow?.startsAtMs ?? null;
  const endsAtMs = trialWindow?.endsAtMs ?? null;
  const key = trialWindow === null ? null : `${trialWindow.startsAtMs}-${trialWindow.endsAtMs}`;
  const [counted, setCounted] = useState<Counted | null>(null);

  useEffect(() => {
    if (startsAtMs === null || endsAtMs === null) return;
    const countedKey = `${startsAtMs}-${endsAtMs}`;
    let isMounted = true;
    const read = async (): Promise<void> => {
      try {
        const logs = await listLocalFoodLogs();
        const mealCount = countTrialAiMeals({ logs, window: { startsAtMs, endsAtMs } });
        if (isMounted) setCounted({ key: countedKey, mealCount });
      } catch {
        // A diary that cannot be read says nothing, and the page goes on.
        if (isMounted) setCounted({ key: countedKey, mealCount: null });
      }
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [startsAtMs, endsAtMs]);

  if (trialWindow === null) return NOTHING_TO_SAY;
  if (counted === null || counted.key !== key) return { settled: false };
  return { settled: true, mealCount: counted.mealCount };
}
