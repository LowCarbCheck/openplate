import { useMemo } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
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
}

//////////////////////////////////////////////////////////////////////////////
// SVG geometry — a fixed viewBox scaled responsively by the container width.
//////////////////////////////////////////////////////////////////////////////

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 200;
/** Wide enough for the y-tick labels that replaced the old min/max corner text. */
const PLOT_LEFT = 40;
const PLOT_RIGHT = VIEW_WIDTH - 8;
const PLOT_TOP = 14;
const PLOT_BOTTOM = VIEW_HEIGHT - 14;
/**
 * Raw-weigh-in dot radius, 6px rather than the usual ≥8px marker minimum. A
 * DELIBERATE, documented deviation: with up to 91 daily weigh-ins across a
 * 640-unit viewBox the points sit ~7 units apart, and 8px dots would fuse into
 * a band. The ≥8px rule is honoured on the EMPHASIS marker below, which is the
 * one a reader actually targets.
 */
const DOT_RADIUS = 3;
/** The crosshair-snapped marker on the trend line: 9px, with a 2px surface ring. */
const ACTIVE_MARKER_RADIUS = 4.5;
/** How many horizontal gridlines the axis aims for. */
const TICK_COUNT = 4;
/** Gap between a tick label and the plot's left edge. */
const TICK_LABEL_GAP = 6;
/** Nudge that centres a tick label on its gridline (the text baseline sits below the anchor). */
const TICK_LABEL_BASELINE = 3;

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
    <figure className="relative m-0 rounded-lg">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="h-auto w-full" aria-hidden="true">
        {geometry.ticks.map((tick, index) => (
          <g key={tick.value}>
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={tick.y}
              y2={tick.y}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PLOT_LEFT - TICK_LABEL_GAP}
              y={tick.y + TICK_LABEL_BASELINE}
              textAnchor="end"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {formatMacroNumberIn(i18n.language, tick.value)}
              {index === geometry.ticks.length - 1 ? ` ${weightUnit}` : ''}
            </text>
          </g>
        ))}

        {geometry.targetY !== null && (
          <g className="stroke-muted-foreground">
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={geometry.targetY}
              y2={geometry.targetY}
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PLOT_RIGHT}
              y={geometry.targetY - 4}
              textAnchor="end"
              className="fill-muted-foreground stroke-none text-[10px]"
            >
              {t('trends.weight.target', {
                value: formatMacroNumberIn(i18n.language, fromKg(targetWeightKg ?? 0, weightUnit)),
                unit: weightUnit,
              })}
            </text>
          </g>
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

        {geometry.dots.map((dot) => (
          <circle
            key={dot.date}
            cx={dot.x}
            cy={dot.y}
            r={DOT_RADIUS}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="fill-muted-foreground/60 stroke-card"
          />
        ))}

        {activeTrend !== null && (
          <circle
            cx={activeTrend.x}
            cy={activeTrend.y}
            r={ACTIVE_MARKER_RADIUS}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="fill-primary stroke-card"
          />
        )}
      </svg>

      {/* Transparent hit layer: snapping is by x only, so a reader never has to
          land on a 6px dot to read a day. It is a real button so that the
          chart's keyboard model (arrows / Home / End) hangs off a focusable,
          interactive element — the SVG above is decorative, and this control
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
