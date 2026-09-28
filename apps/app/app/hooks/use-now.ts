import { useEffect, useState } from 'react';

/**
 * The current instant, re-read on an interval — the clock behind every fasting
 * countdown. Two properties this hook exists to guarantee:
 *
 * 1. **Nothing accumulates.** Every consumer derives its figures from
 *    `Date.now()` afresh, so a throttled background tab, a suspended laptop
 *    and a stepped device clock all resolve to the right answer on the next
 *    read instead of drifting a stored counter.
 * 2. **A hidden tab does no work.** The interval is torn down on
 *    `visibilitychange` and restarted on the way back — and `start()` reads the
 *    clock ONCE before scheduling, so returning to a tab that was hidden for an
 *    hour repaints the true time immediately rather than after one interval.
 *
 * Shape borrowed wholesale from `useLiveDiaryRevalidation` in
 * `app/routes/diary.tsx`; `intervalMs` is a parameter because tick rate should
 * match display resolution — `/fasting` renders seconds and passes 1000,
 * `/dashboard` renders minutes and passes 60000. A 1 s interval on a screen
 * whose smallest rendered unit is a minute buys nothing.
 *
 * NOT gated on `prefers-reduced-motion`: a countdown is live data, like a
 * clock, and freezing it would be a functional regression rather than a
 * courtesy. (The ring's own `stroke-dashoffset` transition stays `motion-safe:`
 * scoped inside `RingProgress`; nothing here overrides it.)
 *
 * SSR-safe by construction: both consuming routes are `clientLoader.hydrate =
 * true` with a `HydrateFallback`, so neither the ring nor the strip is ever
 * server-rendered and this `Date.now()` cannot produce a hydration mismatch.
 *
 * @param intervalMs - how often to re-read the clock while the tab is visible.
 * @param enabled - set false to hold the clock still (defaults to true).
 * @returns the latest epoch-ms reading.
 */
export function useNow({ intervalMs, enabled = true }: { intervalMs: number; enabled?: boolean }): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (globalThis.document === undefined) return;
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => setNowMs(Date.now());
    const start = () => {
      if (timer !== null) return;
      // Read BEFORE scheduling: a tab that was hidden for an hour must repaint
      // the true time on its first frame back, not one interval later.
      tick();
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);

  return nowMs;
}
