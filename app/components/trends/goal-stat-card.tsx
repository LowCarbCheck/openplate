/**
 * One goal's card on the Goals tab (M239/05): how often it was met, by how
 * much the days usually sat under or over it, and, when the person has not
 * switched gamification off, the current and the longest run of met days.
 * Presentational only; every number comes from `computeGoalStats`.
 *
 * NEUTRAL ON PURPOSE (DESIGN.md section 10.1). The bar is the brand token on a
 * muted track, never a warning colour, and the copy says "met" and "under" or
 * "over", never "failed". A day over a ceiling is a fact about that day, not a
 * grade of the person.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { formatMeasureIn } from '#app/lib/format-macro-number';
import type { GoalStat } from '#app/lib/goal-stats';
import type { Translate } from '#app/lib/adherence-message';
import type { AdherenceGoalKey } from '#app/models/adherence-grid';

/** The card title per goal: the metric names the chart already uses. */
const GOAL_TITLE_KEY = {
  netCarbs: 'trends.metric.netCarbs',
  protein: 'trends.metric.protein',
  kcal: 'trends.metric.calories',
} as const satisfies Record<AdherenceGoalKey, string>;

/** The unit each goal is measured in. */
const GOAL_UNIT = {
  netCarbs: 'g',
  protein: 'g',
  kcal: 'kcal',
} as const satisfies Record<AdherenceGoalKey, string>;

/** Whole percent for the bar width. */
const PERCENT = 100;

/**
 * The average-distance sentence. Rounded to a whole gram or kcal first, so a
 * mean of 0.4 g reads "right at your goal" rather than "0 g over".
 */
function distanceSentence({
  stat,
  language,
  t,
}: {
  stat: GoalStat;
  language: string;
  t: Translate;
}): string | null {
  if (stat.averageDifference === null) return null;
  const rounded = Math.round(stat.averageDifference);
  if (rounded === 0) return t('trends.goals.distance.at');
  const amount = formatMeasureIn(language, Math.abs(rounded), GOAL_UNIT[stat.key]);
  return rounded < 0 ? t('trends.goals.distance.under', { amount }) : t('trends.goals.distance.over', { amount });
}

/** The run line: the current run when there is one, then the longest. */
function RunLine({ stat }: { stat: GoalStat }): ReactElement {
  const { t } = useTranslation();
  const hasAnyRun = stat.bestRun > 0;
  return (
    <p data-slot="goal-run" className="text-xs text-pretty text-muted-foreground tabular-nums">
      {stat.currentRun > 0 && <span>{t('trends.goals.run.current', { count: stat.currentRun })} </span>}
      {hasAnyRun ? t('trends.goals.run.best', { count: stat.bestRun }) : t('trends.goals.run.none')}
    </p>
  );
}

/**
 * @param stat - the goal's record over the complete days of the window.
 * @param showRuns - false when gamification is hidden; the run line is then not rendered at all.
 */
export function GoalStatCard({ stat, showRuns }: { stat: GoalStat; showRuns: boolean }): ReactElement {
  const { t, i18n } = useTranslation();
  const goal = formatMeasureIn(i18n.language, stat.goal, GOAL_UNIT[stat.key]);
  const distance = distanceSentence({ stat, language: i18n.language, t });

  return (
    <Card data-slot="goal-stat-card" data-goal={stat.key} data-direction={stat.direction}>
      <CardHeader>
        <CardTitle>{t(GOAL_TITLE_KEY[stat.key])}</CardTitle>
        <CardDescription>
          {stat.direction === 'max' ? t('trends.goals.goalMax', { goal }) : t('trends.goals.goalMin', { goal })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {stat.hitRate === null ?
          <p className="text-sm text-muted-foreground">{t('trends.goals.noRatedDays')}</p>
        : <>
            <p data-slot="goal-hit-rate" className="text-sm font-medium text-foreground tabular-nums">
              {t('trends.goals.hitRate', { met: stat.metDays, rated: stat.ratedDays })}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div data-slot="goal-hit-bar" className="h-full rounded-full bg-primary" style={{ width: `${Math.round(stat.hitRate * PERCENT)}%` }} />
            </div>
          </>
        }
        {distance !== null && <p className="text-sm text-muted-foreground tabular-nums">{distance}</p>}
        {stat.unknownDays > 0 && (
          <p className="text-xs text-muted-foreground">{t('trends.goals.unknownDays', { count: stat.unknownDays })}</p>
        )}
        {showRuns && stat.ratedDays > 0 && <RunLine stat={stat} />}
      </CardContent>
    </Card>
  );
}
