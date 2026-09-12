/**
 * The four practice-level figures above the history list: how many fasts are
 * finished, the longest one, the day streak and the hours in the last seven
 * days. Every number comes from `selectFastingStats`; this file only lays them
 * out.
 *
 * THE STREAK IS THE ONLY CONDITIONAL FIGURE. Zero completed fasts and zero
 * hours are facts about a new device and read as an empty row waiting to fill.
 * A "0 day streak" is different: it is the app telling somebody they are on
 * nothing, which is exactly the grading DESIGN.md section 10.1 forbids. It
 * appears at 1 and disappears again rather than counting down to zero.
 *
 * NOTHING AMBER. There is no threshold here that a person can be under, so
 * there is no state for a warning colour to describe.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatFastDuration } from '#app/models/fasting';
import type { FastingStats } from '#app/models/fasting-stats';

export interface FastingStatsRowProps {
  /** The derived figures. The caller owns the clock they were derived against. */
  stats: FastingStats;
}

/** One figure and its label, the small stat recipe the rest of the app uses. */
function StatFigure({ figure, label }: { figure: string; label: string }): ReactElement {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{figure}</dd>
    </div>
  );
}

/**
 * The row. Renders `null` for nothing, there is always at least the completed
 * count, so an empty state here is the history card's job rather than this
 * one's.
 */
export function FastingStatsRow({ stats }: FastingStatsRowProps): ReactElement {
  const { t, i18n } = useTranslation();
  const hours = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(stats.hoursLast7Days);

  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatFigure figure={String(stats.completedCount)} label={t('fasting.stats.completed')} />
      <StatFigure figure={formatFastDuration(stats.longestMs, t)} label={t('fasting.stats.longest')} />
      {stats.currentStreakDays >= 1 && (
        <StatFigure figure={String(stats.currentStreakDays)} label={t('fasting.stats.streak')} />
      )}
      <StatFigure figure={hours} label={t('fasting.stats.week')} />
    </dl>
  );
}
