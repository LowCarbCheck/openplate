/**
 * The "food added" toast (M129/03) — one family, one copy rule, one sonner id.
 *
 * Two things it does that a bare `toast('Added X')` didn't:
 *
 * 1. **It reports the running total.** "Added Greek yogurt · To breakfast —
 *    12g net carbs so far today." answers the question the add was FOR, on the
 *    surface where the user is already looking, instead of making them read the
 *    diary hero to find out what it cost them.
 * 2. **It batches.** Confirming a four-item plate, or tapping three quick-add
 *    chips in a row, used to stack four toasts. Every add now writes through
 *    the SAME sonner id, and consecutive adds inside `ADD_BATCH_WINDOW_MS`
 *    collapse into one updating toast ("Added 4 foods · …23g net carbs so far
 *    today.") — sonner replaces the content of an existing toast in place when
 *    the id matches.
 *
 * The copy and the batch arithmetic are pure and exported separately from the
 * `showFoodAddedToast` side effect, so the exact strings and the collapse rule
 * are pinned by tests rather than by watching a toast go by.
 */
import { toast as showToast } from 'sonner';
import { formatMeasureIn } from '#app/lib/format-macro-number';

/** The i18next `t` shape this module needs, taken as an argument so the copy stays testable without a provider. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** Which verb the toast leads with. A key discriminator, not a rendered word — the wording lives in the catalog. */
export type FoodAddedVerb = 'added' | 'copied';

/**
 * English fallback used when a call site has not yet been handed a `t`
 * (M129/05 translated the diary's call sites; `/add` and `/scan` follow in
 * their own specs). It is the ONE place the untranslated wording survives, and
 * it renders through the same keys and the same code path as the real
 * translator — so a call site that later starts passing `t` cannot change
 * shape, only language.
 */
const FALLBACK_EN = new Map<string, string>([
  ['diary.toast.addedOne', 'Added {{name}}'],
  ['diary.toast.addedMany', 'Added {{n}} foods'],
  ['diary.toast.copiedOne', 'Copied {{name}}'],
  ['diary.toast.copiedMany', 'Copied {{n}} foods'],
  ['diary.toast.toMeal', 'To {{meal}}'],
  ['diary.toast.soFarToday', '{{carbs}} net carbs so far today.'],
  ['diary.toast.onDay', '{{carbs}} net carbs on {{day}}.'],
  ['diary.toast.description', '{{where}} — {{when}}'],
]);

/** Minimal `{{param}}` interpolation — enough for `FALLBACK_EN`, never used once a real `t` is passed. */
function fallbackTranslate(key: string, params: Readonly<Record<string, string | number | boolean | Date>> = {}): string {
  const template = FALLBACK_EN.get(key);
  if (template === undefined) throw new Error(`No English fallback for toast key: ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params[name] ?? ''));
}

/**
 * The shared sonner id. Every add path (portion step, manual entry, quick-add
 * chip, scan confirm, copy-from-yesterday) writes through this one id — that is
 * the entire batching mechanism, and it must not be parameterised per food.
 */
export const FOOD_ADDED_TOAST_ID = 'food-added';

/** How close two adds must be to read as one action. A four-item plate confirms well inside this. */
export const ADD_BATCH_WINDOW_MS = 4000;

/** The running collapse state: how many adds are in the current burst, and the most recent name. */
export interface FoodAddedBatch {
  count: number;
  lastName: string;
  /** When the burst began — a later add outside the window starts a fresh one. */
  startedAtMs: number;
}

/**
 * Folds one add into the current burst, or starts a new burst when the window
 * has lapsed (or when there was no previous burst at all).
 *
 * @param previous - the burst in progress, or null.
 * @param name - the food just added.
 * @param count - how many entries this single action added (a scan confirms several at once).
 * @param nowMs - the current instant.
 * @param windowMs - the collapse window.
 * @returns the burst state to render.
 */
export function nextFoodAddedBatch({
  previous,
  name,
  count = 1,
  nowMs,
  windowMs = ADD_BATCH_WINDOW_MS,
}: {
  previous: FoodAddedBatch | null;
  name: string;
  count?: number;
  nowMs: number;
  windowMs?: number;
}): FoodAddedBatch {
  if (previous === null || nowMs - previous.startedAtMs > windowMs) {
    return { count, lastName: name, startedAtMs: nowMs };
  }
  return { count: previous.count + count, lastName: name, startedAtMs: previous.startedAtMs };
}

/** The rendered toast: sonner's title line plus its description line. */
export interface FoodAddedToastCopy {
  title: string;
  description: string;
}

/**
 * The toast's copy for a burst.
 *
 * Register notes, since this is the app's most-seen sentence: it states what
 * happened and what it cost, and stops. No praise ("Nice!"), no exclamation,
 * no scolding when the number is large — the figure speaks for itself, and the
 * hero already carries the verdict.
 *
 * @param batch - the burst being reported.
 * @param verb - `added` for a new entry, `copied` for a copy-from-yesterday.
 * @param mealLabel - the meal the food landed in, or null when it has none.
 * @param netCarbsTotal - the day's net carbs AFTER the add.
 * @param hasEstimates - whether that total includes AI estimates (hedges with "~").
 * @param dayLabel - a human day label when the entry went to a day other than today, else null.
 * @param t - the caller's translator; falls back to English for call sites not yet wired (see `FALLBACK_EN`).
 * @returns the title and description to show.
 */
export function formatFoodAddedToast({
  batch,
  verb = 'added',
  mealLabel,
  netCarbsTotal,
  hasEstimates,
  dayLabel,
  t = fallbackTranslate,
  language,
}: {
  batch: FoodAddedBatch;
  verb?: FoodAddedVerb;
  mealLabel: string | null;
  netCarbsTotal: number;
  hasEstimates: boolean;
  dayLabel: string | null;
  t?: Translate;
  /** Active UI language for the carb figure. Optional alongside `t`, and for the same reason — see `FALLBACK_EN`. */
  language?: string | null;
}): FoodAddedToastCopy {
  const title =
    batch.count === 1 ?
      t(verb === 'copied' ? 'diary.toast.copiedOne' : 'diary.toast.addedOne', { name: batch.lastName })
    : t(verb === 'copied' ? 'diary.toast.copiedMany' : 'diary.toast.addedMany', { n: batch.count });
  // `formatMeasureIn`, not a `${...}g` template: the toast used to be the only
  // place on the diary that wrote "35g" while the ring beside it wrote "35 g".
  const carbs = `${hasEstimates ? '~' : ''}${formatMeasureIn(language, netCarbsTotal, 'g')}`;
  const where = mealLabel === null ? '' : t('diary.toast.toMeal', { meal: mealLabel });
  const when =
    dayLabel === null ? t('diary.toast.soFarToday', { carbs }) : t('diary.toast.onDay', { carbs, day: dayLabel });
  return { title, description: where === '' ? when : t('diary.toast.description', { where, when }) };
}

/** Module-scoped burst state. Lives for the SPA session, which is the only window in which "consecutive" means anything. */
let currentBatch: FoodAddedBatch | null = null;

/** An optional trailing action (the quick-add chip's "Undo"). */
export interface FoodAddedToastAction {
  label: string;
  onClick: () => void;
}

/**
 * Shows (or updates) the single food-added toast.
 *
 * Safe to call from a `clientAction` immediately before returning a
 * `redirect()` — sonner's queue is a global singleton, the same property
 * `#app/lib/client-toast` relies on.
 *
 * @param input - the add being reported plus the day's post-add totals.
 */
export function showFoodAddedToast({
  name,
  count = 1,
  verb,
  mealLabel,
  netCarbsTotal,
  hasEstimates,
  dayLabel,
  action,
  t,
  language,
  nowMs = Date.now(),
}: {
  name: string;
  count?: number;
  verb?: FoodAddedVerb;
  mealLabel: string | null;
  netCarbsTotal: number;
  hasEstimates: boolean;
  dayLabel: string | null;
  action?: FoodAddedToastAction;
  /** The caller's translator. Optional only until every add path is wired — see `FALLBACK_EN`. */
  t?: Translate;
  /** The caller's active UI language, for the carb figure's decimal separator. Optional for the same reason as `t`. */
  language?: string | null;
  nowMs?: number;
}): void {
  currentBatch = nextFoodAddedBatch({ previous: currentBatch, name, count, nowMs });
  const copy = formatFoodAddedToast({
    batch: currentBatch,
    verb,
    mealLabel,
    netCarbsTotal,
    hasEstimates,
    dayLabel,
    t,
    language,
  });
  showToast.success(copy.title, {
    id: FOOD_ADDED_TOAST_ID,
    description: copy.description,
    // An Undo bound to ONE entry would be a lie on a collapsed burst, so it's
    // offered only while the burst is still a single food.
    action: action && currentBatch.count === 1 ? action : undefined,
  });
}

/** Test seam: drops the burst state so one test's adds can't collapse into the next one's. */
export function resetFoodAddedBatch(): void {
  currentBatch = null;
}
