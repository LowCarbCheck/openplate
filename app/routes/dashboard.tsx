/**
 * Overview — the app home (M134).
 *
 * Three PERMANENT modules: one brand hero answering "where does today stand,
 * and how do I add to it", then a 7-day habit tile and a weight tile, each of
 * which links once to the screen that owns the detail. `/diary` remains today's
 * DETAIL; `/trends` remains the history. This route owns no data of its own —
 * every figure below is derived from an existing aggregate.
 *
 * Plus exactly ONE conditional strip: `FastStrip` (M132), present only while a
 * fast is scheduled or running. The page's budget is one phone screen with no
 * scroll and the three permanent modules already spend it (~320 px hero + 16 px
 * gap + ~155 px glance row ≈ the ~491 px content area of a 375x667 phone), so
 * the strip's ~57 px plus its 16 px gap means the page scrolls by ~73 px WHILE
 * A FAST EXISTS and not otherwise. That cost is accepted on two grounds: the
 * common case is untouched, and the strip sits ABOVE the glance row so what
 * falls below the fold is the bottom of the weight tile rather than the fast —
 * an active fast is the only time-sensitive fact on the screen, and the thing
 * that has to be scrolled to should be the thing that is not moving.
 *
 * That arithmetic is also the standing argument against a FOURTH module and
 * against a mini adherence grid: a third glance tile would orphan a 2+1 row and
 * cost a full ~120 px, which is a different order of expense from a strip.
 */
import type { ReactElement } from 'react';
import type { Route } from './+types/dashboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Link } from '#app/components/link';
import {
  computeDailyTotals,
  computeDailyTotalsInRange,
  computeLocalHabitStrip,
  getLocalProfileGoals,
  listLocalFasts,
  listLocalFoodLogs,
  listLocalWeightEntries,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalFast } from '#app/lib/local-store';
import { selectCurrentFast } from '#app/models/fasting';
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import { computeDayGaps } from '#app/lib/macro-gaps';
import { formatDayLabel } from '#app/lib/format-day-label';
import { fromKg, roundWeightForDisplay, formatKgForDisplay } from '#app/lib/weight-units';
import type { WeightUnit } from '#app/lib/weight-units';
import { readStoredWeightUnit } from '#app/lib/weight-unit-preference';
import { cn } from '#app/lib/utils';
import { EMPTY_DAY_SUMMARY } from '#app/models/food-log-summary';
import type { DaySummary } from '#app/models/food-log-summary';
import { countLoggedDays } from '#app/models/habit-strip';
import type { HabitStripDay } from '#app/models/habit-strip';
import { computeWeightGlance } from '#app/models/dashboard';
import type { WeightGlance } from '#app/models/dashboard';
import { AddFoodActions } from '#app/components/add-food-actions';
import { FastStrip } from '#app/components/fast-strip';
import { HabitStrip } from '#app/components/habit-strip';
import { HeroStat, formatHeroStat } from '#app/components/hero-stat';
import { RingProgress } from '#app/components/ring-progress';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow } from '#app/components/typography';
import { CarbImpactChip, HeroProteinFigure } from '#app/components/day-drill-down';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`).
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.dashboard') },
];

export const handle = {
  // `title` stays as the untranslated fallback for any consumer that reads the
  // handle outside a React tree (where `t` isn't available).
  title: 'Overview',
  titleKey: 'dashboard.title',
};

/** The strip's width, and the window the week tile and the weight delta share. */
const WEEK_DAYS = 7;

/** The one link style this page uses to hand the user on to the screen that owns the detail. */
const HANDOFF_LINK_CLASS =
  'inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline';

/**
 * Card padding for the two glance tiles.
 *
 * They sit two-up from the narrowest phone up (see the page component), so on a
 * 375 px screen each tile is ~164 px wide and `Card`'s stock `p-6` would spend
 * 48 px of that on gutters — leaving ~116 px, which is less than the seven-dot
 * strip's own width. `p-4` below `sm` gives the content ~132 px and hands back
 * 16 px of height per tile; the desktop geometry is untouched at `sm` and up.
 */
const GLANCE_HEADER_CLASS = 'p-4 pb-2 sm:p-6 sm:pb-3';
const GLANCE_CONTENT_CLASS = 'p-4 pt-0 sm:p-6 sm:pt-0';

////////////////////////////////////////////////////////////////////////////////
// Server loader — none needed (this route's data is entirely on-device)
////////////////////////////////////////////////////////////////////////////////

/**
 * No server work. Present so an offline client-side navigation resolves without
 * a `.data` fetch, matching `/diary` and `/trends`.
 */
export async function loader() {
  return {};
}

////////////////////////////////////////////////////////////////////////////////
// Client loader
////////////////////////////////////////////////////////////////////////////////

export interface DashboardData {
  today: string;
  hasLoggedToday: boolean;
  summary: DaySummary;
  goals: { netCarbsCeiling: number | null; proteinFloor: number | null; kcalTarget: number | null };
  habitStrip: HabitStripDay[];
  loggedDaysCount: number;
  weight: WeightGlance;
  /**
   * The one scheduled-or-running fast, or null (M132). The RAW row: its status
   * and every figure the strip renders are derived in the component against a
   * live clock, because a status resolved here is already stale by first paint.
   */
  currentFast: LocalFast | null;
}

export async function clientLoader(): Promise<DashboardData> {
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const today = todayInTimezone(timezone);

  const allLogs = await listLocalFoodLogs();
  const totalsForToday = computeDailyTotals(allLogs, today);

  const goals = {
    netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null,
    proteinFloor: profile?.goalProteinFloorG ?? null,
    kcalTarget: profile?.goalKcalTarget ?? null,
  };

  // ONE range query backs the strip; the weight glance windows the same seven
  // days so "the last 7 days" means one thing on this page.
  const totalsWindow = computeDailyTotalsInRange(allLogs, {
    fromDate: shiftDate(today, -(WEEK_DAYS - 1)),
    toDate: today,
  });
  const habitStrip = computeLocalHabitStrip({
    dailyTotals: totalsWindow,
    today,
    dayCount: WEEK_DAYS,
    netCarbsCeiling: goals.netCarbsCeiling,
  });

  const weightEntries = await listLocalWeightEntries();
  const fasts = await listLocalFasts();

  return {
    currentFast: selectCurrentFast(fasts),
    today,
    hasLoggedToday: totalsForToday.hasLogs,
    summary: totalsForToday.summary ?? EMPTY_DAY_SUMMARY,
    goals,
    habitStrip,
    loggedDaysCount: countLoggedDays(habitStrip),
    weight: computeWeightGlance({ entries: weightEntries, today, windowDays: WEEK_DAYS }),
  };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads today from the on-device primary store. */
export function HydrateFallback(): ReactElement {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('dashboard.loading')}
    </output>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Today — the page's one brand hero
////////////////////////////////////////////////////////////////////////////////

/**
 * Today at a glance, plus the two buttons that start a log.
 *
 * Deliberately NOT a second diary: no meal list, no drill-down, no macro grid,
 * and — unlike `/diary`'s hero — no count-up tween. The tween exists to show an
 * add landing; nothing is added on this screen, so there is no old→new value to
 * animate and `RingProgress` gets the true value with no `animatedValue`.
 */
function TodayHeroCard({
  summary,
  goals,
  hasLoggedToday,
}: {
  summary: DaySummary;
  goals: DashboardData['goals'];
  hasLoggedToday: boolean;
}): ReactElement {
  const { t, i18n } = useTranslation();

  const gaps = computeDayGaps({
    totals: { netCarbs: summary.netCarbs, protein: summary.protein, fiber: summary.fiber },
    goals: { netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor },
    t,
  });

  const heroStat = formatHeroStat({
    netCarbs: summary.netCarbs,
    netCarbsCeiling: goals.netCarbsCeiling,
    kcal: summary.kcal,
    kcalTarget: goals.kcalTarget,
    hasEstimates: summary.hasEstimates,
    t,
    language: i18n.language,
  });

  // The ring tracks whichever budget the user actually set — carbs first,
  // calories for someone who tracks those instead, nothing at all when they set
  // neither (a ring against an invented target would be a fabricated goal).
  const budget =
    goals.netCarbsCeiling !== null && goals.netCarbsCeiling > 0 ?
      { consumed: summary.netCarbs, max: goals.netCarbsCeiling }
    : goals.kcalTarget !== null && goals.kcalTarget > 0 ? { consumed: summary.kcal, max: goals.kcalTarget }
    : null;

  /**
   * The verdict + protein pair, or the empty line.
   *
   * On an untouched plate the carb-impact chip resolves to "Low carb impact",
   * which is true and useless — it grades a day nobody has eaten yet. So the
   * whole glance is suppressed until something is logged, exactly as `/diary`
   * withholds its summary card until then.
   */
  const renderGlance = (centered: boolean) =>
    hasLoggedToday ?
      <div className={cn('flex flex-col gap-2.5', centered ? 'items-center sm:items-start' : 'items-start')}>
        <CarbImpactChip impact={gaps.impact} />
        <HeroProteinFigure gap={gaps.protein} />
      </div>
    : <p className={cn('text-sm text-muted-foreground', centered && 'text-center sm:text-left')}>
        {t('diary.empty.ordinary.line')}
      </p>;

  const actions = (
    <div className="space-y-3">
      <AddFoodActions addTo="/add" scanTo="/scan" />
      <Link to="/diary" className={HANDOFF_LINK_CLASS}>
        {t('dashboard.today.openDiary')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );

  // The page's single `.surface-brand` (DESIGN.md §2, one hero per screen) —
  // the two glance tiles below are plain `bg-card`.
  return (
    <Card className="surface-brand overflow-hidden rounded-2xl border-primary/30 shadow-md">
      <CardContent className="space-y-5 p-5 sm:p-6">
        {budget === null ?
          <div className="space-y-5">
            <div className="space-y-1.5">
              <SectionEyebrow>{t('diary.hero.eyebrow')}</SectionEyebrow>
              <HeroStat stat={heroStat} value={heroStat.value} size="headline" />
            </div>
            {renderGlance(false)}
          </div>
        : <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
            <RingProgress
              value={budget.consumed}
              max={budget.max}
              size={120}
              strokeWidth={10}
              className="[--ring-box:104px] sm:[--ring-box:120px]"
              trackClassName="text-primary/20"
              progressClassName={heroStat.isOver ? 'text-accent-amber' : 'text-primary'}
              label={heroStat.srLabel}
            >
              <HeroStat stat={heroStat} value={heroStat.value} />
            </RingProgress>
            <div className="w-full min-w-0 flex-1 space-y-3">{renderGlance(true)}</div>
          </div>
        }
        {actions}
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The two glance tiles
////////////////////////////////////////////////////////////////////////////////

/**
 * The last seven days as the diary's own dot strip — NOT a miniature of
 * `/trends`' 13-week adherence grid. A different time scale is a different
 * fact; a shrunken copy of the grid would be the duplication the nav catalog
 * exists to prevent. The streak NUMBER stays on `/trends` for the same reason.
 */
function WeekGlanceCard({
  habitStrip,
  loggedDaysCount,
  hasCeiling,
}: {
  habitStrip: HabitStripDay[];
  loggedDaysCount: number;
  hasCeiling: boolean;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className={GLANCE_HEADER_CLASS}>
        <CardTitle className="text-base">{t('dashboard.week.title')}</CardTitle>
      </CardHeader>
      <CardContent className={cn(GLANCE_CONTENT_CLASS, 'space-y-3')}>
        <HabitStrip
          days={habitStrip}
          loggedCount={loggedDaysCount}
          hasCeiling={hasCeiling}
          showLegend={false}
          emptyLabel={t('dashboard.week.empty')}
          dense
        />
        <Link to="/trends" className={HANDOFF_LINK_CLASS}>
          {t('dashboard.week.link')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

/** A signed weekly change in the display unit — "+0.4 kg", "−1.2 kg", "0 kg". */
function formatWeightDelta(deltaKg: number, unit: WeightUnit): string {
  const displayed = roundWeightForDisplay(fromKg(deltaKg, unit));
  const sign =
    displayed > 0 ? '+'
    : displayed < 0 ? '−'
    : '';
  return `${sign}${Math.abs(displayed)} ${unit}`;
}

/**
 * The latest weigh-in, and how it moved over the same seven days the strip
 * covers. A single weigh-in shows the figure and no delta — "0.0 over the last
 * 7 days" would read as "no change" rather than "not enough data".
 */
function WeightGlanceCard({ weight }: { weight: WeightGlance }): ReactElement {
  const { t, i18n } = useTranslation();
  // Device-local display preference, owned by `/settings/goals`. Read once per
  // mount, same as `/trends`.
  const [weightUnit] = useState<WeightUnit>(readStoredWeightUnit);

  return (
    <Card>
      <CardHeader className={GLANCE_HEADER_CLASS}>
        <CardTitle className="text-base">{t('trends.weight.title')}</CardTitle>
      </CardHeader>
      <CardContent className={cn(GLANCE_CONTENT_CLASS, 'space-y-2')}>
        {weight.latestKg === null || weight.latestDate === null ?
          <p className="text-sm text-muted-foreground">{t('trends.weight.empty')}</p>
        : <>
            <p className="text-2xl font-semibold tabular-nums">
              {formatKgForDisplay(weight.latestKg, weightUnit)}{' '}
              <span className="text-base font-normal text-muted-foreground">{weightUnit}</span>
            </p>
            {/*
              The weigh-in DATE is the first thing to go on a phone: it is the
              least load-bearing line in the tile (the figure and the 7-day
              delta both survive), and `/trends` — one tap away through the link
              below — is where the dated history actually lives.
            */}
            <p className="hidden text-xs text-muted-foreground sm:block">
              {t('trends.weight.stat.latestOn', { date: formatDayLabel(weight.latestDate, i18n.language) })}
            </p>
            {weight.deltaKg !== null && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {t('dashboard.weight.since', { delta: formatWeightDelta(weight.deltaKg, weightUnit) })}
              </p>
            )}
          </>
        }
        <Link to="/trends" className={HANDOFF_LINK_CLASS}>
          {t('dashboard.weight.link')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { hasLoggedToday, summary, goals, habitStrip, loggedDaysCount, weight, currentFast } = loaderData;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <TodayHeroCard summary={summary} goals={goals} hasLoggedToday={hasLoggedToday} />
      {/*
        Conditional and ABOVE the glance row (M132) — see this file's header for
        the height arithmetic and why the fast outranks last week's weight for
        the space above the fold. Absent entirely with no fast, so the shipped
        no-scroll page is untouched in the common case.
      */}
      {currentFast !== null && <FastStrip fast={currentFast} />}
      {/*
        Two-up at EVERY width, not just from `sm`. Stacked, the two tiles put
        the page at 812 px on a 375x667 phone against ~491 px of content area,
        and the weight tile ended up behind the fixed bottom bar. Side by side
        they cost one row instead of two, which is the design spec's own
        prescribed mitigation for the small-phone case (§1.2 caveat) — the hero
        stays exactly as it is.
      */}
      <div className="grid grid-cols-2 gap-4">
        <WeekGlanceCard
          habitStrip={habitStrip}
          loggedDaysCount={loggedDaysCount}
          hasCeiling={goals.netCarbsCeiling !== null}
        />
        <WeightGlanceCard weight={weight} />
      </div>
    </div>
  );
}
