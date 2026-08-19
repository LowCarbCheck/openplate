/**
 * Pure tween math for the diary hero's count-up (M129/03). No React, no rAF,
 * no clock — the hook (`#app/hooks/use-count-up`) owns the frame loop and this
 * owns the arithmetic, so the interesting behaviour (interruption, clamping,
 * the exact landing value) is unit-testable without a DOM.
 *
 * The tween is deliberately short and ease-OUT: the number should arrive
 * almost immediately and settle, not sweep. A logging app's feedback has to be
 * quick enough that a second add half a second later feels responsive.
 */

/** Tween length in ms. Short enough to never gate a second add, long enough to read as motion. */
export const COUNT_UP_DURATION_MS = 400;

/**
 * Cubic ease-out — fast start, gentle landing. Matches the `ease-out` easing
 * the ring's CSS transition uses, so the arc and the number stay visually in
 * step even though one is animated by CSS and the other by rAF.
 *
 * @param progress - linear progress, clamped to 0..1 by the caller.
 * @returns the eased progress.
 */
export function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * The tween's value at a point in time.
 *
 * `from` is always the value CURRENTLY on screen, never zero: a second add
 * landing mid-tween must continue from wherever the number happens to be, not
 * restart from the bottom (counsel amendment — rapid successive adds must not
 * stack or rewind). The hook enforces that by reading its own last rendered
 * value; this function just honours whatever `from` it's given.
 *
 * A non-positive `durationMs` means "no animation" and lands on `to`
 * immediately, which is also the reduced-motion path.
 *
 * @param from - the value the tween starts at (the currently displayed one).
 * @param to - the value the tween lands on.
 * @param elapsedMs - milliseconds since the tween started.
 * @param durationMs - the tween's total length.
 * @returns the value to render this frame; exactly `to` once elapsed reaches the duration.
 */
export function countUpValue({
  from,
  to,
  elapsedMs,
  durationMs = COUNT_UP_DURATION_MS,
}: {
  from: number;
  to: number;
  elapsedMs: number;
  durationMs?: number;
}): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs);
}

/**
 * Whether a value change is worth animating at all. A first paint (no previous
 * value) and a no-op change both jump straight to the target — animating from
 * nothing is how a hero ends up counting up from 0 on every page load, which
 * reads as a loading state rather than as feedback.
 *
 * @param from - the previously displayed value, or null on first paint.
 * @param to - the new target value.
 * @returns true when a tween should run.
 */
export function shouldAnimateCountUp(from: number | null, to: number): boolean {
  if (from === null) return false;
  return Math.abs(to - from) > 0.05;
}
