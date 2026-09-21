/**
 * The Overview tab (M239/06): the chosen range's summary strip, three doors
 * into the other tabs, then the existing streak, weekly recap and weight
 * cards, in that order. Moved out of `trends.tsx` so the route module stays a
 * dispatcher between tabs rather than growing a fourth screen's worth of JSX
 * inline, the same split `GoalTabContent`/`MealsTabContent` already use for
 * their own tabs.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Link } from '#app/components/link';
import type { WeightChartPoint } from '#app/components/weight/weight-trend-chart';
import type { InsightsTab } from '#app/lib/insights-tabs';
import type { RangeSummary } from '#app/lib/range-summary';
import type { TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import type { WeeklyRecap } from '#app/lib/trend-recap';
import type { WeeklyWeightChange } from '#app/lib/trend-weight';
import type { EatingWindow } from '#app/lib/trend-eating-window';
import type { LocalActivityMark } from '#app/lib/local-store';
import type { WeightUnit } from '#app/lib/weight-units';
import { controlHref } from '#app/components/trends/trend-controls';
import { ActivityStreakCard } from '#app/components/gamification/activity-streak-card';
import { RangeSummaryCard } from '#app/components/trends/range-summary-card';
import { WeeklyRecapCard } from '#app/components/trends/weekly-recap-card';
import { WeightProgressCard } from '#app/components/trends/weight-progress-card';
import { Card, CardContent, CardTitle } from '#app/components/ui/card';

/** The three tabs a mini card can open, in the order the tab strip lists them (Overview itself excluded). */
const DOOR_TABS = ['nutrition', 'meals', 'goals'] as const satisfies readonly InsightsTab[];

/** A door's catalog label key, the tab strip's own key so the two never name a section differently. */
const DOOR_LABEL_KEY = {
  nutrition: 'trends.tabs.nutrition',
  meals: 'trends.tabs.meals',
  goals: 'trends.tabs.goals',
} satisfies Record<(typeof DOOR_TABS)[number], string>;

/**
 * One mini card: a smaller copy of `WeekGlanceCard`'s whole-card-is-the-link
 * shape (`#app/routes/dashboard`), the destination tab's own name, an arrow,
 * nothing else, so three fit one phone-width row (checked at 360 px, the same
 * budget `InsightsTabStrip` above it uses for four).
 */
function InsightsDoorCard({
  tab,
  range,
  slot,
  metric,
}: {
  tab: (typeof DOOR_TABS)[number];
  range: number;
  slot: TrendSlot;
  metric: TrendMetric;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Link
      to={controlHref({ range, slot, tab, metric })}
      data-slot="insights-door-card"
      data-tab={tab}
      // The ring is drawn on this wrapper, so it takes the radius of the card
      // inside it (the ladder's 8px card step).
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="flex min-h-11 items-center justify-between gap-1 p-3">
          <CardTitle className="min-w-0 hyphens-auto break-words text-sm font-medium leading-tight">
            {t(DOOR_LABEL_KEY[tab])}
          </CardTitle>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  );
}

/** The three doors, one per remaining tab, carrying the active range/slot/metric so switching tabs never resets them. */
function InsightsDoorRow({ range, slot, metric }: { range: number; slot: TrendSlot; metric: TrendMetric }): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-2">
      {DOOR_TABS.map((tab) => (
        <InsightsDoorCard key={tab} tab={tab} range={range} slot={slot} metric={metric} />
      ))}
    </div>
  );
}

/**
 * @param summary - the chosen range's aggregated figures (`computeRangeSummary`).
 * @param range - the active day range, echoed into every door's link.
 * @param slot - the active meal slot, echoed into every door's link.
 * @param metric - the active chart metric, echoed into every door's link.
 * @param marks - every local activity mark, for the streak card.
 * @param today - the caller's current local date.
 * @param gamificationHidden - whether the streak/awards surfaces are switched off.
 * @param recap - this week vs. last week (`computeWeeklyRecap`), the weekly recap card's input.
 * @param weight - this week's raw weight change, or null.
 * @param eatingWindow - this week's median eating window, or null.
 * @param goals - the ceiling/floor the recap card's optional lines gate on.
 * @param weightWindow - the 13-week weigh-in series for the weight card's chart.
 * @param targetWeightKg - the user's target weight, or null.
 * @param todayWeightKg - today's weigh-in, or null.
 * @param weightUnit - the reader's display unit.
 */
export function OverviewTabContent({
  summary,
  range,
  slot,
  metric,
  marks,
  today,
  gamificationHidden,
  recap,
  weight,
  eatingWindow,
  goals,
  weightWindow,
  targetWeightKg,
  todayWeightKg,
  weightUnit,
}: {
  summary: RangeSummary;
  range: number;
  slot: TrendSlot;
  metric: TrendMetric;
  marks: readonly LocalActivityMark[];
  today: string;
  gamificationHidden: boolean;
  recap: { current: WeeklyRecap; previous: WeeklyRecap };
  weight: WeeklyWeightChange | null;
  eatingWindow: EatingWindow | null;
  goals: { netCarbsCeiling: number | null; proteinFloor: number | null };
  weightWindow: WeightChartPoint[];
  targetWeightKg: number | null;
  todayWeightKg: number | null;
  weightUnit: WeightUnit;
}): ReactElement {
  return (
    <>
      <RangeSummaryCard summary={summary} range={range} />

      <InsightsDoorRow range={range} slot={slot} metric={metric} />

      {/* The ACTIVITY streak (M235/06), the same number `/dashboard` shows,
          derived from the same marks by the same function. The card is also
          the only door to `/awards`, and both go together when the person
          has switched these surfaces off. */}
      <ActivityStreakCard marks={marks} today={today} hidden={gamificationHidden} />

      <WeeklyRecapCard current={recap.current} previous={recap.previous} weight={weight} eatingWindow={eatingWindow} goals={goals} />

      {/* The body story is its own chapter: the chart moved here from
          `/settings/profile`, which keeps the entry form and the weigh-in
          list. */}
      <WeightProgressCard
        points={weightWindow}
        targetWeightKg={targetWeightKg}
        today={today}
        todayWeightKg={todayWeightKg}
        weightUnit={weightUnit}
      />
    </>
  );
}
