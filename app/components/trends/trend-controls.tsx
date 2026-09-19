/**
 * The trends chart controls: a metric toggle (net carbs ⇄ calories), a range
 * toggle (7 / 14 / 30 / 90 days) and a meal-slot filter (every meal, or one of the
 * four slots). The metric is client state, because both series come from the
 * same loader data and switching needs no refetch; the range and the slot are
 * URL search params, because each one re-runs the loader over different logs
 * and because a reload should land on the same view. The client metric state
 * survives those same-route navigations.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ALL_MEALS } from '#app/lib/trend-chart';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { MEAL_LABEL_KEYS, MEAL_TYPES } from '#app/lib/meal-choice';
import { Button } from '#app/components/ui/button';

/** The selectable day ranges and their plain-language label keys, mirroring the loader's accepted values. */
const RANGE_OPTIONS: readonly { value: 7 | 14 | 30 | 90; labelKey: string }[] = [
  { value: 7, labelKey: 'trends.range.week' },
  { value: 14, labelKey: 'trends.range.twoWeeks' },
  { value: 30, labelKey: 'trends.range.month' },
  { value: 90, labelKey: 'trends.range.threeMonths' },
];

/** The two metric toggle options and their label keys. */
const METRIC_OPTIONS: readonly { value: TrendMetric; labelKey: string }[] = [
  { value: 'net-carbs', labelKey: 'trends.metric.netCarbs' },
  { value: 'calories', labelKey: 'trends.metric.calories' },
];

/**
 * "Every meal" first, then the four slots in the one order every meal picker in
 * this app lists them. The slot labels are `#app/lib/meal-choice`'s own keys,
 * not new ones: the word for a snack has to be the same here as in the picker
 * that put the food in that slot.
 */
const SLOT_OPTIONS: readonly { value: TrendSlot; labelKey: string }[] = [
  { value: ALL_MEALS, labelKey: 'trends.slot.all' },
  ...MEAL_TYPES.map((meal) => ({ value: meal, labelKey: MEAL_LABEL_KEYS[meal] })),
];

/**
 * The href for one control, carrying the OTHER control's current value with it.
 * Switching the range must not silently drop the chosen slot, and vice versa.
 * `ALL_MEALS` is written as the absence of the param rather than as `slot=all`,
 * so the plain `/trends` URL stays the whole-day view.
 *
 * @param selection.range - the range the link should land on.
 * @param selection.slot - the slot the link should land on.
 * @returns a same-route query string.
 */
function controlHref({ range, slot }: { range: number; slot: TrendSlot }): string {
  const params = new URLSearchParams({ range: `${range}` });
  if (slot !== ALL_MEALS) params.set('slot', slot);
  return `?${params.toString()}`;
}

/**
 * @param metric - the active metric.
 * @param onMetricChange - selects a metric (client state, no navigation).
 * @param range - the active day range (drives active styling on the range links).
 * @param slot - the active meal slot, or `ALL_MEALS`.
 */
export function TrendControls({
  metric,
  onMetricChange,
  range,
  slot,
}: {
  metric: TrendMetric;
  onMetricChange: (metric: TrendMetric) => void;
  range: number;
  slot: TrendSlot;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
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
                to={controlHref({ range: option.value, slot })}
                preventScrollReset
                aria-current={range === option.value ? 'true' : undefined}
              >
                {t(option.labelKey)}
              </Link>
            </Button>
          ))}
        </fieldset>
      </div>
      {/* Its own row, and wrapping: five options do not fit a phone's width
          beside the two groups above, and a control that scrolls sideways is
          the one thing this layout budget forbids. */}
      <fieldset data-slot="trend-slot-controls" className="flex min-w-0 flex-wrap gap-1">
        <legend className="sr-only">{t('trends.controls.slotGroup')}</legend>
        {SLOT_OPTIONS.map((option) => (
          <Button key={option.value} asChild size="sm" variant={slot === option.value ? 'default' : 'outline'}>
            <Link
              to={controlHref({ range, slot: option.value })}
              preventScrollReset
              aria-current={slot === option.value ? 'true' : undefined}
            >
              {t(option.labelKey)}
            </Link>
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
