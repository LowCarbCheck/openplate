/**
 * Which "Save this as a meal?" hints this device has waved away (M227/03).
 *
 * ── Why localStorage and not the primary store ───────────────────────────
 *
 * A dismissed hint is a UI preference about a nudge, not health data. Losing
 * it costs the person one more nudge; carrying it in the IndexedDB store
 * would put it in every backup and on every synced device, so somebody who
 * dismissed the breakfast hint on their phone would silently never see it on
 * their laptop. The diary's favorites key and `celebration.ts` made the same
 * call for the same reason, and neither moved `SCHEMA_VERSION`.
 *
 * ── Per slot, not per group ──────────────────────────────────────────────
 *
 * The unit of dismissal is the SLOT, because that is the unit the person is
 * answering about: "stop asking me about my breakfast". Keying it on the
 * foods would ask again the first morning they swap the yoghurt, which is the
 * nagging this dismissal exists to prevent.
 *
 * ── Pure but for two storage calls ───────────────────────────────────────
 *
 * Both take their storage as an argument, so the "stays dismissed" promise is
 * testable without a browser.
 */
import type { MealType } from '#types/enums';
import { MEAL_TYPES } from '#app/lib/meal-choice';

/** Where the dismissed slots live. Versioned, so a future retune can start clean. */
export const SAVE_MEAL_HINT_STORAGE_KEY = 'openplate:save-meal-hint-dismissed:v1';

/** Minimal storage surface, `localStorage` satisfies it, and so does a plain fake in a test. */
export interface SaveMealHintStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Reads the dismissed slots. Anything unreadable or corrupt degrades to
 * "nothing dismissed" rather than throwing, because a broken preference must
 * never take the diary down with it.
 *
 * @param storage - the storage to read from.
 * @returns the slots whose hint has been waved away on this device.
 */
export function readDismissedSaveMealHints(storage: SaveMealHintStorage): Set<MealType> {
  try {
    const raw = storage.getItem(SAVE_MEAL_HINT_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((slot): slot is MealType => MEAL_TYPES.includes(slot)));
  } catch {
    return new Set();
  }
}

/**
 * Records a slot's hint as dismissed. Write failures (private mode, full
 * quota) are swallowed for the same reason as above.
 *
 * @param storage - the storage to write to.
 * @param slot - the slot the person waved away.
 */
export function dismissSaveMealHint(storage: SaveMealHintStorage, slot: MealType): void {
  try {
    const dismissed = readDismissedSaveMealHints(storage);
    dismissed.add(slot);
    storage.setItem(SAVE_MEAL_HINT_STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Ignored by design, see this function's doc.
  }
}
