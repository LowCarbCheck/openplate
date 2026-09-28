/**
 * The Goals tab (M239/05), phone first: the headline, one card per goal that
 * is set, the fasting card, the 13-week grid, and the honesty line. With no
 * goal set there is nothing to measure, so the headline, the goal cards and
 * the honesty line give way to one invitation to `/settings/nutrition`, and
 * no empty tiles. The fasting card and the grid stay: each fast carries its
 * own target, and the grid then records the days logged, both real records
 * that need no daily goal.
 *
 * THE HEADLINE is the grid's own summary sentence with the grid's own counts,
 * so the top of the tab and the grid's caption can never disagree.
 *
 * THE RUNS read the gamification switch through `isGamificationHidden`, the
 * one predicate the streak card and the awards screen also use. When it is
 * hidden the run lines are not rendered at all, not merely styled away, the
 * same contract `ActivityStreakCard` keeps.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { AdherenceGridCard } from '#app/components/trends/adherence-grid-card';
import { GoalFastingCard } from '#app/components/trends/goal-fasting-card';
import { GoalStatCard } from '#app/components/trends/goal-stat-card';
import { Button } from '#app/components/ui/button';
import { Card, CardContent } from '#app/components/ui/card';
import { isGamificationHidden } from '#app/lib/gamification/surfaces';
import { WIDE_CLASS } from '#app/components/trends/insights-grid';
import type { GamificationVisibility } from '#app/lib/gamification/surfaces';
import { computeGoalStats } from '#app/lib/goal-stats';
import { cn } from '#app/lib/utils';
import type { AdherenceGoals, AdherenceGrid } from '#app/models/adherence-grid';
import type { FastTargetShare } from '#app/models/fasting-stats';

/** The one card shown instead of empty tiles when no daily goal is set. */
function GoalInviteCard(): ReactElement {
  const { t } = useTranslation();
  return (
    <Card data-slot="goals-invite">
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm text-foreground">{t('trends.goals.invite')}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/settings/nutrition">{t('trends.grid.noGoalsCta')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * @param grid - the resolved 13-week adherence grid.
 * @param goals - the goals that grid was graded against.
 * @param visibility - the profile's gamification switch, or null when there is no profile row yet.
 * @param fastTargets - how many fasts in the window finished, and how many reached their target.
 */
export function GoalTabContent({
  grid,
  goals,
  visibility,
  fastTargets,
}: {
  grid: AdherenceGrid;
  goals: AdherenceGoals;
  visibility: GamificationVisibility | null;
  fastTargets: FastTargetShare;
}): ReactElement {
  const { t } = useTranslation();
  const stats = computeGoalStats({ grid, goals });
  const showRuns = !isGamificationHidden(visibility);

  if (stats.length === 0) {
    return (
      <>
        <div className="space-y-6">
          <GoalInviteCard />
          <GoalFastingCard share={fastTargets} />
        </div>
        <AdherenceGridCard grid={grid} goals={goals} />
      </>
    );
  }

  return (
    <>
      {/* Two columns from 48rem of room: the per-goal records and the fasting
          card on the left, the 13-week grid on the right. The grid's cells are
          squares that fill their card, so it stays at one column's width and
          does not stretch to a 1100 px slab of 80 px squares. */}
      {/* No headline sentence here: `AdherenceGridCard` below already prints
          the same one under its grid, and it was being read twice. */}
      <div className="space-y-6">
        <div className="space-y-3">
          {stats.map((stat) => (
            <GoalStatCard key={stat.key} stat={stat} showRuns={showRuns} />
          ))}
        </div>
        <GoalFastingCard share={fastTargets} />
      </div>
      <AdherenceGridCard grid={grid} goals={goals} />
      <p data-slot="goals-honesty" className={cn('text-xs text-muted-foreground', WIDE_CLASS)}>
        {t('trends.goals.honesty')}
      </p>
    </>
  );
}
