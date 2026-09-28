/**
 * The DOM adapter for the diary's swipe-between-days gesture (M129/04). All the
 * judgement lives in `#app/lib/swipe-day-navigation`'s pure `resolveSwipe`;
 * everything here is plumbing plus the guards that decide whether a touch is
 * even *eligible* to become a swipe.
 *
 * The guards matter more than the thresholds. Swipe is a bonus affordance layered
 * on a page full of other touch surfaces, so a gesture is abandoned outright when
 * it starts:
 *
 * - with more than one finger down (pinch/zoom, never a day change);
 * - inside a form control or contenteditable (text selection is a horizontal drag);
 * - inside an open dialog/sheet/popover (`[role="dialog"]`, `[role="listbox"]`,
 *   `[role="menu"]`) — the calendar popover and the drill-down must never page
 *   the day out from under themselves;
 * - inside anything horizontally scrollable between the target and the diary root
 *   (a chip row, a table wrapper) — that element owns horizontal drags;
 * - inside an explicit `[data-no-swipe]` opt-out, for future surfaces that need one;
 * - within `EDGE_DEAD_ZONE_PX` of either viewport edge, where iOS/Android are
 *   already interpreting the drag as a browser back/forward navigation. Competing
 *   with the OS there produces a double-navigation, which is worse than no gesture.
 *
 * Nothing here calls `preventDefault`, so the listeners stay passive-friendly and
 * vertical scrolling is never blocked: a drag that fails any gate is simply a
 * normal scroll that also happened to move sideways a bit.
 */
import { useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { resolveSwipe } from '#app/lib/swipe-day-navigation';
import type { SwipeDirection } from '#app/lib/swipe-day-navigation';

/**
 * How close to a viewport edge a touch may start before the gesture is ceded to
 * the browser's own back/forward edge swipe.
 */
export const EDGE_DEAD_ZONE_PX = 28;

/** Selector for surfaces that own their own horizontal drags or must not be paged. */
const BLOCKING_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe], [role="dialog"], [role="listbox"], [role="menu"], [role="slider"]';

/** The pointer/time snapshot taken at touchstart, or null when the gesture was refused. */
interface TouchOrigin {
  x: number;
  y: number;
  at: number;
}

/** The touch props to spread onto the swipeable container. */
export interface DaySwipeHandlers {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchCancel: () => void;
}

/** True when some element between `target` and `container` scrolls horizontally. */
function _hasHorizontalScrollAncestor(target: Element | null, container: Element): boolean {
  let node: Element | null = target;
  while (node !== null && node !== container) {
    if (node.scrollWidth - node.clientWidth > 1) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** True when the touch started somewhere a day-swipe must not begin. */
function _isRefusedTarget(target: EventTarget | null, container: Element): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(BLOCKING_SELECTOR) !== null) return true;
  return _hasHorizontalScrollAncestor(target, container);
}

/**
 * Wires touch handlers that navigate to the previous/next day.
 *
 * @param onSwipe - called with the resolved direction; the caller decides whether
 *   that direction is actually navigable (e.g. "next" is a no-op on today).
 * @returns the touch props to spread onto the diary's root element.
 */
export function useDaySwipe(onSwipe: (direction: SwipeDirection) => void): DaySwipeHandlers {
  const origin = useRef<TouchOrigin | null>(null);

  return {
    onTouchStart(event) {
      origin.current = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX < EDGE_DEAD_ZONE_PX) return;
      if (touch.clientX > window.innerWidth - EDGE_DEAD_ZONE_PX) return;
      if (_isRefusedTarget(event.target, event.currentTarget)) return;
      origin.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    },

    // A second finger arriving mid-drag turns this into a pinch/zoom, not a swipe.
    onTouchMove(event) {
      if (event.touches.length > 1) origin.current = null;
    },

    onTouchEnd(event) {
      const start = origin.current;
      origin.current = null;
      if (start === null) return;
      const touch = event.changedTouches[0];
      if (touch === undefined) return;
      const direction = resolveSwipe({
        dx: touch.clientX - start.x,
        dy: touch.clientY - start.y,
        durationMs: Date.now() - start.at,
      });
      if (direction !== null) onSwipe(direction);
    },

    onTouchCancel() {
      origin.current = null;
    },
  };
}
