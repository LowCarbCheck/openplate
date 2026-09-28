/**
 * The two ways a person says "do not count my visits", and the one place they are read
 * (2026-09-28, the pre-launch privacy audit).
 *
 * THE REPORT. The hosted privacy notice said this instance's Matomo honours Do Not Track, and a
 * live browser sending it was counted anyway: the tracker hook never looked. And visit counting
 * rests on legitimate interest, which gives a person the right to object, with no way to do it.
 *
 * TWO SIGNALS, ONE ANSWER:
 * - THE BROWSER'S, `navigator.doNotTrack === '1'` (and the older `window.doNotTrack`) or
 *   `navigator.globalPrivacyControl === true`. Read on every load, never stored.
 * - THE PERSON'S, the switch on Preferences, kept in `localStorage` under
 *   {@link ANALYTICS_OPT_OUT_KEY}. Storing a refusal is the one thing that makes a refusal last,
 *   so it is the storage a person asked for, not analytics storage.
 *
 * `use-matomo-tracker.ts` loads no script at all while either says no. A change of the switch
 * during a visit is announced with {@link ANALYTICS_OPT_OUT_EVENT}, so the hook can stop a
 * tracker that already loaded.
 */
import { z } from 'zod';

/** The `localStorage` key that holds a person's opt-out. `'1'` means do not count. */
export const ANALYTICS_OPT_OUT_KEY = 'openplate-analytics-opt-out';

/** Dispatched on `window` when the switch changes during a visit. */
export const ANALYTICS_OPT_OUT_EVENT = 'openplate:analytics-opt-out';

/**
 * The two browser signals, read off `navigator` and `window` by a schema rather than a cast: an
 * older browser lacks one or both, and a property that is missing or of another type simply
 * says nothing.
 */
const navigatorSignalsSchema = z.object({
  doNotTrack: z.string().nullish(),
  globalPrivacyControl: z.boolean().optional(),
});
const windowSignalsSchema = z.object({ doNotTrack: z.string().nullish() });

/** Whether the browser itself asks sites not to track: Do Not Track or Global Privacy Control. */
export function browserAsksNotToTrack(): boolean {
  if (globalThis.navigator === undefined) return false;
  const fromNavigator = navigatorSignalsSchema.safeParse(globalThis.navigator);
  const fromWindow = windowSignalsSchema.safeParse(globalThis);
  return (
    (fromNavigator.success &&
      (fromNavigator.data.doNotTrack === '1' || fromNavigator.data.globalPrivacyControl === true)) ||
    (fromWindow.success && fromWindow.data.doNotTrack === '1')
  );
}

/** Whether the person switched visit counting off on this device. */
export function hasOptedOutOfAnalytics(): boolean {
  try {
    return globalThis.localStorage?.getItem(ANALYTICS_OPT_OUT_KEY) === '1';
  } catch {
    // Storage blocked outright: nothing was ever saved, so nothing was refused here.
    return false;
  }
}

/** Whether this browser may be counted at all. */
export function mayCountVisits(): boolean {
  return !browserAsksNotToTrack() && !hasOptedOutOfAnalytics();
}

/**
 * Saves the person's choice and tells a running tracker about it.
 *
 * @param optedOut - `true` to stop counting on this device.
 */
export function setAnalyticsOptOut(optedOut: boolean): void {
  try {
    if (optedOut) globalThis.localStorage?.setItem(ANALYTICS_OPT_OUT_KEY, '1');
    else globalThis.localStorage?.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // Storage blocked: the choice cannot outlive this visit, but the event below still stops it now.
  }
  globalThis.dispatchEvent?.(new CustomEvent(ANALYTICS_OPT_OUT_EVENT, { detail: { optedOut } }));
}
