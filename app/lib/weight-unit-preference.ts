/**
 * The device-local kg/lb display preference, shared by every screen that shows
 * a weight — the goals settings page and the Progress page's weight card.
 *
 * Extracted from `settings.goals.tsx` when the weight chart moved onto
 * `/trends`: two copies of the storage key is how the two screens end up
 * disagreeing about which unit the user picked. Browser-local and deliberately
 * NOT synced or exported — it is a rendering preference, not health data.
 */
import type { WeightUnit } from '#app/lib/weight-units';

/** Browser-local (not synced) display-unit preference for every weight field in the app. */
export const WEIGHT_UNIT_STORAGE_KEY = 'openplate:weight-unit';

/**
 * Reads the stored weight-unit preference, defaulting to kg when unset or
 * unavailable (server render, private browsing).
 *
 * @returns the stored unit, or `'kg'`.
 */
export function readStoredWeightUnit(): WeightUnit {
  if (globalThis.window === undefined) return 'kg';
  const stored = window.localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY);
  return stored === 'lb' ? 'lb' : 'kg';
}

/**
 * Persists the weight-unit preference. A no-op outside the browser, and a
 * write failure (private mode, full quota) is swallowed — losing a display
 * preference must never take a page down.
 *
 * @param unit - the unit to remember.
 */
export function writeStoredWeightUnit(unit: WeightUnit): void {
  if (globalThis.window === undefined) return;
  try {
    window.localStorage.setItem(WEIGHT_UNIT_STORAGE_KEY, unit);
  } catch {
    // Ignored by design — see this function's doc.
  }
}
