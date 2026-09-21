/**
 * Overview, the app home (M134).
 *
 * Three PERMANENT modules: one brand hero answering "where does today stand,
 * and how do I add to it", then a 7-day habit tile and a weight tile, each of
 * which links once to the screen that owns the detail. `/diary` remains today's
 * DETAIL; `/trends` remains the history. This route owns no data of its own ,
 * every figure below is derived from an existing aggregate.
 *
 * Plus exactly ONE conditional strip: `FastStrip` (M132), present only while a
 * fast is scheduled or running. The page's budget is one phone screen with no
 * scroll and the three permanent modules already spend it (~320 px hero + 16 px
 * gap + ~155 px glance row ≈ the ~491 px content area of a 375x667 phone), so
 * the strip's ~57 px plus its 16 px gap means the page scrolls by ~73 px WHILE
 * A FAST EXISTS and not otherwise. That cost is accepted on two grounds: the
 * common case is untouched, and the strip sits ABOVE the glance row so what
 * falls below the fold is the bottom of the weight tile rather than the fast ,
 * an active fast is the only time-sensitive fact on the screen, and the thing
 * that has to be scrolled to should be the thing that is not moving.
 *
 * That arithmetic used to be the standing argument against a FOURTH module and
 * against putting the adherence grid here: a third glance tile would orphan a
 * 2+1 row and cost a full ~120 px, which is a different order of expense from a
 * strip. The owner OVERRULED that on 2026-09-10. The 13-week grid from
 * `/trends` now also renders here, near the top, as `StreakGridCard`, and the
 * page scrolls. The argument above is kept as the record of what the cost was,
 * not as a rule: the grid is the record of showing up, and the owner's call is
 * that it is worth a scroll on the screen people open first. The two grids are
 * fed from ONE selection (`#app/lib/adherence-grid-days`) so they can never
 * disagree about a day.
 *
 * The glance row is one column on a phone and two from `sm`, which costs the
 * page another tile's height below 640 px. See that row's own comment for what
 * half a 360 px screen did to the week tile's weekday labels.
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
  getLocalBodyMetrics,
  getLocalProfileGoals,
  listLocalActivityMarks,
  listLocalFoodLogs,
  listLocalWeightEntries,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { ReproductiveStatus } from '#app/lib/local-store';
import { shiftDate, todayInTimezone } from '#app/lib/user-days';
import { selectRepeatYesterday } from '#app/lib/copy-day';
import type { RepeatYesterdayOffer } from '#app/lib/copy-day';
import { computeDayGaps, dayVerdict } from '#app/lib/macro-gaps';
import { effectiveEatingStyle, lensForStyle } from '#app/lib/eating-style';
import type { EatingStyleLens } from '#app/lib/eating-style';
import {
  computeReferenceProteinFloor,
  selectLatestWeighInKg,
  selectMissingReferenceDate,
} from '#app/models/body-metrics';
import { resolveAdherenceGoals } from '#app/lib/adherence-goals';
import type { MissingReferenceDate } from '#app/lib/macro-gaps';
import { formatDayLabel } from '#app/lib/format-day-label';
import { fromKg, roundWeightForDisplay, formatKgForDisplay } from '#app/lib/weight-units';
import type { WeightUnit } from '#app/lib/weight-units';
import { readStoredWeightUnit } from '#app/lib/weight-unit-preference';
import { cn } from '#app/lib/utils';
import { EMPTY_DAY_SUMMARY } from '#app/models/food-log-summary';
import type { DaySummary } from '#app/models/food-log-summary';
import { buildDayRidge } from '#app/models/day-ridge';
import type { DayRidge as DayRidgeModel } from '#app/models/day-ridge';
import { computeWeightGlance } from '#app/models/dashboard';
import type { WeightGlance } from '#app/models/dashboard';
import { GRID_WEEKS, selectAdherenceGridDays } from '#app/lib/adherence-grid-days';
import { buildAdherenceGrid } from '#app/models/adherence-grid';
import type { AdherenceGoals, AdherenceGrid as AdherenceGridModel } from '#app/models/adherence-grid';
import { deriveActivityStreak, isGamificationHidden } from '#app/lib/gamification/surfaces';
import { dismissInsightsHint, isInsightsHintDismissed } from '#app/lib/insights-hint';
import { WhatsNewCard } from '#app/components/whats-new-card';
import { IntakeComposer } from '#app/components/intake/intake-composer';
import { RepeatYesterdayGhost } from '#app/components/repeat-yesterday-door';
import { FastStrip } from '#app/components/fast-strip';
import { PulseTileSlot } from '#app/components/pulse-tile';
import { StreakGridCard } from '#app/components/dashboard/streak-grid-card';
import { AwardNote } from '#app/components/gamification/award-note';
import { ReproductiveStatusPromptBanner } from '#app/components/reproductive-status-prompt-banner';
import { DayRidge } from '#app/components/day-ridge';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SectionEyebrow } from '#app/components/typography';
import { DayBudgetRows } from '#app/components/day-budget-rows';
import { buildDayBudgetRows } from '#app/lib/day-budget-rows';
import { DayVerdictChip } from '#app/components/day-summary-details';
import { MIN_TREND_DAYS } from '#app/components/trends/sparse-trend-notice';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`).
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
  'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline md:min-h-0';

/**
 * The pantry door under the composer (M233/02).
 *
 * A quiet bordered row, NOT a second `surface-brand` card and not a filled
 * button: this page already has exactly one hero (DESIGN.md §2), and the
 * composer directly above it is the loud thing in this block. The door is a
 * headline plus one line, which is enough to say what it is for without
 * competing with the control it sits under.
 */
const PANTRY_DOOR_CLASS =
  'flex w-full flex-col gap-0.5 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5';

/**
 * Card padding for the two glance tiles.
 *
 * They sit two-up from the narrowest phone up (see the page component), so on a
 * 375 px screen each tile is ~164 px wide and `Card`'s stock `p-6` would spend
 * 48 px of that on gutters, leaving ~116 px, which is less than the seven-dot
 * strip's own width. `p-4` below `sm` gives the content ~132 px and hands back
 * 16 px of height per tile; the desktop geometry is untouched at `sm` and up.
 */
const GLANCE_HEADER_CLASS = 'p-4 pb-2 sm:p-6 sm:pb-3';
const GLANCE_CONTENT_CLASS = 'p-4 pt-0 sm:p-6 sm:pt-0';

////////////////////////////////////////////////////////////////////////////////
// Server loader, none needed (this route's data is entirely on-device)
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
  goals: {
    netCarbsCeiling: number | null;
    proteinFloor: number | null;
    /**
     * The calorie target as it is DISPLAYED and compared against: the figure the
     * person typed in, plus the EFSA pregnancy or lactation addition when one
     * applies. The raw figure they typed is what storage and the goals page keep.
     */
    kcalTarget: number | null;
    /** The population reference protein floor, used only while `proteinFloor` is null. */
    proteinReferenceG: number;
    /** Which date would make both references follow the person's real stage, or null. */
    proteinReferenceMissingDate: MissingReferenceDate | null;
    /** The eating style's lens, which decides the day's one verdict. */
    lens: EatingStyleLens;
  };
  /**
   * The week tile's Budget Ridge (M216/01), seven days as one metric against
   * its goal. It replaced the dense habit-strip dots here; `/diary` still ships
   * the dots, which is where the dot metaphor is taught.
   */
  ridge: DayRidgeModel;
  /**
   * The 13-week goal grid, the same model `/trends` draws (owner's call,
   * 2026-09-10, see this file's header). Built in the loader rather than
   * memoised in the component the way `/trends` does it, because that is this
   * page's own convention: `ridge` and `weight` are both built here too, which
   * keeps every component on this route presentational.
   */
  grid: AdherenceGridModel;
  /** The goals the grid graded each day against, carried so the card's readouts can name them. */
  adherenceGoals: AdherenceGoals;
  /**
   * The ACTIVITY streak for the grid card's header line, or null when the
   * person has switched the streak and the awards off, in which case the card
   * keeps the grid and drops the streak line (M235/06).
   */
  streak: number | null;
  /**
   * Whether the streak, the awards screen and the award note are switched off
   * (M235/06). Carried separately from `streak` because the NOTE reads the
   * store for itself (an award can become true between two renders, after a
   * sync pull), so it needs the switch rather than the number.
   */
  gamificationHidden: boolean;
  weight: WeightGlance;
  /** The stored reproductive status, or null. Read only: this page never writes it back. */
  reproductiveStatus: ReproductiveStatus | null;
  /** The stored pregnancy due date (`YYYY-MM-DD`), or null. */
  pregnancyDueDate: string | null;
  /** The stored lactation start date (`YYYY-MM-DD`), or null. */
  lactationStartDate: string | null;
  /**
   * Whether today is worth offering a whole-day repeat of yesterday (M217), and
   * with what counts. Null means the card renders exactly what it did before.
   */
  repeatYesterday: RepeatYesterdayOffer | null;
  /**
   * Whether the one-time door to Insights should render (M239/06): the person
   * has logged at least `MIN_TREND_DAYS` of the last 7 days (the same window
   * `ridge` already summarizes) AND has not waved it away on this device
   * before. Decided here, not in the component, so a dismissal recorded on a
   * PRIOR load already keeps the card gone across a reload without a second
   * localStorage read at render time.
   */
  showInsightsHint: boolean;
}

/**
 * Whether this device has already waved away the Insights hint.
 *
 * Empty (never dismissed) outside a browser, the same guard `diary.tsx`'s own
 * `readDismissedHints` uses for its per-slot hint, and for the same reason:
 * this runs in the client loader, which never sees a server.
 */
function isInsightsHintDismissedOnDevice(): boolean {
  if (globalThis.localStorage === undefined) return false;
  return isInsightsHintDismissed(globalThis.localStorage);
}

/** Records the Insights hint as dismissed on this device. A no-op outside a browser. */
function dismissInsightsHintOnDevice(): void {
  if (globalThis.localStorage === undefined) return;
  dismissInsightsHint(globalThis.localStorage);
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
    // Which single verdict this account is graded by (M210). Derived here from
    // the stored style, or from the numbers for a profile written before the
    // style existed, so the card never has to know either rule.
    lens: lensForStyle(
      effectiveEatingStyle({
        goalNetCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
        goalKcalTarget: profile?.goalKcalTarget ?? null,
        goalProteinFloorG: profile?.goalProteinFloorG ?? null,
        eatingStyle: profile?.eatingStyle ?? null,
      }),
    ),
  };

  // ONE range query backs the ridge; the weight glance windows the same seven
  // days so "the last 7 days" means one thing on this page.
  const totalsWindow = computeDailyTotalsInRange(allLogs, {
    fromDate: shiftDate(today, -(WEEK_DAYS - 1)),
    toDate: today,
  });

  const weightEntries = await listLocalWeightEntries();

  // A protein floor for someone who set none: scaled by their own latest
  // weigh-in, or by height and sex, and tagged `'default'` downstream so the
  // row reads as a reference rather than as a goal they chose.
  const bodyMetrics = await getLocalBodyMetrics();
  // The stage is resolved against `today`, the same device-local day key the
  // weigh-in glance windows, so every figure on this page agrees about what day
  // it is. With no date on file both resolvers answer null and the references
  // fall back to the largest figure for the status, which is what they did
  // before a date could be recorded at all.
  // The energy addition lands on the target the person TYPED IN, and only when
  // they typed one. Nothing is written back: `goalKcalTarget` in the store is
  // still their own figure. The resolved stage comes back with it, so the
  // protein reference below reads the same stage the calories did.
  const { goals: adherenceGoals, stage, kcalTarget } = resolveAdherenceGoals({ goals, bodyMetrics, today });
  const proteinReferenceG = computeReferenceProteinFloor({
    ...stage,
    latestWeighInKg: selectLatestWeighInKg(weightEntries),
    heightCm: bodyMetrics.heightCm,
    biologicalSex: bodyMetrics.biologicalSex,
  }).grams;

  // The grid's own window: 13 whole Monday to Sunday columns, selected through
  // the seam `/trends` uses so the two screens agree day for day.
  const gridDays = selectAdherenceGridDays({ allLogs, today, weeks: GRID_WEEKS });
  // The goals the grid grades against come from `resolveAdherenceGoals` above:
  // `kcalTarget` is the DISPLAYED one, reproductive addition included, so the
  // squares agree with the budget rows above them. `/trends` and the diary's
  // calendar call the same builder, so one day carries one verdict everywhere.

  // The ACTIVITY streak (M235/06), off the marks rather than off the diary:
  // the number here and the number on `/trends` are now one walk over one set
  // of facts, so the two screens cannot disagree. A day over the carb goal
  // changes nothing about it; that idea is an award family of its own.
  const gamificationHidden = isGamificationHidden(profile);

  // Built here, after `kcalTarget` above, so a kcal-lens ridge grades the day
  // against the target the rows DISPLAY, reproductive addition included.
  // Named rather than built inline in the `return`, because its
  // `loggedDayCount` is also the Insights hint's gate below, the same 7-day
  // population the week tile itself already summarizes, not a second count.
  const ridge = buildDayRidge({
    dailyTotals: totalsWindow,
    today,
    dayCount: WEEK_DAYS,
    lens: goals.lens,
    goals: { netCarbsCeiling: goals.netCarbsCeiling, kcalTarget, proteinFloor: goals.proteinFloor },
  });

  return {
    today,
    // The three fields the status prompt reads (M206/04). They ride the loader
    // rather than a second store read in the component, and they are REPORTED
    // only: nothing on this page ever writes a reproductive status back.
    reproductiveStatus: bodyMetrics.reproductiveStatus,
    pregnancyDueDate: bodyMetrics.pregnancyDueDate ?? null,
    lactationStartDate: bodyMetrics.lactationStartDate ?? null,
    hasLoggedToday: totalsForToday.hasLogs,
    // Off the `allLogs` read above, so the "Wie gestern" door costs no second
    // store pass. The day keys are the timezone-derived ones this loader
    // already works in.
    repeatYesterday: selectRepeatYesterday({ logs: allLogs, today, yesterday: shiftDate(today, -1) }),
    summary: totalsForToday.summary ?? EMPTY_DAY_SUMMARY,
    goals: {
      ...goals,
      kcalTarget,
      proteinReferenceG,
      proteinReferenceMissingDate: selectMissingReferenceDate(stage),
    },
    ridge,
    // M239/06: offered once the week tile above already has something to
    // show (at least `MIN_TREND_DAYS` of the last 7 days logged), and never
    // again once this device has waved it away.
    showInsightsHint: ridge.loggedDayCount >= MIN_TREND_DAYS && !isInsightsHintDismissedOnDevice(),
    grid: buildAdherenceGrid({ today, weeks: GRID_WEEKS, days: gridDays, goals: adherenceGoals }),
    adherenceGoals,
    streak: gamificationHidden ? null : deriveActivityStreak({ marks: await listLocalActivityMarks(), today }),
    gamificationHidden,
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
// Today, the page's one brand hero
////////////////////////////////////////////////////////////////////////////////

/**
 * Today at a glance, plus the two buttons that start a log.
 *
 * The same budget rows `/diary` leads with, and nothing else: no meal list, no
 * macro grid, no suggestions, and, unlike `/diary`'s card, no count-up
 * tween. The tween exists to show an add landing; nothing is added on this
 * screen, so `DayBudgetRows` gets the settled headlines. This page's budget is
 * one phone screen with no scroll (see the module header), which is the
 * standing argument against adding anything else here.
 */
function TodayHeroCard({
  summary,
  goals,
  hasLoggedToday,
  repeatYesterday,
}: {
  summary: DaySummary;
  goals: DashboardData['goals'];
  hasLoggedToday: boolean;
  repeatYesterday: RepeatYesterdayOffer | null;
}): ReactElement {
  const { t, i18n } = useTranslation();

  const gaps = computeDayGaps({
    totals: { netCarbs: summary.netCarbs, protein: summary.protein, fiber: summary.fiber },
    goals: {
      netCarbsCeiling: goals.netCarbsCeiling,
      proteinFloor: goals.proteinFloor,
      proteinReferenceG: goals.proteinReferenceG,
      proteinReferenceMissingDate: goals.proteinReferenceMissingDate,
    },
    t,
  });

  // The kcal figure the verdict grades is the one the rows display: the target
  // the person typed in, plus any reproductive addition the loader applied.
  const verdict = dayVerdict({
    lens: goals.lens,
    gaps,
    kcal: { consumed: summary.kcal, target: goals.kcalTarget },
    protein: { consumed: summary.protein, floor: goals.proteinFloor },
  });

  const rows = buildDayBudgetRows({
    totals: {
      netCarbs: summary.netCarbs,
      kcal: summary.kcal,
      protein: summary.protein,
      fat: summary.fat,
      fiber: summary.fiber,
      hasEstimates: summary.hasEstimates,
    },
    goals: {
      netCarbsCeiling: goals.netCarbsCeiling,
      kcalTarget: goals.kcalTarget,
      proteinFloor: goals.proteinFloor,
      missingReferenceDate: goals.proteinReferenceMissingDate,
    },
    gaps,
    t,
    language: i18n.language,
  });

  const actions = (
    <div className="space-y-3">
      {/*
        CONDITIONAL, and above the add row (M217). Somebody who eats the same
        thing every day thinks "wie gestern" on this screen, not on `/diary`,
        so the offer is here; it renders nothing at all on a day with nothing to
        repeat, which leaves the no-scroll phone page untouched in the common
        case. It posts `/diary`'s existing copy intent and owns no write.

        The GHOST card, not the pill button the other surfaces use: a fourth
        thing to press beside the add controls was the complaint, and a card
        that draws the day it would bring over is a different kind of object
        from the strip under it. The strip is the composer, one control with
        the camera and the microphone in its frame, for the same reason.
      */}
      <RepeatYesterdayGhost offer={repeatYesterday} />
      <IntakeComposer describeTo="/describe" />
      {/*
        THE SECOND THING THE COMPOSER ABOVE IS FOR (M233/02), and it is a
        separate door rather than a fourth key inside the strip. The strip
        takes an intake; where that intake GOES is the call site's decision,
        and a person standing in front of an open fridge is answering a
        different question from one who has just eaten. Two sentences under
        the composer say which is which; a toggle inside it would make every
        photograph a guess about which list it lands in.
      */}
      <Link to="/pantry" className={PANTRY_DOOR_CLASS}>
        <span className="text-sm font-medium">{t('pantry.door.title')}</span>
        <span className="text-xs text-muted-foreground">{t('pantry.door.line')}</span>
      </Link>
      <Link to="/diary" className={HANDOFF_LINK_CLASS}>
        {t('dashboard.today.openDiary')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );

  // The page's single `.surface-brand` (DESIGN.md §2, one hero per screen),
  // the two glance tiles below are plain `bg-card`. What marks the hero is the
  // graph paper `.surface-brand` draws inside the panel and the hero radius,
  // not a fill or a border of its own: those are an ordinary card's since
  // M243/04.
  return (
    <Card className="surface-brand overflow-hidden rounded-2xl shadow-sm">
      {/* `p-4 space-y-4` rather than `p-5 space-y-5` (M243 spec 05a): the hero
          filled about four fifths of the phone, and the graph paper it now
          draws is only worth drawing if some of the page shows beside it. */}
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-2">
          <SectionEyebrow>{t('diary.hero.eyebrow')}</SectionEyebrow>
          {/*
            On an untouched plate the carb-impact chip resolves to "Low carb
            impact", which is true and useless, because it grades a day nobody has
            eaten yet. So the verdict is withheld until something is logged,
            exactly as `/diary` withholds its summary card until then. A style
            with no lens is withheld always: `DayVerdictChip` renders nothing.
          */}
          {hasLoggedToday && <DayVerdictChip verdict={verdict} />}
          {!hasLoggedToday && <p className="text-sm text-muted-foreground">{t('diary.empty.ordinary.line')}</p>}
        </div>
        <DayBudgetRows rows={rows} />
        {actions}
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The one-time door to Insights
////////////////////////////////////////////////////////////////////////////////

/**
 * The one-time door to Insights (M239/06): a small card offering the tour of
 * `/trends`'s Overview tab, dismissed for good on tap. `showInsightsHint`
 * already carries the "not dismissed yet" check from the loader; the session
 * state that hides it in the page component below only hides it for the REST
 * OF THIS SESSION the instant it's tapped, so a localStorage round trip is
 * never on the critical path of the click, the same split `diary.tsx`'s
 * "Save this as a meal?" hint uses.
 *
 * Its own bordered `Card`, not a second `.surface-brand` hero: the page's one
 * hero is `TodayHeroCard` (DESIGN.md §2), and this is a low-priority aside a
 * person can ignore forever.
 */
function InsightsHintCard({ onDismiss }: { onDismiss: () => void }): ReactElement {
  const { t } = useTranslation();

  return (
    <Card data-slot="insights-hint" className="border-dashed">
      {/* A COLUMN ON A PHONE. The sentence and the two keys used to share one
          wrapping row, and `flex-1` on a `flex-basis: 0` item never wraps: the
          sentence was squeezed into 76 px of a 326 px card and ran to five
          lines beside them. Stacked, it gets the whole card and the keys get
          their own line under it. */}
      <CardContent className="flex flex-col items-start gap-3 p-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <p className="min-w-0 text-sm text-muted-foreground md:flex-1">{t('dashboard.insightsHint.title')}</p>
        {/* WRAPS, NEVER OVERFLOWS. This row used to be `shrink-0`, so its width was the
            sum of its two `whitespace-nowrap` keys. In Victor Mono the Turkish pair is 344 px
            inside a 328 px card and pushed the document to 377 px at a 360 px phone. A
            wrapping row can drop the second key under the first instead. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="h-11 md:h-8">
            {/* `Insights` itself stays untranslated everywhere (the tab strip's
                own title does the same, M239/02), so the button reads the same
                feature name as the screen it opens in every language. */}
            <Link to="/trends?tab=overview">{t('trends.overview.openInsights', { name: t('trends.title') })}</Link>
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-11 md:h-8" onClick={onDismiss}>
            {t('diary.saveMeal.hint.dismiss')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The two glance tiles
////////////////////////////////////////////////////////////////////////////////

/**
 * The last seven days as the Budget Ridge (M216/01), NOT a miniature of
 * `/trends`' 13-week adherence grid. A different time scale is a different
 * fact; a shrunken copy of the grid would be the duplication the nav catalog
 * exists to prevent. The streak NUMBER stays on `/trends` for the same reason.
 *
 * The whole tile is the door to `/trends`, not just the arrow beside the
 * title: one `Link` wraps the `Card` rather than the page's usual labelled
 * `HANDOFF_LINK_CLASS` row, because at this tile's real width that label
 * wrapped to two lines and spent 40 px of the tile's 164 px budget, which the
 * chart needs to draw in. The arrow stays as a plain, decorative span, the
 * card's own title and content already name the link, so it carries no
 * `aria-label` of its own. See `day-ridge.tsx` for the full arithmetic.
 *
 * The ridge itself renders `interactive={false}`: it used to draw a `Link`
 * per bar into that day's diary, nested inside this tile's own `Link` to
 * `/trends`, which React warned about as `<a>` inside `<a>` and which
 * silently swallowed both taps. Read-only, each bar keeps its screen-reader
 * sentence on an `sr-only` span instead (2026-09-11).
 */
function WeekGlanceCard({ ridge }: { ridge: DayRidgeModel }): ReactElement {
  const { t } = useTranslation();

  return (
    <Link
      to="/trends?tab=overview"
      data-slot="week-glance-card"
      // The ring is drawn on this wrapper, so it takes the radius of the card
      // inside it (the ladder's 8px card step).
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardHeader className={cn(GLANCE_HEADER_CLASS, 'flex-row items-start justify-between gap-2 space-y-0')}>
          <CardTitle className="text-base">{t('dashboard.week.title')}</CardTitle>
          <span className="shrink-0 text-muted-foreground">
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </span>
        </CardHeader>
        <CardContent className={GLANCE_CONTENT_CLASS}>
          <DayRidge ridge={ridge} emptyLabel={t('dashboard.week.empty')} interactive={false} />
        </CardContent>
      </Card>
    </Link>
  );
}

/** A signed weekly change in the display unit, "+0.4 kg", "−1.2 kg", "0 kg". */
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
 * covers. A single weigh-in shows the figure and no delta, "0.0 over the last
 * 7 days" would read as "no change" rather than "not enough data". The whole
 * tile is the door to `/trends`; the trailing text and arrow keep their
 * `HANDOFF_LINK_CLASS` styling as the visible call to action, but are no
 * longer a link of their own.
 */
function WeightGlanceCard({ weight }: { weight: WeightGlance }): ReactElement {
  const { t, i18n } = useTranslation();
  // Device-local display preference, owned by `/settings/profile`. Read once per
  // mount, same as `/trends`.
  const [weightUnit] = useState<WeightUnit>(readStoredWeightUnit);

  return (
    <Link
      to="/trends"
      // The ring is drawn on this wrapper, so it takes the radius of the card
      // inside it (the ladder's 8px card step).
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-primary/40">
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
                delta both survive), and `/trends`, one tap away on the whole
                tile, is where the dated history actually lives.
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
          <span className={HANDOFF_LINK_CLASS}>
            {t('dashboard.weight.link')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Page
////////////////////////////////////////////////////////////////////////////////

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    hasLoggedToday,
    summary,
    goals,
    ridge,
    grid,
    adherenceGoals,
    streak,
    gamificationHidden,
    showInsightsHint,
    weight,
    reproductiveStatus,
    pregnancyDueDate,
    lactationStartDate,
    repeatYesterday,
  } = loaderData;
  // Session-local, so a tap hides the card immediately; the loader's own
  // `showInsightsHint` already carries the persisted dismissal across a reload.
  const [isInsightsHintDismissedThisSession, setIsInsightsHintDismissedThisSession] = useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/*
        What changed in this build, said once (ADR-0018), ABOVE the hero and above
        the Insights hint further down. Two one-time cards on one screen is one
        too many, and this one is the older claim: the Insights hint is about a
        feature that has been there for a while, this is about the update that
        just landed. It renders nothing on a device that has been told.
      */}
      <WhatsNewCard />
      <TodayHeroCard
        summary={summary}
        goals={goals}
        hasLoggedToday={hasLoggedToday}
        repeatYesterday={repeatYesterday}
      />
      {/*
        A question, never a correction: a due date that has passed, or lactation
        older than two years, gets one dismissable line asking whether to update
        the setting. The banner decides for itself and renders nothing the rest
        of the time, and the clock is passed in here rather than read inside it.
        The app never flips the stored status (M206/04).
      */}
      <ReproductiveStatusPromptBanner
        reproductiveStatus={reproductiveStatus}
        dueDate={pregnancyDueDate}
        lactationStartDate={lactationStartDate}
        today={new Date()}
      />
      {/*
        The 13-week record, directly under the hero and its banner and ABOVE
        the fast strip and the glance row (owner's call, 2026-09-10). It is the
        second thing the page says, after "where does today stand": how long
        the showing up has been going on. The whole card is one door to
        `/trends`, where the same grid is interactive.
      */}
      {/*
        A newly earned award, named once and never again (M235/06). It reads
        the store for itself because an award can arrive between two renders of
        this page, and it renders nothing at all when these surfaces are off.
        Here rather than in the diary because this is the screen a person opens,
        and a note that fired in the middle of logging food would interrupt the
        one thing the app exists to make quick.
      */}
      <AwardNote hidden={gamificationHidden} />
      <StreakGridCard grid={grid} goals={adherenceGoals} streak={streak} />
      {/*
        Conditional and ABOVE the glance row (M132), see this file's header for
        the height arithmetic and why the fast outranks last week's weight for
        the space above the fold. Absent entirely with no fast, so the shipped
        no-scroll page is untouched in the common case. The STRIP decides that
        for itself now, off the same hook the header chip reads, so a fast that
        starts or ends on `/fasting` reaches this row without a navigation.
      */}
      <FastStrip />
      {/*
        STACKED ON A PHONE, two-up from `sm`, which reverses the "two-up at
        every width" call this comment used to make. That call was paid for by
        a no-scroll page on a 375x667 phone, and there is no such page any
        more: the hero, the grid, this row and the doors under it measure well
        past a screen at 360 px however these two tiles sit. What two-up does
        still cost is real: half a 360 px screen leaves the week tile 122 px to
        draw a seven-column weekday row in, which needs 141 px at the 10 px
        type it used and more at the 12 px floor this app now holds itself to,
        so the row spilled past the card edge in English and in Turkish. Full
        width, it fits at every width down to 320 with room to spare.

        `h-full` on each tile's own card is what keeps the `sm` row even: the
        grid stretches the LINK around each card, never the card inside it, so
        the weight tile drew 118 px of card inside a 180 px cell.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <WeekGlanceCard ridge={ridge} />
        <WeightGlanceCard weight={weight} />
      </div>
      {/*
        The one-time door to Insights (M239/06), UNDER the glance row: by this
        point the two tiles above already point at `/trends`, so this is a
        low-priority "there's more" aside rather than a first-run instruction.
        Gone for the rest of this session the instant it's tapped, and gone for
        good once the loader sees the dismissal on a later load.
      */}
      {showInsightsHint && !isInsightsHintDismissedThisSession && (
        <InsightsHintCard
          onDismiss={() => {
            dismissInsightsHintOnDevice();
            setIsInsightsHintDismissedThisSession(true);
          }}
        />
      )}
      {/*
        What the whole instance did today, UNDER the glance row and absent
        entirely below three contributors (M222 spec 04). The loader above
        knows nothing about it: the figures are fetched client-side after first
        paint, so a slow or unreachable pulse cannot hold this page up, and a
        device with no account never asks.
      */}
      <PulseTileSlot />
    </div>
  );
}
