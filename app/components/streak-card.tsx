/**
 * The current-streak stat card.
 *
 * Lived on `/profile` until the settings restructure retired that page. The
 * streak is the one thing on the old profile that was about the PERSON rather
 * than about configuration, so it moved to Trends (where the rest of the
 * "how am I doing" story already lives) rather than into the settings hub.
 *
 * DESIGN.md §2 "one `.surface-brand` hero per screen": Trends already spends
 * its hero on `WeeklyRecapCard`, so this renders on an ordinary `bg-card`
 * surface — a second brand wash on that screen would be a bug.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';

import {
  computeStreak,
  getLocalDailyTotalsInRange,
  getLocalProfileGoals,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import { describeStreak, type StreakSnapshot } from '#app/lib/streak-message';
import { Card, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';

/** How far back to look for the current streak — generous enough that a real
 *  streak is never undercounted, without scanning the visitor's whole history. */
const STREAK_LOOKBACK_DAYS = 60;

/**
 * Reads local daily totals for the trailing window and reduces them to the current
 * streak length, plus whether today itself has any logs — `computeStreak` only
 * counts a day that's both logged AND at/under the net-carb goal, so `streak` can
 * legitimately land on `0` on a day that WAS logged (an over-goal day breaks the
 * streak by design). `todayHasLogs` lets `StreakCard` tell that apart from a
 * genuinely empty day — see `#app/lib/streak-message`'s doc comment for the bug
 * this fixes. `dailyTotals` is oldest-first and always ends at `today` (see
 * `computeDailyTotalsInRange`), so its last entry is today's totals.
 */
function useCurrentStreak(): StreakSnapshot | null {
  const [snapshot, setSnapshot] = useState<StreakSnapshot | null>(null);

  useEffect(() => {
    let isCancelled = false;
    async function loadStreak(): Promise<void> {
      const profile = await getLocalProfileGoals();
      const timezone = resolveLocalTimezone(profile);
      const today = todayInTimezone(timezone);
      const dailyTotals = await getLocalDailyTotalsInRange({
        fromDate: shiftDate(today, -STREAK_LOOKBACK_DAYS),
        toDate: today,
      });
      const streak = computeStreak(dailyTotals, { netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null });
      const todayHasLogs = dailyTotals[dailyTotals.length - 1]?.hasLogs ?? false;
      if (!isCancelled) setSnapshot({ streak, todayHasLogs });
    }
    void loadStreak();
    return () => {
      isCancelled = true;
    };
  }, []);

  return snapshot;
}

/** Current-streak stat. Renders nothing until the first read resolves, to avoid a "0" flash. */
export function StreakCard() {
  const { t } = useTranslation();
  const snapshot = useCurrentStreak();
  if (snapshot === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" aria-hidden="true" /> {t('trends.streak.title')}
        </CardTitle>
        <CardDescription>{describeStreak(snapshot, t)}</CardDescription>
      </CardHeader>
    </Card>
  );
}
