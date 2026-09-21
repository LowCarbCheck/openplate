/**
 * Hand-rolled, theme-aware bar chart for the trends page (DESIGN.md §2/§6, no
 * chart library). One inline SVG draws the bars, baseline, and dashed goal line;
 * a transparent grid of `<Link>`s laid over it makes each day tappable
 * (→ `/diary?date=`) with a full-height touch target. Every color is a token
 * (`text-primary`, `text-accent-amber`, `text-muted-foreground`) applied via
 * `currentColor`, so the chart tracks the active theme and can never drift from
 * the diary's palette — M129/04 replaced the last raw Tailwind amber literals
 * here with the `--accent-amber` token the diary's own over-goal state uses.
 *
 * The geometry (which bar is solid / lighter / a floor / empty, the shared
 * scale, the goal fraction) is decided by `buildTrendChart`; this component only
 * maps those states onto SVG units and picks the class recipes.
 *
 * **Status is never hue-only.** Three independent cues carry it: the bar's
 * SHAPE (a floor bar is pale with a solid cap rule; an unlogged day is a
 * baseline tick, not a bar), its POSITION relative to the labelled goal line,
 * and its accessible name ("…, over your goal" / "nothing logged"). The legend
 * below repeats the same shapes verbatim.
 *
 * **The incomplete treatment (M129/04).** Floor bars used to be a dashed
 * *outline* — the same treatment at two different heights, which at chart scale
 * read as noise rather than as "this number is a minimum". They are now drawn as
 * a pale fill of the status hue plus a solid cap rule along the top edge: the
 * fill keeps the height readable as mass, and the crisp cap says "the real value
 * is at least up to here". It also stops competing with the `derived` state
 * (calories only, a plain 55%-opacity fill), which the outline version did.
 *
 * **M239/03.** Protein, fat and fiber are drawn in their own macro hue (the
 * `--macro-*` tokens the diary's ratio bar uses), never a warning hue. A protein
 * day under the floor is flagged in words and by its place below the goal line
 * only: missing a floor is not a warning. Net carbs gain a thin outline behind
 * the bar at the day's TOTAL carbs, so fiber and sugar alcohols show as the
 * gap, and the daily ranges gain a 7-day average line.
 */
import { Link } from '#app/components/link';
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip';
import { useTranslation } from 'react-i18next';
import { chartAxisTicks } from '#app/lib/trend-chart';
import type { BarFill, BarGeometry, TrendChartModel, TrendMetric } from '#app/lib/trend-chart';
import { formatDayLabel } from '#app/lib/format-day-label';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { cn } from '#app/lib/utils';

/**
 * The narrow slice of i18next's `t` these module-scope helpers need. They are
 * called from render, not from a component body, so the function is threaded in
 * as an argument rather than pulled from a hook.
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * How long the pointer rests on a bar before its tooltip opens. The adherence
 * grid uses the same figure, so two charts on one screen do not feel different.
 */
const TOOLTIP_DELAY_MS = 80;
/** The plot's height: 176 px, and 240 px once the page has room for two columns, where a 1000 px wide plot at 176 px reads as a strip. */
const PLOT_HEIGHT_CLASS = 'h-44 @3xl:h-60';
/** Width of the y-axis label gutter: four digits ("2400") at the 12 px body size, and no more. */
const AXIS_GUTTER_CLASS = 'w-9';
/** Above this many bars the day axis prints every second label, so two-digit days never crowd. */
const DENSE_AXIS_BARS = 10;
/** SVG plot height in user units (bars grow up from `PLOT_HEIGHT`). */
const PLOT_HEIGHT = 100;
/** Horizontal units allotted to each day's column. */
const SLOT_WIDTH = 12;
/** Fraction of a slot the drawn bar occupies (the rest is inter-bar gap). */
const BAR_WIDTH_RATIO = 0.64;
/** Minimum drawn height so a small-but-real value never vanishes to a baseline sliver. */
const MIN_BAR_UNITS = 2.5;
/** Height of the hairline that marks an unlogged (no-data) slot. */
const EMPTY_HAIRLINE_UNITS = 5;
/** Height of the low nub for a logged day with nothing computable. */
const INCOMPLETE_NUB_UNITS = 3;
/** Thickness of the solid cap rule that tops a floor ("might be incomplete") bar. */
const CAP_UNITS = 2;
/**
 * Body opacity of a floor bar, pale enough to read as "not the whole story".
 *
 * Two values: at 0.28 on the dark card the teal measured 1.92:1 against its
 * own background, under the 3:1 a graphic has to reach. Light keeps the
 * figure it was drawn for.
 */
const FLOOR_FILL_CLASS = 'opacity-[0.28] dark:opacity-[0.45]';
/** Body opacity of an Atwater-derived calories bar — softened, but still a real value. */
const DERIVED_FILL_OPACITY = 0.55;

/** Stroke thickness of the total-carbs outline, in CSS pixels (the stroke does not scale). */
const OUTLINE_STROKE_PX = 1;
/** Stroke thickness of the rolling-average line, in CSS pixels. */
const AVERAGE_STROKE_PX = 2;

/**
 * Each metric's own hue. Net carbs and calories keep the brand teal they have
 * always had; the three new macros take the diary's macro tokens, so protein
 * reads as the same colour here as in the ratio bar above the diary.
 */
const METRIC_COLOR_CLASS = {
  'net-carbs': 'text-primary',
  calories: 'text-primary',
  protein: 'text-macro-protein',
  fat: 'text-macro-fat',
  fiber: 'text-macro-fiber',
} satisfies Record<TrendMetric, string>;

/** The bar hue class for a metric, shared with the legend's swatches. */
export function metricColorClass(metric: TrendMetric): string {
  return METRIC_COLOR_CLASS[metric];
}

/**
 * The status hue for a bar: amber once it's over the ceiling, the metric's own
 * hue otherwise. A protein day under its floor keeps the protein hue on purpose.
 */
function statusColorClass({ bar, metric }: { bar: BarGeometry; metric: TrendMetric }): string {
  return bar.isOverGoal ? 'text-accent-amber' : metricColorClass(metric);
}

/** Where a bar stands against its goal, as written on the element for the browser tier. */
type BarGoalMark = 'over' | 'under' | 'none';

/** The goal mark for one bar. */
function goalMarkOf(bar: BarGeometry): BarGoalMark {
  if (bar.isOverGoal) return 'over';
  if (bar.isUnderGoal) return 'under';
  return 'none';
}

/**
 * What a bar element carries about itself, in the DOM.
 *
 * The browser tier measures bar HEIGHTS with `getBoundingClientRect`, never a
 * screenshot (see `tests/e2e/trends-slot-filter.spec.ts` for why), and a bar has
 * nothing else to be found by: the tappable link above it is full-height by
 * design, so its box says nothing about the value. `data-fill` rides along
 * because an unlogged day is drawn as a hairline, which HAS a height, so a
 * height alone cannot tell a small bar from no bar.
 */
interface BarMarkers {
  'data-slot': 'trend-bar';
  'data-date': string;
  'data-fill': BarFill;
  'data-goal': BarGoalMark;
}

/** The DOM markers for one bar (see `BarMarkers`). */
function barMarkers(bar: BarGeometry): BarMarkers {
  return { 'data-slot': 'trend-bar', 'data-date': bar.date, 'data-fill': bar.fill, 'data-goal': goalMarkOf(bar) };
}

/** True when a bar carries a total-carbs outline that stands above it. */
function hasVisibleOutline(bar: BarGeometry): boolean {
  return bar.outlineFraction !== null && bar.outlineFraction > bar.heightFraction;
}

/**
 * The total-carbs outline behind a net-carbs bar: a hollow box from the
 * baseline up to the day's total carbs, drawn only where it stands above the
 * bar (the gap IS the fiber and sugar alcohols). When the total is taller than
 * the axis the box is left open at the top, so it reads as running off the
 * chart rather than as ending at the axis top.
 */
function CarbsOutline({ bar, x, barWidth }: { bar: BarGeometry; x: number; barWidth: number }) {
  if (bar.outlineFraction === null || !hasVisibleOutline(bar)) return null;
  const top = PLOT_HEIGHT * (1 - bar.outlineFraction);
  const isCapped = bar.outlineFraction >= 1;
  const right = x + barWidth;
  const path =
    isCapped ?
      `M ${x} ${PLOT_HEIGHT} V ${top} M ${right} ${top} V ${PLOT_HEIGHT}`
    : `M ${x} ${PLOT_HEIGHT} V ${top} H ${right} V ${PLOT_HEIGHT}`;
  return (
    <path
      data-slot="trend-carbs-outline"
      data-date={bar.date}
      d={path}
      className="text-muted-foreground"
      stroke="currentColor"
      strokeWidth={OUTLINE_STROKE_PX}
      fill="none"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** The visible fill classes/attrs per bar state, keyed off `BarGeometry.fill`. */
function BarColumn({ bar, index, metric }: { bar: BarGeometry; index: number; metric: TrendMetric }) {
  const barWidth = SLOT_WIDTH * BAR_WIDTH_RATIO;
  const x = index * SLOT_WIDTH + (SLOT_WIDTH - barWidth) / 2;
  const centerX = x + barWidth / 2;

  // No logs at all: a baseline tick, never a zero-height bar (which would read
  // as "you ate nothing", not "you didn't log").
  if (bar.fill === 'empty') {
    return (
      <line
        {...barMarkers(bar)}
        x1={centerX}
        y1={PLOT_HEIGHT}
        x2={centerX}
        y2={PLOT_HEIGHT - EMPTY_HAIRLINE_UNITS}
        className="text-muted-foreground/40"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  // Logged, but nothing computable: a low muted nub. It has to be visibly a
  // different object from both a real bar and an empty slot.
  if (bar.value === null) {
    return (
      <rect
        {...barMarkers(bar)}
        x={x}
        y={PLOT_HEIGHT - INCOMPLETE_NUB_UNITS}
        width={barWidth}
        height={INCOMPLETE_NUB_UNITS}
        rx={0.8}
        className="text-muted-foreground"
        fill="currentColor"
        fillOpacity={0.45}
      />
    );
  }

  const height = Math.max(bar.heightFraction * PLOT_HEIGHT, MIN_BAR_UNITS);
  const y = PLOT_HEIGHT - height;
  const colorClass = statusColorClass({ bar, metric });

  // A floor: pale body + solid cap rule ("at least this much").
  if (bar.fill === 'incomplete') {
    const capHeight = Math.min(CAP_UNITS, height);
    return (
      <>
        <CarbsOutline bar={bar} x={x} barWidth={barWidth} />
        <g {...barMarkers(bar)} className={colorClass}>
          <rect
            x={x}
            y={y}
            width={barWidth}
            height={height}
            rx={0.8}
            fill="currentColor"
            className={FLOOR_FILL_CLASS}
          />
          <rect x={x} y={y} width={barWidth} height={capHeight} rx={0.8} fill="currentColor" />
        </g>
      </>
    );
  }

  return (
    <>
      <CarbsOutline bar={bar} x={x} barWidth={barWidth} />
      <rect
        {...barMarkers(bar)}
        x={x}
        y={y}
        width={barWidth}
        height={height}
        rx={0.8}
        className={colorClass}
        fill="currentColor"
        fillOpacity={bar.fill === 'derived' ? DERIVED_FILL_OPACITY : 1}
      />
    </>
  );
}

/**
 * The SVG path of the rolling-average line, one point per bar centre. A `null`
 * breaks the line rather than dropping it to zero: a window with nothing
 * logged has no average to draw.
 *
 * @param fractions - one height fraction 0..1 per bar, or null for a gap.
 * @returns the `d` attribute, empty when there is no point at all.
 */
export function averageLinePath(fractions: readonly (number | null)[]): string {
  const commands: string[] = [];
  let isPenDown = false;
  for (const [index, fraction] of fractions.entries()) {
    if (fraction === null) {
      isPenDown = false;
      continue;
    }
    const x = index * SLOT_WIDTH + SLOT_WIDTH / 2;
    const y = PLOT_HEIGHT * (1 - Math.min(Math.max(fraction, 0), 1));
    commands.push(`${isPenDown ? 'L' : 'M'} ${x} ${y}`);
    isPenDown = true;
  }
  return commands.join(' ');
}

/** The rolling-average line over the daily bars. */
function AverageLine({ fractions }: { fractions: readonly (number | null)[] }) {
  const path = averageLinePath(fractions);
  if (path === '') return null;
  return (
    <path
      data-slot="trend-average-line"
      d={path}
      className="text-foreground"
      stroke="currentColor"
      strokeWidth={AVERAGE_STROKE_PX}
      strokeLinejoin="round"
      strokeLinecap="round"
      fill="none"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/**
 * The chart title per metric, in two wordings: "Daily protein" over daily bars,
 * and a weekly one at 30 and 90 days, where each bar is a week's daily average
 * and a title saying "Daily" would be wrong. Whole-sentence keys rather than
 * "Daily {{metric}}": German inflects the adjective with the noun's gender.
 */
const CHART_TITLE_KEY = {
  daily: {
    'net-carbs': 'trends.chart.titleNetCarbs',
    calories: 'trends.chart.titleCalories',
    protein: 'trends.chart.titleProtein',
    fat: 'trends.chart.titleFat',
    fiber: 'trends.chart.titleFiber',
  },
  weekly: {
    'net-carbs': 'trends.chart.titleWeekly.netCarbs',
    calories: 'trends.chart.titleWeekly.calories',
    protein: 'trends.chart.titleWeekly.protein',
    fat: 'trends.chart.titleWeekly.fat',
    fiber: 'trends.chart.titleWeekly.fiber',
  },
} satisfies Record<'daily' | 'weekly', Record<TrendMetric, string>>;

/**
 * The catalog key of the chart title for a metric.
 *
 * @param input.metric - the plotted series.
 * @param input.isWeekly - true when each bar is a week (30 and 90 days).
 * @returns the title key.
 */
export function chartTitleKey({ metric, isWeekly }: { metric: TrendMetric; isWeekly: boolean }): string {
  return CHART_TITLE_KEY[isWeekly ? 'weekly' : 'daily'][metric];
}

/** The per-metric sentence key a valued bar is read out with. */
const BAR_SENTENCE_KEY = {
  'net-carbs': 'trends.chart.bar.netCarbs',
  calories: 'trends.chart.bar.calories',
  protein: 'trends.chart.bar.protein',
  fat: 'trends.chart.bar.fat',
  fiber: 'trends.chart.bar.fiber',
} satisfies Record<TrendMetric, string>;

/**
 * How a bar names its date. A daily bar is its day; a weekly bar is the week
 * starting on its Monday, and a valued weekly bar says its figure is a daily
 * average, so a screen reader never hears one week's mean as one day's total.
 */
function barDateLabel({
  bar,
  isWeekly,
  t,
  formatDate,
}: {
  bar: BarGeometry;
  isWeekly: boolean;
  t: Translate;
  formatDate: (date: string) => string;
}): string {
  if (!isWeekly) return formatDate(bar.date);
  const hasValue = bar.fill !== 'empty' && bar.value !== null;
  return t(hasValue ? 'trends.chart.bar.weekAverage' : 'trends.chart.bar.week', { date: formatDate(bar.date) });
}

/** The date exactly as stored, `YYYY-MM-DD`, which is what a screen reader has always been read. */
const isoDate = (date: string): string => date;

/**
 * A human sentence for a bar's tappable link (its accessible name).
 *
 * The qualifiers ("at least" / "partly estimated" / "over your goal" / "below
 * your goal") are separate keys interpolated into the sentence rather than
 * enumerated sentence variants, so a translator can move each `{{placeholder}}`
 * to wherever the qualifier belongs in the target language's clause order. The
 * total-carbs figure behind a net-carbs bar is appended as its own clause.
 */
export function describeBar({
  bar,
  metric,
  isWeekly,
  t,
  language,
  formatDate = isoDate,
}: {
  bar: BarGeometry;
  metric: TrendMetric;
  isWeekly: boolean;
  t: Translate;
  language: string;
  /** How the bar names its day. The screen-reader name keeps the ISO date; the tooltip passes `formatDayLabel`. */
  formatDate?: (date: string) => string;
}): string {
  const date = barDateLabel({ bar, isWeekly, t, formatDate });
  if (bar.fill === 'empty') return t('trends.chart.bar.empty', { date });
  if (bar.value === null) return t('trends.chart.bar.incomputable', { date });
  const sentence = t(BAR_SENTENCE_KEY[metric], {
    date,
    atLeast: bar.fill === 'incomplete' ? t('trends.chart.bar.atLeast') : '',
    value: metric === 'calories' ? Math.round(bar.value) : formatMacroNumberIn(language, bar.value),
    estimate: bar.hasEstimate ? t('trends.chart.bar.estimate') : '',
    overGoal: bar.isOverGoal ? t('trends.chart.bar.overGoal') : '',
    underGoal: bar.isUnderGoal ? t('trends.chart.bar.underGoal') : '',
  });
  return `${sentence}${totalCarbsClause({ bar, t, language })}`;
}

/** ", 30 g total carbs" behind a net-carbs bar whose outline is drawn, else nothing. */
function totalCarbsClause({ bar, t, language }: { bar: BarGeometry; t: Translate; language: string }): string {
  if (bar.totalCarbs === null || !hasVisibleOutline(bar)) return '';
  return t('trends.chart.bar.totalCarbs', { value: formatMacroNumberIn(language, bar.totalCarbs) });
}

/** The dashed horizontal goal line at `goalFraction` of the plot height. */
function GoalLine({ goalFraction }: { goalFraction: number }) {
  const y = PLOT_HEIGHT * (1 - goalFraction);
  return (
    <line
      data-slot="trend-goal-line"
      x1={0}
      y1={y}
      x2="100%"
      y2={y}
      className="text-muted-foreground/60"
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="4 3"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/**
 * The goal line's inline value tag, sitting over the plot's right end just
 * above its own line. The legend swatch below says *which* line is the goal; this
 * says what it's worth, where the eye already is — without it, reading "am I
 * near my ceiling?" meant hopping to the legend, then to the goals page, then
 * back. Drawn as HTML rather than SVG `<text>` because the plot uses
 * `preserveAspectRatio="none"`, which would stretch glyphs with the chart width.
 *
 * It sits INSIDE the plot rather than in a gutter beside it: a 44px reserved
 * column for a 30px tag cost the bars a fifth of the width they had, which on
 * a 320px phone left the day labels two pixels apart.
 */
function GoalTag({ goalFraction, label }: { goalFraction: number; label: string }) {
  const { t } = useTranslation();

  return (
    <span
      className="pointer-events-none absolute right-0 -translate-y-full whitespace-nowrap rounded bg-muted px-1 py-px text-xs font-medium tabular-nums text-muted-foreground"
      style={{ top: `${(1 - goalFraction) * 100}%` }}
    >
      <span className="sr-only">{t('trends.chart.goalTagPrefix')}</span>
      {label}
    </span>
  );
}

/**
 * The goal tag's text for the active metric ("50 g" / "1800"). Takes the goal
 * VALUE rather than re-deriving it from `domainMax × goalFraction` — that
 * round-trip is lossy (it prints "49.9 g" for a 50 g ceiling on the wrong
 * float) and the user's own number is the one thing on this chart that must be
 * exact.
 */
function goalTagLabel(goalValue: number, metric: TrendMetric, language: string): string {
  return metric === 'calories' ? `${Math.round(goalValue)}` : `${formatMacroNumberIn(language, goalValue)} g`;
}

/**
 * The y-axis label for a gridline: whole calories, otherwise the reader's own
 * number format ("7,5" in German), with no unit because the goal tag and the
 * tooltip carry it.
 */
function axisLabel(value: number, metric: TrendMetric, language: string): string {
  return metric === 'calories' ? `${Math.round(value)}` : formatMacroNumberIn(language, value);
}

/**
 * The bar chart: an SVG plot, a y axis of labelled gridlines, an overlaid
 * tappable-link grid with a tooltip on every day, and a plain day-of-month axis.
 *
 * ── WHAT A PERSON CAN READ WITHOUT TAPPING (2026-09-21) ──────────────────
 *
 * The operator said the charts needed hovers, tooltips and labels. The bars had
 * none of the three: no scale, so "how tall is tall" was a guess, and no way to
 * read one day's figure short of opening the diary. Now there is a gutter of
 * round-number labels on the left with a faint gridline at each, and a tooltip
 * on the day under the pointer or the keyboard focus, saying what the bar's
 * screen-reader name says (`describeBar`) with the day written as a person
 * writes it. A touch screen gets no tooltip: a tap on a bar opens that day's
 * diary, which is the better answer there, and Radix does not open a tooltip
 * from a touch in any case.
 *
 * The gutter costs the bars 36 px of a 360 px phone. The old comment here said
 * a 44 px gutter left the day labels two pixels apart on a 320 px phone; 36 px
 * carries four digits and no more, and a 14-day chart still gives each day
 * about 17 px.
 *
 * Each bar is a link to that day's diary. It is as wide as its own column and
 * cannot be widened without overlapping its neighbour, so the 44px touch rule
 * is met on the height (`min-h-11`) alone; this is a plot, not a button row.
 */
export function TrendChart({
  model,
  metric,
  goalValue,
  isWeekly = false,
  averageFractions = null,
}: {
  model: TrendChartModel;
  metric: TrendMetric;
  /** The user's goal for this metric, used verbatim by the inline goal tag; null hides the tag. */
  goalValue: number | null;
  /** True when each bar is a week's daily average (30 and 90 days), which the bars' names must say. */
  isWeekly?: boolean;
  /** The rolling-average line, one height fraction per bar; null draws no line (weekly bars never get one). */
  averageFractions?: readonly (number | null)[] | null;
}) {
  const { bars, goalFraction, domainMax } = model;
  const { t, i18n } = useTranslation();
  const width = bars.length * SLOT_WIDTH;
  const ticks = chartAxisTicks(domainMax);
  const formatDate = (date: string): string => formatDayLabel(date, i18n.language);
  return (
    <div data-slot="trend-chart">
      <div className="flex gap-1.5">
        <div aria-hidden="true" className={cn('relative shrink-0', PLOT_HEIGHT_CLASS, AXIS_GUTTER_CLASS)}>
          {ticks.map((tick) => (
            <span
              key={tick}
              data-slot="chart-axis-label"
              className="absolute right-0 -translate-y-1/2 text-xs tabular-nums text-muted-foreground"
              style={{ top: `${(1 - tick / domainMax) * 100}%` }}
            >
              {axisLabel(tick, metric, i18n.language)}
            </span>
          ))}
          <span
            data-slot="chart-axis-label"
            className="absolute bottom-0 right-0 translate-y-1/2 text-xs tabular-nums text-muted-foreground"
          >
            0
          </span>
        </div>
        <div className={cn('relative min-w-0 flex-1', PLOT_HEIGHT_CLASS)}>
          <svg
            viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden="true"
          >
            {ticks.map((tick) => {
              const y = PLOT_HEIGHT * (1 - tick / domainMax);
              return (
                <line
                  key={tick}
                  data-slot="chart-gridline"
                  x1={0}
                  y1={y}
                  x2="100%"
                  y2={y}
                  className="text-border"
                  stroke="currentColor"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            <line
              x1={0}
              y1={PLOT_HEIGHT}
              x2="100%"
              y2={PLOT_HEIGHT}
              className="text-border"
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {goalFraction !== null && <GoalLine goalFraction={goalFraction} />}
            {bars.map((bar, index) => (
              <BarColumn key={bar.date} bar={bar} index={index} metric={metric} />
            ))}
            {averageFractions !== null && <AverageLine fractions={averageFractions} />}
          </svg>
          {goalFraction !== null && goalValue !== null && (
            <GoalTag goalFraction={goalFraction} label={goalTagLabel(goalValue, metric, i18n.language)} />
          )}
          <div className="absolute inset-0 flex">
            {bars.map((bar) => (
              <Tooltip key={bar.date} delayDuration={TOOLTIP_DELAY_MS}>
                <TooltipTrigger asChild>
                  <Link
                    to={`/diary?date=${bar.date}`}
                    aria-label={describeBar({ bar, metric, isWeekly, t, language: i18n.language })}
                    data-slot="trend-bar-hit"
                    className="min-h-11 flex-1 rounded-sm data-[state=delayed-open]:bg-foreground/5 data-[state=instant-open]:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="max-w-64">
                  {describeBar({ bar, metric, isWeekly, t, language: i18n.language, formatDate })}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex gap-1.5">
        <div aria-hidden="true" className={cn('shrink-0', AXIS_GUTTER_CLASS)} />
        <div className="flex min-w-0 flex-1">
          {bars.map((bar, index) => (
            <div key={bar.date} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
              {/* Counted back from the newest bar, so the day on the right is
                  always named however many bars the window holds. */}
              <span
                data-slot="chart-day-label"
                className={cn(
                  'text-xs tabular-nums text-muted-foreground',
                  bars.length > DENSE_AXIS_BARS && (bars.length - 1 - index) % 2 !== 0 && 'hidden sm:inline',
                )}
              >
                {bar.date.slice(8, 10)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
