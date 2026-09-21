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
 *    Since M235/06 that streak is the ACTIVITY streak, the same number and the
 *    same walk `/trends` shows, and it is `null` for somebody who has switched
 *    the streak and the awards off, then the card falls back to the grid's own
 *    title and is simply the 13-week record, which is not a gamification
 *    surface and does not go away with them.
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
import type { AdherenceGoals, AdherenceGrid as AdherenceGridModel } from '#app/models/adherence-grid';

/**
 * The streak line plus the 13-week grid, as one door to `/trends`.
 *
 * @param grid - the resolved grid model, built by the route's client loader.
 * @param goals - the daily goals the grid graded each day against.
 * @param streak - the current activity streak, or null when these surfaces are hidden.
 */
export function StreakGridCard({
  grid,
  goals,
  streak,
}: {
  grid: AdherenceGridModel;
  goals: AdherenceGoals;
  streak: number | null;
}): ReactElement {
  const { t } = useTranslation();
  const isActivityMode = grid.mode === 'activity';

  return (
    <Link
      to="/trends?tab=goals"
      // The ring is drawn on this wrapper, so the wrapper takes the radius of
      // the card inside it. A focus ring one step off the corner it traces is
      // the tell that a radius moved and its wrapper did not.
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader>
          {streak === null ?
            <>
              <CardTitle>{t(isActivityMode ? 'trends.grid.titleActivity' : 'trends.grid.title')}</CardTitle>
              <CardDescription>
                {t(isActivityMode ? 'trends.grid.descriptionActivity' : 'trends.grid.description')}
              </CardDescription>
            </>
          : <>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> {t('trends.streak.title')}
              </CardTitle>
              <CardDescription>{describeStreak(streak, t)}</CardDescription>
            </>
          }
        </CardHeader>
        <CardContent className="space-y-3">
          <AdherenceGrid grid={grid} goals={goals} interactive={false} />
          <AdherenceLegend mode={grid.mode} hasUnratedDays={grid.hasUnratedDays} />
        </CardContent>
      </Card>
    </Link>
  );
}
