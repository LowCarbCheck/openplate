/**
 * Whether this device has waved away the dashboard's one-time door to Insights
 * (M239/06). A single flag, not a set: the hint offers exactly one thing once,
 * unlike the per-slot "Save this as a meal?" hint (`#app/lib/save-meal-hint`)
 * it otherwise mirrors.
 *
 * `localStorage`, not the primary store: a dismissed hint is a UI preference
 * about a nudge, not health data. Carrying it in the synced store would put it
 * in every backup and on every synced device, so waving it away on a phone
 * would silently hide it on a laptop too, the same call `save-meal-hint.ts`
 * makes, for the same reason.
 */

/** Where the dismissal lives. Versioned, so a future retune can start clean. */
export const INSIGHTS_HINT_STORAGE_KEY = 'openplate:insights-hint-dismissed:v1';

/** Minimal storage surface, `localStorage` satisfies it, and so does a plain fake in a test. */
export interface InsightsHintStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Whether the hint has been dismissed. Anything unreadable degrades to "not
 * dismissed" rather than throwing, because a broken preference must never
 * take the dashboard down with it.
 *
 * @param storage - the storage to read from.
 * @returns whether this device dismissed the hint.
 */
export function isInsightsHintDismissed(storage: InsightsHintStorage): boolean {
  try {
    return storage.getItem(INSIGHTS_HINT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Records the hint as dismissed. Write failures (private mode, full quota)
 * are swallowed for the same reason as above.
 *
 * @param storage - the storage to write to.
 */
export function dismissInsightsHint(storage: InsightsHintStorage): void {
  try {
    storage.setItem(INSIGHTS_HINT_STORAGE_KEY, '1');
  } catch {
    // Ignored by design, see this function's doc.
  }
}
