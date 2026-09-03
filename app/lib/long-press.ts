/**
 * The bonus long-press path on the tab bar's launcher (`add-launcher.tsx`).
 *
 * A long press is never the only way to reach the sheet — the visible chevron
 * beside the launcher is — so this is a shortcut for people who already expect
 * one, not an affordance anything depends on. It lives here as pure functions
 * because timing and slop tolerances are exactly the part worth pinning in a
 * test, and neither needs a pointer, a timer or a DOM to decide.
 */

/** How long a press must be held before the sheet opens. */
export const LONG_PRESS_MS = 450;

/** How far a pointer may drift during a press before it reads as a scroll, not a press. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/** A pointer position in client coordinates. */
export interface PointerPosition {
  x: number;
  y: number;
}

/**
 * Whether a pointer has drifted far enough to abandon the press.
 *
 * Both points are the same shape, so they are named rather than positional —
 * swapping them would compile and silently invert nothing (the distance is
 * symmetric), which is precisely the kind of bug that never gets noticed.
 */
export function hasMovedBeyondPressTolerance({
  start,
  current,
  tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX,
}: {
  start: PointerPosition;
  current: PointerPosition;
  tolerancePx?: number;
}): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.hypot(dx, dy) > tolerancePx;
}

/**
 * Whether a press held for `heldMs` counts as a long press.
 *
 * Exactly `LONG_PRESS_MS` counts: the timer that drives this fires ON the
 * threshold, and a strict comparison would make the real-world case the one
 * that never opens the sheet.
 */
export function isLongPress(heldMs: number, thresholdMs: number = LONG_PRESS_MS): boolean {
  return heldMs >= thresholdMs;
}
