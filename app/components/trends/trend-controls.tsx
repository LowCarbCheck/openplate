/**
 * The trends chart controls: a metric toggle (net carbs, calories, protein,
 * fat, fiber), a range toggle (7 / 14 / 30 / 90 days) and a meal-slot filter
 * (every meal, or one of the four slots). All three are URL search params
 * (the metric since M239/03, when it left client state): a reload, a shared
 * link or a browser check lands on the same view, and every link carries the
 * other controls' values so one choice never silently resets another.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ALL_MEALS, DEFAULT_TREND_METRIC } from '#app/lib/trend-chart';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { MEAL_LABEL_KEYS, MEAL_TYPES } from '#app/lib/meal-choice';
import type { InsightsTab } from '#app/lib/insights-tabs';
import { SECTION_EYEBROW_CLASS } from '#app/components/typography';
import { Button } from '#app/components/ui/button';
import type { ReactNode } from 'react';

/**
 * One group of chips under its name. Twelve equal chips in three stacked rows
 * read as one wall, so each row wears its group's name as a section label. The
 * name is the fieldset's `legend`, which stays for assistive technology, and
 * this is its sighted twin, hidden from it so the name is read once.
 */
function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p aria-hidden="true" className={SECTION_EYEBROW_CLASS}>
        {label}
      </p>
      {children}
    </div>
  );
}

/** The selectable day ranges and their plain-language label keys, mirroring the loader's accepted values. */
const RANGE_OPTIONS: readonly { value: 7 | 14 | 30 | 90; labelKey: string }[] = [
  { value: 7, labelKey: 'trends.range.week' },
  { value: 14, labelKey: 'trends.range.twoWeeks' },
  { value: 30, labelKey: 'trends.range.month' },
  { value: 90, labelKey: 'trends.range.threeMonths' },
];

/** The metric toggle options and their label keys, in the order the control lists them. */
const METRIC_OPTIONS: readonly { value: TrendMetric; labelKey: string }[] = [
  { value: 'net-carbs', labelKey: 'trends.metric.netCarbs' },
  { value: 'calories', labelKey: 'trends.metric.calories' },
  { value: 'protein', labelKey: 'trends.metric.protein' },
  { value: 'fat', labelKey: 'trends.metric.fat' },
  { value: 'fiber', labelKey: 'trends.metric.fiber' },
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
 * One chip. A fixed grid cell rather than a wrapping flex item, so the three
 * groups take five rows in every language instead of six in English and seven
 * in German, and no group ends in a single orphan chip. 44px tall, and the
 * label wraps inside its cell rather than widening it.
 */
const CHIP_CLASS = 'min-h-11 whitespace-normal px-1 text-xs leading-tight';

/** Every URL dimension of the chart, the full state a control link must carry. */
export interface TrendSelection {
  range: number;
  slot: TrendSlot;
  tab: InsightsTab;
  metric: TrendMetric;
}

/**
 * The href for one control, carrying the OTHER controls' current values with
 * it. Switching the range must not silently drop the chosen slot, metric or
 * active tab, and vice versa. `ALL_MEALS` and the default metric are written
 * as the absence of their param, so the plain URL stays the plain view; `tab`
 * is always spelled out, since these controls only ever render on the
 * Nutrition or Meals tab and dropping it would silently bounce the reader back
 * to Overview.
 *
 * @param selection - the full state the link should land on.
 * @returns a same-route query string.
 */
export function controlHref({ range, slot, tab, metric }: TrendSelection): string {
  const params = new URLSearchParams({ range: `${range}`, tab });
  if (slot !== ALL_MEALS) params.set('slot', slot);
  if (metric !== DEFAULT_TREND_METRIC) params.set('metric', metric);
  return `?${params.toString()}`;
}

/**
 * @param selection.metric - the active metric.
 * @param selection.range - the active day range (drives active styling on the range links).
 * @param selection.slot - the active meal slot, or `ALL_MEALS`.
 * @param selection.tab - the tab these controls are rendered under (Nutrition or Meals), carried into every link.
 */
export function TrendControls({ metric, range, slot, tab }: TrendSelection) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Its own row of three columns: five metrics do not fit a phone beside
          the range group, and a control that scrolls sideways is the one thing
          this layout budget forbids. */}
      <ControlGroup label={t('trends.controls.metricGroup')}>
        <fieldset data-slot="trend-metric-controls" className="grid grid-cols-3 gap-2">
          <legend className="sr-only">{t('trends.controls.metricGroup')}</legend>
          {METRIC_OPTIONS.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              className={CHIP_CLASS}
              variant={metric === option.value ? 'default' : 'outline'}
            >
              <Link
                to={controlHref({ range, slot, tab, metric: option.value })}
                preventScrollReset
                aria-current={metric === option.value ? 'true' : undefined}
              >
                {t(option.labelKey)}
              </Link>
            </Button>
          ))}
        </fieldset>
      </ControlGroup>
      <ControlGroup label={t('trends.controls.rangeGroup')}>
        <fieldset className="grid grid-cols-4 gap-2">
          <legend className="sr-only">{t('trends.controls.rangeGroup')}</legend>
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              className={CHIP_CLASS}
              variant={range === option.value ? 'default' : 'outline'}
            >
              <Link
                to={controlHref({ range: option.value, slot, tab, metric })}
                preventScrollReset
                aria-current={range === option.value ? 'true' : undefined}
              >
                {t(option.labelKey)}
              </Link>
            </Button>
          ))}
        </fieldset>
      </ControlGroup>
      {/* Its own row of three columns: five options do not fit a phone's width
          beside the two groups above, and a control that scrolls sideways is
          the one thing this layout budget forbids. */}
      <ControlGroup label={t('trends.controls.slotGroup')}>
        <fieldset data-slot="trend-slot-controls" className="grid grid-cols-3 gap-2">
          <legend className="sr-only">{t('trends.controls.slotGroup')}</legend>
          {SLOT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              asChild
              size="sm"
              className={CHIP_CLASS}
              variant={slot === option.value ? 'default' : 'outline'}
            >
              <Link
                to={controlHref({ range, slot: option.value, tab, metric })}
                preventScrollReset
                aria-current={slot === option.value ? 'true' : undefined}
              >
                {t(option.labelKey)}
              </Link>
            </Button>
          ))}
        </fieldset>
      </ControlGroup>
    </div>
  );
}
