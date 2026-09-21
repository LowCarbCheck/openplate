import { useMemo } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { cn } from '#app/lib/utils';
import { fromKg, toKg, type WeightUnit } from '#app/lib/weight-units';
import {
  computeValueRange,
  daysBetweenDates,
  exponentialMovingAverage,
  niceTicks,
  scaleLinear,
  type DatedValue,
} from '#app/lib/ewma';

/** A single weigh-in plotted on the chart. */
export interface WeightChartPoint {
  /** Calendar day of the weigh-in, `YYYY-MM-DD`. */
  date: string;
  weightKg: number;
}

interface WeightTrendChartProps {
  /** Weigh-ins within the window, ascending by date. */
  points: WeightChartPoint[];
  /** Dashed goal line is drawn at this weight when set; hidden when null. */
  targetWeightKg: number | null;
  /** Window end (user-local today, `YYYY-MM-DD`) — the chart's right edge. */
  today: string;
  /** Unit the axis labels and target line are displayed in — geometry math below always stays in kg. */
  weightUnit: WeightUnit;
  /** Index into `points` the crosshair is snapped to, or null when nothing is active. */
  activeIndex: number | null;
  /** Raised as the pointer/keyboard moves across the chart — the PARENT owns the caption readout. */
  onActiveIndexChange: (index: number | null) => void;
  /**
   * The parent's readout of the active weigh-in ("Sat 12 Jul · 84.6 kg on the scale · 84.9 kg trend"), drawn as a
   * tooltip on the point itself as well as in the caption under the chart. Null draws no tooltip.
   */
  readout?: string | null;
}

//////////////////////////////////////////////////////////////////////////////
// SVG geometry — a fixed viewBox scaled responsively by the container width.
//////////////////////////////////////////////////////////////////////////////

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 200;
/** The y-tick labels live in an HTML gutter beside the plot, so this is only a dot's own margin. */
const PLOT_LEFT = 8;
const PLOT_RIGHT = VIEW_WIDTH - 8;
const PLOT_TOP = 14;
const PLOT_BOTTOM = VIEW_HEIGHT - 14;
/**
 * Above this many weigh-ins the raw dots are drawn at 4px instead of 6px. A
 * DELIBERATE, documented deviation from the usual >=8px marker minimum: 91
 * daily weigh-ins across a phone-wide plot sit about 2.5px apart, and dots any
 * bigger fuse into a band. The >=8px rule is honoured on the EMPHASIS marker,
 * which is the one a reader actually targets.
 */
const CROWDED_DOT_COUNT = 40;
/** How many horizontal gridlines the axis aims for. */
const TICK_COUNT = 4;
/** A point this close to either end (as a share of the plot width) pins its tooltip to that edge. */
const TOOLTIP_EDGE_SHARE = 0.2;
/** A point higher than this share of the plot height puts its tooltip below it instead of above. */
const TOOLTIP_FLIP_SHARE = 0.25;

/**
 * Hand-rolled inline-SVG weight-trend chart (DESIGN.md §7 — no chart library):
 * raw weigh-ins as recessive grey dots, a teal EWMA trend line over them,
 * recessive gridlines with clean y-ticks, and a dashed goal line at the target
 * weight when one is set. A crosshair snaps to the nearest weigh-in and raises
 * `onActiveIndexChange`; the caption that reads it out belongs to the parent.
 * Falls back to a muted empty state before the first weigh-in. Pure renderer —
 * all data is derived from props.
 *
 * Three things this chart deliberately does NOT do:
 *
 * - **No area wash under the line.** A weight chart's baseline is not zero, so
 *   filling to the frame bottom would encode a quantity that does not exist.
 * - **No broken segments across weigh-in gaps.** The EWMA is a MODEL, not a
 *   measurement, and `exponentialMovingAverage` already widens its effective
 *   alpha across a gap, so a continuous line is the honest rendering. This is a
 *   decision, not an oversight — don't "fix" it without revisiting that.
 * - **No dual axis, no legend box.** One emphasis series; the card title names
 *   it and the caption sentence names the two marks.
 */
export function WeightTrendChart({
  points,
  targetWeightKg,
  today,
  weightUnit,
  activeIndex,
  onActiveIndexChange,
  readout = null,
}: WeightTrendChartProps) {
  const geometry = useMemo(
    () => _buildGeometry({ points, targetWeightKg, today, weightUnit }),
    [points, targetWeightKg, today, weightUnit],
  );
  const { t, i18n } = useTranslation();

  if (!geometry) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('trends.weight.chartEmpty')}
      </div>
    );
  }

  // The unit is spelled out in the accessible name (a screen reader saying
  // "kg" as a word is not the same as saying "kilograms"), so it needs its own
  // key rather than the symbol used in the visible labels.
  const spelledUnit = weightUnit === 'kg' ? t('trends.weight.unitKilograms') : t('trends.weight.unitPounds');
  const dotSize = geometry.dots.length > CROWDED_DOT_COUNT ? 'size-1' : 'size-1.5';
  const active = activeIndex === null ? null : (geometry.dots[activeIndex] ?? null);
  const activeTrend = activeIndex === null ? null : (geometry.trendDots[activeIndex] ?? null);

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    const viewX = ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    onActiveIndexChange(_nearestIndex(geometry.dots, viewX));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const last = geometry.dots.length - 1;
    const current = activeIndex ?? last;
    let next: number;
    if (event.key === 'ArrowLeft') next = current - 1;
    else if (event.key === 'ArrowRight') next = current + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    onActiveIndexChange(Math.min(Math.max(next, 0), last));
  };

  return (
    <figure className="m-0 flex gap-1.5">
      {/*
        THE Y AXIS IS HTML, NOT SVG `<text>`. The plot's viewBox is stretched to
        the card's width, so a 10-unit SVG label rendered at 4.3px on a 360px
        phone. Out here it is a plain 12px span, positioned by percentage
        against the same coordinate space the gridlines use.
      */}
      <div aria-hidden="true" className="relative w-10 shrink-0">
        {geometry.ticks.map((tick, index) => (
          <span
            key={tick.value}
            data-slot="weight-axis-label"
            className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
            style={{ top: `${(tick.y / VIEW_HEIGHT) * 100}%` }}
          >
            {formatMacroNumberIn(i18n.language, tick.value)}
            {index === geometry.ticks.length - 1 ? ` ${weightUnit}` : ''}
          </span>
        ))}
      </div>

      <div className="relative h-40 min-w-0 flex-1 rounded-lg sm:h-48">
        {/*
          `preserveAspectRatio="none"` so the plot fills a height this card
          chooses instead of one its width dictates: at 3.2:1 the chart was 87px
          tall on a phone. Only lines are drawn in here, and a line under a
          non-uniform scale is still that line; the round marks are HTML below,
          which is what would have been squashed into ellipses.
        */}
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          {geometry.ticks.map((tick) => (
            <line
              key={tick.value}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={tick.y}
              y2={tick.y}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {geometry.targetY !== null && (
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={geometry.targetY}
              y2={geometry.targetY}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {active !== null && (
            <line
              x1={active.x}
              x2={active.x}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <polyline
            points={geometry.trendPath}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-primary"
          />
        </svg>

        {geometry.targetY !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0 -translate-y-full rounded bg-card px-1 text-xs tabular-nums text-muted-foreground"
            style={{ top: `${(geometry.targetY / VIEW_HEIGHT) * 100}%` }}
          >
            {t('trends.weight.target', {
              value: formatMacroNumberIn(i18n.language, fromKg(targetWeightKg ?? 0, weightUnit)),
              unit: weightUnit,
            })}
          </span>
        )}

        {geometry.dots.map((dot) => (
          <span
            key={dot.date}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70 ring-2 ring-card',
              dotSize,
            )}
            style={{ left: `${(dot.x / VIEW_WIDTH) * 100}%`, top: `${(dot.y / VIEW_HEIGHT) * 100}%` }}
          />
        ))}

        {activeTrend !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
            style={{
              left: `${(activeTrend.x / VIEW_WIDTH) * 100}%`,
              top: `${(activeTrend.y / VIEW_HEIGHT) * 100}%`,
            }}
          />
        )}

        {/* THE READOUT AT THE POINT (2026-09-21). The caption under the chart has
            always said what the crosshair is on, but it sits a screen's width
            from the point, and the operator asked for a tooltip. It is the same
            string as the caption, placed above the higher of the two marks so it
            covers neither, below them when they sit near the top of the plot, and
            pinned to the near edge when the point is within a fifth of either end
            so it never leaves the card. */}
        {readout !== null && active !== null && activeTrend !== null && (
          <span
            data-slot="weight-tooltip"
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md',
              active.x < VIEW_WIDTH * TOOLTIP_EDGE_SHARE ? 'translate-x-[-12px]'
              : active.x > VIEW_WIDTH * (1 - TOOLTIP_EDGE_SHARE) ? 'translate-x-[calc(-100%+12px)]'
              : '-translate-x-1/2',
              Math.min(active.y, activeTrend.y) < VIEW_HEIGHT * TOOLTIP_FLIP_SHARE ? 'mt-4' : '-translate-y-full -mt-3',
            )}
            style={{
              left: `${(active.x / VIEW_WIDTH) * 100}%`,
              top: `${(Math.min(active.y, activeTrend.y) / VIEW_HEIGHT) * 100}%`,
            }}
          >
            {readout}
          </span>
        )}

        {/* Transparent hit layer: snapping is by x only, so a reader never has to
            land on a 6px dot to read a day. It is a real button so that the
            chart's keyboard model (arrows / Home / End) hangs off a focusable,
            interactive element , the plot above is decorative, and this control
            carries the chart's accessible name. */}
        <button
          type="button"
          aria-label={t('trends.weight.chartLabel', { unit: spelledUnit })}
          className="absolute inset-0 cursor-default rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={handleKeyDown}
          onBlur={() => onActiveIndexChange(null)}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => onActiveIndexChange(null)}
        />
      </div>
    </figure>
  );
}

interface Dot {
  date: string;
  x: number;
  y: number;
}

interface AxisTick {
  /** The tick's value in the DISPLAY unit — what the label reads. */
  value: number;
  y: number;
}

interface ChartGeometry {
  range: { min: number; max: number };
  dots: Dot[];
  trendDots: Dot[];
  trendPath: string;
  targetY: number | null;
  ticks: AxisTick[];
}

/** The index of the dot nearest `viewX`, or null when there are none. */
function _nearestIndex(dots: Dot[], viewX: number): number | null {
  if (dots.length === 0) return null;
  let best = 0;
  for (let index = 1; index < dots.length; index++) {
    if (Math.abs(dots[index].x - viewX) < Math.abs(dots[best].x - viewX)) best = index;
  }
  return best;
}

/**
 * Derives every pixel coordinate the chart needs, or null when there's nothing
 * to plot. Geometry math always stays in kg; `weightUnit` only decides where
 * the y-ticks land, and they are chosen in the DISPLAY unit so the axis reads
 * "72 / 74 / 76" rather than a converted "158.7".
 */
function _buildGeometry({
  points,
  targetWeightKg,
  today,
  weightUnit,
}: Pick<WeightTrendChartProps, 'points' | 'targetWeightKg' | 'today' | 'weightUnit'>): ChartGeometry | null {
  if (points.length === 0) return null;
  const trend = exponentialMovingAverage(
    points.map((point): DatedValue => ({ date: point.date, value: point.weightKg })),
  );
  const spannedValues = [
    ...points.map((point) => point.weightKg),
    ...trend.map((entry) => entry.value),
    ...(targetWeightKg !== null ? [targetWeightKg] : []),
  ];
  const range = computeValueRange(spannedValues);
  const domainStart = points[0].date;
  const totalDays = Math.max(1, daysBetweenDates(domainStart, today));
  const xForDate = (date: string): number =>
    scaleLinear({
      value: daysBetweenDates(domainStart, date),
      domainMin: 0,
      domainMax: totalDays,
      rangeMin: PLOT_LEFT,
      rangeMax: PLOT_RIGHT,
    });
  const yForValue = (value: number): number =>
    scaleLinear({ value, domainMin: range.min, domainMax: range.max, rangeMin: PLOT_BOTTOM, rangeMax: PLOT_TOP });
  const dots = points.map((point): Dot => ({
    date: point.date,
    x: xForDate(point.date),
    y: yForValue(point.weightKg),
  }));
  const trendDots = trend.map((entry): Dot => ({
    date: entry.date,
    x: xForDate(entry.date),
    y: yForValue(entry.value),
  }));
  const trendPath = trendDots.map((dot) => `${dot.x},${dot.y}`).join(' ');
  const targetY = targetWeightKg !== null ? yForValue(targetWeightKg) : null;
  const ticks = niceTicks({ min: fromKg(range.min, weightUnit), max: fromKg(range.max, weightUnit) }, TICK_COUNT).map(
    (value): AxisTick => ({ value, y: yForValue(toKg(value, weightUnit)) }),
  );
  return { range, dots, trendDots, trendPath, targetY, ticks };
}
