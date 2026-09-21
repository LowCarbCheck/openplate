/**
 * The impure half of "Your usual <slot>" (M227/01): the one store read that
 * fills the section, and the one write a tap performs.
 *
 * The ranking itself is pure and lives in
 * `#app/lib/local-store/local-slot-suggestions`. This module is the shell
 * around it, and it exists so `/add` and `/scan` share ONE write path. Two
 * copies of "find the offer, mint a batch id, write every item, report the
 * log" is how the two screens drift into logging the same tap differently,
 * which is the defect `#app/lib/local-store/saved-meals` already documents one
 * level down.
 *
 * WHY THE TAP POSTS AN ID, A SLOT AND A SCALE, AND NOTHING ELSE. The screen
 * already resolved the slot it was offering for (`mealTypeForTime` on `/add`,
 * `mealTypeForCapture` on `/scan`), so it says which one, and the entries are
 * stamped with exactly that. The confirm dialog's portion stepper
 * (`usual-at-slot.tsx`) is the one thing genuinely chosen at the tap, so it
 * travels too, as a plain percent. Everything else is re-read from the store
 * here: the macros, the licence credit, the portion and the micronutrients of
 * the rows being written never travel through a form field, they are scaled
 * from the store's own recorded numbers by `scaleSavedMealItem`, never from a
 * figure the client computed and sent over.
 *
 * WHY IT REDIRECTS TO THE DIARY. This is the same action `/meals`'s "log now"
 * performs (`handleLogMeal`), it lands in the same place, and it says so the
 * same way.
 */
import { z } from 'zod';
import { parseWithZod } from '@conform-to/zod/v4';
import i18n from '#app/i18n/i18n';
import type { MealType } from '#types/enums';
import { MEAL_TYPES } from '#app/lib/meal-choice';
import { randomUuid } from '#app/lib/uuid';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { trackUsualAtSlotLogged } from '#app/lib/matomo-events';
import { noteActivity } from '#app/lib/gamification/record';
import {
  buildLogsFromSavedMealItems,
  computeSlotSuggestions,
  findSlotSuggestion,
  getLocalProfileGoals,
  listLocalFoodLogs,
  listLocalSavedMeals,
  putLocalFoodLog,
  resolveLocalTimezone,
  toUsualAtSlotOffer,
  SLOT_SUGGESTION_LIMIT,
} from '#app/lib/local-store';
import type { LocalFoodLog, LocalSavedMealItem, UsualAtSlotOffer } from '#app/lib/local-store';

/** The form intent both routes route to `handleLogUsual`. */
export const LOG_USUAL_INTENT = 'log-usual';

/**
 * The tap's payload. The slot is REQUIRED and is a real `MealType`, unlike
 * `mealTypeFormField`'s optional one: a suggestion that was offered under a
 * slot is logged into that slot, and "no meal" is not one of the answers this
 * section can produce.
 */
const LogUsualSchema = z.object({
  suggestionId: z.string().min(1),
  slot: z.enum(MEAL_TYPES),
  /**
   * The portion scale the confirm dialog applied, as a percent of the
   * suggestion's recorded amount (150 = one and a half times). OPTIONAL: a
   * caller that posts no `scalePercent` at all (any code predating the
   * confirm dialog) gets today's exact, unscaled behavior, defaulted to 100
   * in `handleLogUsual` below, so nothing that already calls this action
   * breaks.
   */
  scalePercent: z.coerce.number().int().positive().optional(),
});

/**
 * Reads the section's offers for one slot.
 *
 * Takes the logs rather than reading them, because `/add`'s `clientLoader`
 * already holds every log for its recent-foods ranking and a second full read
 * of the store per keystroke is a cost with no answer attached.
 *
 * @param options.logs - every local food log, any order.
 * @param options.slot - the meal slot the calling screen resolved for now.
 * @param options.nowMs - the current instant, the end of the ranking's lookback window.
 * @returns the offers to render, at most `SLOT_SUGGESTION_LIMIT`, possibly empty.
 */
export async function readUsualAtSlot({
  logs,
  slot,
  nowMs,
}: {
  logs: readonly LocalFoodLog[];
  slot: MealType;
  nowMs: number;
}): Promise<UsualAtSlotOffer[]> {
  const savedMeals = await listLocalSavedMeals();
  const suggestions = computeSlotSuggestions({ logs, savedMeals, slot, nowMs, limit: SLOT_SUGGESTION_LIMIT });
  return suggestions.map(toUsualAtSlotOffer);
}

/**
 * Scales one saved-meal item's per-serving amount by a percent of what was
 * recorded (150 = one and a half times), the pure half of the confirm
 * dialog's portion stepper (`usual-at-slot.tsx`). Only `quantityGrams` and
 * `macros` move: `netCarbsPer100g` and `micronutrientsPer100g` are
 * DENSITIES, stated per 100 g, so they stay exactly as true at 50 g as at
 * 500 g, the same reason `reconstructPer100g`'s doc gives for never
 * rescaling them. `portion` (the "2 eggs" display label) is dropped once the
 * scale moves off 100%, the same rule `resolveEditedPortion`
 * (`diary.entry.$id.tsx`) applies to a manual grams edit: a household-count
 * label is wrong the moment the weight behind it no longer matches that
 * count.
 *
 * @param item - the saved-meal item at its recorded (100%) amount.
 * @param scalePercent - the portion scale to apply, e.g. 150 for one and a half times; 100 is a no-op.
 * @returns a fresh item at the scaled amount.
 */
export function scaleSavedMealItem(item: LocalSavedMealItem, scalePercent: number): LocalSavedMealItem {
  const factor = scalePercent / 100;
  const scaleAmount = (value: number | null): number | null => (value === null ? null : value * factor);
  return {
    ...item,
    quantityGrams: item.quantityGrams * factor,
    macros: {
      carbs: scaleAmount(item.macros.carbs),
      fiber: scaleAmount(item.macros.fiber),
      sugars: scaleAmount(item.macros.sugars),
      polyols: scaleAmount(item.macros.polyols),
      protein: scaleAmount(item.macros.protein),
      fat: scaleAmount(item.macros.fat),
      kcal: scaleAmount(item.macros.kcal),
    },
    portion: scalePercent === 100 ? (item.portion ?? null) : null,
  };
}

/**
 * Logs one tapped offer into TODAY's slot, every item under ONE `logBatchId`
 * so undo removes the whole tap as a unit.
 *
 * Throws rather than returning a failure when the offer no longer qualifies:
 * the only way to get here is by tapping something the screen printed, so an
 * offer that has vanished means the screen and the store disagree, and the
 * person is better served by a visible error than by a button that silently
 * did nothing.
 *
 * @param formData - the submitted tap, carrying the suggestion id, the slot and the confirm dialog's portion scale.
 * @returns the redirect to the diary, with the confirmation already published.
 */
export async function handleLogUsual(formData: FormData): Promise<Response> {
  const submission = parseWithZod(formData, { schema: LogUsualSchema });
  if (submission.status !== 'success') throw new Response('Invalid usual payload', { status: 400 });
  const { suggestionId, slot, scalePercent } = submission.value;

  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const nowMs = Date.now();
  const dayKey = todayInTimezone(timezone, new Date(nowMs));

  const [logs, savedMeals] = await Promise.all([listLocalFoodLogs(), listLocalSavedMeals()]);
  const suggestion = findSlotSuggestion({ logs, savedMeals, slot, nowMs, id: suggestionId });
  if (!suggestion) throw new Response('Suggestion no longer available', { status: 404 });

  const logBatchId = randomUuid();
  // Scaled BEFORE the write, every item by the same percent chosen in the
  // confirm dialog's stepper: `buildLogsFromSavedMealItems` stays the one
  // untouched "items in, entries out" contract every other caller of it
  // still relies on, see `saved-meals.ts`.
  const scaledItems = suggestion.items.map((item) => scaleSavedMealItem(item, scalePercent ?? 100));
  const entries = buildLogsFromSavedMealItems({
    items: scaledItems,
    makeId: randomUuid,
    dayKey,
    loggedAtMs: nowMs,
    mealType: slot,
    logBatchId,
    createdAtMs: nowMs,
  });
  for (const entry of entries) await putLocalFoodLog(entry);
  // Once per TAP, outside the loop: a bundle of four is one log action, exactly
  // as its single confirmation is (the `handleLogMeal`/`handleConfirm` rule).
  trackUsualAtSlotLogged(suggestion.kind);
  // The same signal `/meals` writes: a tap on "your usual" repeats a meal,
  // whether the offer came from a saved meal or from a habit (M235/04).
  await noteActivity({ signal: 'meal.repeat', now: nowMs });

  return redirectWithLocalToast('/diary', {
    type: 'success',
    description: i18n.t('usual.toast.logged', { name: suggestion.name, count: entries.length }),
  });
}
