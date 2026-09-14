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
 * WHY THE TAP POSTS AN ID AND A SLOT, AND NOTHING ELSE. The screen already
 * resolved the slot it was offering for (`mealTypeForTime` on `/add`,
 * `mealTypeForCapture` on `/scan`), so it says which one, and the entries are
 * stamped with exactly that. Everything else is re-read from the store here:
 * the macros, the licence credit, the portion and the micronutrients of the
 * rows being written never travel through a form field.
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
import type { LocalFoodLog, UsualAtSlotOffer } from '#app/lib/local-store';

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
 * Logs one tapped offer into TODAY's slot, every item under ONE `logBatchId`
 * so undo removes the whole tap as a unit.
 *
 * Throws rather than returning a failure when the offer no longer qualifies:
 * the only way to get here is by tapping something the screen printed, so an
 * offer that has vanished means the screen and the store disagree, and the
 * person is better served by a visible error than by a button that silently
 * did nothing.
 *
 * @param formData - the submitted tap, carrying the suggestion id and the slot.
 * @returns the redirect to the diary, with the confirmation already published.
 */
export async function handleLogUsual(formData: FormData): Promise<Response> {
  const submission = parseWithZod(formData, { schema: LogUsualSchema });
  if (submission.status !== 'success') throw new Response('Invalid usual payload', { status: 400 });
  const { suggestionId, slot } = submission.value;

  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const nowMs = Date.now();
  const dayKey = todayInTimezone(timezone, new Date(nowMs));

  const [logs, savedMeals] = await Promise.all([listLocalFoodLogs(), listLocalSavedMeals()]);
  const suggestion = findSlotSuggestion({ logs, savedMeals, slot, nowMs, id: suggestionId });
  if (!suggestion) throw new Response('Suggestion no longer available', { status: 404 });

  const logBatchId = randomUuid();
  const entries = buildLogsFromSavedMealItems({
    items: suggestion.items,
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

  return redirectWithLocalToast('/diary', {
    type: 'success',
    description: i18n.t('usual.toast.logged', { name: suggestion.name, count: entries.length }),
  });
}
