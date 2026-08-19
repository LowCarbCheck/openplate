/**
 * The bar-chart legend, kept deliberately short — only the states a normal
 * person (not a chart-reading analyst) needs to make sense of what they're
 * looking at: a day with an unusual/partial bar, a day over their goal, a day
 * with no entry, and the goal line itself. A plain solid bar needs no
 * explanation (it's just "a day you logged"), and the finer reported-vs-
 * calculated distinction is a nuance for the chart's shading, not the legend.
 * Presentational only.
 *
 * Each swatch is a literal miniature of the shape the chart draws, so the legend
 * is what makes the chart's status readable WITHOUT relying on hue: the floor
 * swatch carries the same pale body + solid cap rule as a floor bar (M129/04),
 * and the no-entry swatch is the same baseline tick. Change a bar treatment in
 * `trend-chart.tsx` and this file changes with it — they are one convention.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrendMetric } from '#app/lib/trend-chart';

/** One legend entry: a small swatch and its label. */
function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}

/**
 * The legend for the given metric.
 *
 * @param metric - the active series (only net-carbs gets the "over your goal" swatch — mirrors the diary, which only ambers the carb ceiling).
 * @param hasGoal - whether a dashed goal line is drawn for this metric.
 */
export function TrendLegend({ metric, hasGoal }: { metric: TrendMetric; hasGoal: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {hasGoal && (
        <LegendItem
          swatch={<span className="w-3 border-t border-dashed border-muted-foreground/60" />}
          label={t('trends.legend.goal')}
        />
      )}
      {hasGoal && metric === 'net-carbs' && (
        <LegendItem
          swatch={<span className="h-2.5 w-2.5 rounded-sm bg-accent-amber" />}
          label={t('trends.legend.overGoal')}
        />
      )}
      <LegendItem
        swatch={<span className="h-2.5 w-2.5 rounded-sm border-t-2 border-primary bg-primary/25" />}
        label={t('trends.legend.incomplete')}
      />
      <LegendItem swatch={<span className="h-3 w-px bg-muted-foreground/40" />} label={t('trends.legend.noEntry')} />
    </div>
  );
}
