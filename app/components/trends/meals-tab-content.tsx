/**
 * The Meals tab's own content (M239/04), everything below the shared chart:
 *
 * - with no slot chosen (`ALL_MEALS`): every slot's averages side by side,
 *   the day/week share of a metric by slot (including "no meal set"), and the
 *   weekly snack share over time;
 * - with one slot chosen (`?slot=breakfast`, say): that slot's own averages,
 *   and its five most-logged foods in the range ("Your usual breakfast").
 *   The chart itself stays in `trends.tsx`'s `ChartCard`, already filtered to
 *   the chosen slot since M227/02 — this component does not repeat it.
 *
 * All arithmetic is computed here, at render time, from the raw logs the
 * loader already read for the chart window, so it runs only on the render
 * where the Meals tab is actually shown (the same reasoning `trends.tsx`'s
 * own `ChartCard` gives for computing `buildTrendChart` inline rather than in
 * the loader or a `useMemo`).
 */
import { ALL_MEALS } from '#app/lib/trend-chart';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import { computeSlotAverages, computeSlotShares, topFoodsForSlot } from '#app/lib/slot-stats';
import type { DateRange, SlotShareMetric } from '#app/lib/slot-stats';
import type { LocalFoodLog } from '#app/lib/local-store/schema';
import { SlotAveragesCard } from '#app/components/trends/slot-averages-card';
import { PAIR_CLASS, WIDE_CLASS } from '#app/components/trends/insights-grid';
import { SlotShareCard } from '#app/components/trends/slot-share-card';
import { SnackShareCard } from '#app/components/trends/snack-share-card';
import { UsualSlotFoodsCard } from '#app/components/trends/usual-slot-foods-card';

/**
 * Below this many days of range, a weekly snack trend has too few points to
 * mean anything, so `SnackShareCard` shows a note instead of a chart.
 */
const SNACK_SHARE_MIN_RANGE_DAYS = 14;

/** `?metric=` narrowed to what the share cards can draw; anything else (protein/fat/fiber) defaults to kcal. */
function _shareMetricFor(metric: TrendMetric): SlotShareMetric {
  return metric === 'net-carbs' ? 'net-carbs' : 'kcal';
}

/**
 * @param logs - the local food logs covering at least `range` (the loader's `windowLogs`).
 * @param range - the chart's current window, the same one `entries`/`ChartCard` are built from.
 * @param rangeDays - the selected day range (7/14/30/90), driving weekly bucketing and the snack card's threshold.
 * @param isWeekly - true at 30 and 90 days, where the share bars are one per week rather than one per day.
 * @param slot - the active meal slot, or `ALL_MEALS` for the overview layout.
 * @param metric - the active chart metric, narrowed to kcal/net-carbs for the share card.
 */
export function MealsTabContent({
  logs,
  range,
  rangeDays,
  isWeekly,
  slot,
  metric,
}: {
  logs: readonly LocalFoodLog[];
  range: DateRange;
  rangeDays: number;
  isWeekly: boolean;
  slot: TrendSlot;
  metric: TrendMetric;
}) {
  const averages = computeSlotAverages({ logs, range });

  if (slot !== ALL_MEALS) {
    return (
      <div className={PAIR_CLASS}>
        <SlotAveragesCard slots={[slot]} averages={averages} />
        <UsualSlotFoodsCard slot={slot} foods={topFoodsForSlot({ logs, range, slot })} />
      </div>
    );
  }

  const shareMetric = _shareMetricFor(metric);
  return (
    <>
      <div className={WIDE_CLASS}>
        <SlotAveragesCard slots={MEAL_TYPES} averages={averages} />
      </div>
      <div className={PAIR_CLASS}>
        <SlotShareCard
          rows={computeSlotShares({ logs, range, metric: shareMetric, isWeekly })}
          isWeekly={isWeekly}
          metric={shareMetric}
        />
        <SnackShareCard
          rows={computeSlotShares({ logs, range, metric: 'kcal', isWeekly: true })}
          hasEnoughWeeks={rangeDays >= SNACK_SHARE_MIN_RANGE_DAYS}
        />
      </div>
    </>
  );
}
