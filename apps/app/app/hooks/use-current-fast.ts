/**
 * use-current-fast.ts, "is a fast open on this device right now, and how far
 * in is it?" as one implementation, plus the app badge that answers the same
 * question when the app is closed.
 *
 * The header chip (`components/fast-chip.tsx`) is the one caller today, and it
 * mounts on EVERY route, so this hook is deliberately cheap: one read of the
 * fasts table per tick, and the tick is a minute because minutes are the
 * smallest unit the chip renders. `/fasting` keeps its own second-resolution
 * clock; it does not come through here.
 *
 * NOTHING ACCUMULATES. The hook returns the stored row and a clock reading; the
 * caller derives every figure with `resolveFastTimeline(fast, nowMs)` on each
 * render. A suspended laptop, a throttled background tab and a stepped device
 * clock therefore all resolve to the right answer on the next read instead of
 * drifting a counter. Same contract as `useNow`, which supplies the clock and
 * already owns the visibility handling: it ticks once on the way back to a
 * visible tab, so a re-read lands there too without this module registering a
 * second `visibilitychange` listener.
 *
 * THE TICK IS NOT THE ONLY TRIGGER. A minute of lag is the right resolution for
 * a running figure and the wrong answer for a write: someone who ends a fast on
 * `/fasting` watched the header pill keep counting for up to a minute, and the
 * same lag delayed the pill appearing when a fast started. So this module also
 * listens to the primary store's own `fasts` table and re-reads on any write,
 * which covers all six of them (create, end, cancel, start-time edit,
 * planned-start edit, reflection) without either side naming the other.
 */
import { useEffect, useState } from 'react';

import { useNow } from '#app/hooks/use-now';
import { listLocalFasts } from '#app/lib/local-store';
import type { LocalFast } from '#app/lib/local-store';
import { getPrimaryStore } from '#app/lib/local-store/persist';
import { FASTS_TABLE } from '#app/lib/local-store/store';
import { resolveFastTimeline, selectCurrentFast, type FastTimeline } from '#app/models/fasting';

/** Minutes are the smallest unit the chip renders, so a faster tick buys nothing. */
const DEFAULT_TICK_MS = 60_000;

const HOUR_MS = 3_600_000;

/**
 * What the app badge should say for one timeline.
 *
 * - a whole number: show that many hours on the badge
 * - `null`: show the badge with NO number, which renders as a plain dot
 * - `'clear'`: take the badge down
 *
 * A dot rather than a "0" for the first hour: "0" reads as nothing to see,
 * which is the opposite of what a fast that just started means.
 */
export type FastBadgeValue = number | null | 'clear';

/** The open fast on this device, resolved against a clock reading. */
export interface CurrentFast {
  /** The single open fast, or null when none is scheduled or running. */
  fast: LocalFast | null;
  /** The clock reading every figure must be derived against. */
  nowMs: number;
}

/**
 * The badge decision, PURE and exported so it can be pinned without a
 * `navigator`. A scheduled fast carries no badge: the person has not started
 * anything yet, and a badge on a plan is a nag.
 *
 * @param timeline - the resolved timeline of the current fast.
 * @returns the hours to show, `null` for a numberless dot, `'clear'` to take it down.
 */
export function badgeValueFor(timeline: FastTimeline): FastBadgeValue {
  if (timeline.status !== 'active') return 'clear';
  const hours = Math.floor(timeline.elapsedMs / HOUR_MS);
  return hours > 0 ? hours : null;
}

/**
 * The badge decision for the whole hook state, including the case the hook
 * spends most of its life in: there is no open fast at all. PURE, and the one
 * expression the badge effect is keyed on, so "the fast went away" and "the
 * fast is finished" take the badge down through the same path rather than
 * leaving a stale number on the icon.
 *
 * @param fast - the open fast on this device, or null when none is open.
 * @param nowMs - the clock reading to resolve the fast against.
 * @returns the hours to show, `null` for a numberless dot, `'clear'` to take it down.
 */
export function badgeValueForCurrent(fast: LocalFast | null, nowMs: number): FastBadgeValue {
  if (fast === null) return 'clear';
  return badgeValueFor(resolveFastTimeline(fast, nowMs));
}

/**
 * Calls `listener` after every write to the primary store's `fasts` table, and
 * returns the unsubscribe. TinyBase already carries the signal, so none of the
 * write functions in `primary-store.ts` has to know a header chip exists.
 *
 * Store access is lazy and the whole attach is best effort: on the server, and
 * in a browser with no usable IndexedDB, there is nothing to listen to and the
 * minute tick remains the only refresh.
 *
 * @param listener - called once per write, with no arguments.
 * @returns a function that removes the listener, safe to call before it attached.
 */
function subscribeToFasts(listener: () => void): () => void {
  let isCancelled = false;
  let remove: (() => void) | null = null;
  void (async () => {
    try {
      const store = await getPrimaryStore();
      if (isCancelled) return;
      const listenerId = store.addTableListener(FASTS_TABLE, () => listener());
      remove = () => store.delListener(listenerId);
    } catch {
      // No store to listen to. Nothing to tell the person, and nothing to retry.
    }
  })();
  return () => {
    isCancelled = true;
    if (remove) remove();
  };
}

/** Whether this process can talk to the Badging API at all. */
function canSetAppBadge(): boolean {
  if (globalThis.document === undefined) return false;
  if (globalThis.navigator === undefined) return false;
  return 'setAppBadge' in navigator && 'clearAppBadge' in navigator;
}

/**
 * Applies one badge decision, fire and forget. Every rejection is swallowed:
 * the Badging API rejects on a browser that exposes it but refuses it for an
 * uninstalled page, and a fasting chip is not worth an unhandled rejection in
 * someone's console.
 */
function applyAppBadge(value: FastBadgeValue): void {
  if (!canSetAppBadge()) return;
  void (async () => {
    try {
      if (value === 'clear') await navigator.clearAppBadge();
      else if (value === null) await navigator.setAppBadge();
      else await navigator.setAppBadge(value);
    } catch {
      // The page is not installed, or the platform refuses badges. Nothing to
      // tell the person, and nothing to retry.
    }
  })();
}

/**
 * The open fast on this device plus the clock to resolve it against, re-read
 * on an interval while the tab is visible.
 *
 * Owns the app badge as a side effect: the effect below is keyed on the badge
 * DECISION, not on the clock, so the platform is called once per whole hour
 * rather than once per minute.
 *
 * @param intervalMs - how often to re-read the store and the clock (defaults to a minute).
 * @returns the open fast, or null, and the clock reading it was resolved against.
 */
export function useCurrentFast({ intervalMs = DEFAULT_TICK_MS }: { intervalMs?: number } = {}): CurrentFast {
  const nowMs = useNow({ intervalMs });
  const [fast, setFast] = useState<LocalFast | null>(null);
  // Bumped by the store listener below. A counter rather than a boolean because
  // two writes in a row must both land, and a boolean that is already true
  // would swallow the second.
  const [writeCount, setWriteCount] = useState(0);

  // One subscription for the life of the hook, NOT one per tick: a subscription
  // that is torn down and re-attached every minute has a gap in it, and a write
  // that lands in the gap is the exact defect this listener exists to fix.
  useEffect(() => subscribeToFasts(() => setWriteCount((count) => count + 1)), []);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const current = selectCurrentFast(await listLocalFasts());
      if (!isCancelled) setFast(current);
    })();
    return () => {
      isCancelled = true;
    };
  }, [nowMs, writeCount]);

  const badgeValue = badgeValueForCurrent(fast, nowMs);
  useEffect(() => {
    applyAppBadge(badgeValue);
  }, [badgeValue]);

  return { fast, nowMs };
}
