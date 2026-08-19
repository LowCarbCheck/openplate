/**
 * Count-up tween for the diary hero's headline figure (M129/03).
 *
 * Three properties this hook exists to guarantee, all of them from the spec's
 * counsel amendments:
 *
 * 1. **It animates from what's ON SCREEN, never from zero.** The previous
 *    value is remembered per `key` in a module-scoped map rather than in
 *    component state, because the common case — logging a food from `/add` —
 *    REMOUNTS the diary route, which would otherwise wipe the "old" value and
 *    make every add look like a fresh count-up from nothing. The map lives for
 *    the SPA session, which is exactly the window in which "old → new" means
 *    anything.
 * 2. **In-flight tweens are cancelled, not stacked.** A second add half a
 *    second after the first picks up from the partially-counted figure and
 *    retargets; it never restarts and never runs two rAF loops at once.
 * 3. **`prefers-reduced-motion` short-circuits the whole thing.** No frame loop
 *    is scheduled at all — the value is set once, synchronously.
 *
 * First paint never animates (see `shouldAnimateCountUp`): with no remembered
 * previous value the hook returns the target immediately, so a cold load shows
 * the real number rather than a number climbing toward it.
 */
import { useEffect, useRef, useState } from 'react';
import { countUpValue, shouldAnimateCountUp } from '#app/lib/count-up';

/**
 * Last displayed value per key, surviving route remounts within the SPA
 * session. Keyed by the caller (the diary keys on the viewed date + hero mode)
 * so paging to another day doesn't tween yesterday's number into today's.
 */
const lastDisplayedByKey = new Map<string, number>();

/** Whether this device has asked for reduced motion. SSR-safe (no `window` → no motion). */
function prefersReducedMotion(): boolean {
  if (globalThis.window === undefined || !('matchMedia' in globalThis.window)) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The value to paint before any tween starts: the remembered one when there's
 * a real animation to run from it, otherwise the target itself.
 *
 * @param target - the real, current value.
 * @param key - the figure's identity in the remembered-value map.
 * @returns the initial display value.
 */
function initialDisplayValue(target: number, key: string): number {
  const previous = lastDisplayedByKey.get(key) ?? null;
  if (prefersReducedMotion() || !shouldAnimateCountUp(previous, target)) return target;
  return previous ?? target;
}

/**
 * Tweens toward `target`, returning the value to render this frame.
 *
 * @param target - the real, current value.
 * @param key - identity of the figure being animated; a change of key resets rather than tweens.
 * @returns the value to display now (always exactly `target` once the tween lands).
 */
export function useCountUp(target: number, key: string): number {
  // The FIRST rendered value has to be the remembered one, not the target:
  // effects run after paint, so seeding this with `target` would paint the
  // final number and then visibly jump backwards to start the tween. On a
  // genuine first paint (nothing remembered) there is nothing to animate from
  // and the target is correct immediately.
  const [displayed, setDisplayed] = useState(() => initialDisplayValue(target, key));
  // Mirrors `displayed` so the effect can read the on-screen value without
  // listing it as a dependency (which would restart the tween every frame).
  const displayedRef = useRef(displayed);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const previous = lastDisplayedByKey.get(key) ?? null;
    const land = () => {
      displayedRef.current = target;
      setDisplayed(target);
      lastDisplayedByKey.set(key, target);
    };

    if (prefersReducedMotion() || !shouldAnimateCountUp(previous, target)) {
      land();
      return;
    }

    // Continue from whatever is on screen right now — a mid-tween retarget
    // must not rewind to the last settled value.
    const from = displayedRef.current;
    const startedAt = performance.now();

    const step = (now: number) => {
      const value = countUpValue({ from, to: target, elapsedMs: now - startedAt });
      displayedRef.current = value;
      setDisplayed(value);
      if (value === target) {
        lastDisplayedByKey.set(key, target);
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      // Remember where the interrupted tween actually got to, so the NEXT one
      // continues from there even across a remount.
      lastDisplayedByKey.set(key, displayedRef.current);
    };
  }, [target, key]);

  return displayed;
}
