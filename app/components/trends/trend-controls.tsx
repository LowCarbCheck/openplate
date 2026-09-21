/**
 * The trends chart controls: a metric picker (net carbs, calories, protein,
 * fat, fiber), a meal-slot picker (every meal, or one of the four slots) and a
 * range toggle (7 / 14 / 30 / 90 days). All three are URL search params (the
 * metric since M239/03, when it left client state): a reload, a shared link or
 * a browser check lands on the same view, and every change carries the other
 * controls' values so one choice never silently resets another.
 *
 * ── ONE SHORT ROW, NOT TWELVE CHIPS (2026-09-21) ─────────────────────────
 *
 * The operator said the control buttons took way too much space. They did:
 * five metric chips, four range chips and five meal chips were five rows of
 * 44 px on a phone and three on a desktop, most of a screen before the chart
 * began. The two pickers with five choices are now select boxes, which is what
 * a choice among five is, and the range (four short words) stays a segmented
 * row. A phone gets two rows, a desktop gets one.
 *
 * ── THE CONTROLS NEVER MOVE (same report) ────────────────────────────────
 *
 * They also moved. They sat under the chart title, and that title wraps to two
 * lines at 30 and 90 days and gains a "Showing Breakfast only" line under a
 * meal, so choosing something pushed the next thing to choose down by 20 to 22
 * px, out from under the finger. `ChartCard` now puts this row FIRST in the
 * card. Everything that changes with a choice changes below it, and this row
 * is the same height in every state: it holds only controls, and none of them
 * changes size with its value.
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { ALL_MEALS, DEFAULT_TREND_METRIC } from '#app/lib/trend-chart';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { MEAL_LABEL_KEYS, MEAL_TYPES } from '#app/lib/meal-choice';
import type { InsightsTab } from '#app/lib/insights-tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select';
import { cn } from '#app/lib/utils';

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
  const navigate = useAppNavigate();

  /** Moves to the same view with one dimension changed, and leaves the scroll where it is. */
  const go = (next: Partial<TrendSelection>): void => {
    navigate(controlHref({ range, slot, tab, metric, ...next }), { preventScrollReset: true });
  };

  return (
    // A CONTAINER, so the row lays itself out by the room the CARD has and not
    // by the window: with the sidebar open a 1024 px window gives the card the
    // width of a phone-sized tablet.
    <div data-slot="trend-controls" className="@container">
      <div className="grid grid-cols-2 gap-2 @xl:flex @xl:flex-wrap @xl:items-center">
        <div data-slot="trend-metric-controls" className="min-w-0 @xl:w-44">
          <Select
            value={metric}
            onValueChange={(value) => {
              const chosen = METRIC_OPTIONS.find((option) => option.value === value);
              if (chosen !== undefined) go({ metric: chosen.value });
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label={t('trends.controls.metricGroup')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRIC_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div data-slot="trend-slot-controls" className="min-w-0 @xl:w-44">
          <Select
            value={slot}
            onValueChange={(value) => {
              const chosen = SLOT_OPTIONS.find((option) => option.value === value);
              if (chosen !== undefined) go({ slot: chosen.value });
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label={t('trends.controls.slotGroup')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Four short words, so a segmented row and not a third select: the
            window is the one control a person changes while looking at the
            chart, and one tap beats two. It takes the full second row on a
            phone and the right-hand end of the one row on a desktop. */}
        <fieldset
          data-slot="trend-range-controls"
          className="col-span-2 grid grid-cols-4 gap-0.5 rounded-md border bg-card p-0.5 @xl:col-span-1 @xl:ml-auto @xl:w-96"
        >
          <legend className="sr-only">{t('trends.controls.rangeGroup')}</legend>
          {RANGE_OPTIONS.map((option) => {
            const isActive = range === option.value;
            return (
              <Link
                key={option.value}
                to={controlHref({ range: option.value, slot, tab, metric })}
                preventScrollReset
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex min-h-11 min-w-0 items-center justify-center rounded-sm px-1 text-center text-xs font-medium leading-tight transition-colors md:min-h-7',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(option.labelKey)}
              </Link>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}
