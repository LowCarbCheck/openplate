/**
 * Pure swipe-intent decision for the diary's between-days gesture (M129/04).
 * DOM-free on purpose: the touch handler that feeds it (`use-day-swipe.ts`) is
 * a thin adapter, so every threshold here is directly unit-testable without a
 * browser.
 *
 * The gesture is a BONUS affordance — the chevrons and the date picker remain
 * the visible, discoverable way to change days. That framing sets the tuning:
 * this function should be *conservative*. A false negative costs the user
 * nothing (they tap the chevron); a false positive yanks the page out from
 * under a scroll and feels broken. Hence three independent gates, all of which
 * must pass:
 *
 * 1. **Distance** — the drag must cover at least `minDistancePx`. Short flicks
 *    are almost always the start of a tap or a scroll.
 * 2. **Horizontal intent** — vertical travel must stay under
 *    `maxOffAxisRatio × |dx|`. This is the gate that keeps a diagonal scroll
 *    (the common case on a long diary) from paging the day.
 * 3. **Duration** — a drag that took longer than `maxDurationMs` is a slow
 *    exploratory movement (or a finger resting mid-scroll), not a swipe.
 *
 * Direction follows the physical-page metaphor the whole app already implies:
 * dragging right pulls YESTERDAY in from the left (`prev`), dragging left
 * pushes toward TOMORROW (`next`).
 */

/** Which neighbouring day a resolved swipe should navigate to. */
export type SwipeDirection = 'prev' | 'next';

/** Minimum horizontal travel, in CSS pixels, before a drag counts as a swipe. */
export const SWIPE_MIN_DISTANCE_PX = 56;

/**
 * The most vertical travel a swipe may carry, as a fraction of its horizontal
 * travel. 0.6 means "the drag must be noticeably flatter than 31°" — comfortably
 * permissive for a real thumb arc, strict enough that an ordinary scroll (which
 * is overwhelmingly vertical) can never resolve.
 */
export const SWIPE_MAX_OFF_AXIS_RATIO = 0.6;

/** Longest a drag may take and still read as a swipe rather than a slow drag/scroll. */
export const SWIPE_MAX_DURATION_MS = 800;

/** The tunable gates; each defaults to the module constant of the same name. */
export interface SwipeThresholds {
  minDistancePx?: number;
  maxOffAxisRatio?: number;
  maxDurationMs?: number;
}

/** One completed drag: net travel and how long it took. */
export interface SwipeGesture {
  /** Net horizontal travel (end − start). Positive = dragged right. */
  dx: number;
  /** Net vertical travel (end − start). Sign is irrelevant; only magnitude is judged. */
  dy: number;
  /** Elapsed time between touchstart and touchend, in milliseconds. */
  durationMs: number;
}

/**
 * Decides whether a completed drag is a day-changing swipe.
 *
 * @param gesture - the drag's net travel and duration.
 * @param thresholds - optional overrides for the three gates.
 * @returns `'prev'` (dragged right), `'next'` (dragged left), or `null` when the
 *   drag fails any gate — the caller must then do nothing at all.
 */
export function resolveSwipe(gesture: SwipeGesture, thresholds: SwipeThresholds = {}): SwipeDirection | null {
  const minDistancePx = thresholds.minDistancePx ?? SWIPE_MIN_DISTANCE_PX;
  const maxOffAxisRatio = thresholds.maxOffAxisRatio ?? SWIPE_MAX_OFF_AXIS_RATIO;
  const maxDurationMs = thresholds.maxDurationMs ?? SWIPE_MAX_DURATION_MS;

  if (!Number.isFinite(gesture.dx) || !Number.isFinite(gesture.dy)) return null;
  if (gesture.durationMs > maxDurationMs) return null;

  const distance = Math.abs(gesture.dx);
  if (distance < minDistancePx) return null;
  if (Math.abs(gesture.dy) > distance * maxOffAxisRatio) return null;

  return gesture.dx > 0 ? 'prev' : 'next';
}
