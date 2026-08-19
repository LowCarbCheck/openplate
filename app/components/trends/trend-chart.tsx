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
 */
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import type { BarGeometry, TrendChartModel, TrendMetric } from '#app/lib/trend-chart';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';

/**
 * The narrow slice of i18next's `t` these module-scope helpers need. They are
 * called from render, not from a component body, so the function is threaded in
 * as an argument rather than pulled from a hook.
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

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
/** Body opacity of a floor bar — pale enough to read as "not the whole story". */
const FLOOR_FILL_OPACITY = 0.28;
/** Body opacity of an Atwater-derived calories bar — softened, but still a real value. */
const DERIVED_FILL_OPACITY = 0.55;

/** The status hue for a bar: amber once it's over the ceiling, brand teal otherwise. */
function statusColorClass(bar: BarGeometry): string {
  return bar.isOverGoal ? 'text-accent-amber' : 'text-primary';
}

/** The visible fill classes/attrs per bar state, keyed off `BarGeometry.fill`. */
function BarColumn({ bar, index }: { bar: BarGeometry; index: number }) {
  const barWidth = SLOT_WIDTH * BAR_WIDTH_RATIO;
  const x = index * SLOT_WIDTH + (SLOT_WIDTH - barWidth) / 2;
  const centerX = x + barWidth / 2;

  // No logs at all: a baseline tick, never a zero-height bar (which would read
  // as "you ate nothing", not "you didn't log").
  if (bar.fill === 'empty') {
    return (
      <line
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
  const colorClass = statusColorClass(bar);

  // A floor: pale body + solid cap rule ("at least this much").
  if (bar.fill === 'incomplete') {
    const capHeight = Math.min(CAP_UNITS, height);
    return (
      <g className={colorClass}>
        <rect x={x} y={y} width={barWidth} height={height} rx={0.8} fill="currentColor" fillOpacity={FLOOR_FILL_OPACITY} />
        <rect x={x} y={y} width={barWidth} height={capHeight} rx={0.8} fill="currentColor" />
      </g>
    );
  }

  return (
    <rect
      x={x}
      y={y}
      width={barWidth}
      height={height}
      rx={0.8}
      className={colorClass}
      fill="currentColor"
      fillOpacity={bar.fill === 'derived' ? DERIVED_FILL_OPACITY : 1}
    />
  );
}

/**
 * A human sentence for a bar's tappable link (its accessible name).
 *
 * The three qualifiers ("at least" / "partly estimated" / "over your goal") are
 * separate keys interpolated into the sentence rather than eight enumerated
 * sentence variants — a translator can move each `{{placeholder}}` to wherever
 * the qualifier belongs in the target language's clause order.
 */
function describeBar(bar: BarGeometry, metric: TrendMetric, t: Translate, language: string): string {
  if (bar.fill === 'empty') return t('trends.chart.bar.empty', { date: bar.date });
  if (bar.value === null) return t('trends.chart.bar.incomputable', { date: bar.date });
  const estimate = bar.hasEstimate ? t('trends.chart.bar.estimate') : '';
  const atLeast = bar.fill === 'incomplete' ? t('trends.chart.bar.atLeast') : '';
  const overGoal = bar.isOverGoal ? t('trends.chart.bar.overGoal') : '';
  if (metric === 'calories') {
    return t('trends.chart.bar.calories', { date: bar.date, atLeast, value: Math.round(bar.value), estimate });
  }
  return t('trends.chart.bar.netCarbs', {
    date: bar.date,
    atLeast,
    value: formatMacroNumberIn(language, bar.value),
    estimate,
    overGoal,
  });
}

/** The dashed horizontal goal line at `goalFraction` of the plot height. */
function GoalLine({ goalFraction }: { goalFraction: number }) {
  const y = PLOT_HEIGHT * (1 - goalFraction);
  return (
    <line
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
 * The goal line's inline value tag, sitting in the plot's right gutter at the
 * line's own height. The legend swatch below says *which* line is the goal; this
 * says what it's worth, where the eye already is — without it, reading "am I
 * near my ceiling?" meant hopping to the legend, then to the goals page, then
 * back. Drawn as HTML rather than SVG `<text>` because the plot uses
 * `preserveAspectRatio="none"`, which would stretch glyphs with the chart width.
 */
function GoalTag({ goalFraction, label }: { goalFraction: number; label: string }) {
  const { t } = useTranslation();

  return (
    <span
      className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 whitespace-nowrap rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-muted-foreground"
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
 * The bar chart: an SVG plot plus an overlaid tappable-link grid and a plain
 * day-of-month axis. The right gutter (`pr-11`) is reserved for the goal tag, and
 * the axis row shares it so the labels stay under their own bars.
 */
export function TrendChart({
  model,
  metric,
  goalValue,
}: {
  model: TrendChartModel;
  metric: TrendMetric;
  /** The user's goal for this metric, used verbatim by the inline goal tag; null hides the tag. */
  goalValue: number | null;
}) {
  const { bars, goalFraction } = model;
  const { t, i18n } = useTranslation();
  const width = bars.length * SLOT_WIDTH;
  return (
    <div className="pr-11">
      <div className="relative h-44">
        <svg
          viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
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
            <BarColumn key={bar.date} bar={bar} index={index} />
          ))}
        </svg>
        {goalFraction !== null && goalValue !== null && (
          <GoalTag goalFraction={goalFraction} label={goalTagLabel(goalValue, metric, i18n.language)} />
        )}
        <div className="absolute inset-0 flex">
          {bars.map((bar) => (
            <Link
              key={bar.date}
              to={`/diary?date=${bar.date}`}
              aria-label={describeBar(bar, metric, t, i18n.language)}
              className="min-h-11 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex">
        {bars.map((bar) => (
          <div key={bar.date} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">{bar.date.slice(8, 10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
