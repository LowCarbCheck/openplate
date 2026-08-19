/**
 * Weight-trend math for the goals/weight settings page — pure, dependency-free,
 * and directly unit-testable (no React, no DB). Two concerns live here:
 *
 *   1. An **exponential moving average** that copes with irregular weigh-in
 *      gaps (people skip days), used to draw the smoothed trend line over the
 *      raw dots.
 *   2. The **linear scaling helpers** the inline-SVG chart uses to map weights
 *      and dates onto pixel coordinates.
 *
 * Keeping this out of the component keeps the chart a thin renderer and lets the
 * arithmetic be tested in isolation.
 */

/** Milliseconds in one calendar day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Default smoothing factor — higher tracks the latest reading more closely. */
const DEFAULT_ALPHA = 0.25;
/** Fraction of the value span added above and below as breathing room. */
const PAD_FRACTION = 0.1;
/** Half-band applied when every value is identical (a single distinct weight). */
const FLAT_SERIES_PAD_KG = 1;
/** Matches a bare `YYYY-MM-DD` calendar date. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Axis tick ladder, coarsening left to right — see `niceTicks`. */
const TICK_STEPS = [0.5, 1, 2, 5, 10];
/** Slack when testing a tick against the range's upper bound, so `72.9 + 0.1` still counts as 73. */
const TICK_EPSILON = 1e-9;

/** A value stamped with the calendar day it belongs to. */
export interface DatedValue {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  value: number;
}

/** A padded numeric interval for one axis of the chart. */
export interface ValueRange {
  min: number;
  max: number;
}

/**
 * Whole-day distance between two `YYYY-MM-DD` dates (`to - from`). Computed from
 * UTC midnights so it is immune to time zones and DST — it counts calendar days,
 * not elapsed hours.
 *
 * @param from - the earlier calendar date, `YYYY-MM-DD`.
 * @param to - the later calendar date, `YYYY-MM-DD`.
 * @returns signed number of days between them (negative if `to` precedes `from`).
 * @throws if either argument is not a valid `YYYY-MM-DD`.
 */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((_toUtcMillis(to) - _toUtcMillis(from)) / MS_PER_DAY);
}

/**
 * Exponential moving average that respects irregular gaps between weigh-ins.
 *
 * A plain EWMA weights every new sample by a fixed `alpha` regardless of how
 * much time passed — wrong for sporadic weigh-ins, where a reading after a
 * two-week gap should pull the trend harder than one taken the next morning.
 * We instead treat `alpha` as a *per-day* decay and raise the retention factor
 * to the number of days elapsed: `effectiveAlpha = 1 - (1 - alpha) ** gapDays`.
 * After a 1-day gap this is exactly `alpha` (ordinary EWMA); after a long gap it
 * approaches 1, so the trend snaps toward the fresh reading instead of clinging
 * to a stale one. Same-day duplicates are clamped to a 1-day gap.
 *
 * @param points - weigh-ins in ascending date order (caller sorts).
 * @param alpha - per-day smoothing factor in `(0, 1]` (default `0.25`).
 * @returns the smoothed series, one entry per input point, dates preserved.
 * @throws if `alpha` is outside `(0, 1]`.
 */
export function exponentialMovingAverage(points: DatedValue[], alpha: number = DEFAULT_ALPHA): DatedValue[] {
  if (alpha <= 0 || alpha > 1) throw new Error(`alpha must be in (0, 1], got ${alpha}`);
  if (points.length === 0) return [];
  const [first, ...rest] = points;
  const result: DatedValue[] = [{ date: first.date, value: first.value }];
  let previous = points[0];
  for (const current of rest) {
    const gapDays = Math.max(1, daysBetweenDates(previous.date, current.date));
    const effectiveAlpha = 1 - Math.pow(1 - alpha, gapDays);
    const smoothed = effectiveAlpha * current.value + (1 - effectiveAlpha) * result[result.length - 1].value;
    result.push({ date: current.date, value: smoothed });
    previous = current;
  }
  return result;
}

/**
 * Padded value interval covering every supplied number, used for the chart's
 * vertical axis. A 10% pad keeps dots off the frame; a series with a single
 * distinct value is given a fixed ±1 kg band so the point sits centred rather
 * than flush against an edge.
 *
 * @param values - all numbers that must fit (weigh-ins, trend, and target).
 * @returns the `{ min, max }` interval to map onto pixels.
 */
export function computeValueRange(values: number[]): ValueRange {
  if (values.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return { min: lo - FLAT_SERIES_PAD_KG, max: hi + FLAT_SERIES_PAD_KG };
  const pad = (hi - lo) * PAD_FRACTION;
  return { min: lo - pad, max: hi + pad };
}

/**
 * Clean tick values spanning `[min, max]` — the human-readable numbers the
 * weight axis labels. Steps come from a fixed ladder (0.5, 1, 2, 5, 10) so an
 * axis never reads "72.37"; the smallest step producing at most `count` ticks
 * wins, and the coarsest step is the fallback when even it produces more.
 *
 * Unit-agnostic on purpose: the caller passes the range in whatever unit it is
 * going to LABEL (kg or lb), so the round numbers land where the reader sees
 * them rather than in the storage unit.
 *
 * @param range - the padded value interval from `computeValueRange`.
 * @param count - the maximum number of ticks to emit.
 * @returns tick values ascending, all inside `[min, max]`.
 */
export function niceTicks(range: ValueRange, count: number): number[] {
  if (count <= 0 || !(range.max > range.min)) return [];
  let ticks: number[] = [];
  for (const step of TICK_STEPS) {
    ticks = _ticksForStep(range, step);
    if (ticks.length <= count) return ticks;
  }
  return ticks;
}

/** Every multiple of `step` inside `range`, rounded to kill floating-point dust. */
function _ticksForStep(range: ValueRange, step: number): number[] {
  const values: number[] = [];
  const first = Math.ceil(range.min / step) * step;
  for (let value = first; value <= range.max + TICK_EPSILON; value += step) {
    values.push(Math.round(value / step) * step);
  }
  return values;
}

/**
 * Maps a value from a numeric domain onto a pixel range. Supports an inverted
 * range (`rangeMin > rangeMax`) so an SVG y-axis — where larger weights sit at
 * smaller pixel coordinates — falls out naturally. A zero-width domain maps to
 * the range midpoint (a single-point series renders centred).
 *
 * @param input - the value plus its domain and target range bounds.
 * @returns the interpolated position within `[rangeMin, rangeMax]`.
 */
export function scaleLinear(input: {
  value: number;
  domainMin: number;
  domainMax: number;
  rangeMin: number;
  rangeMax: number;
}): number {
  const { value, domainMin, domainMax, rangeMin, rangeMax } = input;
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  const fraction = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + fraction * (rangeMax - rangeMin);
}

/** Parses `YYYY-MM-DD` into the UTC-midnight epoch millis it denotes. */
function _toUtcMillis(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
