/**
 * The trends chart controls: a metric toggle (net carbs ⇄ calories) and a range
 * toggle (7 / 14 / 30 days). The metric is client state (both series come from
 * the same loader data, so switching needs no refetch), while the range is a URL
 * search param — switching it re-runs the loader for the wider window, and the
 * client metric state survives that same-route navigation.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import type { TrendMetric } from '#app/lib/trend-chart';
import { Button } from '#app/components/ui/button';

/** The selectable day ranges and their plain-language label keys, mirroring the loader's accepted values. */
const RANGE_OPTIONS: readonly { value: 7 | 14 | 30; labelKey: string }[] = [
  { value: 7, labelKey: 'trends.range.week' },
  { value: 14, labelKey: 'trends.range.twoWeeks' },
  { value: 30, labelKey: 'trends.range.month' },
];

/** The two metric toggle options and their label keys. */
const METRIC_OPTIONS: readonly { value: TrendMetric; labelKey: string }[] = [
  { value: 'net-carbs', labelKey: 'trends.metric.netCarbs' },
  { value: 'calories', labelKey: 'trends.metric.calories' },
];

/**
 * @param metric - the active metric.
 * @param onMetricChange - selects a metric (client state, no navigation).
 * @param range - the active day range (drives active styling on the range links).
 */
export function TrendControls({
  metric,
  onMetricChange,
  range,
}: {
  metric: TrendMetric;
  onMetricChange: (metric: TrendMetric) => void;
  range: number;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <fieldset className="flex min-w-0 gap-1">
        <legend className="sr-only">{t('trends.controls.metricGroup')}</legend>
        {METRIC_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={metric === option.value ? 'default' : 'outline'}
            aria-pressed={metric === option.value}
            onClick={() => onMetricChange(option.value)}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </fieldset>
      <fieldset className="flex min-w-0 gap-1">
        <legend className="sr-only">{t('trends.controls.rangeGroup')}</legend>
        {RANGE_OPTIONS.map((option) => (
          <Button key={option.value} asChild size="sm" variant={range === option.value ? 'default' : 'outline'}>
            <Link
              to={`?range=${option.value}`}
              preventScrollReset
              aria-current={range === option.value ? 'true' : undefined}
            >
              {t(option.labelKey)}
            </Link>
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
