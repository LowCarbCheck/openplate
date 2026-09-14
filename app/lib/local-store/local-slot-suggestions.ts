/**
 * "Your usual breakfast" (M227/01): what this person normally eats AT THIS
 * TIME OF DAY, ranked, so a routine eater logs in one tap instead of searching.
 *
 * Pure, like `local-quick-add.ts` beside it: no store, no browser, no clock of
 * its own. Every impure input (the logs, the saved meals, the slot, "now") is
 * passed in by the caller, so the whole ranking is directly unit-testable.
 *
 * ── THE SLOT IS NOT CHOSEN HERE ──────────────────────────────────────────
 *
 * The caller hands in the slot its own screen already resolved: `/add` from
 * `mealTypeForTime`, `/scan` from `mealTypeForCapture`. There is exactly one
 * rule mapping a wall clock onto a meal slot (`#app/lib/meal-time`), and this
 * module deliberately does not become a second one.
 *
 * ── ONE TAP IS ONE BATCH ─────────────────────────────────────────────────
 *
 * A suggestion carries ITEMS, never a single row, because a saved meal is
 * several. The caller writes them all under one `logBatchId`
 * (`buildLogsFromSavedMealItems`), so undo removes the whole tap as one unit,
 * the precedent copy-yesterday set and `/meals` already follows.
 *
 * ── WHY DISTINCT DAYS, NOT LOG COUNT ─────────────────────────────────────
 *
 * A food eaten three times on one day (three coffees before noon) is one
 * habit, not three. A food eaten once on each of three days is the habit this
 * section exists to offer. Ranking by raw log count gets that backwards and
 * puts a single heavy day at the top forever, so the rank is the number of
 * DISTINCT `dayKey`s the food appears on in this slot.
 *
 * ── WHY A LOOKBACK WINDOW ────────────────────────────────────────────────
 *
 * "Your usual" is a claim about the present. Without a window, a breakfast
 * somebody ate every day two years ago outranks the one they actually eat now
 * and never stops, because the old count only ever grows. `LOOKBACK_MS` is a
 * ROLLING window measured from the instant passed in, deliberately not a count
 * of calendar days: no local-day boundary arithmetic is needed to answer "is
 * this log recent enough to still describe the habit", and inventing one here
 * would duplicate `#app/lib/user-days` for no gain.
 */
import type { MealType } from '#types/enums';
import type { LocalFoodLog, LocalSavedMeal, LocalSavedMealItem } from './schema';
import { savedMealItemFromLog } from './saved-meals';

/** How many suggestions the section offers at most, matching the density of the quick-add chips. */
export const SLOT_SUGGESTION_LIMIT = 3;

/** Days in the rolling lookback window (see the header for why it is rolling, not calendar). */
const LOOKBACK_DAYS = 60;

/** Milliseconds in a day, for the rolling window only, never for a calendar-day boundary. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The rolling window a log must fall inside to still count towards "usual". */
const LOOKBACK_MS = LOOKBACK_DAYS * MS_PER_DAY;

/** Whether a suggestion re-logs a saved bundle or a single food. */
export type SlotSuggestionKind = 'saved-meal' | 'food';

/** One offer in the "Your usual <slot>" section, ready to render and ready to log. */
export interface SlotSuggestion {
  kind: SlotSuggestionKind;
  /**
   * Stable identity across a re-computation, so the tap handler can find this
   * exact suggestion again from the store without the macros travelling
   * through the DOM. A saved meal carries its own local id; a food carries its
   * lowercased name under a `food:` prefix, which is the same dedupe key
   * `local-quick-add.ts` groups by.
   */
  id: string;
  /** What to print: the saved meal's chosen name, or the food's most recent casing. */
  name: string;
  /** How many DISTINCT days inside the window this suggestion was eaten in this slot. */
  dayCount: number;
  /** Epoch-ms of the most recent qualifying log, the tie-break between equal day counts. */
  lastLoggedAt: number;
  /** The entries one tap writes, in order. One for a food, one per item for a saved meal. */
  items: LocalSavedMealItem[];
}

/**
 * What a ROUTE hands to the section: enough to print the offer and post the
 * tap, and nothing else.
 *
 * The items are deliberately left behind. A `SlotSuggestion` carries the full
 * macro, micronutrient and licence snapshot of every row it would write, which
 * the section never renders and the tap never needs: the handler re-finds the
 * suggestion from the store by `id`. Sending the snapshot into the page would
 * put a person's diary content into a loader payload for decoration.
 */
export interface UsualAtSlotOffer {
  id: string;
  kind: SlotSuggestionKind;
  name: string;
  /** How many entries one tap writes, so a bundle can say it is a bundle. */
  itemCount: number;
}

/** Narrows a ranked suggestion to the part a screen renders and posts back. */
export function toUsualAtSlotOffer(suggestion: SlotSuggestion): UsualAtSlotOffer {
  return {
    id: suggestion.id,
    kind: suggestion.kind,
    name: suggestion.name,
    itemCount: suggestion.items.length,
  };
}

/** Case-insensitive, whitespace-trimmed grouping key for a food name, as `local-quick-add.ts` uses. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The suggestion id a single food is offered under. */
function foodSuggestionId(name: string): string {
  return `food:${nameKey(name)}`;
}

/** A food's accumulating evidence: the days it was eaten in this slot, and its most recent log. */
interface FoodHabit {
  days: Set<string>;
  latest: LocalFoodLog;
}

/**
 * Keeps only the logs that describe the habit being asked about: this slot,
 * inside the rolling window, with a usable name.
 */
function qualifyingLogs({
  logs,
  slot,
  nowMs,
}: {
  logs: readonly LocalFoodLog[];
  slot: MealType;
  nowMs: number;
}): LocalFoodLog[] {
  const oldestMs = nowMs - LOOKBACK_MS;
  return logs.filter((log) => log.mealType === slot && log.loggedAt >= oldestMs && nameKey(log.name) !== '');
}

/** Groups the qualifying logs by food name, counting the distinct days each one appears on. */
function collectFoodHabits(logs: readonly LocalFoodLog[]): Map<string, FoodHabit> {
  const habits = new Map<string, FoodHabit>();
  for (const log of logs) {
    const key = nameKey(log.name);
    const existing = habits.get(key);
    if (!existing) {
      habits.set(key, { days: new Set([log.dayKey]), latest: log });
      continue;
    }
    existing.days.add(log.dayKey);
    if (log.loggedAt > existing.latest.loggedAt) existing.latest = log;
  }
  return habits;
}

/**
 * Most-days-first, then most-recent-first. Both directions are descending, so
 * a food eaten on two days beats one eaten three times on a single day, which
 * is the control case the unit test pins.
 */
function byHabitStrength(a: SlotSuggestion, b: SlotSuggestion): number {
  return b.dayCount - a.dayCount || b.lastLoggedAt - a.lastLoggedAt;
}

/**
 * Scores one saved meal against the habits: the days on which ANY of its items
 * was eaten in this slot.
 *
 * ANY rather than ALL, deliberately. A saved meal is a template somebody named
 * once; requiring every item to reappear together would drop "Sunday
 * breakfast" the first morning they skipped the coffee, which is exactly the
 * morning the one-tap offer is worth most. A meal that scores zero is not
 * offered at all, which is what keeps a dinner bundle out of breakfast.
 */
function scoreSavedMeal(meal: LocalSavedMeal, habits: Map<string, FoodHabit>): SlotSuggestion | null {
  const days = new Set<string>();
  let lastLoggedAt = 0;
  for (const item of meal.items) {
    const habit = habits.get(nameKey(item.name));
    if (!habit) continue;
    for (const day of habit.days) days.add(day);
    if (habit.latest.loggedAt > lastLoggedAt) lastLoggedAt = habit.latest.loggedAt;
  }
  if (days.size === 0) return null;
  return { kind: 'saved-meal', id: meal.id, name: meal.name, dayCount: days.size, lastLoggedAt, items: meal.items };
}

/**
 * The ranked offers for one meal slot: saved meals first, then single foods,
 * each group most-usual-first, capped at `limit`.
 *
 * Saved meals lead because a bundle is one tap for a whole meal while a food
 * is one tap for one row, so the same tap is worth more there. Both groups are
 * built from the SAME slot-filtered, window-filtered evidence, so nothing is
 * offered at a slot it was never eaten at.
 *
 * @param options.logs - every local food log, any order.
 * @param options.savedMeals - every saved meal on this device, any order.
 * @param options.slot - the meal slot the calling screen already resolved for now.
 * @param options.nowMs - the current instant, the end of the rolling lookback window.
 * @param options.limit - how many suggestions to return at most.
 * @returns the ranked suggestions, possibly empty (the section then renders nothing).
 */
export function computeSlotSuggestions({
  logs,
  savedMeals,
  slot,
  nowMs,
  limit,
}: {
  logs: readonly LocalFoodLog[];
  savedMeals: readonly LocalSavedMeal[];
  slot: MealType;
  nowMs: number;
  limit: number;
}): SlotSuggestion[] {
  const habits = collectFoodHabits(qualifyingLogs({ logs, slot, nowMs }));

  const mealSuggestions: SlotSuggestion[] = [];
  for (const meal of savedMeals) {
    const scored = scoreSavedMeal(meal, habits);
    if (scored) mealSuggestions.push(scored);
  }

  const foodSuggestions: SlotSuggestion[] = Array.from(habits.values()).map(({ days, latest }) => ({
    kind: 'food',
    id: foodSuggestionId(latest.name),
    name: latest.name,
    dayCount: days.size,
    lastLoggedAt: latest.loggedAt,
    // The whole snapshot of the most recent log, so the re-log carries the
    // credit, the portion, the authoritative net carbs and the micronutrients
    // the original entry carried, exactly as a saved-meal item does.
    items: [savedMealItemFromLog(latest)],
  }));

  return [...mealSuggestions.toSorted(byHabitStrength), ...foodSuggestions.toSorted(byHabitStrength)].slice(0, limit);
}

/**
 * Finds one suggestion by the id a rendered tap posted back.
 *
 * Uncapped on purpose: the person tapped what the screen offered, and a log
 * written between the render and the tap must not be able to push their choice
 * past the cap and turn the tap into a silent no-op.
 *
 * @param options.logs - every local food log, any order.
 * @param options.savedMeals - every saved meal on this device, any order.
 * @param options.slot - the meal slot the calling screen resolved for now.
 * @param options.nowMs - the current instant, the end of the rolling lookback window.
 * @param options.id - the `SlotSuggestion.id` that was tapped.
 * @returns the suggestion, or null when it no longer qualifies.
 */
export function findSlotSuggestion({
  logs,
  savedMeals,
  slot,
  nowMs,
  id,
}: {
  logs: readonly LocalFoodLog[];
  savedMeals: readonly LocalSavedMeal[];
  slot: MealType;
  nowMs: number;
  id: string;
}): SlotSuggestion | null {
  const all = computeSlotSuggestions({ logs, savedMeals, slot, nowMs, limit: Number.POSITIVE_INFINITY });
  return all.find((suggestion) => suggestion.id === id) ?? null;
}
