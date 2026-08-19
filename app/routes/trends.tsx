import { useMemo, useState } from 'react';
import type { Route } from './+types/trends';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { parseWithZod } from '@conform-to/zod/v4';
import {
  computeDailyTotalsInRange,
  getLocalProfileGoals,
  listLocalFoodLogs,
  listLocalWeightEntries,
  resolveLocalTimezone,
  upsertLocalWeightEntryForDay,
} from '#app/lib/local-store';
import { enumerateDates, shiftDate, todayInTimezone } from '#app/lib/user-days';
import { startOfWeek } from '#app/lib/trend-week';
import { buildTrendChart } from '#app/lib/trend-chart';
import type { TrendMetric } from '#app/lib/trend-chart';
import { computeWeeklyRecap } from '#app/lib/trend-recap';
import { computeWeeklyWeightChange } from '#app/lib/trend-weight';
import { computeEatingWindow } from '#app/lib/trend-eating-window';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { makeLogWeightSchema } from '#app/lib/weight-log-schema';
import { readStoredWeightUnit } from '#app/lib/weight-unit-preference';
import type { WeightUnit } from '#app/lib/weight-units';
import { buildAdherenceGrid } from '#app/models/adherence-grid';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { StreakCard } from '#app/components/streak-card';
import { AdherenceGridCard } from '#app/components/trends/adherence-grid-card';
import { TrendChart } from '#app/components/trends/trend-chart';
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
  title: 'Progress',
  titleKey: 'trends.title',
};

/** The selectable chart windows, in days. */
const ALLOWED_RANGES = [7, 14, 30] as const;
type TrendRange = (typeof ALLOWED_RANGES)[number];
/** Default window when an explicit (but invalid) range is requested. */
const DEFAULT_RANGE: TrendRange = 14;
/** The narrowest selectable window — the smart default for a brand-new account (see `pickDefaultRange`). */
const NEW_ACCOUNT_RANGE: TrendRange = 7;
/** A Monday→Sunday week is seven days wide. */
const DAYS_IN_WEEK = 7;
/** Week columns in the adherence grid. Fixed: one geometry at every breakpoint, no scroll, no responsive week count. */
const GRID_WEEKS = 13;
/** The weight window matches the grid's, so both surfaces honestly say "the last 13 weeks". */
const WEIGHT_WINDOW_DAYS = GRID_WEEKS * DAYS_IN_WEEK;

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance.
 */
const actionT = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>): string => i18n.t(key, params ?? {});

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

/** The oldest `dayKey` across a set of local food logs, or null when there are none. */
function _earliestDayKey(logs: readonly { dayKey: string }[]): string | null {
  if (logs.length === 0) return null;
  return logs.reduce((earliest, log) => (log.dayKey < earliest ? log.dayKey : earliest), logs[0].dayKey);
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

  const allLogs = await listLocalFoodLogs();

  const rawRange = new URL(request.url).searchParams.get('range');
  const range =
    rawRange === null ?
      pickDefaultRange({ earliestLoggedDate: _earliestDayKey(allLogs), today })
    : _parseRange(rawRange);

  // The chart window: `range` days ending on the user's local today.
  const entries = computeDailyTotalsInRange(allLogs, { fromDate: shiftDate(today, -(range - 1)), toDate: today });

  // Two Monday→Sunday weeks (this week + last) computed as one contiguous
  // range, then split by date for the recap comparison.
  const currentWeekStart = startOfWeek(today);
  const currentWeekEnd = shiftDate(currentWeekStart, DAYS_IN_WEEK - 1);
  const previousWeekStart = shiftDate(currentWeekStart, -DAYS_IN_WEEK);
  const previousWeekEnd = shiftDate(currentWeekStart, -1);
  const weekEntries = computeDailyTotalsInRange(allLogs, { fromDate: previousWeekStart, toDate: currentWeekEnd });
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
  const perDayLogs = currentWeekDates.map((date) => allLogs.filter((log) => log.dayKey === date));
  const eatingWindow = computeEatingWindow({
    days: perDayLogs.map((logs) => ({ loggedAtMs: logs.map((log) => log.loggedAt) })),
  });

  // The adherence grid: 13 whole Monday→Sunday columns ending in the week that
  // contains today, so the grid never shows a ragged part-week at either end.
  const gridWeekStart = startOfWeek(today);
  const gridDays = computeDailyTotalsInRange(allLogs, {
    fromDate: shiftDate(gridWeekStart, -(GRID_WEEKS - 1) * DAYS_IN_WEEK),
    toDate: shiftDate(gridWeekStart, DAYS_IN_WEEK - 1),
  }).map((day) => ({
    date: day.date,
    hasLogs: day.hasLogs,
    netCarbs: day.summary?.netCarbs ?? null,
    protein: day.summary?.protein ?? null,
    kcal: day.kcal.total,
  }));

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
    goals,
    range,
    recap,
    weight,
    eatingWindow,
    hasAnyData,
    today,
    gridDays,
    weightWindow,
    targetWeightKg: profile?.targetWeightKg ?? null,
    todayWeightKg: weightRows.find((row) => row.dayKey === today)?.weightKg ?? null,
  };
}
clientLoader.hydrate = true as const;

////////////////////////////////////////////////////////////////////////////////
// Client action — the weight card's inline quick log
////////////////////////////////////////////////////////////////////////////////

/**
 * Logs (or replaces) today's weigh-in. Mirrors `/settings/goals`' own weight
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

export default function Trends({ loaderData }: Route.ComponentProps) {
  const {
    entries,
    goals,
    range,
    recap,
    weight,
    eatingWindow,
    hasAnyData,
    today,
    gridDays,
    weightWindow,
    targetWeightKg,
    todayWeightKg,
  } = loaderData;
  const [metric, setMetric] = useState<TrendMetric>('net-carbs');
  // Device-local display preference, shared with `/settings/goals` (which owns
  // the toggle). Read once per mount, so returning here after switching it
  // there picks the new unit up.
  const [weightUnit] = useState<WeightUnit>(readStoredWeightUnit);
  const { t } = useTranslation();

  const adherenceGoals = useMemo(
    () => ({
      netCarbsCeilingG: goals.netCarbsCeiling,
      proteinFloorG: goals.proteinFloor,
      kcalTarget: goals.kcalTarget,
    }),
    [goals.netCarbsCeiling, goals.proteinFloor, goals.kcalTarget],
  );
  const adherenceGrid = useMemo(
    () => buildAdherenceGrid({ today, weeks: GRID_WEEKS, days: gridDays, goals: adherenceGoals }),
    [today, gridDays, adherenceGoals],
  );

  if (!hasAnyData) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyTrends />
      </div>
    );
  }

  const goalValue = metric === 'net-carbs' ? goals.netCarbsCeiling : goals.kcalTarget;
  const chart = buildTrendChart({ days: entries, metric, goalValue });
  // Two whole-sentence keys rather than "Daily {{metric}}" + a metric noun:
  // German inflects the adjective with the noun's gender, so the two halves
  // can't be translated independently.
  const chartTitle = metric === 'calories' ? t('trends.chart.titleCalories') : t('trends.chart.titleNetCarbs');
  // Below the threshold the chart is replaced, not drawn sparse — see
  // `SparseTrendNotice`. Counted over the SELECTED window, so widening the range
  // to 30 days can reveal a chart the 7-day window couldn't honestly show.
  const loggedDaysInRange = entries.filter((day) => day.hasLogs).length;
  const hasEnoughDays = loggedDaysInRange >= MIN_TREND_DAYS;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Moved here from the retired `/profile` page: the streak is about how
          the person is doing, which is what this screen is for. It renders on
          an ordinary card surface — "This week" below is already this
          screen's one `.surface-brand` hero (DESIGN.md §2). */}
      <StreakCard />

      {/* The 13-week record, between the glanceable streak and this week's
          recap: the page descends from glance to detail, and the heaviest,
          most control-laden surface (the daily bar chart) closes it. */}
      <AdherenceGridCard grid={adherenceGrid} goals={adherenceGoals} />

      <WeeklyRecapCard
        current={recap.current}
        previous={recap.previous}
        weight={weight}
        eatingWindow={eatingWindow}
        goals={{ netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor }}
      />

      {/* The body story is its own chapter: the chart moved here from
          `/settings/goals`, which keeps the entry form and the weigh-in list. */}
      <WeightProgressCard
        points={weightWindow}
        targetWeightKg={targetWeightKg}
        today={today}
        todayWeightKg={todayWeightKg}
        weightUnit={weightUnit}
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="space-y-1">
            {/* No `capitalize` here: the title is now a whole catalog string
                with its own correct casing, and the CSS class title-cases EVERY
                word — it rendered "Daily Net Carbs" in English and "Netto-KH
                Pro Tag" in German, which is simply wrong in both. */}
            <CardTitle className="text-lg">{chartTitle}</CardTitle>
            <CardDescription>
              {hasEnoughDays ? t('trends.chart.tapHint') : t('trends.chart.sparseHint')}
            </CardDescription>
          </div>
          <TrendControls metric={metric} onMetricChange={setMetric} range={range} />
        </CardHeader>
        <CardContent className="space-y-4">
          {hasEnoughDays ?
            <>
              <TrendChart model={chart} metric={metric} goalValue={goalValue} />
              <TrendLegend metric={metric} hasGoal={chart.goalFraction !== null} />
            </>
          : <SparseTrendNotice loggedDays={loggedDaysInRange} />}
        </CardContent>
      </Card>
    </div>
  );
}
