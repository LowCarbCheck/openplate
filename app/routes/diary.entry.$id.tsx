import { useState } from 'react';
import type { Route } from './+types/diary.entry.$id';
import { Form, redirect, useNavigation, useSearchParams, useSubmit } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
// The singleton, not the hook: `clientAction` and the handlers it calls run
// outside React. Both are client-only paths (this route's health data lives in
// the on-device store), so the singleton is always this browser's own
// instance, never one shared between server requests. Importing it here also
// initializes the shared instance before the components below render under a
// bare `renderToStaticMarkup`, which is how this route's render tests drive
// them.
import i18nSingleton from '#app/i18n/i18n';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { formatClockTime } from '#app/lib/format-clock-time';
import { toast } from 'sonner';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import type { SubmissionResult } from '@conform-to/react';
import { dayBoundsInTimezone, todayInTimezone } from '#app/lib/user-days';
import { diaryHrefForDate } from '#app/lib/diary-href';
import { randomUuid } from '#app/lib/uuid';
import type { Macros } from '#app/lib/macros';
import { reconstructPer100g } from '#app/lib/per-hundred';
import { computeEditPatch, macrosDiffer, resolveEditedNetCarbsPer100g } from '#app/lib/log-edit';
import { encodeAuthoritativeNetCarbs } from '#app/lib/authoritative-net-carbs';
import { encodeMicronutrients } from '#app/lib/micronutrients';
import { parseNumericFieldValue } from '#app/lib/conform-field-value';
import {
  PORTION_SCALE_OPTIONS,
  computeMacroPreview,
  derivePortionMultiplier,
  roundToTenth,
  scalePortionGrams,
  type MacroPreview,
} from '#app/lib/portion-preview';
import { encodeDisplayPortion, formatPortionLabel } from '#app/lib/portions';
import type { DisplayPortion } from '#app/lib/portions';
import { formatMacroNumber, formatMacroNumberIn } from '#app/lib/format-macro-number';
import { createOptionalNonNegativeNumberSchema } from '#app/lib/zod-numeric';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import type { Toast } from '#app/utils/toast.server';
import { deletePlatePhoto } from '#app/lib/local-store/photos';
import { usePlatePhoto } from '#app/hooks/use-plate-photo';
import { cn } from '#app/lib/utils';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { useFetcherWithToast } from '#app/hooks/use-toast';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Badge } from '#app/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select';
import { ChevronDown, ChevronRight, Minus, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';
import {
  ANONYMOUS_USER_ID,
  deleteLocalFoodLog,
  getLocalFood,
  getLocalFoodLog,
  getLocalProfileGoals,
  listLocalFoodLogs,
  putLocalFoodLog,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalFoodLog, LocalPersonalFood } from '#app/lib/local-store';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.entry') }];

export const handle = {
  title: 'Entry',
  titleKey: 'entry.title',
  backTo: '/diary',
};

/**
 * The narrow slice of i18next's `t` this route's pure helpers depend on —
 * passed in explicitly so each stays callable from a test with a stub
 * translator rather than carrying a hidden global dependency.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** `t` for the non-React paths (`clientAction` and the handlers it calls). */
const translate: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Same sentinel the diary quick-add uses: Radix `<Select>` forbids an empty value. */
const NO_MEAL_VALUE = 'none';

/** Grams the +/- stepper adds or removes per press. */
const GRAMS_STEP = 5;

/** Matches a bare `YYYY-MM-DD` calendar date — the edit form's `date` field (item 4). */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Matches a 24h `HH:mm` wall-clock time — the edit form's `time` field (item 4). */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** All-unknown macro basis, used when an entry has no reconstructable per-100g basis. */
const EMPTY_MACROS: Macros = {
  carbs: null,
  fiber: null,
  sugars: null,
  polyols: null,
  protein: null,
  fat: null,
  kcal: null,
};

/**
 * The 7 per-100g macro fields, in the order they render in the fine-tune
 * section. Plain words a first-time visitor already knows — never the bare
 * macro key: "kcal" reads as jargon on its own, so it's "Calories"; "polyols"
 * is a term almost nobody outside nutrition science has heard, so it's
 * "Sugar alcohols" with the technical term kept alongside in parentheses for
 * anyone cross-referencing a nutrition label that uses it. Matches the
 * wording in `app/routes/add.tsx`'s own macro labels. Catalog keys rather
 * than literals since M129/05 — the copy itself now lives in the locale
 * files. Exported for direct testability.
 */
export const MACRO_FIELD_KEYS = [
  ['carbs', 'entry.macro.carbs'],
  ['fiber', 'entry.macro.fiber'],
  ['sugars', 'entry.macro.sugars'],
  ['polyols', 'entry.macro.polyols'],
  ['protein', 'entry.macro.protein'],
  ['fat', 'entry.macro.fat'],
  ['kcal', 'entry.macro.kcal'],
] as const;

/**
 * Human labels for the meal-type enum — same convention (and same defect fix)
 * as `app/routes/add.tsx`'s `MEAL_TYPE_LABELS`: Radix `<SelectValue>` mirrors
 * the selected `<SelectItem>`'s own text content, not a CSS `capitalize`
 * class applied to it, so relying on `className="capitalize"` around the raw
 * lowercase enum value capitalizes the dropdown row but leaves the trigger
 * showing the raw "snack". Duplicated here (not imported from `add.tsx`)
 * rather than reaching across route-owned files — same precedent as this
 * route's own duplicated favorites-storage block. Exported for direct
 * testability.
 */
export const MEAL_TYPE_LABEL_KEYS = {
  breakfast: 'entry.meal.breakfast',
  lunch: 'entry.meal.lunch',
  dinner: 'entry.meal.dinner',
  snack: 'entry.meal.snack',
} satisfies Record<(typeof MEAL_TYPES)[number], string>;

/**
 * Catalog keys for the shared `PORTION_SCALE_OPTIONS` chip labels, keyed by
 * multiplier. The option table itself stays literal-English: it is shared with
 * the scan and add flows, which own their own call sites. An option with no
 * key here falls back to that shared label rather than rendering a raw key.
 */
const PORTION_SCALE_LABEL_KEYS = new Map<string, string>([
  ['0.5', 'entry.portionScale.smaller'],
  ['1', 'entry.portionScale.asShown'],
  ['1.5', 'entry.portionScale.bigger'],
  ['2', 'entry.portionScale.double'],
]);

function portionScaleLabel({
  option,
  t,
}: {
  option: (typeof PORTION_SCALE_OPTIONS)[number];
  t: Translate;
}): string {
  const key = PORTION_SCALE_LABEL_KEYS.get(String(option.multiplier));
  return key ? t(key) : option.label;
}

/** Built per-call: every message below is user-facing copy, so the schema needs a translator. */
function createEditEntrySchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t('entry.errors.nameRequired')),
    quantityGrams: z.coerce.number().positive(t('entry.errors.gramsPositive')),
    mealType: z.preprocess((value) => (value === '' ? undefined : value), z.enum(MEAL_TYPES).optional()),
    // Item 4: an entry's date and time can now be changed after saving. `date`'s
    // "not in the future" invariant needs the resolved time zone, so it's
    // enforced in `handleSave`, not here (regex-only at the schema level).
    date: z.string().regex(DATE_PATTERN, t('entry.errors.invalidDate')),
    time: z.string().regex(TIME_PATTERN, t('entry.errors.invalidTime')),
    // All per-100g macros optional here — an edit may leave a value unknown
    // (blank → null), never fabricating 0. Carbs isn't forced: the receipt just
    // shows "Macros unknown" when it's absent.
    carbs: createOptionalNonNegativeNumberSchema(),
    fiber: createOptionalNonNegativeNumberSchema(),
    sugars: createOptionalNonNegativeNumberSchema(),
    polyols: createOptionalNonNegativeNumberSchema(),
    protein: createOptionalNonNegativeNumberSchema(),
    fat: createOptionalNonNegativeNumberSchema(),
    kcal: createOptionalNonNegativeNumberSchema(),
  });
}

////////////////////////////////////////////////////////////////////////////////
// Per-100g basis (shared by clientLoader + save action)
////////////////////////////////////////////////////////////////////////////////

/**
 * The per-100g macro basis for a log entry. The linked personal food is
 * authoritative, but only while the entry still carries its curated/AI
 * provenance — once a user hand-verifies the numbers (provenance cleared) the
 * entry owns its own snapshot, so the basis reconstructs from that snapshot
 * (keeping the receipt hero consistent with the edited values). Returns null
 * when there is no honest basis (no linked food and non-positive grams).
 */
function derivePer100gBasis(log: LocalFoodLog, food: LocalPersonalFood | null): Macros | null {
  const provenanceIntact = log.curatedSource !== null || log.aiEstimated;
  const foodMacros = food !== null && provenanceIntact ? food.macrosPer100g : null;
  if (foodMacros !== null) return foodMacros;
  return reconstructPer100g(log.macros, log.quantityGrams);
}

////////////////////////////////////////////////////////////////////////////////
// Date/time editing (item 4)
////////////////////////////////////////////////////////////////////////////////

/**
 * Combines a `YYYY-MM-DD` date and `HH:mm` 24h time into the UTC instant that
 * wall clock represents in `timezone`, by adding the parsed minutes-since-
 * midnight onto that date's local-midnight instant (`dayBoundsInTimezone`'s
 * `start`). Mirrors the "offset from local midnight" approach `user-days.ts`'s
 * own `instantOnDate` and `copy-day.ts`'s `remapInstantToTargetDay` already
 * use elsewhere in this app — an accepted simplification across a same-day
 * DST transition.
 *
 * @param date - the calendar date as `YYYY-MM-DD`.
 * @param time - the wall-clock time as 24h `HH:mm`.
 * @param timezone - IANA time-zone name.
 * @returns the combined instant, epoch ms.
 * @throws if `time` is not a valid `HH:mm`, or `date`/`timezone` are invalid (via `dayBoundsInTimezone`).
 */
export function combineDateAndTime({
  date,
  time,
  timezone,
}: {
  date: string;
  time: string;
  timezone: string;
}): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`Invalid time (expected HH:mm): ${time}`);
  const minutesSinceMidnight = Number(match[1]) * 60 + Number(match[2]);
  const dayStartMs = dayBoundsInTimezone(date, timezone).start.getTime();
  return dayStartMs + minutesSinceMidnight * 60_000;
}

/**
 * Formats an instant as a 24h `HH:mm` string in `timezone` — the exact shape
 * the edit form's `time` field (and `TIME_PATTERN`) expect. Built from
 * `formatToParts` rather than a locale string so the output is byte-exact
 * regardless of runtime locale quirks.
 *
 * @param instant - the instant to format.
 * @param timezone - IANA time-zone name.
 * @returns the `HH:mm` string.
 */
export function formatTimeInputValue(instant: Date, timezone: string): string {
  // Locale fixed on purpose: the parts are read back to build an
  // `<input type="time">` VALUE, which the HTML spec defines as `HH:mm` in
  // every language. It is not display text and must not follow the UI
  // language. Do NOT "translate" this.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

////////////////////////////////////////////////////////////////////////////////
// Portion invalidation on a grams edit (item 7 — keeps "2 eggs" honest)
////////////////////////////////////////////////////////////////////////////////

/**
 * Household-portion labels ("2 eggs") are a snapshot valid only at the grams
 * they were resolved for. This edit form's grams control is still the flat
 * scale-multiplier chips/stepper (`PORTION_SCALE_OPTIONS`) — it has no concept
 * of named units — so ANY grams change here invalidates a stored portion
 * label; falling back to a plain gram display keeps the receipt honest rather
 * than showing a stale "2 eggs" next to a since-edited weight. An unchanged
 * grams value (a macro/name/meal/time-only edit) keeps the portion exactly as
 * it was.
 *
 * @param options.existingPortion - the entry's portion before this save.
 * @param options.previousGrams - the entry's grams before this save.
 * @param options.newGrams - the grams submitted by this save.
 * @returns the portion to persist.
 */
export function resolveEditedPortion({
  existingPortion,
  previousGrams,
  newGrams,
}: {
  existingPortion: DisplayPortion | null;
  previousGrams: number;
  newGrams: number;
}): DisplayPortion | null {
  if (!existingPortion) return null;
  return roundToTenth(newGrams) === roundToTenth(previousGrams) ? existingPortion : null;
}

////////////////////////////////////////////////////////////////////////////////
// Favorites (explicit, device-local via localStorage — item 6)
////////////////////////////////////////////////////////////////////////////////

/**
 * Same localStorage key + toggle logic as `diary.tsx`'s identical block (that
 * copy is the unit-tested canonical one) — duplicated here because the
 * favorite TOGGLE lives on this route (the entry receipt), while the
 * favorite CHIPS live on the diary route. Small, deliberate duplication
 * rather than reaching across route-owned files — same precedent as the
 * net-carbs formula's independent duplication across
 * `portion-preview.ts`/`frequent-chips.ts`/`export-format.ts`.
 */
const FAVORITE_FOODS_STORAGE_KEY = 'openplate:favoriteFoods';

function normalizeFoodNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function parseFavoriteNames(raw: string | null): Set<string> {
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

function serializeFavoriteNames(names: ReadonlySet<string>): string {
  return JSON.stringify(Array.from(names));
}

function toggleFavoriteName(names: ReadonlySet<string>, name: string): Set<string> {
  const key = normalizeFoodNameKey(name);
  const next = new Set(names);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function readFavoriteNames(): Set<string> {
  if (globalThis.localStorage === undefined) return new Set();
  return parseFavoriteNames(localStorage.getItem(FAVORITE_FOODS_STORAGE_KEY));
}

function writeFavoriteNames(names: ReadonlySet<string>): void {
  if (globalThis.localStorage === undefined) return;
  localStorage.setItem(FAVORITE_FOODS_STORAGE_KEY, serializeFavoriteNames(names));
}

/** Explicit favorite toggle (item 6) — a star button on the receipt that flips `log.name`'s favorite membership. Local UI preference only: no store write, no action round-trip. */
function FavoriteToggle({ name }: { name: string }) {
  const { t } = useTranslation();
  const [isFavorite, setIsFavorite] = useState<boolean>(() => readFavoriteNames().has(normalizeFoodNameKey(name)));

  return (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={isFavorite ? t('entry.favorite.remove', { name }) : t('entry.favorite.add', { name })}
      onClick={() => {
        const next = toggleFavoriteName(readFavoriteNames(), name);
        writeFavoriteNames(next);
        setIsFavorite(next.has(normalizeFoodNameKey(name)));
      }}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors',
        isFavorite ?
          'border-primary bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      <Star className={cn('h-4 w-4', isFavorite && 'fill-current')} />
    </button>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Client loader — this route has NO server loader (M128 spec 03: its only
// server-side input was the signed-in user's id, and there are no accounts).
// `userId` still travels down to scope the device-local photo cache (see
// `usePlatePhoto`'s doc comment), but that owner is now always the
// `ANONYMOUS_USER_ID` sentinel.
////////////////////////////////////////////////////////////////////////////////

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const id = params.id;
  if (!id) throw new Response(null, { status: 404 });

  const log = await getLocalFoodLog(id);
  if (!log) throw new Response(null, { status: 404 });

  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);

  const food = log.foodId !== null ? await getLocalFood(log.foodId) : null;

  // "Logged together": the rest of the scan-confirm batch this entry belongs to.
  const allLogs = await listLocalFoodLogs();
  const siblings =
    log.logBatchId !== null ? allLogs.filter((sibling) => sibling.logBatchId === log.logBatchId && sibling.id !== log.id) : [];

  const basisPer100g = derivePer100gBasis(log, food);

  // Format the timestamp in the user's own time zone on the client, so the
  // receipt is consistent with every other local-first read — and in the
  // active UI language, so a German receipt doesn't read "Mon, Jul 20, 8:32 AM".
  // Reading the language off the i18next singleton is safe here for the same reason
  // it is in `clientAction`: this loader only ever runs in the browser, where
  // there is one document and one language (the server gets a per-request clone).
  const loggedAtDate = new Intl.DateTimeFormat(dateLabelLocale(i18nSingleton.language), {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(log.loggedAt);
  const loggedAtTime = formatClockTime(log.loggedAt, { timezone, language: i18nSingleton.language });

  // Raw values for the edit form's date/time inputs (item 4) — distinct from
  // `loggedAtDate`/`loggedAtTime` above, which are human display strings, not
  // `<input type="date"/"time">`-compatible values.
  const loggedAtDateValue = todayInTimezone(timezone, new Date(log.loggedAt));
  const loggedAtTimeValue = formatTimeInputValue(new Date(log.loggedAt), timezone);
  const todayValue = todayInTimezone(timezone);

  // Every exit from this page (Back link, Delete, Undo-restore) returns to the
  // entry's OWN calendar day, not always "today" — bare `/diary` when that day
  // is today (clean URL, matches the add/scan convention), else `/diary?date=`.
  // `_personal.tsx` reads this `backTo` off the loader data for the Back link.
  const backTo = diaryHrefForDate(todayInTimezone(timezone, new Date(log.loggedAt)), todayInTimezone(timezone));

  return {
    userId: ANONYMOUS_USER_ID,
    log,
    siblings,
    grams: log.quantityGrams,
    snapshotMacros: log.macros,
    basisPer100g,
    loggedAtDate,
    loggedAtTime,
    loggedAtDateValue,
    loggedAtTimeValue,
    todayValue,
    backTo,
  };
}
clientLoader.hydrate = true as const;

/**
 * Shown while the client loader reads the entry from the on-device primary
 * store (M117/03) — this route is now clientLoader-only for health data.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('entry.loading')}
    </output>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Action handlers (local-store writes — no server round-trip)
////////////////////////////////////////////////////////////////////////////////

async function handleDelete(id: string, timezone: string): Promise<Response> {
  const existing = await getLocalFoodLog(id);
  await deleteLocalFoodLog(id);
  // The client fires an optimistic sonner "Undo" toast (see the receipt), so
  // this just returns the user to their diary — no server-flashed toast.
  // Returns to the entry's own day (falling back to a bare `/diary` if the
  // log was already gone, e.g. a stale tab).
  if (!existing) return redirect('/diary');
  return redirect(diaryHrefForDate(todayInTimezone(timezone, new Date(existing.loggedAt)), todayInTimezone(timezone)));
}

async function handleLogAgain(id: string) {
  const existing = await getLocalFoodLog(id);
  if (!existing) throw new Response(null, { status: 404 });
  const now = Date.now();
  await putLocalFoodLog({
    ...existing,
    id: randomUuid(),
    loggedAt: now,
    createdAt: now,
    // Standalone entry — never inherits the original's batch grouping.
    logBatchId: null,
  });
  return {
    id: randomUuid(),
    title: undefined,
    description: translate('entry.toast.loggedAgain', { name: existing.name }),
    type: 'success' as const,
  };
}

async function handleSave(formData: FormData, id: string, timezone: string) {
  const submission = parseWithZod(formData, { schema: createEditEntrySchema(translate) });
  if (submission.status !== 'success') return submission.reply();

  const value = submission.value;

  // Item 4/3 parity: an entry can be backdated but never moved into the
  // future — the same invariant the diary route itself enforces on `?date=`.
  if (value.date > todayInTimezone(timezone)) {
    return submission.reply({ fieldErrors: { date: [translate('entry.errors.dateInFuture')] } });
  }

  const existing = await getLocalFoodLog(id);
  if (!existing) throw new Response(null, { status: 404 });

  const food = existing.foodId !== null ? await getLocalFood(existing.foodId) : null;
  const originalBasis = derivePer100gBasis(existing, food);

  const editedPer100g: Macros = {
    carbs: value.carbs ?? null,
    fiber: value.fiber ?? null,
    sugars: value.sugars ?? null,
    polyols: value.polyols ?? null,
    protein: value.protein ?? null,
    fat: value.fat ?? null,
    kcal: value.kcal ?? null,
  };

  // The fine-tune fields are forceMounted (always in the DOM, see the edit
  // form below), so `editedPer100g` always carries the full submitted basis —
  // a portion-only save (chips/stepper, fine-tune untouched) resubmits the same
  // prefilled values here, not blanks. `computeEditPatch` is the single pure
  // decision: it rescales the snapshot from the (possibly edited) basis at the
  // (possibly re-portioned) grams, and only clears provenance when the basis
  // actually changed.
  const { provenance, snapshot, netCarbsPer100g } = computeEditPatch({
    grams: value.quantityGrams,
    editedPer100g,
    originalBasis: originalBasis ?? EMPTY_MACROS,
    currentProvenance: { aiEstimated: existing.aiEstimated, curatedSource: existing.curatedSource },
    currentNetCarbsPer100g: existing.netCarbsPer100g,
  });

  const loggedAt = combineDateAndTime({ date: value.date, time: value.time, timezone });
  const portion = resolveEditedPortion({
    existingPortion: existing.portion ?? null,
    previousGrams: existing.quantityGrams,
    newGrams: value.quantityGrams,
  });

  await putLocalFoodLog({
    ...existing,
    name: value.name,
    quantityGrams: value.quantityGrams,
    macros: snapshot,
    mealType: value.mealType ?? null,
    aiEstimated: provenance.aiEstimated,
    curatedSource: provenance.curatedSource,
    loggedAt,
    dayKey: value.date,
    portion,
    // Preserved across a portion-only edit (the figure is per-100 g, so it
    // stays valid) and cleared by a real macro edit (the user is now the
    // source) — decided by `resolveEditedNetCarbsPer100g`, alongside the
    // provenance rule it mirrors. `undefined` drops the key on write.
    netCarbsPer100g,
  });

  return redirectWithLocalToast(`/diary/entry/${id}`, {
    type: 'success',
    description: translate('entry.toast.updated'),
  });
}

export async function clientAction({ request, params }: Route.ClientActionArgs) {
  const id = params.id;
  if (!id) throw new Response(null, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get('_intent');

  if (intent === 'delete') {
    const profile = await getLocalProfileGoals();
    return handleDelete(id, resolveLocalTimezone(profile));
  }
  if (intent === 'log-again') return handleLogAgain(id);
  if (intent === 'save') {
    const profile = await getLocalProfileGoals();
    return handleSave(formData, id, resolveLocalTimezone(profile));
  }

  // A `restore` intent (the receipt's own Undo-toast, see `EntryReceipt`'s
  // `handleUndo`) is deliberately submitted to `backTo` — the DIARY route, not
  // this one — via `useSubmit`'s `action` option, so `diary.tsx`'s own
  // `clientAction` handles it; it never reaches here.
  throw new Response('Invalid intent', { status: 400 });
}

////////////////////////////////////////////////////////////////////////////////
// Shared display helpers
////////////////////////////////////////////////////////////////////////////////

/** Per-serving macro value for the facts list: unknown (null) renders an em dash, never 0. */
function formatFact(value: number | null, language: string): string {
  return value === null ? '—' : formatMacroNumberIn(language, value);
}

/** Muted per-portion protein/fat/kcal line for the edit preview; unknown fields are skipped. */
function formatPreviewMuted({ preview, t, language }: { preview: MacroPreview; t: Translate; language: string }): string {
  const parts: string[] = [];
  if (preview.proteinForPortion !== null) {
    parts.push(t('entry.preview.protein', { value: formatMacroNumberIn(language, preview.proteinForPortion) }));
  }
  if (preview.fatForPortion !== null) {
    parts.push(t('entry.preview.fat', { value: formatMacroNumberIn(language, preview.fatForPortion) }));
  }
  if (preview.kcalForPortion !== null) {
    parts.push(t('entry.preview.calories', { value: formatMacroNumberIn(language, preview.kcalForPortion) }));
  }
  return parts.join(' · ');
}

/**
 * Prefill string for a per-100g field: the basis value at one decimal, or blank
 * when unknown. Deliberately the PINNED formatter — this string is a number
 * input's value and is parsed back with `Number()`, where a German "8,4" is
 * both invalid in the field and `NaN` on the way out.
 */
function basisFieldValue(basis: Macros | null, key: keyof Macros): string {
  const value = basis?.[key];
  return value === null || value === undefined ? '' : formatMacroNumber(value);
}

/** The receipt's "Portion" fact: the chosen household unit ("2 eggs") plus the authoritative grams when one was recorded, otherwise a plain gram figure (item 7). */
function formatPortionFact(log: LocalFoodLog, grams: number, language: string): string {
  if (!log.portion) return `${formatMacroNumberIn(language, grams)} g`;
  const label = formatPortionLabel({ unit: log.portion.unit, quantity: log.portion.quantity });
  return `${label} (${formatMacroNumberIn(language, grams)} g)`;
}

////////////////////////////////////////////////////////////////////////////////
// Receipt (view mode)
////////////////////////////////////////////////////////////////////////////////

/**
 * The source's licence credit line (e.g. "Bundeslebensmittelschlüssel (BLS)
 * 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)"), rendered exactly as
 * snapshotted onto the entry at add time (`log.attribution` — see that
 * field's doc in `schema.ts`). `null`/absent for every entry whose source
 * carries no attribution, and for any entry logged before this field existed
 * — a plain, silent omission, never a placeholder or a broken-looking blank.
 * PREVIOUSLY this credit was assumed "discharged once, at the point of adding
 * a food" — a wrong assumption: nothing persisted it onto the logged entry,
 * so it was actually just gone the moment a person left the add flow. CC BY
 * is a real licence obligation, not a nicety, so it must survive here too.
 * Exported for direct testability (render-only, see `tests/unit/diary-entry-route.test.ts`).
 */
export function AttributionNote({ log }: { log: LocalFoodLog }) {
  if (!log.attribution) return null;
  return <p className="text-xs text-muted-foreground">{log.attribution}</p>;
}

/**
 * Provenance note, in four states. Curated wins a neutral "From our food
 * database" note — no brand name on the receipt (carbs-audit round, item 3;
 * matches the wording the add flow already uses for the same source), plus this
 * entry's own licence credit when one was recorded (see `AttributionNote`).
 * Otherwise AI-estimated, then ADAPTED (see below), else plain manual.
 * Exported for direct testability.
 *
 * The ADAPTED state exists to resolve a contradiction this component used to
 * print on one screen: hand-editing a curated entry's macros clears
 * `curatedSource` (`resolveEditedProvenance` — the numbers are the person's
 * now, so the entry must not keep claiming unmodified curated provenance)
 * while deliberately KEEPING `attribution` (CC BY covers adaptations; the BLS
 * credit literally ends "(adapted)", so dropping it would be the actual licence
 * violation — see `resolveAppliedMatchSnapshot`'s doc). Both rules are right,
 * but together they rendered "Manual entry." directly above a licence credit
 * for a database the entry had just denied coming from. A reader with no
 * technical context cannot reconcile those two lines.
 *
 * The fix is neither rule but the LABEL: an entry with a credit and no
 * provenance claim is not a "Manual entry.", it is an adapted one — the
 * person's own numbers, derived from someone else's data. That state is fully
 * derivable from the fields already stored (a credit, no `curatedSource`, not
 * `aiEstimated`), so it needs no new field, no migration, and no change to
 * either of the two rules that produce it.
 */
export function ProvenanceNote({ log }: { log: LocalFoodLog }) {
  const { t } = useTranslation();
  if (log.curatedSource) {
    return (
      <div className="space-y-1">
        <span className="inline-flex w-fit items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
          {t('entry.provenance.curated.badge')}
        </span>
        <p className="text-xs text-muted-foreground">{t('entry.provenance.curated.note')}</p>
        <AttributionNote log={log} />
      </div>
    );
  }
  if (log.aiEstimated) {
    return (
      <div className="space-y-1">
        <Badge variant="secondary" className="w-fit">
          {t('entry.provenance.ai.badge')}
        </Badge>
        <p className="text-xs text-muted-foreground">{t('entry.provenance.ai.note')}</p>
        <AttributionNote log={log} />
      </div>
    );
  }
  if (log.attribution) {
    return (
      <div className="space-y-1">
        <span className="inline-flex w-fit items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
          {t('entry.provenance.adapted.badge')}
        </span>
        <p className="text-xs text-muted-foreground">{t('entry.provenance.adapted.note')}</p>
        <AttributionNote log={log} />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{t('entry.provenance.manual.note')}</p>
      {/* Unreachable with a credit today (the branch above catches every
          credited entry), and kept anyway: this component's one hard rule is
          that no branch of it may swallow a licence credit, and a future
          reordering shouldn't be able to break that silently. */}
      <AttributionNote log={log} />
    </div>
  );
}

/** Compact "logged together" list linking to each sibling entry's receipt. */
function LoggedTogether({ siblings }: { siblings: LocalFoodLog[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('entry.loggedTogether')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {siblings.map((sibling) => (
          <Link
            key={sibling.id}
            to={`/diary/entry/${sibling.id}`}
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:border-teal-300 hover:bg-muted/50 dark:hover:border-teal-600"
          >
            <span className="min-w-0 truncate text-sm font-medium">{sibling.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
              {formatMacroNumberIn(i18n.language, sibling.quantityGrams)} g
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The Undo-toast payload for a just-deleted entry: every field
 * `diary.tsx`'s `RestoreLogSchema` needs to bring the entry back FAITHFULLY
 * rather than as a stripped copy of itself.
 *
 * Pure and exported (rather than an inline object inside `handleUndo`) for the
 * same reason `buildRestoredEntry` on the receiving end is: this payload has
 * now silently dropped three separate fields — the authoritative net carbs, the
 * licence credit, and the chosen portion — and a dropped field here is
 * invisible at the time and permanent afterwards. The entry comes back looking
 * right while quietly missing whatever the payload forgot. Only a test that
 * drives THIS function can catch the next one.
 *
 * Every value is a string: this is form encoding, and each of the three
 * non-trivial fields goes through its own shared encoder so the "none" wire
 * value is never spelled by hand here.
 *
 * @param log - the entry as it was immediately before the delete.
 * @returns the submit payload for the diary route's `restore` intent.
 */
export function buildRestorePayload(log: LocalFoodLog) {
  return {
    _intent: 'restore',
    name: log.name,
    quantityGrams: String(log.quantityGrams),
    loggedAt: new Date(log.loggedAt).toISOString(),
    source: log.source,
    mealType: log.mealType ?? '',
    foodId: log.foodId ?? '',
    aiEstimated: log.aiEstimated ? 'true' : 'false',
    curatedSource: log.curatedSource ?? '',
    logBatchId: log.logBatchId ?? '',
    // Without this the Undo would "restore" the entry stripped of its
    // authoritative net carbs — a fibre-heavy curated food would come back
    // reading 0 g. Encoded (not `String(...)`) to keep absent distinct
    // from upstream-unknown; see `#app/lib/authoritative-net-carbs`.
    netCarbsPer100g: encodeAuthoritativeNetCarbs(log.netCarbsPer100g),
    // The fourth of the same class (M135): without this the Undo would restore
    // the entry with its vitamins/minerals stripped, so the day would silently
    // drop from covered to uncovered for a reason the person never took.
    micronutrientsPer100g: encodeMicronutrients(log.micronutrientsPer100g),
    // Likewise: without this the Undo would quietly strip the entry's
    // licence credit — the restored row would keep claiming a curated
    // source while no longer crediting it.
    attribution: log.attribution ?? '',
    // And the third: the grams are restored unchanged, so the portion label
    // that described them is still exactly as valid as it was — without this
    // the person's own "2 eggs" came back as "180 g".
    portion: encodeDisplayPortion(log.portion),
    carbs: macroPayloadValue(log.macros.carbs),
    fiber: macroPayloadValue(log.macros.fiber),
    sugars: macroPayloadValue(log.macros.sugars),
    polyols: macroPayloadValue(log.macros.polyols),
    protein: macroPayloadValue(log.macros.protein),
    fat: macroPayloadValue(log.macros.fat),
    kcal: macroPayloadValue(log.macros.kcal),
  } satisfies Record<string, string>;
}

/** A per-serving macro as a payload string — blank for unknown, so the restore never fabricates a 0. */
function macroPayloadValue(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * The read-only receipt for one entry. Exported for direct render testing —
 * same precedent as `AttributionNote`/`ProvenanceNote` above, and for the same
 * reason: its headline net-carb number has to be driven by the entry's own
 * stored figure rather than recomputed from the linked personal food's macros,
 * and only a test that renders THIS component can catch a caller that stops
 * passing it (see `tests/unit/authoritative-net-carbs-wiring.test.ts`).
 */
export function EntryReceipt({ loaderData }: { loaderData: Route.ComponentProps['loaderData'] }) {
  const { userId, log, siblings, grams, snapshotMacros, basisPer100g, loggedAtDate, loggedAtTime, backTo } = loaderData;
  const { t, i18n } = useTranslation();
  const submit = useSubmit();
  const logAgainFetcher = useFetcherWithToast<Toast>();
  const [isDeleting, setIsDeleting] = useState(false);

  // The receipt's headline number is the entry's OWN stored figure, never a
  // recompute from `basisPer100g`: for a curated entry that basis is the linked
  // personal food's fibre-EXCLUSIVE "available" carbohydrate, so the local
  // `carbs - fiber - polyols` formula double-subtracts the fibre and floors the
  // food to a confident, green 0 — which is exactly what this hero rendered
  // while the diary row for the very same entry (which goes through
  // `localFoodLogToSnapshot`) read 21.7. A macro edit has already cleared
  // `log.netCarbsPer100g` by the time it is read here (`handleSave` →
  // `computeEditPatch`), so passing it through can never keep a stale figure
  // alive, and an explicit `null` correctly renders "Macros unknown" rather than
  // a fabricated 0.
  const heroPreview =
    basisPer100g ?
      computeMacroPreview({ macrosPer100g: basisPer100g, grams, authoritativeNetCarbsPer100g: log.netCarbsPer100g })
    : null;
  const carbStatus = heroPreview ? getCarbStatus(heroPreview.netCarbsPer100g) : null;

  // Device-local plate photo for this entry's scan batch, if one was cached on
  // this device. `userId` (the authenticated user, from the server loader)
  // scopes the lookup to this device's current account. Null on the server and
  // on a miss — the receipt then renders exactly its image-free form, no
  // layout shift.
  const photoDataUrl = usePlatePhoto({ userId, logBatchId: log.logBatchId });

  // Runs from the toast callback, after we've navigated away and this
  // component has unmounted. `useSubmit` drives the global router, so the
  // captured `submit` stays valid; targeting `backTo` (the entry's own day)
  // posts the restore there and revalidates the visible list — the diary
  // action itself also redirects the restored entry to its own day, so this
  // just avoids a wrong intermediate URL. sonner dismisses the toast on
  // click, so a second Undo can't fire (idempotent by construction).
  const handleUndo = () => {
    submit(buildRestorePayload(log), { method: 'post', action: backTo });
  };

  // Optimistic delete: fire the Undo toast immediately, then submit the delete
  // (which redirects to the entry's own day, see `backTo`). The toast lives at
  // the root, so it survives the navigation; its "Undo" re-creates the entry
  // from the snapshot we already hold in loader data.
  const handleDeleteClick = () => {
    setIsDeleting(true);
    toast(t('entry.toast.removed', { name: log.name }), {
      action: { label: t('entry.toast.undo'), onClick: handleUndo },
    });
    // Device-local photo cache: when this is the batch's last remaining entry,
    // drop its cached photo too. Best-effort — an undo-restored entry simply has
    // no photo back, which the cache treats as a graceful miss (never fatal).
    if (log.logBatchId !== null && siblings.length === 0) {
      void deletePlatePhoto({ userId, logBatchId: log.logBatchId });
    }
    submit({ _intent: 'delete' }, { method: 'post' });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {photoDataUrl && (
        <figure className="space-y-1">
          <img
            src={photoDataUrl}
            alt={t('entry.photo.alt', { name: log.name })}
            className="max-h-80 w-full rounded-lg object-cover"
          />
          <figcaption className="text-xs text-muted-foreground">{t('entry.photo.caption')}</figcaption>
        </figure>
      )}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{log.name}</h2>
          <FavoriteToggle name={log.name} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {loggedAtDate} · {loggedAtTime}
          </span>
          {log.mealType && (
            // Translated label, not the raw enum under a `capitalize` class:
            // the class only cased the English value and left every other
            // language showing the wire value.
            <Badge
              variant="outline"
              className="border-transparent bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {t(MEAL_TYPE_LABEL_KEYS[log.mealType])}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-1 p-6">
          {heroPreview && carbStatus ?
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('entry.hero.netCarbsPerServing')}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-4xl font-bold tabular-nums">
                  {formatMacroNumberIn(i18n.language, heroPreview.netCarbsForPortion)}
                  <span className="ml-1 text-lg font-medium text-muted-foreground">g</span>
                </span>
                <span
                  className={cn(
                    'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    carbStatusBadgeClass[carbStatus],
                  )}
                >
                  {t('entry.hero.per100gBadge', { value: formatMacroNumberIn(i18n.language, heroPreview.netCarbsPer100g) })}
                </span>
              </div>
            </>
          : <p className="text-sm text-muted-foreground">{t('entry.macrosUnknown')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <FactRow label={t('entry.fact.portion')} value={formatPortionFact(log, grams, i18n.language)} />
            <FactRow label={t('entry.macro.carbs')} value={`${formatFact(snapshotMacros.carbs, i18n.language)} g`} />
            <FactRow label={t('entry.macro.fiber')} value={`${formatFact(snapshotMacros.fiber, i18n.language)} g`} />
            <FactRow label={t('entry.macro.sugars')} value={`${formatFact(snapshotMacros.sugars, i18n.language)} g`} />
            {/* Sugar alcohols (polyols): null for nearly every food, so this
                row is dropped from the default view rather than showing
                "Sugar alcohols — g" on almost every entry (carbs-audit round,
                item 2). Still shown, with a shopper-recognizable label
                instead of the jargon "Polyols", on the rare entry that
                actually reports it. */}
            {snapshotMacros.polyols !== null && (
              <FactRow label={t('entry.fact.polyols')} value={`${formatFact(snapshotMacros.polyols, i18n.language)} g`} />
            )}
            <FactRow label={t('entry.macro.protein')} value={`${formatFact(snapshotMacros.protein, i18n.language)} g`} />
            <FactRow label={t('entry.macro.fat')} value={`${formatFact(snapshotMacros.fat, i18n.language)} g`} />
            {/* Label already says "Calories" — no reason to also append the
                jargon unit "kcal" to the value (defect: rows below repeated
                the concept in both plain English and jargon). */}
            <FactRow label={t('entry.macro.kcal')} value={formatFact(snapshotMacros.kcal, i18n.language)} />
          </dl>
          {/* The net-carbs headline above and this Carbs/Fiber pair are two
              different numbers with no stated relationship between them
              (defect) — this ties them together instead of leaving a reader
              to work out carbs minus fiber themselves. */}
          <p className="mt-2 text-xs text-muted-foreground">{t('entry.netCarbsFormula')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <ProvenanceNote log={log} />
        </CardContent>
      </Card>

      {siblings.length > 0 && <LoggedTogether siblings={siblings} />}

      <div className="space-y-2">
        <Button asChild className="h-11 w-full">
          <Link to="?edit=1">{t('entry.action.edit')}</Link>
        </Button>
        <logAgainFetcher.Form method="post">
          <input type="hidden" name="_intent" value="log-again" />
          <SubmitButton
            variant="outline"
            className="h-11 w-full"
            pending={logAgainFetcher.state !== 'idle'}
            pendingLabel={t('entry.action.logAgainPending')}
          >
            <RotateCcw className="h-4 w-4" /> {t('entry.action.logAgain')}
          </SubmitButton>
        </logAgainFetcher.Form>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full text-destructive hover:text-destructive"
          onClick={handleDeleteClick}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" /> {t('entry.action.delete')}
        </Button>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b py-1 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Edit mode (?edit=1) — portion-first
////////////////////////////////////////////////////////////////////////////////

function EditEntry({
  loaderData,
  actionData,
}: {
  loaderData: Route.ComponentProps['loaderData'];
  actionData: Route.ComponentProps['actionData'];
}) {
  const { log, grams, basisPer100g, loggedAtDateValue, loggedAtTimeValue, todayValue } = loaderData;
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting' && navigation.formData?.get('_intent') === 'save';

  const [mealType, setMealType] = useState<string>(log.mealType ?? '');

  // Conform field metadata (`fields.x.value`) does NOT live-update as the user
  // types into an uncontrolled input — it only reflects defaultValue/lastResult
  // at render. So the live preview is driven by local mirror state fed by our
  // own `onChange` handlers layered on top of the spread `getInputProps` (which
  // attach no onChange of their own). The Conform inputs stay uncontrolled, so
  // submission + validation still flow through Conform unchanged.
  // PINNED (not `formatMacroNumberIn`): this string IS the grams input's value
  // and is parsed back by `parseNumericFieldValue` below — a localized "346,7"
  // would be invalid in the field and `NaN` on the way out.
  const [gramsInput, setGramsInput] = useState<string>(formatMacroNumber(grams));
  const [macroInputs, setMacroInputs] = useState<Record<keyof Macros, string>>(() => ({
    carbs: basisFieldValue(basisPer100g, 'carbs'),
    fiber: basisFieldValue(basisPer100g, 'fiber'),
    sugars: basisFieldValue(basisPer100g, 'sugars'),
    polyols: basisFieldValue(basisPer100g, 'polyols'),
    protein: basisFieldValue(basisPer100g, 'protein'),
    fat: basisFieldValue(basisPer100g, 'fat'),
    kcal: basisFieldValue(basisPer100g, 'kcal'),
  }));

  const [form, fields] = useForm({
    id: `edit-entry-${log.id}`,
    // SAFETY: `actionData` is this route's own `clientAction` return value, and
    // every branch of it returns `parseWithZod(...).reply()` — Conform's
    // submission result for string[] errors — or nothing at all.
    lastResult: actionData as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: createEditEntrySchema(t) });
    },
    shouldValidate: 'onBlur',
    // Stable, loader-derived defaults (the mirror state above is seeded from the
    // same values) — Conform only reads these on mount, so keeping them stable
    // avoids any re-render reset.
    defaultValue: {
      name: log.name,
      quantityGrams: formatMacroNumber(grams),
      date: loggedAtDateValue,
      time: loggedAtTimeValue,
      carbs: basisFieldValue(basisPer100g, 'carbs'),
      fiber: basisFieldValue(basisPer100g, 'fiber'),
      sugars: basisFieldValue(basisPer100g, 'sugars'),
      polyols: basisFieldValue(basisPer100g, 'polyols'),
      protein: basisFieldValue(basisPer100g, 'protein'),
      fat: basisFieldValue(basisPer100g, 'fat'),
      kcal: basisFieldValue(basisPer100g, 'kcal'),
    },
  });

  // 1× is the entry's CURRENT grams. The base is the loader value (stable) —
  // never a Conform field, whose initialValue `form.update` rewrites.
  const baseGrams = grams;
  const currentGrams = parseNumericFieldValue(gramsInput) ?? baseGrams;
  const selectedMultiplier = baseGrams > 0 ? derivePortionMultiplier({ baseGrams, currentGrams }) : null;

  // Chips/stepper set the (uncontrolled) grams input via `form.update` for
  // display, and mirror into local state so the preview updates immediately.
  const setGrams = (next: number) => {
    const value = formatMacroNumber(Math.max(0, next));
    form.update({ name: fields.quantityGrams.name, value });
    setGramsInput(value);
  };

  const livePer100g: Macros = {
    carbs: parseNumericFieldValue(macroInputs.carbs),
    fiber: parseNumericFieldValue(macroInputs.fiber),
    sugars: parseNumericFieldValue(macroInputs.sugars),
    polyols: parseNumericFieldValue(macroInputs.polyols),
    protein: parseNumericFieldValue(macroInputs.protein),
    fat: parseNumericFieldValue(macroInputs.fat),
    kcal: parseNumericFieldValue(macroInputs.kcal),
  };
  // Follows the SAME rule the save will apply, via the same pure helpers
  // (`handleSave` → `computeEditPatch`), so what this preview shows is what
  // pressing Save actually stores: an untouched macro set keeps the entry's
  // authoritative figure, a hand-edited one withdraws it and falls back to the
  // person's own parts. Without it the preview contradicted the receipt hero for
  // an unedited curated entry — a green 0 one tap away from a red 21.7.
  const previewNetCarbsPer100g = resolveEditedNetCarbsPer100g({
    macrosChanged: macrosDiffer(basisPer100g ?? EMPTY_MACROS, livePer100g),
    current: log.netCarbsPer100g,
  });
  const preview = computeMacroPreview({
    macrosPer100g: livePer100g,
    grams: currentGrams,
    authoritativeNetCarbsPer100g: previewNetCarbsPer100g,
  });
  const previewCarbStatus = preview ? getCarbStatus(preview.netCarbsPer100g) : null;
  const previewMuted = preview ? formatPreviewMuted({ preview, t, language: i18n.language }) : '';

  return (
    <div className="mx-auto max-w-2xl">
      <Form method="post" {...getFormProps(form)} className="space-y-6">
        <input type="hidden" name="_intent" value="save" />

        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t('entry.edit.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('entry.edit.subtitle')}</p>
        </div>

        {/* Portion — the primary control */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('entry.fact.portion')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {baseGrams > 0 && (
              <div className="flex flex-wrap gap-2">
                {PORTION_SCALE_OPTIONS.map((option) => {
                  const isSelected = selectedMultiplier === option.multiplier;
                  return (
                    <button
                      key={option.multiplier}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setGrams(scalePortionGrams(baseGrams, option.multiplier))}
                      className={cn(
                        'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                        isSelected ?
                          'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
                      )}
                    >
                      {portionScaleLabel({ option, t })} ({option.hint})
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor={fields.quantityGrams.id}>{t('entry.edit.grams')}</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={t('entry.edit.decreaseGrams')}
                  onClick={() => setGrams(currentGrams - GRAMS_STEP)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  {...getInputProps(fields.quantityGrams, { type: 'number', step: '0.1' })}
                  inputMode="decimal"
                  className="h-11 text-center tabular-nums"
                  onChange={(event) => setGramsInput(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={t('entry.edit.increaseGrams')}
                  onClick={() => setGrams(currentGrams + GRAMS_STEP)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <FieldError id={fields.quantityGrams.errorId} errors={fields.quantityGrams.errors} />
            </div>

            {/* Live, read-only preview recomputed from the per-100g basis. */}
            {preview && previewCarbStatus ?
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    carbStatusBadgeClass[previewCarbStatus],
                  )}
                >
                  {t('entry.preview.netCarbsBadge', { value: formatMacroNumberIn(i18n.language, preview.netCarbsForPortion) })}
                </span>
                {previewMuted && <span className="text-xs text-muted-foreground">{previewMuted}</span>}
              </div>
            : <p className="text-xs text-muted-foreground">{t('entry.macrosUnknown')}</p>}
          </CardContent>
        </Card>

        {/* Name + meal */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-2">
              <Label htmlFor={fields.name.id}>{t('entry.edit.name')}</Label>
              <Input {...getInputProps(fields.name, { type: 'text' })} />
              <FieldError id={fields.name.errorId} errors={fields.name.errors} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={fields.mealType.id}>{t('entry.edit.meal')}</Label>
              <Select
                value={mealType || NO_MEAL_VALUE}
                onValueChange={(value) => setMealType(value === NO_MEAL_VALUE ? '' : value)}
              >
                <SelectTrigger id={fields.mealType.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MEAL_VALUE}>{t('entry.edit.noMeal')}</SelectItem>
                  {MEAL_TYPES.map((meal) => (
                    <SelectItem key={meal} value={meal}>
                      {t(MEAL_TYPE_LABEL_KEYS[meal])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name={fields.mealType.name} value={mealType} />
              <FieldError id={fields.mealType.errorId} errors={fields.mealType.errors} />
            </div>
          </CardContent>
        </Card>

        {/* When — date and time (item 4). A backdated entry stays honest about
            when it was actually eaten; `max` blocks picking a future date the
            same way the diary route itself refuses to render one. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('entry.edit.when')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor={fields.date.id}>{t('entry.edit.date')}</Label>
              <Input {...getInputProps(fields.date, { type: 'date' })} max={todayValue} />
              <FieldError id={fields.date.errorId} errors={fields.date.errors} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={fields.time.id}>{t('entry.edit.time')}</Label>
              <Input {...getInputProps(fields.time, { type: 'time' })} />
              <FieldError id={fields.time.errorId} errors={fields.time.errors} />
            </div>
          </CardContent>
        </Card>

        {/* Fine-tune per 100g — single-column, full-width, never a grid. */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-1 px-0">
              <ChevronDown className="h-4 w-4" /> {t('entry.edit.fineTune')}
            </Button>
          </CollapsibleTrigger>
          {/* forceMount + data-[state=closed]:hidden (scan.tsx's pattern) keeps
              these inputs in the DOM while collapsed, so a portion-only save
              still submits every prefilled per-100g value — collapsed must mean
              "unchanged", never "absent". */}
          <CollapsibleContent forceMount className="space-y-4 pt-2 data-[state=closed]:hidden">
            {MACRO_FIELD_KEYS.map(([key, labelKey]) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={fields[key].id}>{t(labelKey)}</Label>
                <Input
                  {...getInputProps(fields[key], { type: 'number', step: '0.1' })}
                  inputMode="decimal"
                  className="w-full"
                  onChange={(event) => setMacroInputs((prev) => ({ ...prev, [key]: event.target.value }))}
                />
                <FieldError id={fields[key].errorId} errors={fields[key].errors} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t('entry.edit.per100gHint')}</p>
          </CollapsibleContent>
        </Collapsible>

        <FieldError id={form.errorId} errors={form.errors} />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <SubmitButton pending={isSaving} pendingLabel={t('entry.edit.saving')} className="h-11 w-full sm:flex-1">
            {t('entry.edit.save')}
          </SubmitButton>
          <Button asChild variant="outline" className="h-11 w-full sm:flex-1">
            <Link to={`/diary/entry/${log.id}`}>{t('entry.edit.cancel')}</Link>
          </Button>
        </div>
      </Form>
    </div>
  );
}

export default function DiaryEntry({ loaderData, actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  if (searchParams.get('edit') === '1') return <EditEntry loaderData={loaderData} actionData={actionData} />;
  return <EntryReceipt loaderData={loaderData} />;
}
