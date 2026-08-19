/**
 * The day's post-write net-carb total, for the add toast's "…12g net carbs so
 * far today." clause (M129/03).
 *
 * Shared by every add path (`/add`'s portion step and manual entry, the
 * diary's quick-add chips and copy-from-yesterday, `/scan`'s confirm) and read
 * from the SAME store, through the SAME aggregate, that the diary hero itself
 * uses — so a toast can never report a number the hero disagrees with a
 * moment later.
 */
import { computeDailyTotals, listLocalFoodLogs } from '#app/lib/local-store';

/** A day's tracked total, plus whether it leans on AI estimates (which hedges the figure with "~"). */
export interface DayCarbTotals {
  netCarbs: number;
  hasEstimates: boolean;
}

/**
 * Reads a day's net carbs from the local store.
 *
 * @param dayKey - the local calendar day to total.
 * @returns that day's net carbs and estimate flag; zeroed for a day with no entries.
 */
export async function readDayCarbTotals(dayKey: string): Promise<DayCarbTotals> {
  const summary = computeDailyTotals(await listLocalFoodLogs(), dayKey).summary;
  return { netCarbs: summary?.netCarbs ?? 0, hasEstimates: summary?.hasEstimates ?? false };
}
