/**
 * The one daily budget of LowCarbCheck calls this server keeps, sized by
 * `CONFIG.foodDbDailyCallLimit` (`FOOD_DB_DAILY_CALL_LIMIT`).
 *
 * Its own `.server` module for the reason `food-matches-rate-limit.server.ts`
 * gives: two route files reserve against it, the unit tests reset it, and a
 * route file may export nothing but its route contract past a `.server`
 * import. The counting itself is pure and lives in `food-db-daily-budget.ts`.
 */
import { CONFIG } from '#app/config';
import { createComponentLogger } from '#app/lib/logger';
import { createDailyCallBudget, DailyCallLimitExceededError } from '#app/lib/food-db-daily-budget';

const logger = createComponentLogger('food-db-budget');

const budget = createDailyCallBudget({ limit: CONFIG.foodDbDailyCallLimit });

/** The UTC day the limit was last reported on, so the warning is written once a day. */
let warnedDay: string | null = null;

/** Records today as warned, and answers whether it already was. */
function hasWarnedToday(now: number): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  if (warnedDay === today) return true;
  warnedDay = today;
  return false;
}

/**
 * Reserves `calls` LowCarbCheck calls against today's budget.
 *
 * The first refusal of a day is logged once, at warn: a cap reached is a
 * decision an operator may want to revisit, and one line a day says so
 * without a line per refused keystroke.
 *
 * @throws DailyCallLimitExceededError when today's limit would be passed.
 */
export function reserveFoodDbCalls(calls: number): void {
  const now = Date.now();
  try {
    budget.reserve({ calls, now });
  } catch (error) {
    if (!(error instanceof DailyCallLimitExceededError)) throw error;
    if (!hasWarnedToday(now)) {
      logger.warn('The daily food database call limit is reached, lookups pause until midnight UTC', {
        limit: CONFIG.foodDbDailyCallLimit,
      });
    }
    throw error;
  }
}

/** Forgets today's count. TEST SEAM, and nothing in the app calls it. */
export function resetFoodDbDailyBudget(): void {
  budget.reset();
  warnedDay = null;
}
