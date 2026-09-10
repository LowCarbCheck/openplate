/**
 * Overview's copy of the 13-week goal-adherence grid, headed by the streak.
 *
 * The grid lived only on `/trends` until the owner ruled on 2026-09-10 that it
 * belongs on the app home too (see `app/routes/dashboard.tsx`'s header for the
 * decision and what it overruled). This is the same `AdherenceGrid` and the
 * same `AdherenceLegend` `/trends` draws, fed the same model, so the two
 * screens cannot show different squares for the same day.
 *
 * Two deliberate differences from `AdherenceGridCard`:
 *
 * 1. The whole card is ONE `Link` to `/trends`, matching the two glance tiles
 *    below it on this page. That rules out every nested anchor and every nested
 *    button, which costs two things. The trends card's "set a goal" call to
 *    action is not repeated here, because that copy needs a real button, and it
 *    still reads well on `/trends`. And the grid is drawn `interactive={false}`:
 *    on `/trends` each of its 91 cells is a `<button>` carrying a tooltip and
 *    the grid's roving tab stop, and a button inside an `<a>` is invalid HTML.
 *    The read-only cells keep the same paint and the same per-cell
 *    `aria-label`, so a screen reader loses nothing; a tap goes to `/trends`,
 *    where the interactive grid lives.
 * 2. The header is the streak sentence rather than the grid's own title. The
 *    streak is the glanceable fact; the grid underneath is the evidence for it.
 *
 * Plain `bg-card`: this page spends its one `.surface-brand` hero on the today
 * card (DESIGN.md §2).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';

import { Link } from '#app/components/link';
import { AdherenceGrid } from '#app/components/trends/adherence-grid';
import { AdherenceLegend } from '#app/components/trends/adherence-legend';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { describeStreak } from '#app/lib/streak-message';
import type { StreakSnapshot } from '#app/lib/streak-message';
import type { AdherenceGoals, AdherenceGrid as AdherenceGridModel } from '#app/models/adherence-grid';

/**
 * The streak line plus the 13-week grid, as one door to `/trends`.
 *
 * @param grid - the resolved grid model, built by the route's client loader.
 * @param goals - the daily goals the grid graded each day against.
 * @param streak - the current streak and whether today itself carries any logs.
 */
export function StreakGridCard({
  grid,
  goals,
  streak,
}: {
  grid: AdherenceGridModel;
  goals: AdherenceGoals;
  streak: StreakSnapshot;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Link
      to="/trends"
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="h-5 w-5 text-primary" aria-hidden="true" /> {t('trends.streak.title')}
          </CardTitle>
          <CardDescription>{describeStreak(streak, t)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AdherenceGrid grid={grid} goals={goals} interactive={false} />
          <AdherenceLegend mode={grid.mode} hasUnratedDays={grid.hasUnratedDays} />
        </CardContent>
      </Card>
    </Link>
  );
}
