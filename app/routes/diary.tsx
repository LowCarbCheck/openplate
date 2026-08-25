import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Route } from './+types/diary';
import { Trans, useTranslation } from 'react-i18next';
import i18next from '#app/i18n/i18n';
import { formatClockTime } from '#app/lib/format-clock-time';
import { DEFAULT_LANGUAGE } from '#app/i18n/language-prefs';
import { redirect, useFetcher, useNavigate, useRevalidator } from 'react-router';
import { Link } from '#app/components/link';
import { z } from 'zod';
import { parseWithZod } from '@conform-to/zod/v4';
import { countLoggedDays } from '#app/models/habit-strip';
import type { HabitStripDay } from '#app/models/habit-strip';
import { EMPTY_DAY_SUMMARY, summarizeDay } from '#app/models/food-log-summary';
import type { DaySummary } from '#app/models/food-log-summary';
import {
  dayBoundsInTimezone,
  enumerateDates,
  instantOnDate,
  parseDateParam,
  shiftDate,
  todayInTimezone,
} from '#app/lib/user-days';
import { mealTypeForTime } from '#app/lib/meal-time';
import { randomUuid } from '#app/lib/uuid';
import { readDayCarbTotals } from '#app/lib/day-carb-totals';
import { dayKeyToLocalDate, localDateToDayKey } from '#app/lib/day-key-date';
import { resolveDiaryEmptyState } from '#app/lib/diary-empty-state';
import type { DiaryEmptyState } from '#app/lib/diary-empty-state';
import { diaryHrefForDate } from '#app/lib/diary-href';
import { useDaySwipe } from '#app/hooks/use-day-swipe';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { computeDayGaps } from '#app/lib/macro-gaps';
import { useCountUp } from '#app/hooks/use-count-up';
import { useCelebration } from '#app/hooks/use-celebration';
import { showFoodAddedToast } from '#app/lib/food-added-toast';
import { remapInstantToTargetDay } from '#app/lib/copy-day';
import { formatDayLabel } from '#app/lib/format-day-label';
import { encodeDisplayPortion, formatPortionLabel, portionField } from '#app/lib/portions';
import { chipCarbStatus } from '#app/lib/frequent-chips';
import type { Macros } from '#app/lib/macros';
import { createOptionalNonNegativeNumberSchema } from '#app/lib/zod-numeric';
import { authoritativeNetCarbsField, encodeAuthoritativeNetCarbs } from '#app/lib/authoritative-net-carbs';
import { encodeMicronutrients, micronutrientsField } from '#app/lib/micronutrients';
import { toStoredAttribution } from '#app/lib/attribution';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { carbStatusDotClass } from '#app/utils/carb-status';
import { cn } from '#app/lib/utils';
import {
  buildSavedMealFromLogs,
  computeDailyTotals,
  computeDailyTotalsInRange,
  computeLocalHabitStrip,
  computeLocalRecentFoods,
  daysSinceExport,
  daysSinceFirstData,
  deleteLocalFoodLog,
  getLocalProfileGoals,
  listLocalFoodLogs,
  listLocalFoods,
  listLocalWeightEntries,
  localFoodLogToSnapshot,
  putLocalFoodLog,
  putLocalSavedMeal,
  resolveLocalTimezone,
  selectLocalFrequentChips,
} from '#app/lib/local-store';
import type { LocalDailyTotals, LocalFoodLog, LocalFrequentChip, LocalRecentFood } from '#app/lib/local-store';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { AddFoodActions } from '#app/components/add-food-actions';
import { BackupNudgeBanner } from '#app/components/backup-nudge-banner';
import { HabitStrip } from '#app/components/habit-strip';
import { RingProgress } from '#app/components/ring-progress';
import { HeroStat, formatHeroStat, formatHeroValue } from '#app/components/hero-stat';
import { PlateGlyph } from '#app/components/plate-glyph';
import { SectionEyebrow } from '#app/components/typography';
import {
  CarbImpactChip,
  DayDetailsButton,
  DayDetailsPanel,
  DayDrillDown,
  HeroProteinFigure,
  useDayDetails,
} from '#app/components/day-drill-down';
import { Button } from '#app/components/ui/button';
import { Badge } from '#app/components/ui/badge';
import { Card, CardContent } from '#app/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '#app/components/ui/popover';
import { Calendar as CalendarPicker } from '#app/components/ui/calendar';
import { BookMarked, ChevronDown, ChevronLeft, ChevronRight, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

/**
 * The narrow slice of i18next's `t` this route's pure helpers depend on.
 * Threaded in as an explicit parameter rather than reaching for the singleton
 * from inside them, so each helper stays directly callable from a test with a
 * stub translator and never carries a hidden global dependency.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** `t` for the non-React paths (`clientAction` and the handlers it calls). */
function translate(key: string, params?: Readonly<Record<string, string | number | boolean | Date>>): string {
  return i18next.t(key, params);
}

/**
 * Active UI language for the non-React paths — same singleton, same
 * client-only justification as `translate`. Dates in a toast must follow the
 * language the toast's copy is written in.
 */
function currentLanguage(): string {
  return i18next.language;
}

/**
 * ROUTE-CHUNK SPLITTER RULE (React Router 8.1.0) — applies to this file and
 * every other route module with a `clientLoader`/`clientAction`/
 * `HydrateFallback`, because those exports are compiled into separate chunks.
 *
 * In a route file, an EXPORTED FUNCTION DECLARATION must not give a parameter a
 * default value that references another binding:
 *
 *   export function f(x: string = SOME_IMPORT) {}   // ❌ breaks `pnpm build`
 *   export function f(x?: string) {                 // ✅
 *     const resolved = x ?? SOME_IMPORT;
 *   }
 *
 * The splitter walks every identifier a chunked export transitively depends on.
 * When that walk lands on an identifier inside an `AssignmentPattern` (which is
 * what a default parameter is) it assumes it is looking at a destructured
 * variable and asserts that some enclosing `VariableDeclarator` exists. A
 * function declaration's parameter list has none, so the assert fires as
 * `Error: Expected a Path, but got null` from
 * `[plugin react-router:split-route-modules]` — with no file, no line, and no
 * mention of the actual identifier. It cost a failed production deploy to find.
 *
 * Two things that are NOT the trigger, so nobody re-litigates them: exported
 * ARROW functions are fine (`export const f = (x = Y) => …` has a
 * `VariableDeclarator`), and so are default parameters in non-exported
 * functions. Only the exported-declaration form is affected — and only once the
 * dependency walk actually reaches it, which is why this file built fine until
 * i18n gave the chunked exports a shared import with the component code.
 *
 * `formatEntryTime` below is the one that bit us; it is written in the ✅ shape.
 */

/**
 * Shown while the client loader reads local-first health data (M117/03 route
 * cutover — the diary now reads and writes exclusively via the on-device
 * primary store, never the server). React Router requires a `HydrateFallback`
 * on any route whose data comes solely from a `clientLoader`.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('diary.loading')}
    </output>
  );
}

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.diary') }];

export const handle = {
  title: 'Diary',
  titleKey: 'diary.title',
};

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Meal-group render order: the four meals, then entries with no meal set. Reused for both the viewed day's entry list (item 1) and the previous day's copy-source breakdown (item 5). */
const MEAL_GROUP_ORDER: readonly LocalFoodLog['mealType'][] = [...MEAL_TYPES, null];

/** Sentinel form value for "the entries with no meal set" — mirrors `diary.entry.$id.tsx`'s `NO_MEAL_VALUE`, needed here so a per-meal copy can target the null-meal bucket distinctly from "copy everything". */
const NO_MEAL_VALUE = 'none';

/** The seven per-serving macro fields carried on the quick-log chip form, in order. */
const MACRO_KEYS = ['carbs', 'fiber', 'sugars', 'polyols', 'protein', 'fat', 'kcal'] as const;

/** Width of the diary's habit strip: today plus the previous six local days. */
const HABIT_STRIP_DAYS = 7;

/** How long a freshly-created entry keeps its "just added" highlight. */
const RECENT_LOG_THRESHOLD_MS = 60_000;

/** Most-frequent recent foods surfaced as one-tap chips. */
const MAX_FREQUENT_CHIPS = 4;
/** A food must have been logged at least this many times to earn a chip. */
const MIN_CHIP_TIMES_LOGGED = 2;
/** How many recent foods to scan when picking chips + detecting the last-log gap. */
const RECENT_CHIP_SCAN_LIMIT = 50;
/** Days since the last log that flip today's empty state to "welcome back". */
const GAP_THRESHOLD_DAYS = 3;
/** How often the diary polls for another tab's writes while the tab is visible (item 9). */
const LIVE_REVALIDATE_POLL_MS = 2_000;

////////////////////////////////////////////////////////////////////////////////
// Server loader — none needed (M117/04: accounts optional, health data is
// local-only — there is no auth invariant left to enforce or echo here)
////////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

////////////////////////////////////////////////////////////////////////////////
// Action schemas (imperative shell)
////////////////////////////////////////////////////////////////////////////////

/**
 * Recreates a just-deleted entry from the snapshot the detail page's Undo toast
 * posts back. Carries the ORIGINAL `loggedAt` so the entry lands on the day it
 * belonged to, plus the full per-serving snapshot and provenance flags — a
 * faithful restore (fresh local id), not a fresh log. Every value arrives as a
 * string (form encoding); numeric/enum/boolean fields are coerced here.
 */
export const RestoreLogSchema = z.object({
  name: z.string().min(1),
  quantityGrams: z.coerce.number().positive(),
  loggedAt: z.string().min(1),
  source: z.enum(['manual', 'plate_ai']),
  mealType: z.preprocess((value) => (value === '' ? undefined : value), z.enum(MEAL_TYPES).optional()),
  foodId: z.preprocess((value) => (value === '' || value == null ? undefined : value), z.string().optional()),
  aiEstimated: z.preprocess((value) => value === 'true', z.boolean()),
  curatedSource: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  logBatchId: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  /** The deleted entry's authoritative per-100g net carbs, so Undo is faithful rather than lossy. */
  netCarbsPer100g: authoritativeNetCarbsField,
  /** The deleted entry's per-100 g vitamins/minerals — same reason: an Undo must restore the entry, not a version of it that has silently gone uncovered. */
  micronutrientsPer100g: micronutrientsField,
  /** The deleted entry's licence credit — same reason: an Undo must restore the entry, not a stripped copy of it. */
  attribution: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  /**
   * The deleted entry's chosen display portion ("2 eggs") — the third field of
   * the same class, and the one this payload was still dropping: without it an
   * Undo brought the entry back as bare grams, so the person's own "2 eggs"
   * silently became "180 g" the moment they used a button labelled Undo.
   */
  portion: portionField,
  carbs: createOptionalNonNegativeNumberSchema(),
  fiber: createOptionalNonNegativeNumberSchema(),
  sugars: createOptionalNonNegativeNumberSchema(),
  polyols: createOptionalNonNegativeNumberSchema(),
  protein: createOptionalNonNegativeNumberSchema(),
  fat: createOptionalNonNegativeNumberSchema(),
  kcal: createOptionalNonNegativeNumberSchema(),
});

/**
 * One-tap re-log of a frequent/favorite chip: last-used grams + the recorded
 * per-serving snapshot, stamped onto `date` — the day the chip was tapped
 * FROM, not always "today" (item 6: favorites are surfaced on any day, so a
 * favorite tapped while browsing a past day must log to that day).
 *
 * Re-logging a favourite is the single most common action a returning user
 * takes, which makes this schema the most load-bearing entry-creating boundary
 * in the app — and it used to carry only the macro parts. The three fields
 * below are the ones a chip re-log silently dropped: the tapped favourite came
 * back as a curated-provenance entry with a double-subtracted 0 g, no licence
 * credit, and "180 g" where the person had chosen "2 eggs". Exported so the
 * whole chip → schema → entry chain is unit-testable without a store or a DOM.
 */
export const LogRecentSchema = z.object({
  name: z.string().min(1),
  quantityGrams: z.coerce.number().positive(),
  date: z.string().min(1),
  foodId: z.preprocess((value) => (value === '' || value == null ? undefined : value), z.string().optional()),
  curatedSource: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  aiEstimated: z.preprocess((value) => value === 'true', z.boolean()),
  /**
   * The chip's authoritative per-100g net carbs. The chip carries the ORIGINAL
   * LOG's own stored figure, which is already gated at the point it was written
   * (only an upstream source ever sets it) — so unlike the add flow's portion
   * step there is no source-tier gate to repeat here: a chip built from a
   * manual or AI-estimated log simply has no figure and submits none.
   */
  netCarbsPer100g: authoritativeNetCarbsField,
  /**
   * The chip's per-100 g vitamins/minerals, carried from the original log for
   * the same reason as the figure above: a re-log is a new use of the same
   * upstream data. Dropping them would make the day's micronutrient coverage
   * depend on which screen the food was logged from.
   */
  micronutrientsPer100g: micronutrientsField,
  /** The chip's licence credit. A re-log is a new use of the same credited data, so it owes the same credit — the obligation follows the data, not the entry point. */
  attribution: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  /** The chip's display portion ("2 eggs"). Valid at the chip's `quantityGrams`, which a re-log reuses unchanged. */
  portion: portionField,
  carbs: createOptionalNonNegativeNumberSchema(),
  fiber: createOptionalNonNegativeNumberSchema(),
  sugars: createOptionalNonNegativeNumberSchema(),
  polyols: createOptionalNonNegativeNumberSchema(),
  protein: createOptionalNonNegativeNumberSchema(),
  fat: createOptionalNonNegativeNumberSchema(),
  kcal: createOptionalNonNegativeNumberSchema(),
});

/** Undo of a chip re-log: delete the just-created entry. */
const DeleteLogSchema = z.object({ logId: z.string().min(1) });

/**
 * "Copy yesterday's meals" onto the viewed date — the whole day when
 * `mealType` is absent, or just one meal group when present. `NO_MEAL_VALUE`
 * targets the "no meal set" bucket distinctly from "copy everything" (item 5).
 */
const CopyYesterdaySchema = z.object({
  date: z.string().min(1),
  mealType: z.preprocess(
    (value) => {
      if (value === '' || value == null) return undefined;
      if (value === NO_MEAL_VALUE) return null;
      return value;
    },
    z.union([z.enum(MEAL_TYPES), z.null()]).optional(),
  ),
  /**
   * Item 3 (M123/07): explicit per-entry selection from the "choose entries"
   * picker. When present and non-empty this is AUTHORITATIVE and `mealType`
   * above is ignored — the person picked exact entries, which may span more
   * than one meal, so a meal filter on top would silently drop some of their
   * choices. Optional so the pre-existing whole-day/per-meal chips (which
   * never send this field) keep working exactly as before.
   */
  entryIds: z.array(z.string().min(1)).optional(),
});

/** Undo of a copy-yesterday batch: delete the whole batch. */
const DeleteBatchSchema = z.object({ batchId: z.string().min(1) });

/**
 * "Save as meal" (item 1, M123/07): bundles a set of currently-logged
 * entries — typically a whole meal group — into a named, reusable
 * `LocalSavedMeal`. `logIds` names the exact entries to snapshot, so the
 * action never has to re-derive "which entries are in this meal" and can
 * never disagree with what the person actually saw on screen.
 */
const SaveMealSchema = z.object({
  name: z.string().min(1),
  logIds: z.array(z.string().min(1)).min(1),
});

/** Builds a per-serving `Macros` from the optional numeric fields (blank → null, never 0). */
function macrosFromOptionalFields(value: {
  carbs?: number;
  fiber?: number;
  sugars?: number;
  polyols?: number;
  protein?: number;
  fat?: number;
  kcal?: number;
}): Macros {
  return {
    carbs: value.carbs ?? null,
    fiber: value.fiber ?? null,
    sugars: value.sugars ?? null,
    polyols: value.polyols ?? null,
    protein: value.protein ?? null,
    fat: value.fat ?? null,
    kcal: value.kcal ?? null,
  };
}

////////////////////////////////////////////////////////////////////////////////
// Action handlers (all local-store writes — no server round-trip)
////////////////////////////////////////////////////////////////////////////////

/**
 * Rebuilds a just-deleted entry from the snapshot its Undo toast posted back —
 * the pure core of `handleRestore`, split out so "faithful restore" is a
 * testable claim rather than an aspiration (same precedent as
 * `#app/routes/add`'s `buildLoggedEntry`). Undo is the one place where a
 * dropped field is invisible at the time and permanent afterwards: the entry
 * comes back looking right while quietly missing whatever the payload forgot.
 *
 * @param options.value - a successfully parsed `RestoreLogSchema` submission.
 * @param options.id - the fresh local id (a restore is a new row, never the old one).
 * @param options.loggedAtMs - the ORIGINAL instant, so the entry lands back on its own day.
 * @param options.dayKey - the device-local calendar day that instant belongs to.
 * @param options.createdAtMs - the instant this row was re-created on-device.
 * @returns the entry to persist.
 */
export function buildRestoredEntry({
  value,
  id,
  loggedAtMs,
  dayKey,
  createdAtMs,
}: {
  value: z.infer<typeof RestoreLogSchema>;
  id: string;
  loggedAtMs: number;
  dayKey: string;
  createdAtMs: number;
}): LocalFoodLog {
  return {
    id,
    name: value.name,
    quantityGrams: value.quantityGrams,
    macros: macrosFromOptionalFields(value),
    mealType: value.mealType ?? null,
    source: value.source,
    aiEstimated: value.aiEstimated,
    curatedSource: value.curatedSource ?? null,
    foodId: value.foodId ?? null,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId: value.logBatchId ?? null,
    netCarbsPer100g: value.netCarbsPer100g,
    micronutrientsPer100g: value.micronutrientsPer100g,
    attribution: toStoredAttribution(value.attribution),
    // The third field of the same class. `quantityGrams` above is restored
    // unchanged, so the portion label that was valid for it is still valid —
    // dropping it here is what turned an undone "2 eggs" back into "180 g".
    portion: value.portion ?? null,
  };
}

async function handleRestore(formData: FormData, timezone: string): Promise<Response> {
  const submission = parseWithZod(formData, { schema: RestoreLogSchema });
  // Restore is client-driven with well-formed data, so a parse failure is an
  // unexpected bug rather than user input — fail fast.
  if (submission.status !== 'success') throw new Response('Invalid restore payload', { status: 400 });

  const value = submission.value;
  const loggedAtMs = new Date(value.loggedAt).getTime();
  if (Number.isNaN(loggedAtMs)) throw new Response('Invalid loggedAt', { status: 400 });

  const entryDate = todayInTimezone(timezone, new Date(loggedAtMs));
  await putLocalFoodLog(
    buildRestoredEntry({ value, id: randomUuid(), loggedAtMs, dayKey: entryDate, createdAtMs: Date.now() }),
  );

  // Land the user on the day the restored entry belongs to (which may not be
  // the day they were viewing when they hit Undo).
  return redirectWithLocalToast(`/diary?date=${entryDate}`, {
    type: 'success',
    description: translate('diary.toast.restored', { name: value.name }),
  });
}

/**
 * Builds the entry a chip tap persists — the pure core of `handleLogRecent`,
 * split out for the same reason `buildLoggedEntry`/`buildRestoredEntry` were:
 * this is an entry-creating path in its own right, and the only way to prove it
 * carries every describing field is to drive it in a test without a store, a
 * clock, or a DOM. Every impure input (id, instant, meal, day) is passed in.
 *
 * @param options.value - a successfully parsed `LogRecentSchema` submission.
 * @param options.id - the client-generated entry id / idempotency key.
 * @param options.loggedAtMs - the instant the re-log is stamped with.
 * @param options.mealType - the meal derived from that instant (see `mealTypeForTime`).
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the entry to persist.
 */
export function buildRecentLogEntry({
  value,
  id,
  loggedAtMs,
  mealType,
  createdAtMs,
}: {
  value: z.infer<typeof LogRecentSchema>;
  id: string;
  loggedAtMs: number;
  mealType: LocalFoodLog['mealType'];
  createdAtMs: number;
}): LocalFoodLog {
  return {
    id,
    name: value.name,
    quantityGrams: value.quantityGrams,
    macros: macrosFromOptionalFields(value),
    mealType,
    source: 'manual',
    aiEstimated: value.aiEstimated,
    curatedSource: value.curatedSource ?? null,
    foodId: value.foodId ?? null,
    dayKey: value.date,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId: null,
    // The three fields this path used to drop. Same food, same source, same
    // grams as the chip's underlying log, so all three carry forward exactly
    // as they do in `buildCopiedEntry` — a re-log is a new use of the same
    // data, not a fresh manual entry that happens to share a name.
    netCarbsPer100g: value.netCarbsPer100g,
    micronutrientsPer100g: value.micronutrientsPer100g,
    attribution: toStoredAttribution(value.attribution),
    portion: value.portion ?? null,
  };
}

/** A day label for the toast when the entry did NOT land on today, else null ("…so far today." only when it IS today). */
function toastDayLabel(dayKey: string, timezone: string): string | null {
  return dayKey === todayInTimezone(timezone) ? null : formatDayLabel(dayKey, currentLanguage());
}

/** Chip tap: re-log a frequent/favorite food at its last-used grams, onto `date` (see `LogRecentSchema`). */
async function handleLogRecent(
  formData: FormData,
  timezone: string,
): Promise<{
  intent: 'log-recent';
  createdLogId: string;
  name: string;
  mealLabel: string;
  netCarbsTotal: number;
  hasEstimates: boolean;
  dayLabel: string | null;
}> {
  const submission = parseWithZod(formData, { schema: LogRecentSchema });
  if (submission.status !== 'success') throw new Response('Invalid quick-log payload', { status: 400 });

  const value = submission.value;
  const now = new Date();
  // `instantOnDate` returns `now` unchanged when `value.date` IS today (the
  // existing today-only frequent-chip behavior), and maps a favorite tapped
  // on a past day onto that day at a sensible time-of-day instead of midnight.
  const loggedAt = instantOnDate(value.date, timezone, now);
  const id = randomUuid();
  const mealType = mealTypeForTime({ at: loggedAt, timezone });
  await putLocalFoodLog(
    buildRecentLogEntry({
      value,
      id,
      loggedAtMs: loggedAt.getTime(),
      mealType,
      createdAtMs: now.getTime(),
    }),
  );
  const totals = await readDayCarbTotals(value.date);
  return {
    intent: 'log-recent',
    createdLogId: id,
    name: value.name,
    // Translated here rather than left to the toast: the fetcher's data crosses
    // no locale boundary, and the chip's `useEffect` would otherwise have to
    // re-derive a meal it never saw.
    mealLabel: mealGroupLabel(mealType, translate),
    netCarbsTotal: totals.netCarbs,
    hasEstimates: totals.hasEstimates,
    dayLabel: toastDayLabel(value.date, timezone),
  };
}

/** Undo a chip re-log by deleting the just-created entry. */
async function handleDeleteLog(formData: FormData): Promise<{ intent: 'log-recent-undo'; ok: true }> {
  const submission = parseWithZod(formData, { schema: DeleteLogSchema });
  if (submission.status !== 'success') throw new Response('Invalid undo payload', { status: 400 });
  await deleteLocalFoodLog(submission.value.logId);
  return { intent: 'log-recent-undo', ok: true };
}

/**
 * Copies one previous-day entry onto the target day — the pure core of
 * `handleCopyYesterday`. It is a copy of the SAME FOOD from the SAME SOURCE,
 * so every describing field rides along verbatim; only identity (`id`),
 * placement (`dayKey`/`loggedAt`/`createdAt`), and grouping (`logBatchId`)
 * change. Written as an explicit field list rather than a spread precisely so
 * that adding a field to `LocalFoodLog` and forgetting it here shows up as a
 * missing line in review — but the accompanying test is what actually catches
 * it (this file has now dropped `netCarbsPer100g` and `attribution` here once
 * each).
 *
 * @param options.log - the source day's entry.
 * @param options.id - the fresh local id for the copy.
 * @param options.dayKey - the day being copied onto.
 * @param options.loggedAtMs - the source instant remapped onto that day (see `remapInstantToTargetDay`).
 * @param options.createdAtMs - the instant the copy was made on-device.
 * @param options.logBatchId - the id grouping this whole copy batch, for one-tap Undo.
 * @returns the entry to persist.
 */
export function buildCopiedEntry({
  log,
  id,
  dayKey,
  loggedAtMs,
  createdAtMs,
  logBatchId,
}: {
  log: LocalFoodLog;
  id: string;
  dayKey: string;
  loggedAtMs: number;
  createdAtMs: number;
  logBatchId: string;
}): LocalFoodLog {
  return {
    id,
    name: log.name,
    quantityGrams: log.quantityGrams,
    macros: log.macros,
    mealType: log.mealType,
    source: log.source,
    aiEstimated: log.aiEstimated,
    curatedSource: log.curatedSource,
    foodId: log.foodId,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId,
    portion: log.portion,
    // Same food, same per-100g basis — the authoritative figure copies
    // forward verbatim, exactly like `macros`/`portion` above.
    netCarbsPer100g: log.netCarbsPer100g,
    // Same food, same source: the copy is a new use of the same credited
    // data, so it owes the same credit.
    attribution: log.attribution,
    // Same food, same per-100 g basis — the vitamins/minerals copy forward
    // verbatim too, or yesterday's covered day would come back uncovered.
    micronutrientsPer100g: log.micronutrientsPer100g,
  };
}

/**
 * Copies the previous day's entries onto the viewed date, preserving each
 * entry's time-of-day and provenance, under one shared batch id so Undo can
 * remove the whole batch. Copies get fresh local ids (never the original id).
 * When `mealType` is present, only that meal group is copied — otherwise the
 * whole day (item 5).
 */
async function handleCopyYesterday(
  formData: FormData,
  timezone: string,
): Promise<{
  intent: 'copy-yesterday';
  copiedBatchId: string | null;
  copiedCount: number;
  firstName: string;
  netCarbsTotal: number;
  hasEstimates: boolean;
  dayLabel: string | null;
}> {
  const submission = parseWithZod(formData, { schema: CopyYesterdaySchema });
  if (submission.status !== 'success') throw new Response('Invalid copy payload', { status: 400 });

  const { date: targetDate, mealType, entryIds } = submission.value;
  const sourceDate = shiftDate(targetDate, -1);
  const allLogs = await listLocalFoodLogs();
  const hasEntrySelection = entryIds !== undefined && entryIds.length > 0;
  const sourceLogs = allLogs.filter((log) => {
    if (log.dayKey !== sourceDate) return false;
    // Explicit entry ids win outright over the meal filter — see the schema
    // comment above.
    if (hasEntrySelection) return entryIds.includes(log.id);
    return mealType === undefined || log.mealType === mealType;
  });
  if (sourceLogs.length === 0) {
    return {
      intent: 'copy-yesterday',
      copiedBatchId: null,
      copiedCount: 0,
      firstName: '',
      netCarbsTotal: 0,
      hasEstimates: false,
      dayLabel: null,
    };
  }

  const sourceDayStartMs = dayBoundsInTimezone(sourceDate, timezone).start.getTime();
  const targetDayStartMs = dayBoundsInTimezone(targetDate, timezone).start.getTime();
  const batchId = randomUuid();
  const now = Date.now();
  for (const log of sourceLogs) {
    await putLocalFoodLog(
      buildCopiedEntry({
        log,
        id: randomUuid(),
        dayKey: targetDate,
        loggedAtMs: remapInstantToTargetDay({ sourceMs: log.loggedAt, sourceDayStartMs, targetDayStartMs }),
        createdAtMs: now,
        logBatchId: batchId,
      }),
    );
  }
  const totals = await readDayCarbTotals(targetDate);
  return {
    intent: 'copy-yesterday',
    copiedBatchId: batchId,
    copiedCount: sourceLogs.length,
    firstName: sourceLogs[0]?.name ?? '',
    netCarbsTotal: totals.netCarbs,
    hasEstimates: totals.hasEstimates,
    dayLabel: toastDayLabel(targetDate, timezone),
  };
}

/** Undo a copy-yesterday batch by deleting every entry stamped with the batch id. */
async function handleDeleteBatch(formData: FormData): Promise<{ intent: 'copy-undo'; ok: true }> {
  const submission = parseWithZod(formData, { schema: DeleteBatchSchema });
  if (submission.status !== 'success') throw new Response('Invalid undo payload', { status: 400 });
  const allLogs = await listLocalFoodLogs();
  for (const log of allLogs) {
    if (log.logBatchId === submission.value.batchId) await deleteLocalFoodLog(log.id);
  }
  return { intent: 'copy-undo', ok: true };
}

/**
 * "Save as meal" (item 1, M123/07): snapshots the named entries into a new
 * `LocalSavedMeal`. A malformed/empty `logIds` is a bug in the caller (the
 * button always submits at least one hidden `logIds` field per entry in the
 * group it renders from) rather than user input to recover from — fail fast.
 */
async function handleSaveMeal(
  formData: FormData,
): Promise<{ intent: 'save-meal'; name: string; count: number }> {
  const submission = parseWithZod(formData, { schema: SaveMealSchema });
  if (submission.status !== 'success') throw new Response('Invalid save-meal payload', { status: 400 });
  const { name, logIds } = submission.value;
  const allLogs = await listLocalFoodLogs();
  const logs = allLogs.filter((log) => logIds.includes(log.id));
  if (logs.length === 0) throw new Response('No matching entries to save', { status: 400 });
  const meal = buildSavedMealFromLogs({ logs, name, id: randomUuid(), createdAtMs: Date.now() });
  await putLocalSavedMeal(meal);
  return { intent: 'save-meal', name: meal.name, count: meal.items.length };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);

  // The per-entry delete lives on the entry detail page; the diary fields the
  // Undo-toast restore plus the quick-log / copy-yesterday flows below.
  if (intent === 'restore') return handleRestore(formData, timezone);
  if (intent === 'log-recent') return handleLogRecent(formData, timezone);
  if (intent === 'log-recent-undo') return handleDeleteLog(formData);
  if (intent === 'copy-yesterday') return handleCopyYesterday(formData, timezone);
  if (intent === 'copy-undo') return handleDeleteBatch(formData);
  if (intent === 'save-meal') return handleSaveMeal(formData);
  throw new Response('Invalid intent', { status: 400 });
}

////////////////////////////////////////////////////////////////////////////////
// Meal grouping (item 1) — shared by the viewed day's entry list and the
// previous day's copy-source breakdown (item 5)
////////////////////////////////////////////////////////////////////////////////

export interface MealGroup {
  mealType: LocalFoodLog['mealType'];
  logs: LocalFoodLog[];
  subtotal: DaySummary;
}

/**
 * Groups a day's entries by meal — breakfast, lunch, dinner, snack, then "no
 * meal" — skipping empty groups, each carrying its own subtotal via the same
 * `summarizeDay` arithmetic the day-level total uses. Entries within a group
 * keep the caller's ordering (the loader passes them chronological, oldest
 * first, so each meal section reads top-to-bottom by time).
 *
 * @param logs - a day's entries, any order.
 * @returns the populated meal groups, in `MEAL_GROUP_ORDER`.
 */
export function groupLogsByMeal(logs: readonly LocalFoodLog[]): MealGroup[] {
  const buckets = new Map<LocalFoodLog['mealType'], LocalFoodLog[]>();
  for (const log of logs) {
    const bucket = buckets.get(log.mealType);
    if (bucket) bucket.push(log);
    else buckets.set(log.mealType, [log]);
  }
  return MEAL_GROUP_ORDER.filter((mealType) => buckets.has(mealType)).map((mealType) => {
    const groupLogs = buckets.get(mealType) ?? [];
    return { mealType, logs: groupLogs, subtotal: summarizeDay(groupLogs.map(localFoodLogToSnapshot)) };
  });
}

/**
 * Display label for a meal group's header — "Breakfast" … "No meal".
 *
 * Translated here rather than via `#app/lib/meal-time`'s `mealLabel`, which
 * returns fixed English and is shared with `/add` — the same split `/add`
 * already made. `mealLabel` stays the source of truth for the meal TYPES; this
 * is only their wording.
 *
 * @param mealType - the meal group, or null for the "no meal" bucket.
 * @param t - the caller's translator.
 * @returns the header label.
 */
export function mealGroupLabel(mealType: LocalFoodLog['mealType'], t: Translate): string {
  return t(`diary.meals.${mealType ?? 'none'}`);
}

////////////////////////////////////////////////////////////////////////////////
// Favorites (explicit, device-local via localStorage — item 6)
////////////////////////////////////////////////////////////////////////////////

/**
 * localStorage key for the user's explicitly favorited foods, by
 * case-insensitive name. Deliberately NOT part of the TinyBase primary store
 * (`#app/lib/local-store`) — a favorite is a lightweight, low-stakes UI
 * preference (losing it costs nothing but re-tapping a star), not health data
 * needing that store's migration/backup/durability guarantees. Device-scoped,
 * same as the rest of this app's local-first data. `diary.entry.$id.tsx`
 * keeps an identical copy of this key + the toggle helpers (its `Favorite`
 * toggle lives on the entry receipt, not here) — see that file's note.
 */
const FAVORITE_FOODS_STORAGE_KEY = 'openplate:favoriteFoods';

/** Case-insensitive, whitespace-trimmed dedupe key for a favorited food name — mirrors `local-quick-add.ts`'s `nameKey`. */
function normalizeFoodNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Parses the raw localStorage value into a favorite-name set. Never throws — corrupt/missing/malformed JSON reads as "no favorites". */
export function parseFavoriteNames(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw));
    if (!parsed.success) return new Set();
    const names = new Set<string>();
    for (const entry of parsed.data) {
      const name = z.string().safeParse(entry);
      if (name.success) names.add(name.data);
    }
    return names;
  } catch {
    return new Set();
  }
}

/** Serializes a favorite-name set back to the localStorage string form. */
export function serializeFavoriteNames(names: ReadonlySet<string>): string {
  return JSON.stringify(Array.from(names));
}

/** Toggles `name`'s favorite membership, returning a NEW set (never mutates the input). */
export function toggleFavoriteName(names: ReadonlySet<string>, name: string): Set<string> {
  const key = normalizeFoodNameKey(name);
  const next = new Set(names);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Reads the current favorite-name set from localStorage. Empty outside a browser (SSR/Node) or on a fresh device. */
function readFavoriteNames(): Set<string> {
  if (globalThis.localStorage === undefined) return new Set();
  return parseFavoriteNames(localStorage.getItem(FAVORITE_FOODS_STORAGE_KEY));
}

/**
 * Converts a ranked recent food into the chip shape both the frequent and
 * favorite rows render. Deliberately mirrors `selectLocalFrequentChips`'
 * mapping field-for-field (favorites skip that function's frequency filter, not
 * its projection) — the two must never disagree about what a chip carries, or
 * a favorite and a frequent chip for the SAME food would re-log differently.
 */
function toFrequentChip(recent: LocalRecentFood): LocalFrequentChip {
  return {
    name: recent.name,
    lastQuantityGrams: recent.lastQuantityGrams,
    macros: recent.macros,
    foodId: recent.foodId,
    curatedSource: recent.curatedSource,
    aiEstimated: recent.aiEstimated,
    timesLogged: recent.timesLogged,
    carbStatus: chipCarbStatus(recent.macros, recent.lastQuantityGrams, {
      authoritativeNetCarbsPer100g: recent.netCarbsPer100g,
    }),
    portion: recent.portion,
    attribution: recent.attribution,
    netCarbsPer100g: recent.netCarbsPer100g,
  };
}

////////////////////////////////////////////////////////////////////////////////
// Client loader (local-first: reads entirely from the primary store)
////////////////////////////////////////////////////////////////////////////////

/**
 * Whole days between the most recent log and today, using the 7-day strip window
 * we already fetched. A logged day inside the window gives the exact gap (0–6);
 * an empty window with older history means the gap is at least the window width.
 */
function resolveDaysSinceLastLog(window: LocalDailyTotals[], today: string, hasAnyLogs: boolean): number | null {
  for (let index = window.length - 1; index >= 0; index--) {
    if (window[index].hasLogs) return enumerateDates(window[index].date, today).length - 1;
  }
  return hasAnyLogs ? HABIT_STRIP_DAYS : null;
}

/**
 * Whether this device has anything worth protecting with a backup export —
 * logged foods, food-log entries, or weight entries. Deliberately narrower
 * than `hasAnyLocalData` (which also counts a bare profile/goals row):
 * onboarding stamps a profile the moment a user finishes or skips it, before
 * they've logged a single food, so using that broader signal fired the
 * backup nudge on a first-ever visit with nothing yet worth losing (carbs-
 * audit round, item 6). Losing a goal setting is a minor inconvenience —
 * re-enter it; losing months of food logs is what the nudge exists to guard
 * against.
 */
export function hasDataWorthBackingUp({
  logCount,
  foodCount,
  weightEntryCount,
}: {
  logCount: number;
  foodCount: number;
  weightEntryCount: number;
}): boolean {
  return logCount > 0 || foodCount > 0 || weightEntryCount > 0;
}

/** One of yesterday's meal groups, offered as a copy target (item 5). */
export interface CopyableMeal {
  mealType: LocalFoodLog['mealType'];
  count: number;
}

/** The diary view-model — everything the component renders. */
export interface DiaryData {
  date: string;
  /** Today's local calendar date — the upper bound for navigation/the date picker (item 3). */
  today: string;
  isToday: boolean;
  /** The resolved IANA time zone, needed to render each entry's local time (item 1). */
  timezone: string;
  logs: LocalFoodLog[];
  mealGroups: MealGroup[];
  summary: DaySummary;
  goals: { netCarbsCeiling: number | null; proteinFloor: number | null; kcalTarget: number | null };
  habitStrip: HabitStripDay[];
  loggedDaysCount: number;
  frequentChips: LocalFrequentChip[];
  /** Explicitly favorited foods (item 6) — surfaced regardless of the viewed day. */
  favoriteChips: LocalFrequentChip[];
  hasAnyLogs: boolean;
  daysSinceLastLog: number | null;
  canCopyYesterday: boolean;
  /** Yesterday's meal groups, offered as copy targets — whole-day or per-meal (item 5). */
  copyableMeals: CopyableMeal[];
  /**
   * Yesterday's individual entries, chronological — the source list the
   * per-entry copy picker (item 3, M123/07) renders as checkboxes, grouped by
   * meal via the same `groupLogsByMeal` the day-level list already uses. Kept
   * separate from `copyableMeals` (which only carries counts) because the
   * picker needs each entry's own name/macros/id, not just how many there are
   * per meal.
   */
  copyableEntries: LocalFoodLog[];
  /** Whole days since the device last exported a backup, or null when never exported (M117/08 nudge). */
  daysSinceExportBackup: number | null;
  /**
   * Whole days since this device first held data, or null when the
   * `firstDataAt` marker is absent (M123/01 item 4). This is what a NEVER-
   * exported device is judged on — it has no `daysSinceExportBackup` to
   * measure, and firing the nudge the instant data appears would nag a user
   * minutes after their first log. See `shouldShowBackupNudge`.
   */
  daysSinceFirstDataLocal: number | null;
  /**
   * Whether the device holds anything irreplaceable enough to be worth
   * nudging about — logged foods, food-log entries, or weight entries (see
   * `hasDataWorthBackingUp`). Pairs with the two day-counts above: a never-
   * exported device only gets nudged once it has something to lose AND that
   * something has aged past the threshold (see `shouldShowBackupNudge`).
   */
  hasLocalData: boolean;
  /** Every food-log entry on this device — the "first food ever logged" milestone reads this (M129/03). */
  totalLogCount: number;
  /** How many entries on this device came from an AI plate identification — the "first scan" milestone. */
  aiEstimatedLogCount: number;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs): Promise<DiaryData> {
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const url = new URL(request.url);
  const today = todayInTimezone(timezone);
  // A malformed `?date=` falls back to today (matches /add and /scan). A
  // well-formed but FUTURE date bounces straight back to today (item 3) — a
  // future diary day has nothing to show and no honest Add affordance (you
  // can't log food you haven't eaten yet).
  const requestedDate = parseDateParam(url.searchParams.get('date')) ?? today;
  if (requestedDate > today) throw redirect('/diary');
  const date = requestedDate;
  const isToday = date === today;

  const allLogs = await listLocalFoodLogs();
  const logsForDay = allLogs.filter((log) => log.dayKey === date).toSorted((a, b) => a.loggedAt - b.loggedAt);
  const mealGroups = groupLogsByMeal(logsForDay);
  const totalsForDay = computeDailyTotals(allLogs, date);
  const summary = totalsForDay.summary ?? EMPTY_DAY_SUMMARY;

  const goals = {
    netCarbsCeiling: profile?.goalNetCarbsCeilingG ?? null,
    proteinFloor: profile?.goalProteinFloorG ?? null,
    kcalTarget: profile?.goalKcalTarget ?? null,
  };

  // The habit strip always ends on the real "today" (not the viewed date), so
  // it stays a stable at-a-glance streak even while paging back through history.
  // ONE range query backs both the strip and the last-log-gap detection.
  const windowStart = shiftDate(today, -(HABIT_STRIP_DAYS - 1));
  const totalsWindow = computeDailyTotalsInRange(allLogs, { fromDate: windowStart, toDate: today });
  const habitStrip = computeLocalHabitStrip({
    dailyTotals: totalsWindow,
    today,
    dayCount: HABIT_STRIP_DAYS,
    netCarbsCeiling: goals.netCarbsCeiling,
  });

  // One recents computation drives the frequent chips, the favorite chips, and
  // "has the user ever logged?".
  const recents = computeLocalRecentFoods(allLogs, { limit: RECENT_CHIP_SCAN_LIMIT });
  const hasAnyLogs = recents.length > 0;

  // Favorites (item 6): an EXPLICIT choice, so they're surfaced regardless of
  // the viewed day. A favorited name is excluded from the frequent row so the
  // same food never appears in both (a favorite already says "I want this
  // here").
  const favoriteNames = readFavoriteNames();
  const favoriteChips = recents
    .filter((recent) => favoriteNames.has(normalizeFoodNameKey(recent.name)))
    .map(toFrequentChip);
  const favoriteNameKeys = new Set(favoriteChips.map((chip) => normalizeFoodNameKey(chip.name)));
  // M123/07 item 2: frequent chips used to compute only `isToday ? … : []`,
  // and the render below additionally hid BOTH chip rows on the
  // "returning-after-gap" empty state. That combination hid the fastest
  // re-log shortcut in the app on exactly the two occasions it matters most —
  // a person checking a past day's log, and a person coming back after a
  // break who is the most likely to reach for "the usual" rather than search
  // from scratch. The heuristic (`minTimesLogged`/`MAX_FREQUENT_CHIPS`) is
  // unchanged; only the day- and empty-state gates are gone. Computed for
  // every viewed day now, not only today.
  const frequentChips = selectLocalFrequentChips(recents, {
    limit: MAX_FREQUENT_CHIPS,
    minTimesLogged: MIN_CHIP_TIMES_LOGGED,
  }).filter((chip) => !favoriteNameKeys.has(normalizeFoodNameKey(chip.name)));
  const daysSinceLastLog = resolveDaysSinceLastLog(totalsWindow, today, hasAnyLogs);

  // Copy-from-yesterday (item 5): offered whenever the previous day has
  // anything worth copying — no longer gated on the viewed day being empty —
  // broken down per meal so a single meal can be copied, not only the whole day.
  const previousDate = shiftDate(date, -1);
  const previousDayLogs = allLogs
    .filter((log) => log.dayKey === previousDate)
    .toSorted((a, b) => a.loggedAt - b.loggedAt);
  const copyableMeals: CopyableMeal[] = groupLogsByMeal(previousDayLogs).map((group) => ({
    mealType: group.mealType,
    count: group.logs.length,
  }));

  // Backup-nudge gating (item 6): deliberately NOT `hasAnyLocalData()` — see
  // `hasDataWorthBackingUp`'s doc for why a bare profile/goals row shouldn't
  // count.
  const [personalFoods, weightEntries] = await Promise.all([listLocalFoods(), listLocalWeightEntries()]);

  return {
    date,
    today,
    isToday,
    timezone,
    logs: logsForDay,
    mealGroups,
    summary,
    goals,
    habitStrip,
    loggedDaysCount: countLoggedDays(habitStrip),
    frequentChips,
    favoriteChips,
    hasAnyLogs,
    daysSinceLastLog,
    canCopyYesterday: copyableMeals.length > 0,
    copyableMeals,
    copyableEntries: previousDayLogs,
    totalLogCount: allLogs.length,
    aiEstimatedLogCount: allLogs.filter((log) => log.aiEstimated).length,
    daysSinceExportBackup: await daysSinceExport(),
    // Read from the `firstDataAt` marker in the store's VALUES partition, so
    // it still reports the true age of this device's data after a tables wipe.
    daysSinceFirstDataLocal: await daysSinceFirstData(),
    hasLocalData: hasDataWorthBackingUp({
      logCount: allLogs.length,
      foodCount: personalFoods.length,
      weightEntryCount: weightEntries.length,
    }),
  };
}
clientLoader.hydrate = true as const;

////////////////////////////////////////////////////////////////////////////////
// Display helpers
////////////////////////////////////////////////////////////////////////////////

/**
 * Renders a per-serving macro value with its unit, or "unknown" when the
 * macro wasn't recorded. Replaces the old `formatMacro` + template-literal-
 * appended unit pairing, which rendered a bare em dash followed by a stray
 * unit ("protein —g") for any unrecorded macro (carbs-audit round, item 1).
 */
export function formatMacroOrUnknown(value: number | null, unit: string, t: Translate, language: string): string {
  return value === null ? t('diary.macros.unknown') : `${formatMacroNumberIn(language, value)}${unit}`;
}

/**
 * Net-carb display shared by every level of this page — a single entry, a
 * meal subtotal, and the day total — so the tracked metric never differs in
 * precision or rounding depending on where it's read (carbs-audit round,
 * item 4: entry rows used to show one decimal place while the meal/day
 * totals rounded to whole grams). Hedged with a leading "~" when the total it
 * describes includes AI estimates.
 */
export function formatNetCarbGrams(value: number, hasEstimates: boolean, language: string): string {
  return `${hasEstimates ? '~' : ''}${formatMacroNumberIn(language, value)}`;
}

/**
 * One entry's net carbs, reusing `summarizeDay`'s per-entry rule via a
 * one-item array rather than re-deriving the carbs-minus-fiber-minus-polyols
 * subtraction locally. Going through the shared `localFoodLogToSnapshot` is
 * what makes a curated entry's stored authoritative figure win here — a
 * hand-rolled projection is precisely how this row rendered "0 g net carbs"
 * for a fibre-heavy curated food.
 */
function entryNetCarbs(log: LocalFoodLog): number {
  return summarizeDay([localFoodLogToSnapshot(log)]).netCarbs;
}

/**
 * The entry row's single carbs figure. This is the fix for the primary
 * defect this round: entry rows used to render TOTAL carbs while the day
 * headline and every meal-section header rendered NET carbs — same word, two
 * different numbers, one screen. Every level of this page now shows the same
 * metric, labeled the same way: "unknown" (never a misleading "0g net
 * carbs") when this entry has no carbs data at all, otherwise the same
 * one-decimal, "~"-hedged figure the meal and day totals use.
 */
export function formatEntryNetCarbs(log: LocalFoodLog, t: Translate, language: string): string {
  if (log.macros.carbs === null) return t('diary.entry.netCarbsUnknown');
  return t('diary.netCarbsValue', { value: formatNetCarbGrams(entryNetCarbs(log), log.aiEstimated, language) });
}

/**
 * Single caveat line for the day summary. Missing data takes precedence over
 * estimate hedging — a total built on unknown macros is more suspect than one
 * built on estimates. Returns null when the totals are fully known and manual.
 */
function getSummaryCaveat(summary: DaySummary, t: Translate): string | null {
  if (summary.hasUnknowns) return t('diary.caveat.missingData');
  if (summary.hasEstimates) return t('diary.caveat.estimates');
  return null;
}

/** Hidden-input string for an optional per-serving macro (null → empty, so unknowns stay blank). */
function macroHidden(value: number | null): string {
  return value === null ? '' : String(value);
}

/** An entry's portion for display: the chosen household unit ("2 eggs") when one was recorded, plus the authoritative grams — otherwise a plain gram figure (item 7). */
export function formatEntryPortion(log: LocalFoodLog): string {
  if (!log.portion) return `${log.quantityGrams.toFixed(0)}g`;
  const label = formatPortionLabel({ unit: log.portion.unit, quantity: log.portion.quantity });
  return `${label} (${log.quantityGrams.toFixed(0)}g)`;
}

/**
 * An entry's logged time, in the resolved local time zone — "8:32 AM" in
 * English, "08:32" in German (12- vs 24-hour is a locale convention, not a
 * setting). An omitted `language` falls back to English so existing callers
 * and tests keep their current output.
 *
 * The formatting itself is `#app/lib/format-clock-time`'s — this wrapper exists
 * only for the positional `(loggedAt, timezone, language?)` signature its
 * callers and tests already use, and for the language fallback.
 *
 * The fallback is resolved in the BODY, not as a `language = DEFAULT_LANGUAGE`
 * default parameter, and that is load-bearing rather than stylistic: it is what
 * makes this file buildable. React Router 8.1.0's route-chunk splitter walks
 * the identifiers each chunked export (`clientLoader`, `clientAction`,
 * `HydrateFallback`) depends on, and when that walk reaches an identifier
 * sitting in an `AssignmentPattern` — a default parameter — inside an EXPORTED
 * function declaration, it looks for an enclosing `VariableDeclarator`, finds
 * none, and throws `Expected a Path, but got null` with no source location.
 * Moving the reference into the body takes it out of the pattern and the walk
 * completes. See the note above `HydrateFallback` for the full rule.
 */
export function formatEntryTime(loggedAt: number, timezone: string, language?: string): string {
  const resolved = language ?? DEFAULT_LANGUAGE;
  return formatClockTime(loggedAt, { timezone, language: resolved });
}

/**
 * Id of the newest log entry when it was created within the last minute, else
 * null — used to briefly highlight a row that a scan, quick-add, or chip just
 * landed. Client-only (via a mount effect) so the wall-clock read never causes
 * an SSR/hydration mismatch, and re-evaluated whenever the loaded logs change (a
 * fresh insert bumps the newest `createdAt`).
 */
function useJustAddedLogId(logs: LocalFoodLog[]): string | null {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
  }, [logs]);

  if (nowMs === null) return null;
  const newest = logs.reduce<LocalFoodLog | null>(
    (latest, log) => (latest === null || log.createdAt > latest.createdAt ? log : latest),
    null,
  );
  if (newest === null) return null;
  const ageMs = nowMs - newest.createdAt;
  return ageMs >= 0 && ageMs < RECENT_LOG_THRESHOLD_MS ? newest.id : null;
}

/**
 * Cross-tab convergence (item 9): the primary store already reconciles
 * another tab's write into THIS tab's in-memory TinyBase store within about a
 * second (see `local-store/persist.ts`'s `startAutoLoad` doc), but this
 * route's rendered data is a point-in-time snapshot taken by `clientLoader` —
 * nothing re-runs it just because the underlying store changed underneath.
 * Polling `revalidate()` while the tab is visible is the simplest fix that
 * needs no changes to `local-store` itself: a background/hidden tab does no
 * work (paused on `visibilitychange`), and a visible tab picks up another
 * tab's write within one poll tick after the store's own reconciliation
 * window. Skips a poll while a revalidation is already in flight.
 */
function useLiveDiaryRevalidation(): void {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (globalThis.document === undefined) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (revalidator.state === 'idle') revalidator.revalidate();
      }, LIVE_REVALIDATE_POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [revalidator]);
}

////////////////////////////////////////////////////////////////////////////////
// Date nav + habit strip
////////////////////////////////////////////////////////////////////////////////

/**
 * Day navigation: prev/next paging (next disabled once the viewed day IS
 * today — item 3), the human day label, and a calendar popover for jumping
 * straight to any past day (carbs-audit round → date-nav rework: replaces a
 * hidden native `<input type="date">` opened via `showPicker()` plus a tiny
 * underlined "Today" link floating under the heading — reported as "weird
 * and confusing" — with the shadcn `Popover`/`Calendar` pair below).
 *
 * The center date button IS the popover trigger: tapping it (or its
 * chevron-down) opens a `CalendarPicker` anchored underneath, in single-select
 * mode, disabling any day after `today` (item 3 — a future diary day has
 * nothing to show). The calendar's displayed month starts on the viewed
 * date, via `month={dayKeyToLocalDate(date)}` — so paging back several days
 * with Prev/Next still opens the popover on the right month rather than
 * always defaulting to the current one.
 *
 * "Back to today" is now a real, clearly-labeled `Button` (never a bare
 * underlined word) rather than a fragment floating unexplained under the
 * date — it appears in two places when browsing a past day: inline next to
 * the date button, and again as the popover's footer action, so it's
 * reachable whether or not the calendar is open. The date label itself picks
 * up a muted amber tint while viewing a past day, a second, quieter cue that
 * doesn't rely on either button being visible.
 *
 * Selecting a day in the calendar converts the `Date` back to a `YYYY-MM-DD`
 * day key via `localDateToDayKey` (never `toISOString()` — see
 * `#app/lib/day-key-date`'s header for the UTC-shift bug that would
 * reintroduce) and navigates to `/diary?date=<key>` (or bare `/diary` for
 * today), closing the popover.
 */
function DateNav({ date, today }: { date: string; today: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const isToday = date === today;
  const canGoNext = date < today;
  const todayDate = dayKeyToLocalDate(today);

  const goToDay = (nextDate: Date) => {
    const nextKey = localDateToDayKey(nextDate);
    navigate(nextKey === today ? '/diary' : `/diary?date=${nextKey}`);
    setIsPickerOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="icon" asChild aria-label={t('diary.nav.previousDay')}>
        <Link to={`/diary?date=${shiftDate(date, -1)}`}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </Button>

      <div className="flex items-center gap-2">
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              aria-label={t('diary.nav.openCalendar', { day: formatDayLabel(date, i18n.language) })}
              className={cn('gap-1.5 text-lg font-semibold tabular-nums', !isToday && 'text-accent-amber')}
            >
              {formatDayLabel(date, i18n.language)}
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center">
            <CalendarPicker
              mode="single"
              selected={dayKeyToLocalDate(date)}
              month={dayKeyToLocalDate(date)}
              disabled={{ after: todayDate }}
              onSelect={(nextDate) => {
                if (!nextDate) return;
                goToDay(nextDate);
              }}
            />
            {!isToday && (
              <div className="border-t p-2">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => goToDay(todayDate)}>
                  {t('diary.nav.jumpToToday')}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        {!isToday && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/diary">{t('diary.nav.jumpToToday')}</Link>
          </Button>
        )}
      </div>

      {canGoNext ?
        <Button variant="ghost" size="icon" asChild aria-label={t('diary.nav.nextDay')}>
          <Link to={`/diary?date=${shiftDate(date, 1)}`}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      : <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label={t('diary.nav.nextDay')}
          title={t('diary.nav.alreadyToday')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      }
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Goal-aware day summary
////////////////////////////////////////////////////////////////////////////////

interface DiaryGoals {
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
  kcalTarget: number | null;
}

/** Hedged calorie-target line — whole numbers, "~" when estimates/unknowns are involved. Never "remaining". */
function KcalGoalLine({ kcal, target, hedged }: { kcal: number; target: number; hedged: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      {/* The "~" stays outside the catalog string: it hedges the FIGURE, and a
          translator moving it would detach it from the number it qualifies. */}
      {hedged ? '~' : ''}
      {t('diary.kcal.ofTarget', { value: Math.round(kcal), target: Math.round(target) })}
    </p>
  );
}

/**
 * Pure formatter for the day's full macro-breakdown line. Two defects fixed
 * here: (1) Carbs/Fiber/Protein/Fat now share the headline's own one-decimal
 * rounding (`formatMacroNumber`) instead of a hard `Math.round()` — a small
 * day's fractional grams no longer disappear into "Carbs 0g" directly under
 * a "0.3g net carbs" headline, the same sub-gram vanishing act already fixed
 * at the headline level but not here; (2) "kcal" is spelled out as
 * "calories". Exported for direct testability.
 */
export function formatMacroBreakdownLine(summary: DaySummary, t: Translate, language: string): string {
  return t('diary.macros.breakdownLine', {
    carbs: formatMacroNumberIn(language, summary.carbs),
    fiber: formatMacroNumberIn(language, summary.fiber),
    protein: formatMacroNumberIn(language, summary.protein),
    fat: formatMacroNumberIn(language, summary.fat),
    kcal: Math.round(summary.kcal),
  });
}

/**
 * The day summary — openplate's most-looked-at surface, recomposed
 * novice-first in M129/06.
 *
 * What it USED to show at a glance: a ring, a macro ratio bar, four macro
 * figures, a protein line, a calorie line, a net-carb definition, and a
 * caveat. That is nine pieces of information for someone whose actual
 * question is "how did today go?".
 *
 * What it shows now (M129/03 reframed the number itself): what's LEFT of the
 * day's budget, one qualitative carb-impact chip, one protein figure, and a
 * "Day details" button. Everything else lives behind that button in
 * `DayDrillDown`, where it's joined by the thing the old hero never offered —
 * a per-target GAP view and foods that would close it.
 *
 * The ring tracks whichever budget the user actually set: their net-carb
 * ceiling, or — for someone who tracks calories instead — their calorie
 * target. With neither, there is no budget to draw, so the card falls back to
 * a left-aligned absolute headline. `formatHeroStat` owns which of those five
 * framings applies and every word in it.
 */
function DaySummaryCard({
  summary,
  goals,
  addBase,
  date,
  celebrating,
}: {
  summary: DaySummary;
  goals: DiaryGoals;
  addBase: string;
  /** The viewed day — scopes the count-up so paging days doesn't tween one day's figure into another's. */
  date: string;
  /** True while a one-time celebration is playing, which pulses this card's edge. */
  celebrating: boolean;
}) {
  const { t, i18n } = useTranslation();
  const gaps = computeDayGaps({
    totals: { netCarbs: summary.netCarbs, protein: summary.protein, fiber: summary.fiber },
    goals: { netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor },
    t,
  });
  const hasAnyGoal = goals.netCarbsCeiling !== null || goals.proteinFloor !== null || goals.kcalTarget !== null;
  const details = useDayDetails();
  const kcalHedged = summary.hasEstimates || summary.hasUnknowns;

  const heroStat = formatHeroStat({
    netCarbs: summary.netCarbs,
    netCarbsCeiling: goals.netCarbsCeiling,
    kcal: summary.kcal,
    kcalTarget: goals.kcalTarget,
    hasEstimates: summary.hasEstimates,
    t,
    language: i18n.language,
  });

  // The ring tracks the budget the hero is framing — carbs when there's a
  // ceiling, calories for a calorie-only tracker, nothing at all when the user
  // set neither (a ring against an invented target would be a fabricated goal).
  const budget =
    goals.netCarbsCeiling !== null && goals.netCarbsCeiling > 0 ?
      { consumed: summary.netCarbs, max: goals.netCarbsCeiling }
    : goals.kcalTarget !== null && goals.kcalTarget > 0 ? { consumed: summary.kcal, max: goals.kcalTarget }
    : null;

  // ONE tweened scalar drives both the headline and the arc: the hero counts
  // the remaining (or over-by) figure, and the arc's position is derived back
  // out of it, so the two can never drift apart mid-animation. Keyed by day +
  // framing so switching days or goal modes resets instead of tweening across.
  const animatedFigure = useCountUp(heroStat.numericValue, `${date}:${heroStat.mode}`);
  const animatedConsumed =
    budget === null ? summary.netCarbs
    : heroStat.isOver ? budget.max + animatedFigure
    : budget.max - animatedFigure;
  const heroValue = formatHeroValue({
    numericValue: animatedFigure,
    mode: heroStat.mode,
    hasEstimates: summary.hasEstimates,
    language: i18n.language,
  });

  // The calorie line is composed here (it needs the goals) but RENDERS inside
  // the drill-down — calories are exactly the kind of secondary figure the
  // novice-first hero exists to get out of the way.
  const kcalLine =
    goals.kcalTarget !== null ?
      <KcalGoalLine kcal={summary.kcal} target={goals.kcalTarget} hedged={kcalHedged} />
    : <p className="text-sm text-muted-foreground tabular-nums">
        {t('diary.kcal.absolute', { value: Math.round(summary.kcal) })}
      </p>;

  /**
   * The two lines that survive at hero level: the verdict, and the one macro
   * people chase. `centered` follows the RING: in the ring variant the glance
   * sits under a centered circle on a phone and beside it on desktop, so it
   * centers then left-aligns; in the ceiling-less variant there is no ring and
   * the card leads with a left-aligned headline, so the glance stays left at
   * every width (centering it there left the card reading as two unrelated
   * halves).
   */
  const renderGlance = (centered: boolean) => (
    <div className={cn('flex flex-col gap-2.5', centered ? 'items-center sm:items-start' : 'items-start')}>
      <CarbImpactChip impact={gaps.impact} />
      <HeroProteinFigure gap={gaps.protein} />
    </div>
  );

  const drillDown = (
    <DayDetailsPanel {...details}>
      <DayDrillDown
        summary={summary}
        gaps={gaps}
        addBase={addBase}
        hasAnyGoal={hasAnyGoal}
        caveat={getSummaryCaveat(summary, t)}
        kcalLine={kcalLine}
      />
    </DayDetailsPanel>
  );

  // Brand hero surface (M129/01, recomposed in the soul pass): this is the
  // diary's single most-looked-at card, so it gets the directional teal wash
  // (`surface-brand`, see app.css) plus a brand-tinted border and a real
  // shadow, where every other card on the page is plain `bg-card`.
  // The celebration pulse rides on the hero card's own edge — no extra
  // element, no layout shift, and gated behind `motion-safe:` so a
  // reduced-motion visitor simply doesn't get it (see app.css).
  const heroCardClass = cn(
    'surface-brand overflow-hidden rounded-2xl border-primary/30 shadow-md',
    celebrating && 'motion-safe:animate-celebrate',
  );

  if (budget === null) {
    return (
      <Card className={heroCardClass}>
        <CardContent className="space-y-5 p-5 sm:p-6">
          {/*
            The budget-less variant's headline stat. Deliberately NOT
            `font-display`: this is a live figure, and the Fraunces subset has
            no tabular figures, so the number would jitter in width as it
            changes (see app.css). The brand voice on this card is carried by
            the eyebrow above it, which is fixed text.
          */}
          <div className="space-y-1.5">
            <SectionEyebrow>{t('diary.hero.eyebrow')}</SectionEyebrow>
            <HeroStat stat={heroStat} value={heroValue} size="headline" />
          </div>
          <div className="space-y-4">
            {renderGlance(false)}
            <DayDetailsButton {...details} />
          </div>
          {drillDown}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={heroCardClass}>
      <CardContent className="space-y-5 p-5 sm:p-6">
        {/*
          Ring left of the glance on wide screens, stacked above it on narrow
          ones. `items-center` on the row plus a real `gap-8` gutter centers
          the two columns against each other and gives the circle air on all
          four sides; the ring itself steps 120px -> 136px purely through the
          `--ring-box` custom property (see RingProgress) — one component, one
          geometry, two sizes.

          M129/06 shrank the right-hand column from a seven-line block to two
          lines, which is why the ring now reads as the hero of its own card
          rather than as a decoration beside a wall of text.
        */}
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
          <RingProgress
            value={budget.consumed}
            animatedValue={animatedConsumed}
            max={budget.max}
            size={136}
            strokeWidth={11}
            className="[--ring-box:120px] sm:[--ring-box:136px]"
            trackClassName="text-primary/20"
            progressClassName={heroStat.isOver ? 'text-accent-amber' : 'text-primary'}
            label={heroStat.srLabel}
          >
            <HeroStat stat={heroStat} value={heroValue} />
          </RingProgress>
          {/*
            The right-hand column holds the glance AND the disclosure trigger.
            On a phone that stacks under the ring exactly as before; on a wide
            screen it's what stops the novice-first hero's two short lines from
            leaving a void beside the ring. The expanded panel still spans the
            card's full width (see `DayDetailsPanel`) — its macro grid needs it.
          */}
          <div className="w-full min-w-0 flex-1 space-y-4">
            {renderGlance(true)}
            <DayDetailsButton {...details} />
          </div>
        </div>
        {drillDown}
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Entry list, grouped by meal (item 1)
////////////////////////////////////////////////////////////////////////////////

/**
 * Provenance pill derived from the log row: a curated match wins a neutral
 * "From our food database" chip — no brand name on every row (carbs-audit
 * round, item 3; matches the wording the add flow already uses for the same
 * source). The licence credit for that data is discharged once, at the point
 * of adding a food, not repeated as a brand chip on every diary row.
 * Otherwise an AI-estimated entry gets the existing "AI estimated" badge; a
 * plain manual entry gets nothing.
 */
function ProvenanceBadge({ log }: { log: LocalFoodLog }) {
  const { t } = useTranslation();
  if (log.curatedSource) {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
        {t('diary.entry.fromDatabase')}
      </Badge>
    );
  }
  if (log.aiEstimated) {
    return <Badge variant="secondary">{t('diary.entry.aiEstimated')}</Badge>;
  }
  return null;
}

/**
 * A day's log entry, a whole-row link to its detail receipt (where editing,
 * re-logging, and deleting live). The row is a single interactive element — no
 * nested buttons — so the entire touch target is tappable; a chevron signals
 * the drill-in. The meal itself is no longer repeated per-card — the section
 * header above already states it (item 1) — but the logged TIME now is.
 */
function LogEntryCard({ log, justAdded, time }: { log: LocalFoodLog; justAdded: boolean; time: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Card
      className={cn(
        // Brand-token hover (M129 soul pass) — the row lifts onto a faint
        // teal wash instead of the old literal `teal-300`/`teal-600` border
        // pair, so a brand retune moves the whole app at once. Deliberately
        // restrained: entry rows are the densest thing on the page and must
        // stay scannable, so the tint is a hover state, never a resting one.
        'transition-colors duration-300 hover:border-primary/40 hover:bg-primary/5',
        justAdded && 'border-primary/50 bg-primary/10',
      )}
    >
      <Link to={`/diary/entry/${log.id}`} className="block">
        <CardContent className="flex min-h-[3.5rem] items-center justify-between gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{log.name}</span>
              {justAdded && (
                <Badge variant="outline" className="border-primary/50 text-primary">
                  {t('diary.entry.justAdded')}
                </Badge>
              )}
              <ProvenanceBadge log={log} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground tabular-nums">
              {time} · {formatEntryPortion(log)} · {formatEntryNetCarbs(log, t, i18n.language)} ·{' '}
              {t('diary.entry.protein')} {formatMacroOrUnknown(log.macros.protein, 'g', t, i18n.language)} ·{' '}
              {t('diary.entry.fat')} {formatMacroOrUnknown(log.macros.fat, 'g', t, i18n.language)} ·{' '}
              {/* "calories" already says what the number is — appending the
                  jargon unit "kcal" on top said it twice (defect). */}
              {t('diary.entry.calories')} {formatMacroOrUnknown(log.macros.kcal, '', t, i18n.language)}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Link>
    </Card>
  );
}

/** One meal's section: a header (meal name + net-carb subtotal) over its entries. */
function MealGroupSection({
  group,
  justAddedLogId,
  timezone,
}: {
  group: MealGroup;
  justAddedLogId: string | null;
  timezone: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="space-y-2">
      {/*
        Meal headers carry the app's shared brand eyebrow (M129 soul pass):
        teal, uppercase, with a hairline running from the label to the
        subtotal so the two read as one row rather than two loose fragments at
        opposite edges. The subtotal sits in a quiet brand-tinted pill for the
        same reason — it's a figure about the group, not body copy.
      */}
      <div className="flex items-center gap-2.5">
        <SectionEyebrow as="h3">{mealGroupLabel(group.mealType, t)}</SectionEyebrow>
        <span className="h-px flex-1 bg-primary/20" aria-hidden="true" />
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {t('diary.netCarbsValue', {
            value: formatNetCarbGrams(group.subtotal.netCarbs, group.subtotal.hasEstimates, i18n.language),
          })}
        </span>
        <SaveMealButton group={group} />
      </div>
      <div className="space-y-2">
        {group.logs.map((log) => (
          <LogEntryCard
            key={log.id}
            log={log}
            justAdded={log.id === justAddedLogId}
            time={formatEntryTime(log.loggedAt, timezone, i18n.language)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * "Save as meal" (item 1, M123/07): a small button on the meal header that
 * bundles every entry in THIS group into a named, reusable `LocalSavedMeal`
 * (re-logged/deleted from `/meals`). Local UI state, own fetcher — the same
 * inline-toggle-then-submit shape `CopyFromYesterday`'s "choose entries"
 * picker already established, so a person familiar with one recognizes the
 * other.
 */
function SaveMealButton({ group }: { group: MealGroup }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const shownRef = useRef(false);
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState('');
  const isSaving = fetcher.state !== 'idle';

  useEffect(() => {
    const data = fetcher.data;
    if (!data || !('intent' in data) || data.intent !== 'save-meal' || shownRef.current) return;
    shownRef.current = true;
    toast.success(t('diary.saveMeal.toast', { name: data.name, count: data.count }));
    setIsNaming(false);
    setName('');
  }, [fetcher.data, t]);

  if (!isNaming) {
    return (
      <button
        type="button"
        onClick={() => setIsNaming(true)}
        aria-label={t('diary.saveMeal.trigger')}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <BookMarked className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <fetcher.Form
      method="post"
      className="flex shrink-0 items-center gap-1.5"
      onSubmit={(event) => {
        if (name.trim().length === 0) event.preventDefault();
      }}
    >
      <input type="hidden" name="_intent" value="save-meal" />
      {group.logs.map((log) => (
        <input key={log.id} type="hidden" name="logIds" value={log.id} />
      ))}
      <input
        type="text"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t('diary.saveMeal.namePlaceholder')}
        aria-label={t('diary.saveMeal.namePlaceholder')}
        className="h-7 w-32 rounded-full border border-border bg-card px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={isSaving || name.trim().length === 0}>
        {isSaving ? t('diary.saveMeal.saving') : t('diary.saveMeal.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setIsNaming(false)}>
        {t('diary.copy.cancel')}
      </Button>
    </fetcher.Form>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Quick-add chips: frequent (today only, unchanged) + favorites (any day, item 6)
////////////////////////////////////////////////////////////////////////////////

/**
 * A single one-tap quick-add chip (frequent or favorite). Submitting re-logs
 * the food at its last-used grams via its own fetcher (so the tapped chip
 * shows its own pending state) onto `date` — the day being viewed, not always
 * "today" (item 6) — then fires a sonner "Added … · Undo" toast whose Undo
 * deletes the just-created entry. The traffic-light dot reads the food's
 * net-carb status.
 *
 * Exported so its OWN rendered hidden inputs can drive the re-log chain in a
 * test (the precedent `PortionStep`/`ConfirmDraftForm` set): every field this
 * form omits is a field the re-logged entry silently loses, and reading the
 * fields off the real markup is the only way to catch that.
 */
export function QuickAddChipButton({ chip, date }: { chip: LocalFrequentChip; date: string }) {
  const { t, i18n } = useTranslation();
  const logFetcher = useFetcher<typeof clientAction>();
  const undoFetcher = useFetcher<typeof clientAction>();
  const shownRef = useRef<Set<string>>(new Set());
  const isLogging = logFetcher.state !== 'idle';

  useEffect(() => {
    const data = logFetcher.data;
    if (!data || !('intent' in data) || data.intent !== 'log-recent') return;
    if (shownRef.current.has(data.createdLogId)) return;
    shownRef.current.add(data.createdLogId);
    const logId = data.createdLogId;
    showFoodAddedToast({
      name: data.name,
      mealLabel: data.mealLabel,
      netCarbsTotal: data.netCarbsTotal,
      hasEstimates: data.hasEstimates,
      dayLabel: data.dayLabel,
      t,
      language: i18n.language,
      action: {
        label: t('diary.actions.undo'),
        onClick: () => undoFetcher.submit({ _intent: 'log-recent-undo', logId }, { method: 'post' }),
      },
    });
  }, [logFetcher.data, undoFetcher, t, i18n.language]);

  return (
    <logFetcher.Form method="post">
      <input type="hidden" name="_intent" value="log-recent" />
      <input type="hidden" name="name" value={chip.name} />
      <input type="hidden" name="quantityGrams" value={String(chip.lastQuantityGrams)} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="foodId" value={chip.foodId ?? ''} />
      <input type="hidden" name="curatedSource" value={chip.curatedSource ?? ''} />
      <input type="hidden" name="aiEstimated" value={chip.aiEstimated ? 'true' : 'false'} />
      {/* The three fields a chip tap used to lose. No source gate on any of
          them (unlike /add's portion step): these are the ORIGINAL LOG's own
          already-gated values, not a candidate's re-derived estimate — a chip
          from a manual or AI-estimated food simply carries none, and each
          encoder maps "none" to a value that decodes straight back to it. */}
      <input type="hidden" name="netCarbsPer100g" value={encodeAuthoritativeNetCarbs(chip.netCarbsPer100g)} />
      {/* The fourth field of the same class (M135): the original log's
          vitamins/minerals, so a chip re-log lands as covered a day as the
          first log did. */}
      <input type="hidden" name="micronutrientsPer100g" value={encodeMicronutrients(chip.micronutrientsPer100g)} />
      <input type="hidden" name="attribution" value={chip.attribution ?? ''} />
      <input type="hidden" name="portion" value={encodeDisplayPortion(chip.portion)} />
      {MACRO_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={macroHidden(chip.macros[key])} />
      ))}
      <button
        type="submit"
        disabled={isLogging}
        /* In flight the chip breathes rather than only dimming. A tap on a
           quick-add chip writes to IndexedDB and usually settles before the
           progress bar's 150ms delay elapses, so this chip is the only place
           that slow taps show up at all — and `pulse-soft` costs no layout, so
           a row of chips can't reflow as one of them goes pending. */
        className={cn(
          'inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60',
          isLogging && 'pulse-soft',
        )}
      >
        {chip.carbStatus && (
          <span className={cn('h-2 w-2 shrink-0 rounded-full', carbStatusDotClass[chip.carbStatus])} />
        )}
        <span className="truncate">+ {chip.name}</span>
      </button>
    </logFetcher.Form>
  );
}

/** A labeled row of quick-add chips — shared by the "Favorites" and "Quick add" sections. */
function QuickAddChips({ title, chips, date }: { title: string; chips: LocalFrequentChip[]; date: string }) {
  return (
    <div className="space-y-2">
      <SectionEyebrow>{title}</SectionEyebrow>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <QuickAddChipButton key={`${chip.name}:${chip.foodId ?? 'none'}`} chip={chip} date={date} />
        ))}
      </div>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Copy from yesterday (item 5) — whole day or a single meal, any day
////////////////////////////////////////////////////////////////////////////////

/**
 * One copy affordance: the whole previous day (`mealType` omitted) or a
 * single meal group (`mealType` set — `NO_MEAL_VALUE` for the "no meal"
 * bucket). Own fetcher per chip, same mutate-with-Undo convention as the
 * quick-add chips above.
 */
function CopyFromYesterdayChip({
  date,
  mealType,
  label,
}: {
  date: string;
  mealType: LocalFoodLog['mealType'] | undefined;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const copyFetcher = useFetcher<typeof clientAction>();
  const undoFetcher = useFetcher<typeof clientAction>();
  const shownRef = useRef<Set<string>>(new Set());
  const isCopying = copyFetcher.state !== 'idle';

  useEffect(() => {
    const data = copyFetcher.data;
    if (!data || !('intent' in data) || data.intent !== 'copy-yesterday') return;
    if (data.copiedBatchId === null || data.copiedCount === 0) return;
    if (shownRef.current.has(data.copiedBatchId)) return;
    shownRef.current.add(data.copiedBatchId);
    const batchId = data.copiedBatchId;
    showFoodAddedToast({
      name: data.firstName,
      count: data.copiedCount,
      verb: 'copied',
      mealLabel: null,
      netCarbsTotal: data.netCarbsTotal,
      hasEstimates: data.hasEstimates,
      dayLabel: data.dayLabel,
      t,
      language: i18n.language,
      action: {
        label: t('diary.actions.undo'),
        onClick: () => undoFetcher.submit({ _intent: 'copy-undo', batchId }, { method: 'post' }),
      },
    });
  }, [copyFetcher.data, undoFetcher, t, i18n.language]);

  return (
    <copyFetcher.Form method="post">
      <input type="hidden" name="_intent" value="copy-yesterday" />
      <input type="hidden" name="date" value={date} />
      {mealType !== undefined && <input type="hidden" name="mealType" value={mealType ?? NO_MEAL_VALUE} />}
      <button
        type="submit"
        disabled={isCopying}
        /* Same treatment as the quick-add chip above — the label already swaps
           to "Copying…", the pulse is what keeps it from looking stuck. */
        className={cn(
          'inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:opacity-60',
          isCopying && 'pulse-soft',
        )}
      >
        <Copy className="h-3.5 w-3.5" />
        {isCopying ? t('diary.copy.copying') : label}
      </button>
    </copyFetcher.Form>
  );
}

/**
 * "Copy from yesterday" section: a whole-day chip (only shown when yesterday
 * spans more than one meal — a single-meal day would just duplicate the one
 * per-meal chip below) plus one chip per populated meal group. Rendered
 * whenever yesterday has anything to copy, regardless of whether the viewed
 * day is empty (item 5).
 */
function CopyFromYesterday({
  date,
  timezone,
  copyableMeals,
  copyableEntries,
}: {
  date: string;
  timezone: string;
  copyableMeals: CopyableMeal[];
  copyableEntries: LocalFoodLog[];
}) {
  const { t } = useTranslation();
  const [isPicking, setIsPicking] = useState(false);
  const totalCount = copyableMeals.reduce((sum, group) => sum + group.count, 0);
  return (
    <div className="space-y-2">
      <SectionEyebrow>{t('diary.copy.title')}</SectionEyebrow>
      <div className="flex flex-wrap gap-2">
        {copyableMeals.length > 1 && (
          <CopyFromYesterdayChip date={date} mealType={undefined} label={t('diary.copy.all', { total: totalCount })} />
        )}
        {copyableMeals.map((group) => (
          <CopyFromYesterdayChip
            key={group.mealType ?? NO_MEAL_VALUE}
            date={date}
            mealType={group.mealType}
            label={t('diary.copy.meal', { meal: mealGroupLabel(group.mealType, t), n: group.count })}
          />
        ))}
        {/* Item 3 (M123/07): the whole-day and per-meal chips above stay
            all-or-nothing WITHIN their own scope — copying "lunch" still means
            every lunch entry. This toggle is the escape hatch for someone who
            wants a handful of specific entries, possibly spanning more than
            one meal, without either re-logging from scratch or copying
            everything and deleting the rest. */}
        {!isPicking && (
          <button
            type="button"
            onClick={() => setIsPicking(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
          >
            {t('diary.copy.chooseEntries')}
          </button>
        )}
      </div>
      {isPicking && (
        <CopyEntryPicker date={date} timezone={timezone} entries={copyableEntries} onClose={() => setIsPicking(false)} />
      )}
    </div>
  );
}

/**
 * The per-entry copy picker (item 3, M123/07): a checkbox list of yesterday's
 * entries, grouped by meal via the same `groupLogsByMeal` the day view uses,
 * so its sections read identically to the list the person is already used to.
 * Selection is local UI state — nothing is copied until "Copy selected" is
 * pressed, which posts every checked id as a repeated `entryIds` field (the
 * schema reads them via `formData.getAll`, same as any other Conform array
 * field).
 */
function CopyEntryPicker({
  date,
  timezone,
  entries,
  onClose,
}: {
  date: string;
  timezone: string;
  entries: LocalFoodLog[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const copyFetcher = useFetcher<typeof clientAction>();
  const undoFetcher = useFetcher<typeof clientAction>();
  const shownRef = useRef<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isCopying = copyFetcher.state !== 'idle';
  const groups = groupLogsByMeal(entries);

  useEffect(() => {
    const data = copyFetcher.data;
    if (!data || !('intent' in data) || data.intent !== 'copy-yesterday') return;
    if (data.copiedBatchId === null || data.copiedCount === 0) return;
    if (shownRef.current.has(data.copiedBatchId)) return;
    shownRef.current.add(data.copiedBatchId);
    const batchId = data.copiedBatchId;
    showFoodAddedToast({
      name: data.firstName,
      count: data.copiedCount,
      verb: 'copied',
      mealLabel: null,
      netCarbsTotal: data.netCarbsTotal,
      hasEstimates: data.hasEstimates,
      dayLabel: data.dayLabel,
      t,
      language: i18n.language,
      action: {
        label: t('diary.actions.undo'),
        onClick: () => undoFetcher.submit({ _intent: 'copy-undo', batchId }, { method: 'post' }),
      },
    });
    onClose();
  }, [copyFetcher.data, undoFetcher, t, i18n.language, onClose]);

  function toggle(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.set('_intent', 'copy-yesterday');
    formData.set('date', date);
    for (const id of selectedIds) formData.append('entryIds', id);
    copyFetcher.submit(formData, { method: 'post' });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.mealType ?? NO_MEAL_VALUE} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{mealGroupLabel(group.mealType, t)}</p>
                {group.logs.map((log) => (
                  <label
                    key={log.id}
                    className="-m-1 flex cursor-pointer items-center justify-between gap-3 rounded-md p-1 transition-colors hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(log.id)}
                        onChange={() => toggle(log.id)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="truncate text-sm">{log.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatEntryTime(log.loggedAt, timezone, i18n.language)}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t('diary.copy.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={selectedIds.size === 0 || isCopying}>
              {isCopying ?
                t('diary.copy.copying')
              : t('diary.copy.copySelected', { count: selectedIds.size })}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Empty states + add affordances
////////////////////////////////////////////////////////////////////////////////

/**
 * First-ever empty state: zero food logs on this device — which is either a
 * brand-new user (the common case: search is the zero-setup path) OR a
 * device with nothing on it yet because its data lives elsewhere (a fresh
 * install, a second device before spec 06's sync, a cleared browser). This
 * screen never assumes the first case silently (M117/08 item 2, counsel End
 * User review): it names the alternative plainly and links both ways out, so
 * a blank diary never reads as a bug.
 */
function FirstEverEmpty({ addTo, scanTo }: { addTo: string; scanTo: string }) {
  const { t } = useTranslation();
  const syncServerUrl = useSyncServerUrl();
  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t('diary.empty.firstEver.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('diary.empty.firstEver.subtitle')}</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button asChild className="h-11 w-full sm:w-auto sm:min-w-52">
            <Link to={addTo}>
              <Plus className="h-4 w-4" /> {t('diary.empty.firstEver.cta')}
            </Link>
          </Button>
          <Link
            to={scanTo}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('diary.empty.firstEver.scanLink')}
          </Link>
        </div>
        {/*
          `Trans` rather than three sentence fragments glued around two links:
          German puts "auf diesem Gerät" and the verb somewhere English doesn't,
          and a split-key version would pin an English word order onto every
          translation. The two links are named slots the catalog string moves
          freely.

          TWO KEYS, not one with a hidden slot: on an instance without
          `SYNC_SERVER_URL` there is no sync to enable, and offering it here
          would send someone to a 404. Blanking the slot inside the shared
          sentence would leave a dangling "or" in both languages, so the
          sync-free instance gets its own, complete sentence.
        */}
        <p className="border-t pt-4 text-xs text-muted-foreground">
          <Trans
            i18nKey={syncServerUrl === null ? 'diary.empty.firstEver.noDataBackupOnly' : 'diary.empty.firstEver.noData'}
            components={{
              backup: (
                <Link to="/settings/data#import-backup" className="underline underline-offset-2 hover:text-foreground" />
              ),
              sync: <Link to="/settings/sync" className="underline underline-offset-2 hover:text-foreground" />,
            }}
          />
        </p>
      </CardContent>
    </Card>
  );
}

/** Returning-after-a-gap empty state: a warm fresh start, no backfill prompts, no guilt. */
function WelcomeBackEmpty({ addTo }: { addTo: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t('diary.empty.welcomeBack.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('diary.empty.welcomeBack.subtitle')}</p>
        </div>
        <div className="flex justify-center">
          <Button asChild className="h-11 w-full sm:w-auto sm:min-w-52">
            <Link to={addTo}>
              <Plus className="h-4 w-4" /> {t('diary.actions.addFood')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Ordinary empty day: neutral copy plus the add affordances. Copy-from-yesterday now renders as its own always-available section (item 5), not nested in here. */
function OrdinaryEmpty({ addTo, scanTo }: { addTo: string; scanTo: string }) {
  const { t } = useTranslation();
  return (
    // The empty day is the one screen with nothing to look at, so it carries
    // the brand mark at a size and opacity where it actually READS (the first
    // pass drew it at `/20`, which — as a filled blob — was an illegible
    // smudge). Dashed brand border + soft wash mark it as a placeholder
    // surface rather than a card that failed to load.
    <Card className="surface-brand-soft border-dashed border-primary/30">
      <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
        <PlateGlyph className="h-16 w-16 text-primary/60" />
        <p className="text-sm text-muted-foreground">{t('diary.empty.ordinary.line')}</p>
        <div className="flex w-full flex-col items-center gap-2">
          <Button asChild className="h-11 w-full sm:w-auto sm:min-w-52">
            <Link to={addTo}>
              <Plus className="h-4 w-4" /> {t('diary.actions.addFood')}
            </Link>
          </Button>
          <Link
            to={scanTo}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('diary.empty.ordinary.scanLink')}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Route
////////////////////////////////////////////////////////////////////////////////

/**
 * The diary's swipe-between-days gesture (M129/04) — a BONUS affordance layered
 * over the chevrons and the date picker, which remain the visible, discoverable
 * controls. It navigates to exactly the same URLs `DateNav` does (via
 * `diaryHrefForDate`), and honours the same upper bound: swiping forward on
 * today does nothing, because there is no tomorrow to log.
 *
 * All the intent logic is elsewhere and testable — thresholds in
 * `#app/lib/swipe-day-navigation`, eligibility guards in `#app/hooks/use-day-swipe`.
 * This hook only maps a resolved direction onto a day.
 *
 * @param date - the currently viewed day (`YYYY-MM-DD`).
 * @param today - the user's local today; the forward limit.
 * @returns touch props to spread onto the diary's root element.
 */
function useDiaryDaySwipe({ date, today }: { date: string; today: string }) {
  const navigate = useNavigate();
  return useDaySwipe((direction) => {
    if (direction === 'next' && date >= today) return;
    const target = shiftDate(date, direction === 'next' ? 1 : -1);
    navigate(diaryHrefForDate(target, today));
  });
}

export default function Diary({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  useLiveDiaryRevalidation();
  const {
    date,
    today,
    isToday,
    timezone,
    logs,
    mealGroups,
    summary,
    goals,
    habitStrip,
    loggedDaysCount,
    frequentChips,
    favoriteChips,
    hasAnyLogs,
    daysSinceLastLog,
    canCopyYesterday,
    copyableMeals,
    copyableEntries,
    daysSinceExportBackup,
    daysSinceFirstDataLocal,
    hasLocalData,
    totalLogCount,
    aiEstimatedLogCount,
  } = loaderData;
  const justAddedLogId = useJustAddedLogId(logs);
  // One-time celebrations for genuine firsts only — see `#app/lib/celebration`
  // for what qualifies as a first and why each one can only ever fire once.
  // The weight facts are the neutral values, not a claim: the diary doesn't
  // read weigh-ins, and `target-weight` is resolved on /trends, which does.
  const celebration = useCelebration({
    totalLogCount,
    aiEstimatedLogCount,
    loggedDaysInWindow: loggedDaysCount,
    windowDays: habitStrip.length,
    weighInCount: 0,
    crossedTargetOnLatest: false,
  });
  const hasLogs = logs.length > 0;
  // Carry the viewed day into the add/scan flows only when it isn't today, so a
  // back-dated log returns to the day the user is looking at (not "today").
  const addTo = isToday ? '/add' : `/add?date=${date}`;
  const scanTo = isToday ? '/scan' : `/scan?date=${date}`;
  const emptyState: DiaryEmptyState = resolveDiaryEmptyState({
    hasAnyLogs,
    isToday,
    daysSinceLastLog,
    gapThresholdDays: GAP_THRESHOLD_DAYS,
  });

  // Both chip rows are surfaced on every day AND on the "returning-after-gap"
  // empty state (item 2) — that state used to suppress them on the theory
  // that a fresh-start screen should stay calm, but "the person hasn't logged
  // in a few days" is exactly when a one-tap re-log of what they usually eat
  // is the most useful shortcut in the app, not a state that should hide it.
  const showFavoriteChips = favoriteChips.length > 0;
  const showFrequentChips = frequentChips.length > 0;
  const swipeHandlers = useDiaryDaySwipe({ date, today });

  return (
    <div className="mx-auto max-w-2xl space-y-6" {...swipeHandlers}>
      <BackupNudgeBanner
        daysSinceExport={daysSinceExportBackup}
        daysSinceFirstData={daysSinceFirstDataLocal}
        hasData={hasLocalData}
      />
      <DateNav date={date} today={today} />
      <HabitStrip days={habitStrip} loggedCount={loggedDaysCount} hasCeiling={goals.netCarbsCeiling !== null} />

      {hasLogs && (
        <DaySummaryCard
          summary={summary}
          goals={goals}
          addBase={addTo}
          date={date}
          celebrating={celebration !== null}
        />
      )}

      {showFavoriteChips && <QuickAddChips title={t('diary.chips.favorites')} chips={favoriteChips} date={date} />}
      {showFrequentChips && <QuickAddChips title={t('diary.chips.quickAdd')} chips={frequentChips} date={date} />}

      {canCopyYesterday && (
        <CopyFromYesterday
          date={date}
          timezone={timezone}
          copyableMeals={copyableMeals}
          copyableEntries={copyableEntries}
        />
      )}

      {hasLogs && (
        <div className="space-y-5">
          {mealGroups.map((group) => (
            <MealGroupSection
              key={group.mealType ?? NO_MEAL_VALUE}
              group={group}
              justAddedLogId={justAddedLogId}
              timezone={timezone}
            />
          ))}
        </div>
      )}

      {!hasLogs && emptyState === 'first-ever' && <FirstEverEmpty addTo={addTo} scanTo={scanTo} />}
      {!hasLogs && emptyState === 'returning-after-gap' && <WelcomeBackEmpty addTo={addTo} />}
      {!hasLogs && emptyState === 'ordinary' && <OrdinaryEmpty addTo={addTo} scanTo={scanTo} />}

      {hasLogs && <AddFoodActions addTo={addTo} scanTo={scanTo} />}
    </div>
  );
}
