/**
 * Today's logs as the totals `computeRemainingDay` reads.
 *
 * Through `computeDailyEntry` and `localFoodLogToSnapshot`, never a second
 * hand-rolled rollup: the authoritative net-carbs figure has been dropped by
 * exactly such a copy before (see `localFoodLogToSnapshot`'s own doc).
 *
 * ── Why it is not in the route that uses it (M233/05) ────────────────────
 *
 * It shipped inside `app/routes/pantry.recipes.tsx` and `/pantry/recipes` died
 * on arrival in the PRODUCTION build with
 * `ReferenceError: dayTotalsFromLogs is not defined`, while dev, typecheck and
 * every unit test stayed green. React Router splits a route module into
 * separate chunks per export, so `clientLoader` is built on its own
 * (`build/client/assets/pantry.recipes-client-loader-*.js`), and the call this
 * function made from inside that loader was left in the chunk as a free
 * identifier because the function itself stayed behind with the component.
 *
 * So the rule: anything a `clientLoader` calls lives in a module of its own,
 * not beside the component in the route file. `tests/e2e/pantry-to-recipe.spec.ts`
 * is what caught it and is what keeps it caught, because only a built bundle
 * has the defect.
 */
import type { LocalFoodLog } from '#app/lib/local-store';
import { localFoodLogToSnapshot } from '#app/lib/local-store';
import type { RemainingDayTotals } from '#app/lib/remaining-day';
import { computeDailyEntry } from '#app/models/daily-totals';

/**
 * @param logs - one day's entries, any order.
 * @returns the day's totals, with `kcal` and `fatG` null when nothing computable was logged.
 */
export function dayTotalsFromLogs(logs: readonly LocalFoodLog[]): RemainingDayTotals {
  const totals = computeDailyEntry(logs.map(localFoodLogToSnapshot));
  const summary = totals.summary;
  return {
    netCarbs: summary?.netCarbs ?? 0,
    protein: summary?.protein ?? 0,
    fiber: summary?.fiber ?? 0,
    kcal: totals.kcal.total,
    fatG: summary?.fat ?? null,
  };
}
