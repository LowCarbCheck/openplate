/**
 * The Overview tab's summary strip (M239/06): how the chosen chart range
 * went, one glance before the three doors below it. Below `MIN_TREND_DAYS`
 * logged days in the range, `SparseTrendNotice` replaces it outright, the
 * same honest stand-in `ChartCard` swaps to below the same threshold, so a
 * sparse range never has two different ways of saying "not enough data yet".
 */
import { useTranslation } from 'react-i18next';
import type { RangeMetricSummary, RangeSummary } from '#app/lib/range-summary';
import { MIN_TREND_DAYS, SparseTrendNotice } from '#app/components/trends/sparse-trend-notice';
import {
  STAT_FIGURE_CLASS,
  STAT_GRID_CLASS,
  STAT_NOTE_CLASS,
  STAT_UNIT_CLASS,
  StatTile,
} from '#app/components/trends/stat-tile';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { cn } from '#app/lib/utils';

/** The narrow slice of i18next's `t` the module-scope formatter needs. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** A signed whole-number delta with its unit, e.g. `+120 kcal` / `−6 g` / `no change`. Mirrors `WeeklyRecapCard`'s own delta formatters. */
function formatSignedDelta({ value, unit, t }: { value: number; unit: string; t: Translate }): string {
  const rounded = Math.round(value);
  if (rounded === 0) return t('trends.recap.noChange');
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} ${unit}`;
}

/** One metric's tile: its label, its "~"-hedged average, and its change line against the range before. */
function MetricTile({
  metric,
  label,
  summary,
  unit,
  range,
}: {
  metric: 'kcal' | 'netCarbs' | 'protein';
  label: string;
  summary: RangeMetricSummary;
  unit: 'kcal' | 'g';
  range: number;
}) {
  const { t } = useTranslation();
  // Reached only when the strip itself renders (`loggedDays >= MIN_TREND_DAYS`
  // below), at which point every metric shares that same logged-day
  // population and so is never null in practice, but this still degrades to
  // "say nothing" rather than a fabricated figure, for the same honesty
  // reason `computeRangeSummary` returns null instead of zero.
  if (summary.average === null) return null;

  return (
    <StatTile label={label} data-slot="range-summary-metric" data-metric={metric}>
      <p className={STAT_FIGURE_CLASS}>
        <span data-slot="range-summary-value" data-value={summary.average}>
          ~{Math.round(summary.average)}
        </span>{' '}
        <span className={STAT_UNIT_CLASS}>{unit}</span>
      </p>
      {summary.change !== null && (
        <p className={cn(STAT_NOTE_CLASS, 'tabular-nums')}>
          {t('trends.overview.summary.change', {
            change: formatSignedDelta({ value: summary.change, unit, t }),
            days: range,
          })}
        </p>
      )}
    </StatTile>
  );
}

/**
 * @param summary - the chosen range's aggregated figures (`computeRangeSummary`).
 * @param range - the active day range, both the strip's heading and the change line's "days before".
 */
export function RangeSummaryCard({ summary, range }: { summary: RangeSummary; range: number }) {
  const { t } = useTranslation();

  if (summary.loggedDays < MIN_TREND_DAYS) {
    return <SparseTrendNotice loggedDays={summary.loggedDays} />;
  }

  return (
    <Card data-slot="range-summary-card">
      <CardHeader>
        <CardTitle>{t('trends.overview.summary.title', { days: range })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p data-slot="range-summary-logged-days" className="text-sm text-muted-foreground tabular-nums">
          {t('trends.meals.averages.loggedDays', { days: summary.loggedDays, total: range })}
        </p>
        <div className={STAT_GRID_CLASS}>
          <MetricTile
            metric="kcal"
            label={t('trends.metric.calories')}
            summary={summary.kcal}
            unit="kcal"
            range={range}
          />
          <MetricTile
            metric="netCarbs"
            label={t('trends.metric.netCarbs')}
            summary={summary.netCarbs}
            unit="g"
            range={range}
          />
          <MetricTile
            metric="protein"
            label={t('trends.metric.protein')}
            summary={summary.protein}
            unit="g"
            range={range}
          />
        </div>
      </CardContent>
    </Card>
  );
}
