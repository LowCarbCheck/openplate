/**
 * Pure geometry math for `RingProgress` (M129/02) — no React/DOM, so the
 * clamping and dashoffset arithmetic are directly unit-testable without
 * rendering the SVG. The ring is drawn as a single circle whose
 * `stroke-dasharray` equals its own circumference and whose
 * `stroke-dashoffset` is dialled back from full-circumference (0% drawn) to
 * 0 (100% drawn) as `value` approaches `max`.
 */

export interface RingGeometry {
  /** Radius of the stroked circle, inset by half the stroke width so the ring doesn't clip the SVG viewport. */
  radius: number;
  /** Circumference of that circle — the `stroke-dasharray` value. */
  circumference: number;
  /** `stroke-dashoffset` for the progress arc, in the same units as `circumference`. */
  dashoffset: number;
  /** `value` clamped to `[0, max]` — what the arc actually draws (an over-goal value still renders a full ring, not an overflowing one). */
  clampedValue: number;
  /** Clamped fill as a 0-100 percentage, for callers that want it directly. */
  percent: number;
}

/**
 * Computes the ring's radius/circumference/dashoffset for a given value/max
 * and SVG size. `max <= 0` is treated as "no denominator to divide against" —
 * it renders a full ring when `value > 0`, an empty one otherwise, the same
 * degenerate-ceiling handling `computeCarbGoalProgress` already uses.
 *
 * @param value - the raw (unclamped) value being tracked.
 * @param max - the goal/ceiling the ring fills toward.
 * @param size - the SVG's width/height in pixels (the ring is always a circle).
 * @param strokeWidth - the stroke width in pixels, inset from `size`'s edge.
 * @returns the radius, circumference, dashoffset, clamped value, and percent.
 */
export function computeRingGeometry({
  value,
  max,
  size,
  strokeWidth,
}: {
  value: number;
  max: number;
  size: number;
  strokeWidth: number;
}): RingGeometry {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (max <= 0) {
    const isFull = value > 0;
    return {
      radius,
      circumference,
      dashoffset: isFull ? 0 : circumference,
      clampedValue: isFull ? max : 0,
      percent: isFull ? 100 : 0,
    };
  }

  const clampedValue = Math.min(Math.max(value, 0), max);
  const fraction = clampedValue / max;
  return {
    radius,
    circumference,
    dashoffset: circumference * (1 - fraction),
    clampedValue,
    percent: fraction * 100,
  };
}
