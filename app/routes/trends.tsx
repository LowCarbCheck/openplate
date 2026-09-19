import { useState } from 'react';
import type { Route } from './+types/trends';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { parseWithZod } from '@conform-to/zod/v4';
import {
  computeDailyTotalsInRange,
  computeSlotTotalsInRange,
  getEarliestLocalFoodLogDayKey,
  getLocalBodyMetrics,
  getLocalProfileGoals,
  listLocalActivityMarks,
  listLocalFoodLogsInRange,
  listLocalWeightEntries,
  resolveLocalTimezone,
  upsertLocalWeightEntryForDay,
} from '#app/lib/local-store';
import { noteActivity } from '#app/lib/gamification/record';
import { enumerateDates, shiftDate, todayInTimezone } from '#app/lib/user-days';
import { startOfWeek } from '#app/lib/trend-week';
import { ALL_MEALS, buildTrendChart, DEFAULT_TREND_METRIC, goalValueFor, TREND_METRICS } from '#app/lib/trend-chart';
import { bucketByWeek } from '#app/lib/trend-buckets';
import { ROLLING_AVERAGE_DAYS, selectAverageFractions } from '#app/lib/rolling-average';
import type { TrendDay, TrendGoals, TrendMetric, TrendSlot } from '#app/lib/trend-chart';
import { DEFAULT_INSIGHTS_TAB, INSIGHTS_TABS } from '#app/lib/insights-tabs';
import type { InsightsTab } from '#app/lib/insights-tabs';
import { MEAL_LABEL_KEYS, MEAL_TYPES } from '#app/lib/meal-choice';
import { computeWeeklyRecap } from '#app/lib/trend-recap';
import { computeWeeklyWeightChange } from '#app/lib/trend-weight';
import { computeEatingWindow } from '#app/lib/trend-eating-window';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { trackWeightLogged } from '#app/lib/matomo-events';
import { makeLogWeightSchema } from '#app/lib/weight-log-schema';
import { readStoredWeightUnit } from '#app/lib/weight-unit-preference';
import type { WeightUnit } from '#app/lib/weight-units';
import { buildAdherenceGrid } from '#app/models/adherence-grid';
import type { AdherenceGoals } from '#app/models/adherence-grid';
import { resolveAdherenceGoals } from '#app/lib/adherence-goals';
import { GRID_WEEKS, selectAdherenceGridDays } from '#app/lib/adherence-grid-days';
import { isGamificationHidden } from '#app/lib/gamification/surfaces';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ActivityStreakCard } from '#app/components/gamification/activity-streak-card';
import { AdherenceGridCard } from '#app/components/trends/adherence-grid-card';
import { InsightsTabStrip } from '#app/components/trends/insights-tab-strip';
import { chartTitleKey, TrendChart } from '#app/components/trends/trend-chart';
import { MacroEnergySplitCard } from '#app/components/trends/macro-energy-split-card';
import { TrendControls } from '#app/components/trends/trend-controls';
import { TrendLegend } from '#app/components/trends/trend-legend';
import { MIN_TREND_DAYS, SparseTrendNotice } from '#app/components/trends/sparse-trend-notice';
import { WeeklyRecapCard } from '#app/components/trends/weekly-recap-card';
import { WeightProgressCard } from '#app/components/trends/weight-progress-card';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import i18n from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.trends') }];

export const handle = {
  // `title` stays as the untranslated fallback for any consumer that reads the
  // handle outside a React tree (where `t` isn't available).
  title: 'Insights',
  titleKey: 'trends.title',
};

/** The selectable chart windows, in days. */
const ALLOWED_RANGES = [7, 14, 30, 90] as const;
type TrendRange = (typeof ALLOWED_RANGES)[number];
/** Default window when an explicit (but invalid) range is requested. */
const DEFAULT_RANGE: TrendRange = 14;
/** The narrowest selectable window — the smart default for a brand-new account (see `pickDefaultRange`). */
const NEW_ACCOUNT_RANGE: TrendRange = 7;
/**
 * From this range up the chart draws one bar per week, not per day: 90 daily
 * bars do not fit a phone, and 30 are already a comb of slivers.
 */
const WEEKLY_BARS_FROM_RANGE: TrendRange = 30;
/** A Monday→Sunday week is seven days wide. */
const DAYS_IN_WEEK = 7;
// `GRID_WEEKS` is imported: Overview draws the same grid, so the week count
// and the day selection live in `#app/lib/adherence-grid-days` where both
// screens read them. Fixed at 13: one geometry at every breakpoint, no scroll,
// no responsive week count.
/** The weight window matches the grid's, so both surfaces honestly say "the last 13 weeks". */
const WEIGHT_WINDOW_DAYS = GRID_WEEKS * DAYS_IN_WEEK;

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance.
 */
const actionT = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>): string => i18n.t(key, params ?? {});

/**
 * Parses the `slot` search param into a meal slot, falling back to "every meal"
 * on anything the picker could not have produced. A bad value reads as no
 * filter rather than as an error: the worst outcome is the view the plain
 * `/trends` URL already gives.
 *
 * @param raw - the raw search-param value, or null when it is absent.
 * @returns the slot to chart.
 */
function _parseSlot(raw: string | null): TrendSlot {
  return MEAL_TYPES.find((meal) => meal === raw) ?? ALL_MEALS;
}

/**
 * Parses the `tab` search param into an insights tab, falling back to
 * overview on anything the tab strip could not have produced. A bad value
 * reads as the glance-first section rather than as an error, the same rule
 * `_parseSlot` above applies to a bad meal slot.
 *
 * @param raw - the raw search-param value, or null when it is absent.
 * @returns the tab to show.
 */
export function _parseTab(raw: string | null): InsightsTab {
  return INSIGHTS_TABS.find((tab) => tab === raw) ?? DEFAULT_INSIGHTS_TAB;
}

/**
 * Parses the `metric` search param, falling back to net carbs on anything the
 * metric control could not have produced, the same rule as `_parseSlot`.
 *
 * @param raw - the raw search-param value, or null when it is absent.
 * @returns the metric to chart.
 */
export function _parseMetric(raw: string | null): TrendMetric {
  return TREND_METRICS.find((metric) => metric === raw) ?? DEFAULT_TREND_METRIC;
}

/** Parses an explicit `range` search param, falling back to the default on anything invalid. */
function _parseRange(raw: string): TrendRange {
  const value = Number(raw);
  return ALLOWED_RANGES.find((allowed) => allowed === value) ?? DEFAULT_RANGE;
}

/**
 * Picks the chart window when the URL doesn't request one explicitly. A
 * brand-new account (its earliest logged day within the last week) gets the
 * narrowest 7-day window instead of the usual 14 — so a user with one or two
 * logged days sees a chart that's mostly this week, not a 14-day strip that's
 * a dozen empty "no entry" slots and a single bar.
 *
 * @param earliestLoggedDate - the oldest `dayKey` across every local food log, or null when there are none yet.
 * @param today - the caller's current local date (`YYYY-MM-DD`).
 * @returns the range to use when the URL didn't specify one.
 */
export function pickDefaultRange({
  earliestLoggedDate,
  today,
}: {
  earliestLoggedDate: string | null;
  today: string;
}): TrendRange {
  if (earliestLoggedDate === null) return DEFAULT_RANGE;
  const newAccountFloor = shiftDate(today, -(NEW_ACCOUNT_RANGE - 1));
  return earliestLoggedDate >= newAccountFloor ? NEW_ACCOUNT_RANGE : DEFAULT_RANGE;
}

/** The earlier of two `YYYY-MM-DD` days; the format sorts as text. */
function _earlierDay({ left, right }: { left: string; right: string }): string {
  return left < right ? left : right;
}

////////////////////////////////////////////////////////////////////////////////
// Server loader — none needed (M117/04: accounts optional, health data is
// local-only — there is no auth invariant left to enforce or echo here)
////////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

////////////////////////////////////////////////////////////////////////////////
// Client loader
////////////////////////////////////////////////////////////////////////////////

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const today = todayInTimezone(timezone);

  const goals = {
    netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null,
    proteinFloor: profile?.goalProteinFloorG ?? null,
    kcalTarget: profile?.goalKcalTarget ?? null,
  };

  const searchParams = new URL(request.url).searchParams;
  const rawRange = searchParams.get('range');
  // The earliest day is read off the store's day index, not by loading the
  // diary: it is the one question here that reaches back past every window.
  const range =
    rawRange === null ?
      pickDefaultRange({ earliestLoggedDate: await getEarliestLocalFoodLogDayKey(), today })
    : _parseRange(rawRange);
  const slot = _parseSlot(searchParams.get('slot'));
  const tab = _parseTab(searchParams.get('tab'));
  const metric = _parseMetric(searchParams.get('metric'));

  const chartWindow = { fromDate: shiftDate(today, -(range - 1)), toDate: today };
  // The six days before the first bar, so the first bars' 7-day average
  // windows are whole rather than cut off at the chart's left edge.
  const leadWindow = { fromDate: shiftDate(chartWindow.fromDate, -(ROLLING_AVERAGE_DAYS - 1)), toDate: shiftDate(chartWindow.fromDate, -1) };
  const currentWeekStart = startOfWeek(today);
  const currentWeekEnd = shiftDate(currentWeekStart, DAYS_IN_WEEK - 1);
  const previousWeekStart = shiftDate(currentWeekStart, -DAYS_IN_WEEK);
  const previousWeekEnd = shiftDate(currentWeekStart, -1);
  const gridWeeksStart = shiftDate(currentWeekStart, -(GRID_WEEKS - 1) * DAYS_IN_WEEK);

  // ONE BOUNDED READ covers every window this screen draws: the chart's range,
  // the 13 grid weeks (which also contain the two recap weeks and this week's
  // eating window) and the rest of the current week, which the grid and the
  // recap both run to. Nothing older is parsed, however long the diary is.
  const windowLogs = await listLocalFoodLogsInRange({
    fromDate: _earlierDay({ left: leadWindow.fromDate, right: gridWeeksStart }),
    toDate: currentWeekEnd,
  });

  // The chart window: `range` days ending on the user's local today. With a
  // slot chosen, each day counts only the entries that went into that slot
  // (M227/02); a day whose entries all sit in OTHER slots comes back as a gap
  // day, which the chart draws as "nothing logged" rather than as a zero.
  const entries =
    slot === ALL_MEALS ?
      computeDailyTotalsInRange(windowLogs, chartWindow)
    : computeSlotTotalsInRange(windowLogs, chartWindow, slot);
  const leadEntries =
    slot === ALL_MEALS ?
      computeDailyTotalsInRange(windowLogs, leadWindow)
    : computeSlotTotalsInRange(windowLogs, leadWindow, slot);

  // Two Monday→Sunday weeks (this week + last) computed as one contiguous
  // range, then split by date for the recap comparison.
  const weekEntries = computeDailyTotalsInRange(windowLogs, { fromDate: previousWeekStart, toDate: currentWeekEnd });
  const currentWeekDays = weekEntries.filter((day) => day.date >= currentWeekStart && day.date <= currentWeekEnd);
  const previousWeekDays = weekEntries.filter((day) => day.date >= previousWeekStart && day.date <= previousWeekEnd);
  const recap = {
    current: computeWeeklyRecap({
      days: currentWeekDays,
      today,
      netCarbsCeiling: goals.netCarbsCeiling,
      proteinFloor: goals.proteinFloor,
    }),
    previous: computeWeeklyRecap({
      days: previousWeekDays,
      today,
      netCarbsCeiling: goals.netCarbsCeiling,
      proteinFloor: goals.proteinFloor,
    }),
  };

  // Raw first→last weight delta for the current week (smoothing lives elsewhere).
  const weightRows = await listLocalWeightEntries();
  const weekWeights = weightRows
    .filter((row) => row.dayKey >= currentWeekStart && row.dayKey <= currentWeekEnd)
    .map((row) => ({ measuredAt: row.dayKey, weightKg: row.weightKg }));
  const weight = computeWeeklyWeightChange(weekWeights);

  // Eating window: this week's per-day log timestamps → median first→last span.
  const currentWeekDates = enumerateDates(currentWeekStart, currentWeekEnd);
  const perDayLogs = currentWeekDates.map((date) => windowLogs.filter((log) => log.dayKey === date));
  const eatingWindow = computeEatingWindow({
    days: perDayLogs.map((logs) => ({ loggedAtMs: logs.map((log) => log.loggedAt) })),
  });

  // The adherence grid: 13 whole Monday→Sunday columns ending in the week that
  // contains today, so the grid never shows a ragged part-week at either end.
  // Selected through the shared seam Overview uses, so the two grids cannot
  // disagree about their window.
  const gridDays = selectAdherenceGridDays({ allLogs: windowLogs, today, weeks: GRID_WEEKS });
  // The goals those columns are graded against, from the one builder Overview
  // and the diary's calendar also call: `kcalTarget` carries the reproductive
  // energy addition, so a pregnant person's day cannot read as met here and
  // missed there. Resolved in the loader rather than in the component, because
  // the stage is a store read and the grid is pure arithmetic on its result.
  const adherenceGoals: AdherenceGoals = resolveAdherenceGoals({
    goals,
    bodyMetrics: await getLocalBodyMetrics(),
    today,
  }).goals;

  // The same 91-day window, ascending — the weight chart's series.
  const weightWindowStart = shiftDate(today, -(WEIGHT_WINDOW_DAYS - 1));
  const weightWindow = weightRows
    .filter((row) => row.dayKey >= weightWindowStart)
    .toSorted((left, right) => left.dayKey.localeCompare(right.dayKey))
    .map((row) => ({ date: row.dayKey, weightKg: row.weightKg }));

  // "Fresh account" (empty state) only when nothing shows anywhere we looked —
  // the chart window, the two recap weeks, or any weigh-in — so toggling the
  // range never flips a returning user back into the onboarding nudge.
  const hasAnyData =
    entries.some((day) => day.hasLogs) || weekEntries.some((day) => day.hasLogs) || weightRows.length > 0;

  return {
    entries,
    leadEntries,
    goals,
    range,
    slot,
    tab,
    metric,
    recap,
    weight,
    eatingWindow,
    hasAnyData,
    today,
    gridDays,
    adherenceGoals,
    weightWindow,
    // The marks and the switch, read here rather than from inside the card:
    // this loader already reads the device, and a card that read the store from
    // an effect of its own could not be rendered in a test (M235/06).
    marks: await listLocalActivityMarks(),
    gamificationHidden: isGamificationHidden(profile),
    targetWeightKg: profile?.targetWeightKg ?? null,
    todayWeightKg: weightRows.find((row) => row.dayKey === today)?.weightKg ?? null,
  };
}
clientLoader.hydrate = true as const;

////////////////////////////////////////////////////////////////////////////////
// Client action — the weight card's inline quick log
////////////////////////////////////////////////////////////////////////////////

/**
 * Logs (or replaces) today's weigh-in. Mirrors `/settings/profile`' own weight
 * action down to the schema and the local-store upsert — the only difference is
 * where it redirects — so the two entry points can never diverge on what a
 * valid weight is.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: makeLogWeightSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const profile = await getLocalProfileGoals();
  const dayKey = todayInTimezone(resolveLocalTimezone(profile));
  await upsertLocalWeightEntryForDay({ dayKey, weightKg: submission.value.weightKg });
  trackWeightLogged();
  await noteActivity({ signal: 'weight.log', now: Date.now() });
  return redirectWithLocalToast('/trends', {
    type: 'success',
    description: actionT('goals.toast.weightLogged'),
  });
}

/**
 * Shown while the client loader reads trend data from the on-device primary
 * store (M117/03) — this route is now clientLoader-only for health data.
 */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('trends.loading')}
    </output>
  );
}

/** The friendly empty state for a fresh account with nothing to chart yet. */
function EmptyTrends() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('trends.title')}</CardTitle>
        <CardDescription>{t('trends.empty.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('trends.empty.body')}</p>
        <Button asChild>
          <Link to="/add">{t('trends.empty.cta')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The trend chart: the metric/range/slot controls, the bar chart (with its
 * 7-day average line over daily bars) or the sparse notice, and the slot-only
 * note under the title. Shown on both
 * the Nutrition and the Meals tab for now, since M239/04 gives Meals its own
 * content, and until then `?tab=meals&slot=breakfast` already narrows this
 * exact chart to one meal, which is what the Meals tab claims to offer today.
 *
 * A component rather than inline JSX so its several derived values (the
 * title, the sparse threshold, the bucketed days) are computed only when a
 * tab that needs them is actually rendered, since React never calls a
 * component function whose element the parent didn't include.
 *
 * @param entries - the loader's per-day totals for the active range and slot.
 * @param range - the active day range; drives daily-vs-weekly bucketing and the range control's active state.
 * @param slot - the active meal slot, or `ALL_MEALS`.
 * @param tab - which tab this card is rendered under, so its controls keep switching tab in the URL.
 * @param metric - the active metric (a URL param since M239/03).
 * @param goals - the day-level goals the chart's goal line reads.
 * @param leadEntries - the days just before the range, which only the 7-day average line reads.
 */
function ChartCard({
  entries,
  leadEntries,
  range,
  slot,
  tab,
  metric,
  goals,
}: {
  entries: TrendDay[];
  leadEntries: TrendDay[];
  range: TrendRange;
  slot: TrendSlot;
  tab: InsightsTab;
  metric: TrendMetric;
  goals: TrendGoals;
}) {
  const { t } = useTranslation();

  const goalValue = goalValueFor({ metric, goals });
  // `slot` goes to the model rather than being applied to the goal here: every
  // stored goal is a whole-day figure, and `buildTrendChart` is the one place
  // that decides a part-day bar has nothing to be measured against.
  // At the wide ranges each bar is a week, averaged over its logged days
  // (`bucketByWeek`). The slot filter has already been applied to `entries`,
  // so a week of snacks is the mean of the snack days, not of whole days.
  const isWeekly = range >= WEEKLY_BARS_FROM_RANGE;
  const chartDays = isWeekly ? bucketByWeek(entries) : entries;
  const chart = buildTrendChart({ days: chartDays, metric, goalValue, slot });
  // The 7-day line goes over daily bars only: over weekly bars each bar is
  // already a mean, and a mean of means would say less than the bars do.
  const averageFractions =
    isWeekly ? null : selectAverageFractions({ leadDays: leadEntries, days: chartDays, metric, domainMax: chart.domainMax });
  const chartTitle = t(chartTitleKey({ metric, isWeekly }));
  // Below the threshold the chart is replaced, not drawn sparse — see
  // `SparseTrendNotice`. Counted over the SELECTED window AND the selected slot,
  // because those are the days this chart would actually draw: widening the
  // range to 30 days can reveal a chart the 7-day window couldn't honestly show,
  // and filtering to a slot the person rarely logs honestly has too little.
  const loggedDaysInRange = entries.filter((day) => day.hasLogs).length;
  const hasEnoughDays = loggedDaysInRange >= MIN_TREND_DAYS;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          {/* No `capitalize` here: the title is now a whole catalog string
              with its own correct casing, and the CSS class title-cases EVERY
              word — it rendered "Daily Net Carbs" in English and "Netto-KH
              Pro Tag" in German, which is simply wrong in both. */}
          <CardTitle className="text-lg">{chartTitle}</CardTitle>
          <CardDescription>{hasEnoughDays ? t('trends.chart.tapHint') : t('trends.chart.sparseHint')}</CardDescription>
          {/* The title still says "Daily net carbs", which is only half true
              once a slot is chosen, so the slot is named right under it. */}
          {slot !== ALL_MEALS && (
            <p className="text-xs font-medium text-muted-foreground">
              {t('trends.chart.slotOnly', { meal: t(MEAL_LABEL_KEYS[slot]) })}
            </p>
          )}
        </div>
        <TrendControls metric={metric} range={range} slot={slot} tab={tab} />
      </CardHeader>
      <CardContent className="space-y-4">
        {hasEnoughDays ?
          <>
            <TrendChart
              model={chart}
              metric={metric}
              goalValue={goalValue}
              isWeekly={isWeekly}
              averageFractions={averageFractions}
            />
            <TrendLegend
              metric={metric}
              hasGoal={chart.goalFraction !== null}
              hasAverageLine={averageFractions !== null && averageFractions.some((fraction) => fraction !== null)}
              hasCarbsOutline={chart.bars.some((bar) => bar.outlineFraction !== null && bar.outlineFraction > bar.heightFraction)}
            />
          </>
        : <SparseTrendNotice loggedDays={loggedDaysInRange} />}
      </CardContent>
    </Card>
  );
}

export default function Trends({ loaderData }: Route.ComponentProps) {
  const {
    entries,
    leadEntries,
    goals,
    range,
    slot,
    tab,
    metric,
    recap,
    weight,
    eatingWindow,
    hasAnyData,
    today,
    gridDays,
    adherenceGoals,
    weightWindow,
    targetWeightKg,
    todayWeightKg,
    marks,
    gamificationHidden,
  } = loaderData;
  // Device-local display preference, shared with `/settings/profile` (which owns
  // the toggle). Read once per mount, so returning here after switching it
  // there picks the new unit up.
  const [weightUnit] = useState<WeightUnit>(readStoredWeightUnit);
  const { t } = useTranslation();

  if (!hasAnyData) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyTrends />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* M239/02: four review sections in the URL. Every tab keeps `range`
          and `slot`, so switching sections never resets the chart window or
          the meal filter. */}
      <InsightsTabStrip active={tab} range={range} slot={slot} metric={metric} />

      {tab === 'overview' && (
        <>
          {/* The ACTIVITY streak (M235/06), the same number `/dashboard` shows,
              derived from the same marks by the same function. The card is also
              the only door to `/awards`, and both go together when the person
              has switched these surfaces off. It renders on an ordinary card
              surface — "This week" below is already this screen's one
              `.surface-brand` hero (DESIGN.md §2). */}
          <ActivityStreakCard marks={marks} today={today} hidden={gamificationHidden} />

          <WeeklyRecapCard
            current={recap.current}
            previous={recap.previous}
            weight={weight}
            eatingWindow={eatingWindow}
            goals={{ netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor }}
          />

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
      )}

      {/* The 13-week goal record. `buildAdherenceGrid` is called here, inline
          in the JSX it feeds, rather than through a `useMemo` computed on
          every render: this way the grid is built only on the render where
          the Goals tab is actually shown, not on every metric toggle from the
          Nutrition tab. */}
      {tab === 'goals' && (
        <AdherenceGridCard
          grid={buildAdherenceGrid({ today, weeks: GRID_WEEKS, days: gridDays, goals: adherenceGoals })}
          goals={adherenceGoals}
        />
      )}

      {(tab === 'nutrition' || tab === 'meals') && (
        <>
          <ChartCard
            entries={entries}
            leadEntries={leadEntries}
            range={range}
            slot={slot}
            tab={tab}
            metric={metric}
            goals={goals}
          />
          {tab === 'nutrition' && (
            <>
              <MacroEnergySplitCard days={entries} isWeekly={range >= WEEKLY_BARS_FROM_RANGE} />
              <Button variant="outline" size="sm" asChild>
                <Link to="/nutrients">{t('nav.nutrients')}</Link>
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
