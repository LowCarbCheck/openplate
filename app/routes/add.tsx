import type { Route } from './+types/add';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Form, redirect, useNavigate, useNavigation } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
// The singleton, not a hook: `clientAction` and the helpers it calls run
// outside React, where `useTranslation` is unavailable. Importing it here also
// guarantees the shared instance is initialized before this module's
// components render under a bare `renderToStaticMarkup` (no `I18nProvider`),
// which is how the add-flow render tests drive them.
import i18next from '#app/i18n/i18n';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import type { SubmissionResult } from '@conform-to/react';
import { fetchFoodMatches } from '#app/lib/food-matches-client';
import { randomUuid } from '#app/lib/uuid';
import type { FoodMatch } from '#app/services/food-resolution';
import { scaleMacrosPer100gToServing, type Macros } from '#app/lib/macros';
import { mealTypeForTime } from '#app/lib/meal-time';
import { instantOnDate, parseDateParam, todayInTimezone } from '#app/lib/user-days';
import { formatDayLabel } from '#app/lib/format-day-label';
import {
  federateLocalQuickAddCandidates,
  localCuratedMatchToCandidate,
  localFoodToCandidate,
  localRecentFoodToCandidate,
  type LocalQuickAddCandidate,
  type LocalQuickAddSource,
} from '#app/lib/local-store/local-quick-add';
import { computeMacroPreview, type MacroPreview } from '#app/lib/portion-preview';
import { authoritativeNetCarbsField, encodeAuthoritativeNetCarbs } from '#app/lib/authoritative-net-carbs';
import { encodeMicronutrients, micronutrientsField } from '#app/lib/micronutrients';
import { macrosDiffer, resolveEditedNetCarbsPer100g } from '#app/lib/log-edit';
import { parseCarbBasis } from '#app/lib/net-carbs';
import type { CarbBasis } from '#app/lib/net-carbs';
import { CARB_BASIS_NOT_SURE_VALUE, CarbBasisField } from '#app/components/carb-basis-field';
import { toStoredAttribution } from '#app/lib/attribution';
import {
  derivePortionChoices,
  deriveSelectedPortionQuantity,
  encodeDisplayPortion,
  portionField,
  resolveMacrosPer100gFromEntry,
  type DisplayPortion,
  type MacroEntryBasis,
} from '#app/lib/portions';
import { matchTier, type MatchTier } from '#app/lib/match-quality';
import { createOptionalNonNegativeNumberSchema } from '#app/lib/zod-numeric';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { useOnlineStatus } from '#app/lib/service-worker';
import {
  computeLocalRecentFoods,
  deleteLocalFood,
  getLocalFood,
  getLocalProfileGoals,
  listLocalFoodLogs,
  listLocalFoods,
  putLocalFood,
  putLocalFoodLog,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalFoodLog, LocalPersonalFood, LocalRecentFood } from '#app/lib/local-store';
import { showFoodAddedToast } from '#app/lib/food-added-toast';
import { readDayCarbTotals } from '#app/lib/day-carb-totals';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
import { cn } from '#app/lib/utils';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { OfflineBanner } from '#app/components/offline-banner';
import { LoggingToBanner } from '#app/components/logging-to-banner';
import { SearchResultRow } from '#app/components/add/search-result-row';
import { SpeechInputButton, useSpeechInputAvailable } from '#app/components/add/speech-input-button';
import { ManageCustomFoodsSheet } from '#app/components/add/manage-custom-foods';
import { PlateGlyph } from '#app/components/plate-glyph';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { SectionEyebrow } from '#app/components/typography';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select';
import { Camera, ChevronDown, ChevronLeft, Search } from 'lucide-react';

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
 * Active UI language for those same non-React paths. Day labels are display
 * text, so they follow the language the surrounding copy is written in.
 */
function currentLanguage(): string {
  return i18next.language;
}

/**
 * Shown while the client loader reads local-first health data (M117/03 route
 * cutover — `/add` now reads/writes exclusively via the on-device primary
 * store; only the curated food-database search still needs a network call).
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('add.loading')}
    </output>
  );
}

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.add') }];

export const handle = {
  title: 'Add food',
  titleKey: 'add.title',
  backTo: '/diary',
};

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/**
 * Radix `<Select>` forbids an empty-string item value, so "no meal chosen"
 * rides on this sentinel in the UI and is normalized to `''` in the hidden
 * input (which the schema then maps to `undefined`).
 */
const NO_MEAL_VALUE = 'none';

/** The seven per-100g macro fields carried through the portion step, in order. */
const MACRO_KEYS = ['carbs', 'fiber', 'sugars', 'polyols', 'protein', 'fat', 'kcal'] as const;

/**
 * Translation keys for the seven macro-field labels, reused by both the
 * manual-add and edit-food forms. The English catalog behind these keys uses
 * plain words a first-time visitor already knows — never the bare macro key:
 * "kcal" reads as jargon on its own, so it's "Calories"; "polyols" is a term
 * almost nobody outside nutrition science has heard, so it's "Sugar alcohols"
 * with the technical term kept alongside in parentheses for anyone
 * cross-referencing a nutrition label that uses it.
 */
export const MACRO_FIELD_LABEL_KEYS: readonly (readonly [(typeof MACRO_KEYS)[number], string])[] = [
  ['carbs', 'add.macros.carbs'],
  ['fiber', 'add.macros.fiber'],
  ['sugars', 'add.macros.sugars'],
  ['polyols', 'add.macros.polyols'],
  ['protein', 'add.macros.protein'],
  ['fat', 'add.macros.fat'],
  ['kcal', 'add.macros.kcal'],
];

/**
 * Translation keys for the meal-type enum, plus the "no meal chosen" state.
 * Used for the dropdown options, the trigger's displayed value AND the
 * add-toast's meal clause — Radix's `<SelectValue>` mirrors the selected
 * `<SelectItem>`'s own text content, not a CSS `capitalize` class applied to
 * it, so relying on `className="capitalize"` around the raw lowercase enum
 * value (the old approach) capitalized the dropdown row but left the trigger
 * showing the raw "snack" (defect). A real label fixes both at once.
 *
 * `none` is here rather than translated at the toast call site so the select's
 * "No meal" row and the toast's meal clause can never drift apart — the same
 * reason `#app/lib/meal-time`'s `mealLabel` (which this replaces at every
 * call site in this route) held both.
 */
export const MEAL_LABEL_KEYS = {
  none: 'add.meal.none',
  breakfast: 'add.meal.breakfast',
  lunch: 'add.meal.lunch',
  dinner: 'add.meal.dinner',
  snack: 'add.meal.snack',
} satisfies Record<(typeof MEAL_TYPES)[number] | 'none', string>;

/** Where a successful log returns to when no `?returnTo=` is supplied. */
const DEFAULT_RETURN_TO = '/diary';

const SEARCH_DEBOUNCE_MS = 250;
/** How many recent foods to pull before filtering by the query. */
const RECENT_SCAN_LIMIT = 50;
/** How many recent foods to surface (before any keystroke, and per query). */
const RECENT_DISPLAY_LIMIT = 8;
/** How many custom foods to surface per query. */
const CUSTOM_DISPLAY_LIMIT = 8;
/** Shortest query length that hits the (network) curated food-database search. */
const MIN_CURATED_QUERY_LENGTH = 2;

/**
 * Plain-language starter searches shown to a brand-new person with no logging
 * history yet (defect: the search step used to be a bare box with nothing to
 * tap). These are just NAMES to search for — never nutrition numbers of our
 * own invention, which would break this app's "never fabricate a macro
 * value" promise. Tapping one runs the exact same real, verified lookup as
 * typing it would.
 *
 * Translated, not literal: the term is what actually gets typed into the food
 * search, so an English word would return nothing useful to someone searching
 * a non-English food database.
 */
const STARTER_SEARCH_SUGGESTION_KEYS: readonly string[] = [
  'add.search.starters.eggs',
  'add.search.starters.chickenBreast',
  'add.search.starters.greekYogurt',
  'add.search.starters.banana',
  'add.search.starters.rice',
  'add.search.starters.broccoli',
];

const mealTypeField = z.preprocess((value) => (value === '' ? undefined : value), z.enum(MEAL_TYPES).optional());

/**
 * Optional target day (`YYYY-MM-DD`) carried from the diary when back-dating a
 * log. Blank/absent → `undefined`; present values must be a real calendar date
 * (re-validated with the same `parseDateParam` semantics the loader uses, so a
 * tampered param can't slip through).
 */
const logDateField = z.preprocess(
  (value) => {
    const raw = z.string().safeParse(value);
    return raw.success && raw.data.trim() !== '' ? raw.data : undefined;
  },
  z
    .string()
    // Deliberately untranslated: this rides on a hidden input nobody types
    // into, so the only way to trip it is a tampered `?date=` — there is no
    // field error rendered for it anywhere in the flow.
    .refine((value) => parseDateParam(value) !== null, 'Invalid date')
    .optional(),
);

/**
 * Required, always-positive grams field with a fully human message at every
 * failure step. A bare `z.coerce.number().positive(message)` looks right in
 * isolation, but Conform's automatic form coercion strips ANY blank string it
 * finds, including one synthesized by an intermediate `z.preprocess` step —
 * not just the raw submitted value — so a preprocess-based "blank → sentinel"
 * rewrite silently loses its own substitution and Zod's raw "Invalid input:
 * expected number, received NaN" leaks through on an empty field (verified
 * interactively against this repo's installed conform/zod versions). Building
 * this as a plain `z.string()…transform()…refine()` chain — no preprocess
 * layer for Conform to reach past — mirrors `#app/lib/zod-numeric.ts`'s
 * `createRequiredNonNegativeNumberSchema`, which already solved the same
 * problem for a non-negative (not strictly positive) field.
 */
function createRequiredPositiveGramsSchema(t: Translate): z.ZodType<number> {
  const missing = t('add.errors.gramsRequired');
  return z
    .string({ error: missing })
    .trim()
    .min(1, missing)
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value), { message: t('add.errors.gramsNotANumber'), abort: true })
    .refine((value) => value > 0, t('add.errors.gramsNotPositive'));
}

/** A person-controlled hidden toggle — always one of two known values, so an unexpected one just falls back rather than erroring. */
const macroBasisField = z.enum(['per100g', 'perServing']).catch('per100g');

/**
 * Portion-step log: a chosen candidate, its per-100g macros carried through as
 * hidden fields.
 *
 * A factory rather than a module constant because every message a person can
 * actually read has to come out of the active locale, and a constant would
 * freeze whatever language the singleton happened to hold at import time.
 * Exported for direct schema-behavior testing with a stub translator (see
 * tests/unit/add-route.test.ts).
 */
export function createLogSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t('add.errors.nameRequired')),
    quantityGrams: createRequiredPositiveGramsSchema(t),
    mealType: mealTypeField,
    date: logDateField,
    foodId: z.preprocess((value) => {
      const raw = z.string().safeParse(value);
      return raw.success && raw.data.trim() === '' ? undefined : value;
    }, z.string().optional()),
    curatedSource: z.string().optional(),
    aiEstimated: z.preprocess((value) => value === 'true', z.boolean()),
    portion: portionField,
    /**
     * The candidate's AUTHORITATIVE per-100g net carbs, carried through from the
     * search result so it survives into `LocalFoodLog.netCarbsPer100g` instead of
     * dying at log time (which is what made a curated fibre-heavy food read
     * "0 g net carbs" on the diary forever after). `PortionStep` renders this
     * input for EVERY candidate; a candidate with no upstream figure submits the
     * blank that `decodeAuthoritativeNetCarbs` maps back to `undefined`, so all
     * three states survive the round trip — see `netCarbsPer100g`'s three-state
     * doc on `LocalFoodLog`.
     */
    netCarbsPer100g: authoritativeNetCarbsField,
    /**
     * The candidate's per-100 g vitamins and minerals (M135), carried through
     * from the search result so they survive into
     * `LocalFoodLog.micronutrientsPer100g` rather than dying at log time — the
     * exact defect the field above exists to document, one dimension over. A
     * candidate whose source has no micronutrients submits the blank that
     * `decodeMicronutrients` maps back to `undefined`, which the daily
     * aggregation reads as UNCOVERED (never as zeros).
     */
    micronutrientsPer100g: micronutrientsField,
    /**
     * The candidate's licence credit, carried through so it survives into
     * `LocalFoodLog.attribution`. CC BY requires the credit to travel with the
     * data wherever it is shown, and the entry detail page is one of those
     * places — showing it once on the portion step and then dropping it is not
     * compliance, it's a disappearing footnote. Blank for a candidate whose
     * source carries none (a personal food, a manual entry); normalized by
     * `toStoredAttribution` on the way in.
     */
    attribution: z.string().optional(),
    /**
     * The candidate's printed-panel convention, carried through so it survives
     * into `LocalFoodLog.carbBasis` instead of dying at log time — the exact
     * defect `netCarbsPer100g` above exists to document, one field over. Its
     * absence here was the M123/13 review finding: the preview above already
     * reads `candidate.carbBasis` (see `computeMacroPreview`'s call below),
     * so the screen showed the right, basis-aware number while the row this
     * form created reverted to the `total` fallback and silently understated
     * an EU-basis food with fibre — a false green zero on a red preview. Same
     * "the data is the gate" convention as `attribution`: blank submits as
     * "unknown", never a guess. Parsed with `parseCarbBasis` in the builder,
     * not here — same split as `createManualSchema`'s `carbBasis` field.
     */
    carbBasis: z.string().optional(),
    carbs: createOptionalNonNegativeNumberSchema(),
    fiber: createOptionalNonNegativeNumberSchema(),
    sugars: createOptionalNonNegativeNumberSchema(),
    polyols: createOptionalNonNegativeNumberSchema(),
    protein: createOptionalNonNegativeNumberSchema(),
    fat: createOptionalNonNegativeNumberSchema(),
    kcal: createOptionalNonNegativeNumberSchema(),
  });
}

/** A validated portion-step submission. */
export type LogInput = z.infer<ReturnType<typeof createLogSchema>>;

/**
 * Manual fallback: a fresh name + macros entry (mirrors the diary quick-add).
 * `macroBasis`/`servingGrams` let a person type a package label exactly as
 * printed ("per serving (30 g): 120 kcal") instead of doing the per-100g math
 * themselves — see `resolveMacrosPer100gFromEntry` in `handleManual`. A factory
 * for the same reason as `createLogSchema`. Exported for direct schema-behavior
 * testing (see tests/unit/add-route.test.ts).
 */
export function createManualSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t('add.errors.nameRequired')),
    quantityGrams: createRequiredPositiveGramsSchema(t),
    mealType: mealTypeField,
    date: logDateField,
    macroBasis: macroBasisField,
    servingGrams: createOptionalNonNegativeNumberSchema(),
    carbs: createOptionalNonNegativeNumberSchema(),
    fiber: createOptionalNonNegativeNumberSchema(),
    sugars: createOptionalNonNegativeNumberSchema(),
    polyols: createOptionalNonNegativeNumberSchema(),
    protein: createOptionalNonNegativeNumberSchema(),
    fat: createOptionalNonNegativeNumberSchema(),
    kcal: createOptionalNonNegativeNumberSchema(),
    // The three-state control's "not sure" chip submits '' — unrecognised, so
    // it can't fail this schema; `parseCarbBasis` (applied in the handler, not
    // here) turns it into the persisted absent state. Default "not sure".
    carbBasis: z.string().optional(),
  });
}

/**
 * Edits an existing custom food's name/macros (the "Your foods" management
 * sheet). Same basis/serving convention as the manual-add schema.
 *
 * Its messages stay untranslated on purpose: this form renders no field
 * errors at all — a failure comes back as a `reason` the sheet turns into its
 * own translated toast (`editFailureMessage`), so nothing below is ever read
 * by a person.
 */
const EditFoodSchema = z.object({
  foodId: z.string().min(1, 'Missing food'),
  name: z.string().min(1, 'Name is required'),
  macroBasis: macroBasisField,
  servingGrams: createOptionalNonNegativeNumberSchema(),
  carbs: createOptionalNonNegativeNumberSchema(),
  fiber: createOptionalNonNegativeNumberSchema(),
  sugars: createOptionalNonNegativeNumberSchema(),
  polyols: createOptionalNonNegativeNumberSchema(),
  protein: createOptionalNonNegativeNumberSchema(),
  fat: createOptionalNonNegativeNumberSchema(),
  kcal: createOptionalNonNegativeNumberSchema(),
  // Same convention as `createManualSchema.carbBasis` above.
  carbBasis: z.string().optional(),
});

const DeleteFoodSchema = z.object({ foodId: z.string().min(1, 'Missing food') });

type ActionResult =
  | { intent: 'log'; submission: SubmissionResult<string[]> }
  | { intent: 'manual'; submission: SubmissionResult<string[]> };

/** Result of the "Your foods" sheet's delete action — read by `ManageCustomFoodsSheet` via its own fetcher. */
export interface DeleteFoodResult {
  intent: 'deleteFood';
  foodId: string;
  name: string;
}

/** Result of the "Your foods" sheet's edit action. `ok: false` carries a `reason` the sheet turns into a plain-language toast. */
export type EditFoodResult =
  | { intent: 'editFood'; ok: true; name: string }
  | { intent: 'editFood'; ok: false; reason: 'invalid' | 'carbs-required' };

////////////////////////////////////////////////////////////////////////////////
// Server loader — none needed (M117/04: accounts optional, health data is
// local-only — there is no auth invariant left to enforce or echo here)
////////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

////////////////////////////////////////////////////////////////////////////////
// Shared pure helpers (imperative shell)
////////////////////////////////////////////////////////////////////////////////

/** Keeps `?returnTo=` internal-only: rejects off-site and protocol-relative targets. */
function sanitizeReturnTo(value: string | null): string {
  const raw = value ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_RETURN_TO;
  return raw;
}

/** Case-insensitive substring filter + display cap over the ranked local recents list. */
function filterLocalRecentsByQuery({
  recentFoods,
  query,
  limit,
}: {
  recentFoods: LocalRecentFood[];
  query: string;
  limit: number;
}): LocalRecentFood[] {
  if (query === '') return recentFoods.slice(0, limit);
  const lowerQuery = query.toLowerCase();
  return recentFoods.filter((food) => food.name.toLowerCase().includes(lowerQuery)).slice(0, limit);
}

/** Resolves the `?date=` back-dating context shared by the client loader and the action handlers. */
function resolveLogDateContext({ url, today }: { url: URL; today: string }) {
  // A `?date=` other than today back-dates the log. Normalize a today-valued
  // param to "no date" so the common path stays free of stray query state.
  const rawDate = parseDateParam(url.searchParams.get('date'));
  const logDate = rawDate !== null && rawDate !== today ? rawDate : null;
  const logDateLabel = logDate ? formatDayLabel(logDate, currentLanguage()) : null;

  // An explicit `?returnTo=` always wins (onboarding relies on it); otherwise a
  // back-dated log returns to that day's diary, and a normal log to /diary.
  const explicitReturnTo = url.searchParams.get('returnTo');
  const returnTo =
    explicitReturnTo !== null ? sanitizeReturnTo(explicitReturnTo)
    : logDate ? `/diary?date=${logDate}`
    : DEFAULT_RETURN_TO;

  return { logDate, logDateLabel, returnTo };
}

////////////////////////////////////////////////////////////////////////////////
// Client loader (local-first: recents/custom foods local, curated search networked)
////////////////////////////////////////////////////////////////////////////////

/**
 * A federated candidate decorated with the curated match's relevance tier
 * (defect: 10 curated results now return, up from 3 — an exact match and a
 * fuzzy typo-recovery guess must not look identical). `LocalQuickAddCandidate`
 * itself doesn't carry a raw score (it's a local-first, source-agnostic
 * shape), so the tier is computed once here, at candidate-build time, from
 * the `FoodMatch.score` that's still in scope — `null` for `'recent'`/
 * `'custom'` rows, which have no relevance score to tier.
 */
export interface AddSearchCandidate extends LocalQuickAddCandidate {
  matchTier: MatchTier | null;
}

/**
 * Cheap proxy for "this is an annotated/derivative preparation" rather than
 * the plain form of a food. A live search for "eggs" returns several BLS
 * descriptors scored identically — "Eggs in frying batter fried" (5 words),
 * "Eggs with cheese gratinated" (4 words), "Eggs boiled" (2 words) — with no
 * commas anywhere to key off. Word count catches this where a comma count
 * wouldn't: the plain "Eggs boiled" has the fewest words of the three, and a
 * heavily annotated name ("Eggs boiled, with remoulade sauce, diluted with
 * cream and mustard") racks up both extra clauses AND extra words. Crude but
 * directionally right, and never fabricates or edits a name — it only
 * informs the sort order below.
 */
function preparationComplexity(name: string): number {
  return name.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Client-side readability tiebreak for curated matches — NEVER a re-sort of
 * the list. LCC's own relevance order is authoritative: it already encodes a
 * lexical tier (exact/prefix/token-prefix/substring/token-overlap/fuzzy) PLUS
 * a per-origin bias (curated > bls > fdc/user) tuned against the real
 * production index (see `apps/remix-lcc/app/lib/food-api/matcher.ts`'s
 * `rankWithBias`/`ORIGIN_BIAS`) — discarding that order and resequencing by a
 * client-only heuristic (the previous defect: a full resort by match-tier
 * bucket, then word count, silently reordered "eggs" to put "Eggplant" and
 * "Egg salad" ahead of the actual best match, and buried real cheese/bread/
 * rice/yogurt hits behind derivative preparations of the same word count).
 *
 * The only client-side adjustment left is a strict tiebreak WITHIN a
 * contiguous run of EXACTLY equal scores (the server can and does emit exact
 * ties — e.g. two curated rows both landing on the prefix tier's ceiling) —
 * never across a score difference, however small: a genuinely
 * higher-relevance match must never drop behind a lower one. Within a tied
 * run, the least "annotated" name (see `preparationComplexity`) sorts first,
 * since a live "eggs boiled" vs "eggs boiled, with remoulade sauce, diluted…"
 * tie reads better with the plain preparation up front. Never invents, edits,
 * or drops a match; only resequences ties the server left unresolved.
 * Exported for direct testability.
 */
export function orderCuratedMatchesForReadability(matches: readonly FoodMatch[]): FoodMatch[] {
  const result = [...matches];
  // The server already returns matches sorted by (biased) relevance
  // descending, so exactly-tied scores are always adjacent — no need to
  // group non-adjacent items. Walk the list once, resequencing each
  // contiguous equal-score run in place; everything outside a run keeps its
  // server-given position untouched. `start` strictly advances to `end` (>
  // `start`) every iteration, so this is bounded by `result.length` even
  // though the trip count isn't a fixed constant.
  let start = 0;
  while (start < result.length) {
    let end = start + 1;
    while (end < result.length && result[end].score === result[start].score) end += 1;
    if (end - start > 1) {
      const tiedRun = result
        .slice(start, end)
        .toSorted((a, b) => preparationComplexity(a.title) - preparationComplexity(b.title));
      result.splice(start, end - start, ...tiedRun);
    }
    start = end;
  }
  return result;
}

/** The add loader payload — everything the search/portion steps render. */
export interface AddData {
  query: string;
  returnTo: string;
  defaultMealType: string;
  candidates: AddSearchCandidate[];
  /** Every locally-saved food, unfiltered — feeds the "Your foods" management sheet (defect: custom foods used to be write-only). */
  customFoods: LocalPersonalFood[];
  hasAnyRecent: boolean;
  logDate: string | null;
  logDateLabel: string | null;
  /** True only when the curated lookup was rate-limited — never "no matches" (see `describeSearchPause`). */
  throttled: boolean;
  retryAfterMs: number | null;
  /** `?speak=1` — the launcher's "Speak" entry. Arms and focuses the microphone button; never starts listening (see `SpeechInputButton`). */
  speak: boolean;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs): Promise<AddData> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  const today = todayInTimezone(timezone);
  const { logDate, logDateLabel, returnTo } = resolveLogDateContext({ url, today });
  const defaultMealType = mealTypeForTime({ at: new Date(), timezone });

  const allLogs = await listLocalFoodLogs();
  const recentFoods = computeLocalRecentFoods(allLogs, { limit: RECENT_SCAN_LIMIT });
  const matchedRecents = filterLocalRecentsByQuery({ recentFoods, query, limit: RECENT_DISPLAY_LIMIT });

  // Unconditional (not query-scoped) — feeds both the query-filtered search
  // candidates below AND the "Your foods" management sheet.
  const customFoods = await listLocalFoods();

  let customCandidates: AddSearchCandidate[] = [];
  let curatedMatches: FoodMatch[] = [];
  let throttled = false;
  let retryAfterMs: number | null = null;
  if (query !== '') {
    const lowerQuery = query.toLowerCase();
    customCandidates = customFoods
      .filter((food) => food.name.toLowerCase().includes(lowerQuery))
      .slice(0, CUSTOM_DISPLAY_LIMIT)
      .map((food) => Object.assign(localFoodToCandidate(food), { matchTier: null }));
    // Only the food NAME is sent to the curated food database, and the call
    // is fail-open — a down/erroring lookup yields no curated matches while
    // recents + custom foods still render (no error wall). A THROTTLED lookup
    // is distinct from a genuine empty result — see `describeSearchPause` and
    // the throttled banner in `SearchStep` for how that reaches the person
    // instead of a false "nothing found".
    if (query.length >= MIN_CURATED_QUERY_LENGTH) {
      const resolved = await fetchFoodMatches([query]);
      curatedMatches = orderCuratedMatchesForReadability(resolved.matches[0] ?? []);
      throttled = resolved.throttled;
      retryAfterMs = resolved.retryAfterMs;
    }
  }

  // SAFETY: `federateLocalQuickAddCandidates` only filters/reorders the objects
  // passed in below (never reconstructs them — see its source), so every element
  // still carries the `matchTier` decoration added here even though the
  // function's declared return type doesn't know about that add.tsx-local field.
  const candidates = federateLocalQuickAddCandidates({
    recent: matchedRecents.map((recent) => Object.assign(localRecentFoodToCandidate(recent), { matchTier: null })),
    custom: customCandidates,
    curated: curatedMatches.map((match) =>
      Object.assign(localCuratedMatchToCandidate(match), { matchTier: matchTier(match.score) }),
    ),
  }) as AddSearchCandidate[];

  return {
    query,
    returnTo,
    defaultMealType,
    candidates,
    customFoods,
    hasAnyRecent: recentFoods.length > 0,
    logDate,
    logDateLabel,
    throttled,
    retryAfterMs,
    speak: url.searchParams.get('speak') === '1',
  };
}
clientLoader.hydrate = true as const;

/** Resolves the optional back-dating of a log: the instant to stamp (mid-day preserved) + the active day for the toast. */
function resolveLoggedAt({ date, timezone }: { date: string | undefined; timezone: string }) {
  const activeDate = date !== undefined && date !== todayInTimezone(timezone) ? date : null;
  const now = new Date();
  return { loggedAtMs: (activeDate ? instantOnDate(activeDate, timezone) : now).getTime(), activeDate };
}

/**
 * Fires the shared add toast, then returns the redirect back to wherever the
 * add flow was entered from (M129/03).
 *
 * The toast reports the day's running net-carb total, which is why it happens
 * HERE rather than in a `redirectWithLocalToast` call: the total has to be read
 * after the write. Every add path in the app writes through the one sonner id
 * behind `showFoodAddedToast`, so confirming a multi-item plate — or tapping
 * four chips in a row — collapses into a single updating toast.
 *
 * @param options.name - the food just logged.
 * @param options.mealType - the meal it landed in, or null.
 * @param options.dayKey - the day it landed on.
 * @param options.activeDate - the back-dated day, or null when it's today.
 * @param options.returnTo - the path to redirect to.
 * @returns the redirect response.
 */
async function addedToastRedirect({
  name,
  mealType,
  dayKey,
  activeDate,
  returnTo,
}: {
  name: string;
  mealType: LocalFoodLog['mealType'];
  dayKey: string;
  activeDate: string | null;
  returnTo: string;
}): Promise<Response> {
  const totals = await readDayCarbTotals(dayKey);
  showFoodAddedToast({
    name,
    // Translated here rather than via `#app/lib/meal-time`'s `mealLabel`,
    // which returns fixed English — the toast renders whatever string this
    // call site hands it.
    mealLabel: translate(MEAL_LABEL_KEYS[mealType ?? 'none']),
    netCarbsTotal: totals.netCarbs,
    hasEstimates: totals.hasEstimates,
    dayLabel: activeDate === null ? null : formatDayLabel(activeDate, currentLanguage()),
    // Both the copy and the figure, from the same client-only singleton the
    // `mealLabel` line above already uses (see `translate`'s doc). Without the
    // pair, a German user logging a food got an English toast carrying an
    // English-formatted number — the one surface `/add` still spoke English on.
    t: translate,
    language: currentLanguage(),
  });
  return redirect(returnTo);
}

/** Builds the per-100g macro set from the optional numeric form fields. */
function macrosFromFields(data: {
  carbs?: number;
  fiber?: number;
  sugars?: number;
  polyols?: number;
  protein?: number;
  fat?: number;
  kcal?: number;
}): Macros {
  return {
    carbs: data.carbs ?? null,
    fiber: data.fiber ?? null,
    sugars: data.sugars ?? null,
    polyols: data.polyols ?? null,
    protein: data.protein ?? null,
    fat: data.fat ?? null,
    kcal: data.kcal ?? null,
  };
}

/**
 * Builds the food-log entry a validated portion-step submission persists —
 * the pure core of `handleLog`, split out so the whole "search candidate →
 * stored entry" path is unit-testable without a store, a clock, or a form
 * (same precedent as `#app/lib/log-edit`'s `computeEditPatch`). Every impure
 * input (id, instant, day) is passed in rather than generated here.
 *
 * @param options.data - a successfully parsed portion-step submission.
 * @param options.id - the client-generated entry id / idempotency key.
 * @param options.loggedAtMs - the instant the entry is logged against.
 * @param options.dayKey - the device-local calendar day the entry belongs to.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the entry to persist.
 */
export function buildLoggedEntry({
  data,
  id,
  loggedAtMs,
  dayKey,
  createdAtMs,
}: {
  data: LogInput;
  id: string;
  loggedAtMs: number;
  dayKey: string;
  createdAtMs: number;
}): LocalFoodLog {
  const macrosPer100g = macrosFromFields(data);
  const curatedSource = data.curatedSource && data.curatedSource.trim() !== '' ? data.curatedSource.trim() : null;
  return {
    id,
    name: data.name,
    quantityGrams: data.quantityGrams,
    macros: scaleMacrosPer100gToServing(macrosPer100g, data.quantityGrams),
    mealType: data.mealType ?? null,
    source: 'manual',
    // Provenance is carried from the source: a curated pick isn't AI-guessed,
    // and a recent re-log copies the original entry's flag.
    aiEstimated: data.aiEstimated,
    curatedSource,
    foodId: data.foodId ?? null,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId: null,
    portion: data.portion ?? null,
    // Snapshotted per-100g so a later quantity edit rescales it correctly.
    // Absent for candidates with no upstream figure (see `LogSchema`). THIS is
    // the line that makes an origin-aware net-carbs figure survive being
    // logged instead of dying at the store boundary — see
    // `tests/unit/authoritative-net-carbs-wiring.test.ts`.
    netCarbsPer100g: data.netCarbsPer100g,
    // The candidate's printed-panel convention, snapshotted alongside the
    // figure above for the identical reason — see `LogSchema.carbBasis`'s
    // doc comment. Absent (never `'total'`) for a candidate with no basis,
    // exactly the UNKNOWN-means-`total`-in-computation-but-not-in-storage
    // rule `#app/lib/net-carbs` documents.
    carbBasis: parseCarbBasis(data.carbBasis) ?? undefined,
    // The upstream vitamins/minerals, snapshotted per-100 g at log time for
    // the same reason the figure above is — this is the line that lets a day's
    // micronutrient coverage reflect what was actually eaten.
    micronutrientsPer100g: data.micronutrientsPer100g,
    // The source's licence credit, snapshotted at log time (never re-looked-up
    // later — see `LocalFoodLog.attribution`). Null for a candidate whose
    // source carries none. Same defect as the line above, one field over: the
    // credit reached the portion step's header and then died here, so the
    // entry detail page's `AttributionNote` had nothing to render, ever.
    attribution: toStoredAttribution(data.attribution),
  };
}

/** Logs a chosen search candidate (recent re-log / custom / curated) — one tap from the portion step. */
async function handleLog({
  formData,
  returnTo,
  timezone,
}: {
  formData: FormData;
  returnTo: string;
  timezone: string;
}): Promise<ActionResult | Response> {
  const submission = parseWithZod(formData, { schema: createLogSchema(translate) });
  if (submission.status !== 'success') {
    return { intent: 'log', submission: submission.reply() };
  }
  const data = submission.value;
  const { loggedAtMs, activeDate } = resolveLoggedAt({ date: data.date, timezone });
  const dayKey = todayInTimezone(timezone, new Date(loggedAtMs));
  await putLocalFoodLog(
    buildLoggedEntry({
      data,
      id: randomUuid(),
      loggedAtMs,
      dayKey,
      createdAtMs: Date.now(),
    }),
  );
  return addedToastRedirect({ name: data.name, mealType: data.mealType ?? null, dayKey, activeDate, returnTo });
}

/**
 * Builds the PERSONAL FOOD a manual entry saves — the pure core of the food
 * half of `handleManual`, split out for the same reason `buildConfirmedFood`
 * (`app/routes/scan.tsx`) was: this is the OTHER way a personal food comes into
 * existence, and the two differ in exactly what they may claim about their
 * source. What a manual food must NOT carry is as load-bearing as what the
 * scanned one must, and while this object was written inline no test could
 * drive it to prove either.
 *
 * @param options.name - the food's name as typed.
 * @param options.macrosPer100g - the per-100 g macros, with `carbs` already narrowed to a number (the personal-food invariant).
 * @param options.id - the client-generated food id.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the personal food to persist.
 */
export function buildManualFood({
  name,
  macrosPer100g,
  carbBasis,
  id,
  createdAtMs,
}: {
  name: string;
  macrosPer100g: Macros & { carbs: number };
  /** The confirmed panel convention, or null for "not sure" — persists as absent. */
  carbBasis: CarbBasis | null;
  id: string;
  createdAtMs: number;
}): LocalPersonalFood {
  return {
    id,
    name,
    brand: null,
    macrosPer100g,
    source: 'user',
    createdAt: createdAtMs,
    carbBasis: carbBasis ?? undefined,
    // `netCarbsPer100g` is deliberately OMITTED, exactly as it is on the log
    // `handleManual` writes alongside this: on a manual entry the person typing
    // the label IS the source, so there is no upstream figure to snapshot.
    // Leaving it absent makes `localFoodToCandidate` hand `undefined` to
    // `computeMacroPreview`, which then computes net carbs from the very
    // numbers they typed — the correct answer. Do not "fix" this by deriving
    // one from the parts: that would claim an authority this food doesn't have
    // and freeze a value that must track a later macro edit.
    //
    // `micronutrientsPer100g` (v10) is OMITTED for the same reason and one step
    // more firmly: a nutrition label carries no vitamin or mineral figures,
    // nobody measured them, and this form never asks for them. Absent is the
    // honest answer and the aggregation reads it as UNCOVERED. Filling the key
    // with empty blocks, or with zeros, would turn "we don't know" into "we
    // measured none" — the one collapse the whole micronutrient dimension
    // exists to prevent (`#app/lib/micronutrients`). The scan's applied-match
    // food is the ONLY personal food that may claim micronutrients.
  };
}

/** Manual fallback: create a personal food when per-100g carbs are given, then log it (mirrors diary quick-add). */
async function handleManual({
  formData,
  returnTo,
  timezone,
}: {
  formData: FormData;
  returnTo: string;
  timezone: string;
}): Promise<ActionResult | Response> {
  const submission = parseWithZod(formData, { schema: createManualSchema(translate) });
  if (submission.status !== 'success') {
    return { intent: 'manual', submission: submission.reply() };
  }
  const data = submission.value;
  const enteredMacros = macrosFromFields(data);
  // Package labels are almost never printed "per 100 g" — this converts a
  // "per serving (30 g)" entry to the per-100g basis the rest of the tracker
  // stores. A non-positive/absent serving size degrades to all-null macros
  // (never a crash, never a fabricated number) — see `resolveMacrosPer100gFromEntry`.
  const macrosPer100g = resolveMacrosPer100gFromEntry({
    basis: data.macroBasis,
    macros: enteredMacros,
    servingGrams: data.servingGrams ?? 0,
  });
  // Without carbs (the only NOT-NULL macro on a personal food) we can't persist
  // a master food, so the log stays foodId-less — exactly like the diary quick-add.
  // Gated on the CONVERTED figure, not the raw typed value — for a per-serving
  // entry those can differ, and only the converted one is what actually gets stored.
  const carbsPer100g = macrosPer100g.carbs;
  const carbBasis = parseCarbBasis(data.carbBasis);
  let foodId: string | null = null;
  if (carbsPer100g !== null) {
    foodId = randomUuid();
    await putLocalFood(
      buildManualFood({
        name: data.name,
        macrosPer100g: { ...macrosPer100g, carbs: carbsPer100g },
        carbBasis,
        id: foodId,
        createdAtMs: Date.now(),
      }),
    );
  }
  const { loggedAtMs, activeDate } = resolveLoggedAt({ date: data.date, timezone });
  const dayKey = todayInTimezone(timezone, new Date(loggedAtMs));
  await putLocalFoodLog({
    id: randomUuid(),
    name: data.name,
    quantityGrams: data.quantityGrams,
    macros: scaleMacrosPer100gToServing(macrosPer100g, data.quantityGrams),
    mealType: data.mealType ?? null,
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: Date.now(),
    logBatchId: null,
    carbBasis: carbBasis ?? undefined,
    // `netCarbsPer100g` and `attribution` are both deliberately OMITTED here:
    // on a manual entry the person typing the label IS the source, so there is
    // no upstream figure to snapshot and no third party to credit. Leaving the
    // figure absent makes the readers compute net carbs from the macros they
    // just typed — the correct answer. Do not "fix" this by deriving one from
    // the parts: that would claim upstream authority the entry doesn't have,
    // and would suppress the day's `hasUnknowns` caveat when they left fibre
    // blank.
  });
  return addedToastRedirect({ name: data.name, mealType: data.mealType ?? null, dayKey, activeDate, returnTo });
}

/** Deletes a custom food (the "Your foods" management sheet). Fails fast on a malformed payload — this is a hidden, self-authored submission, never a user-typed form. */
async function handleDeleteFood({ formData }: { formData: FormData }): Promise<DeleteFoodResult> {
  const submission = parseWithZod(formData, { schema: DeleteFoodSchema });
  if (submission.status !== 'success') throw new Response('Invalid delete payload', { status: 400 });
  const existing = await getLocalFood(submission.value.foodId);
  await deleteLocalFood(submission.value.foodId);
  return {
    intent: 'deleteFood',
    foodId: submission.value.foodId,
    name: existing?.name ?? translate('add.custom.fallbackName'),
  };
}

/** Edits a custom food's name/macros (the "Your foods" management sheet). */
async function handleEditFood({ formData }: { formData: FormData }): Promise<EditFoodResult> {
  const submission = parseWithZod(formData, { schema: EditFoodSchema });
  if (submission.status !== 'success') return { intent: 'editFood', ok: false, reason: 'invalid' };
  const data = submission.value;
  const enteredMacros = macrosFromFields(data);
  const macrosPer100g = resolveMacrosPer100gFromEntry({
    basis: data.macroBasis,
    macros: enteredMacros,
    servingGrams: data.servingGrams ?? 0,
  });
  // Every existing personal food was created with carbs known (see
  // `handleManual`) — an edit must preserve that invariant rather than
  // silently saving an incomplete food or silently discarding the person's edit.
  if (macrosPer100g.carbs === null) return { intent: 'editFood', ok: false, reason: 'carbs-required' };
  const existing = await getLocalFood(data.foodId);
  if (!existing) throw new Response('Food not found', { status: 404 });
  // A food created by the scan's confirm step from an APPLIED CURATED MATCH
  // carries that match's authoritative net-carbs figure. Hand-changing the
  // macros makes the person the source of these numbers, so a figure
  // snapshotted from a food database no longer describes them — it has to
  // clear, exactly as it does when a LOG's macros are edited. Reuses the same
  // pure helpers (`macrosDiffer`/`resolveEditedNetCarbsPer100g`) rather than
  // re-deciding the rule here, so the food and the log can never drift apart on
  // when the figure survives. A name-only edit leaves the macros identical and
  // therefore keeps the figure.
  const netCarbsPer100g = resolveEditedNetCarbsPer100g({
    macrosChanged: macrosDiffer(existing.macrosPer100g, macrosPer100g),
    current: existing.netCarbsPer100g,
  });
  // `micronutrientsPer100g` (v10) deliberately rides the `...existing` spread
  // below rather than getting a rule of its own: it follows `attribution`'s
  // rule, not the figure's. Net carbs are derived from the very macros being
  // edited, so an upstream figure computed for different numbers becomes a lie;
  // a vitamin C measurement is an independent fact about the matched food that
  // the person adjusting a carb value has neither measured nor invalidated.
  // Same split `resolveAppliedMatchSnapshot` draws on the scan side.
  //
  // `carbBasis` (spec 13, M123), by contrast, is NOT cleared by this edit —
  // it is a property of the printed panel the person is looking at, not of
  // the upstream snapshot the macro edit just invalidated. The edit form's
  // three-state control DOES let the person correct it explicitly (this is
  // the escape hatch spec 13 gives an already-UNKNOWN row), so the submitted
  // value wins outright rather than falling back to `existing.carbBasis`.
  const carbBasis = parseCarbBasis(data.carbBasis);
  await putLocalFood({
    ...existing,
    name: data.name,
    macrosPer100g: { ...macrosPer100g, carbs: macrosPer100g.carbs },
    netCarbsPer100g,
    carbBasis: carbBasis ?? undefined,
  });
  return { intent: 'editFood', ok: true, name: data.name };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  // The "Your foods" management sheet's two intents don't need the log-date/
  // returnTo context below — they mutate a saved food directly, not a log.
  if (intent === 'deleteFood') return handleDeleteFood({ formData });
  if (intent === 'editFood') return handleEditFood({ formData });

  const returnTo = sanitizeReturnTo(z.string().safeParse(formData.get('returnTo')).data ?? null);
  const profile = await getLocalProfileGoals();
  const timezone = resolveLocalTimezone(profile);
  if (intent === 'manual') return handleManual({ formData, returnTo, timezone });
  return handleLog({ formData, returnTo, timezone });
}

////////////////////////////////////////////////////////////////////////////////
// View (functional shell)
////////////////////////////////////////////////////////////////////////////////

/**
 * Active back-dating context shared by the search and portion steps. When
 * `date` is null the flow logs to today (no banner, no hidden input, bare
 * links); when set, every step surfaces the "Logging to <day>" banner and
 * carries the day through as a hidden `date` input.
 */
interface LogDateContext {
  /** The active non-today day (`YYYY-MM-DD`), or null when logging to today. */
  date: string | null;
  /** Human day label for the context banner, or null when logging to today. */
  label: string | null;
  /** Href that clears the date param (preserving `q`) to switch back to today. */
  switchToTodayHref: string;
}

/** Provenance header key for the portion step, per source. */
const SOURCE_HEADER_KEYS = {
  recent: 'add.portion.source.recent',
  custom: 'add.portion.source.custom',
  curated: 'add.portion.source.curated',
} satisfies Record<LocalQuickAddSource, string>;

/** Muted per-portion protein/fat/kcal line; unknown (null) fields are skipped, never shown as 0. */
function formatPortionMacroLine(preview: MacroPreview, t: Translate, language: string): string {
  const parts: string[] = [];
  if (preview.proteinForPortion !== null) {
    parts.push(t('add.portion.protein', { value: formatMacroNumberIn(language, preview.proteinForPortion) }));
  }
  if (preview.fatForPortion !== null) {
    parts.push(t('add.portion.fat', { value: formatMacroNumberIn(language, preview.fatForPortion) }));
  }
  if (preview.kcalForPortion !== null) {
    parts.push(t('add.portion.calories', { value: formatMacroNumberIn(language, preview.kcalForPortion) }));
  }
  return parts.join(' · ');
}

/** Hidden-input string for a per-100g macro (null → empty string, so unknowns stay blank). */
function toHiddenMacro(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Shared chip-button classes (portion choices, meal-less states, basis toggle) — a small selected/unselected pill. */
function chipButtonClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
  );
}

/** A relative-size fallback chip — a label plus the gram weight it actually represents, never hidden behind vague wording like the old "As shown". */
export interface FallbackPortionChoice {
  label: string;
  grams: number;
}

/** Multipliers of the resolved default grams used to build the fallback size chips, smallest first. */
const FALLBACK_PORTION_SIZES: readonly { labelKey: string; multiplier: number }[] = [
  { labelKey: 'add.portion.fallback.small', multiplier: 0.75 },
  { labelKey: 'add.portion.fallback.medium', multiplier: 1 },
  { labelKey: 'add.portion.fallback.large', multiplier: 1.5 },
];

/**
 * Relative-size chips ("Small (75 g)" / "Medium (100 g)" / "Large (150 g)")
 * for a candidate with no resolvable household unit or upstream serving size
 * (`candidate.defaultPortion === null` — see `#app/lib/portions`'
 * `resolveDefaultPortion`). Defect: a food like "Chicken breast" used to
 * offer nothing but a bare grams box pre-filled with a number the person had
 * to just accept or guess around — every chip here states its own gram
 * weight up front, so nobody has to invent a number from nothing even when
 * the food has no natural per-unit label ("egg", "slice") to hang a chip on.
 * A collision from rounding (e.g. a very small reference weight) is dropped
 * rather than shown as a duplicate. Exported for direct testability.
 */
export function deriveFallbackPortionChoices(referenceGrams: number, t: Translate): FallbackPortionChoice[] {
  const seenGrams = new Set<number>();
  const choices: FallbackPortionChoice[] = [];
  for (const { labelKey, multiplier } of FALLBACK_PORTION_SIZES) {
    const grams = Math.max(1, Math.round(referenceGrams * multiplier));
    if (seenGrams.has(grams)) continue;
    seenGrams.add(grams);
    choices.push({ label: t(labelKey, { grams }), grams });
  }
  return choices;
}

/**
 * The portion step: a chosen candidate's name + provenance, a grams input
 * with real portion chips ("1 egg" / "2 eggs") when a natural unit resolved,
 * or stated-weight relative-size chips ("Small (75 g)") when it didn't (never
 * a bare box with nothing to tap), a live read-only macro preview, and a
 * time-of-day-defaulted meal select. One tap logs it — the write commits
 * directly to the on-device primary store (M117/03), so there is no
 * online/offline branch here anymore: the form always submits normally.
 *
 * Exported for direct testability: `tests/unit/authoritative-net-carbs-wiring.test.ts`
 * renders this component and `SearchResultRow` against the same candidate to
 * pin that the two surfaces show the SAME net-carb number (they once didn't).
 */
export function PortionStep({
  candidate,
  defaultMealType,
  returnTo,
  logContext,
  lastResult,
  onBack,
}: {
  candidate: AddSearchCandidate;
  defaultMealType: string;
  returnTo: string;
  logContext: LogDateContext;
  lastResult: SubmissionResult<string[]> | undefined;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting' && navigation.formData?.get('_intent') === 'log';
  const [gramsInput, setGramsInput] = useState<string>(() => String(candidate.defaultGrams));
  const [mealType, setMealType] = useState<string>(defaultMealType);

  const [form, fields] = useForm({
    id: 'quick-add-log',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: createLogSchema(t) });
    },
    shouldValidate: 'onBlur',
  });

  const gramsNumber = Number(gramsInput);
  const validGrams = Number.isFinite(gramsNumber) && gramsNumber > 0 ? gramsNumber : null;
  // Distinguish "macros unknown" (no carbs on the source) from "grams not yet
  // entered" — the former shows the name-only note, the latter just hides the
  // badge until a valid weight is typed.
  const macrosKnown = candidate.macrosPer100g.carbs !== null;
  // `candidate.authoritativeNetCarbsPer100g` is the upstream figure for this
  // candidate — LCC's own origin-aware value for a curated match, the original
  // log's own for a 'recent' re-log — passed straight through, never
  // recomputed here (see `computeMacroPreview`'s doc and
  // `#app/lib/local-store/local-quick-add`'s honesty-rule note). Without this,
  // a bls/curated match's fiber-exclusive carbs got double-subtracted by the
  // local `carbs - fiber` formula and displayed 0g net carbs on screen while
  // the API reported the correct figure. `undefined` (a personal food, a
  // manual entry) is the "no upstream figure" state and correctly falls back
  // to that local formula inside `computeMacroPreview`.
  const preview =
    validGrams !== null ?
      computeMacroPreview({
        macrosPer100g: candidate.macrosPer100g,
        grams: validGrams,
        authoritativeNetCarbsPer100g: candidate.authoritativeNetCarbsPer100g,
        carbBasis: candidate.carbBasis,
      })
    : null;
  const carbStatus = preview ? getCarbStatus(preview.netCarbsPer100g) : null;
  const mutedPreview = preview ? formatPortionMacroLine(preview, t, i18n.language) : '';

  // Real portion chips ("2 eggs") when a natural unit resolved for this food;
  // otherwise stated-weight relative-size chips ("Small (75 g)") — see
  // `deriveFallbackPortionChoices` — so there's always something to tap, never
  // a bare grams box with a number to invent from nothing.
  const portionChoices =
    candidate.defaultPortion ? derivePortionChoices(candidate.defaultPortion, i18n.language) : [];
  const fallbackPortionChoices =
    candidate.defaultPortion ? [] : deriveFallbackPortionChoices(candidate.defaultGrams, t);
  const selectedQuantity =
    portionChoices.length > 0 && validGrams !== null ?
      deriveSelectedPortionQuantity({ choices: portionChoices, currentGrams: validGrams })
    : null;
  // Only set when the current grams exactly match one of the chip choices —
  // a manual edit to an in-between weight persists as grams-only (null), same
  // as the field's own "doesn't correspond to a whole portion choice" contract.
  const selectedPortion: DisplayPortion | null =
    candidate.defaultPortion && selectedQuantity !== null ?
      { unit: candidate.defaultPortion.unit, quantity: selectedQuantity, gramsPerUnit: candidate.defaultPortion.gramsPerUnit }
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t('add.portion.back')}
      </button>
      {logContext.date && logContext.label && (
        <LoggingToBanner label={logContext.label} switchToTodayHref={logContext.switchToTodayHref} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="line-clamp-2">{candidate.name}</CardTitle>
          <CardDescription>{t(SOURCE_HEADER_KEYS[candidate.source])}</CardDescription>
          {/* The source's licence credit (e.g. CC BY 4.0) — real, and kept
              discoverable, but placed up here in the header rather than
              between the macro preview and the primary "Add to diary" button
              (defect: it used to sit directly in the path of that tap). */}
          {candidate.attribution && <p className="text-xs text-muted-foreground">{candidate.attribution}</p>}
        </CardHeader>
        <CardContent>
          <Form method="post" {...getFormProps(form)} className="space-y-4">
            <input type="hidden" name="_intent" value="log" />
            <input type="hidden" name="returnTo" value={returnTo} />
            {logContext.date && <input type="hidden" name="date" value={logContext.date} />}
            <input type="hidden" name={fields.name.name} value={candidate.name} />
            <input type="hidden" name={fields.curatedSource.name} value={candidate.curatedSource ?? ''} />
            <input type="hidden" name={fields.foodId.name} value={candidate.foodId ?? ''} />
            <input type="hidden" name={fields.aiEstimated.name} value={candidate.aiEstimated ? 'true' : 'false'} />
            <input type="hidden" name={fields.portion.name} value={encodeDisplayPortion(selectedPortion)} />
            {/* No source-tier gate here — the DATA is the gate, exactly as on
                the diary's chip re-log. `candidate.authoritativeNetCarbsPer100g`
                is three-state and only ever holds an UPSTREAM figure, so a
                candidate with none carries `undefined`, which
                `encodeAuthoritativeNetCarbs` writes as `''` and the schema
                decodes straight back to `undefined` — nothing persisted, no
                authority claimed. This used to read `source === 'curated' &&`,
                which existed solely to compensate for the field conflating an
                upstream figure with a locally re-derived display estimate (see
                `LocalQuickAddCandidate.authoritativeNetCarbsPer100g`). That gate
                also threw away the genuine figure a 'recent' candidate inherits
                from its own log, so the SAME favourite logged from here and from
                the diary chip produced two different day totals. */}
            <input
              type="hidden"
              name={fields.netCarbsPer100g.name}
              value={encodeAuthoritativeNetCarbs(candidate.authoritativeNetCarbsPer100g)}
            />
            {/* Same rule, one field over: `candidate.carbBasis` is the same
                value `computeMacroPreview` below already reads for the
                on-screen figure. Without this hidden field the preview and
                the stored row disagreed — see `LogSchema.carbBasis`'s doc. */}
            <input type="hidden" name={fields.carbBasis.name} value={candidate.carbBasis ?? ''} />
            {/* Same "the data is the gate" rule, one dimension over: a
                candidate with no micronutrient snapshot encodes to `''`, which
                decodes back to `undefined` — nothing persisted, nothing
                fabricated, and the day reads as uncovered for those nutrients
                instead of quietly gaining a pile of zeros. */}
            <input
              type="hidden"
              name={fields.micronutrientsPer100g.name}
              value={encodeMicronutrients(candidate.micronutrientsPer100g)}
            />
            {/* Same rule as the figure above, for the same reason: the value
                is already `null` for every candidate whose source carries no
                credit, and a recent re-log of a curated food SHOULD carry the
                original's credit forward (the licence obligation follows the
                data, not the entry point). Blank submits as "no credit".
                This field never had a source gate; the one above did, and that
                asymmetry was the bug. */}
            <input type="hidden" name={fields.attribution.name} value={candidate.attribution ?? ''} />
            {MACRO_KEYS.map((key) => (
              <input
                key={key}
                type="hidden"
                name={fields[key].name}
                value={toHiddenMacro(candidate.macrosPer100g[key])}
              />
            ))}

            <div className="grid gap-2">
              <Label htmlFor={fields.quantityGrams.id}>{t('add.portion.grams')}</Label>
              <Input
                id={fields.quantityGrams.id}
                name={fields.quantityGrams.name}
                type="number"
                step="0.1"
                inputMode="decimal"
                className="h-11"
                value={gramsInput}
                onChange={(event) => setGramsInput(event.target.value)}
              />
              <FieldError id={fields.quantityGrams.errorId} errors={fields.quantityGrams.errors} />
            </div>

            {portionChoices.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {portionChoices.map((choice) => (
                  <button
                    key={choice.quantity}
                    type="button"
                    aria-pressed={selectedQuantity === choice.quantity}
                    onClick={() => setGramsInput(String(choice.grams))}
                    className={chipButtonClass(selectedQuantity === choice.quantity)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}

            {portionChoices.length === 0 && fallbackPortionChoices.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fallbackPortionChoices.map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    aria-pressed={validGrams === choice.grams}
                    onClick={() => setGramsInput(String(choice.grams))}
                    className={chipButtonClass(validGrams === choice.grams)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}

            {!macrosKnown && <p className="text-xs text-muted-foreground">{t('add.portion.macrosUnknown')}</p>}
            {macrosKnown && preview && carbStatus && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    carbStatusBadgeClass[carbStatus],
                  )}
                >
                  {t('add.portion.netCarbs', { value: formatMacroNumberIn(i18n.language, preview.netCarbsForPortion) })}
                </span>
                {mutedPreview && <span className="text-xs text-muted-foreground">{mutedPreview}</span>}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor={fields.mealType.id}>{t('add.portion.meal')}</Label>
              <Select
                value={mealType || NO_MEAL_VALUE}
                onValueChange={(value) => setMealType(value === NO_MEAL_VALUE ? '' : value)}
              >
                <SelectTrigger id={fields.mealType.id} className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MEAL_VALUE}>{t(MEAL_LABEL_KEYS.none)}</SelectItem>
                  {MEAL_TYPES.map((meal) => (
                    <SelectItem key={meal} value={meal}>
                      {t(MEAL_LABEL_KEYS[meal])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name={fields.mealType.name} value={mealType} />
            </div>

            {candidate.url && (
              <a
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-primary underline-offset-4 hover:underline"
              >
                {t('add.portion.viewDetails')}
              </a>
            )}

            <SubmitButton pending={isSaving} pendingLabel={t('add.portion.submitPending')} className="w-full">
              {t('add.portion.submit')}
            </SubmitButton>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

/** The manual fallback form — a fresh name + macros entry, mirroring the diary quick-add, with a per-100g/per-serving toggle for typing a package label as printed. */
function ManualAddForm({
  returnTo,
  logDate,
  lastResult,
}: {
  returnTo: string;
  logDate: string | null;
  lastResult: SubmissionResult<string[]> | undefined;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting' && navigation.formData?.get('_intent') === 'manual';
  const [mealType, setMealType] = useState<string>('');
  const [macroBasis, setMacroBasis] = useState<MacroEntryBasis>('per100g');
  // Default "not sure" (spec 13, M123) — this is a FRESH food, there is no
  // existing basis to pre-fill from.
  const [carbBasis, setCarbBasis] = useState<CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE>(CARB_BASIS_NOT_SURE_VALUE);

  const [form, fields] = useForm({
    id: 'quick-add-manual',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: createManualSchema(t) });
    },
    shouldValidate: 'onBlur',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('add.manual.title')}</CardTitle>
        <CardDescription>{t('add.manual.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" {...getFormProps(form)} className="space-y-4">
          <input type="hidden" name="_intent" value="manual" />
          <input type="hidden" name="returnTo" value={returnTo} />
          {logDate && <input type="hidden" name="date" value={logDate} />}
          <input type="hidden" name={fields.macroBasis.name} value={macroBasis} />
          <div className="grid gap-2">
            <Label htmlFor={fields.name.id}>{t('add.manual.name')}</Label>
            <Input
              {...getInputProps(fields.name, { type: 'text' })}
              className="h-11"
              placeholder={t('add.manual.namePlaceholder')}
            />
            <FieldError id={fields.name.errorId} errors={fields.name.errors} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor={fields.quantityGrams.id}>{t('add.manual.grams')}</Label>
              <Input {...getInputProps(fields.quantityGrams, { type: 'number', step: '0.1' })} className="h-11" />
              <FieldError id={fields.quantityGrams.errorId} errors={fields.quantityGrams.errors} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={fields.mealType.id}>{t('add.manual.mealOptional')}</Label>
              <Select
                value={mealType || NO_MEAL_VALUE}
                onValueChange={(value) => setMealType(value === NO_MEAL_VALUE ? '' : value)}
              >
                <SelectTrigger id={fields.mealType.id} className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MEAL_VALUE}>{t(MEAL_LABEL_KEYS.none)}</SelectItem>
                  {MEAL_TYPES.map((meal) => (
                    <SelectItem key={meal} value={meal}>
                      {t(MEAL_LABEL_KEYS[meal])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name={fields.mealType.name} value={mealType} />
              <FieldError id={fields.mealType.errorId} errors={fields.mealType.errors} />
            </div>
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-1 px-0">
                <ChevronDown className="h-4 w-4" /> {t('add.manual.nutritionToggle')}
              </Button>
            </CollapsibleTrigger>
            {/* Fine-tune: forceMount keeps the inputs in the DOM (so they always submit) while collapsed. */}
            <CollapsibleContent forceMount className="space-y-4 pt-2 data-[state=closed]:hidden">
              {/* Disambiguates "(optional)" on the trigger above — nutrition
                  really is skippable to just log this once, but adding carbs
                  is what lets it get saved and reused (defect: the card used
                  to flatly say "Carbs are needed to save it" right next to a
                  collapsible literally titled "optional", contradicting itself). */}
              <p className="text-xs text-muted-foreground">{t('add.manual.nutritionHint')}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={macroBasis === 'per100g'}
                  onClick={() => setMacroBasis('per100g')}
                  className={chipButtonClass(macroBasis === 'per100g')}
                >
                  {t('add.manual.per100g')}
                </button>
                <button
                  type="button"
                  aria-pressed={macroBasis === 'perServing'}
                  onClick={() => setMacroBasis('perServing')}
                  className={chipButtonClass(macroBasis === 'perServing')}
                >
                  {t('add.manual.perServing')}
                </button>
              </div>
              {macroBasis === 'perServing' && (
                <div className="grid max-w-40 gap-1">
                  <Label htmlFor={fields.servingGrams.id}>{t('add.manual.servingSize')}</Label>
                  <Input {...getInputProps(fields.servingGrams, { type: 'number', step: '0.1' })} />
                  <FieldError id={fields.servingGrams.errorId} errors={fields.servingGrams.errors} />
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                {MACRO_FIELD_LABEL_KEYS.map(([key, labelKey]) => (
                  <div key={key} className="grid gap-1">
                    <Label htmlFor={fields[key].id}>{t(labelKey)}</Label>
                    <Input {...getInputProps(fields[key], { type: 'number', step: '0.1' })} />
                    <FieldError id={fields[key].errorId} errors={fields[key].errors} />
                  </div>
                ))}
              </div>
              <CarbBasisField
                name={fields.carbBasis.name}
                legend={t('add.custom.carbBasis.legend')}
                hint={t('add.custom.carbBasis.hint')}
                selected={carbBasis}
                onSelect={setCarbBasis}
                totalLabel={t('add.custom.carbBasis.total')}
                availableLabel={t('add.custom.carbBasis.available')}
                notSureLabel={t('add.custom.carbBasis.notSure')}
              />
            </CollapsibleContent>
          </Collapsible>

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSubmitting} pendingLabel={t('add.manual.submitPending')}>
            {t('add.manual.submit')}
          </SubmitButton>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * How long to tell a throttled person to wait, in plain words — never the raw
 * millisecond figure (that's an implementation detail, not something to read
 * aloud). `null` (the retry window wasn't reported) reads the same as "a few
 * seconds": short and non-committal beats a made-up precise number.
 */
export function describeSearchPause(retryAfterMs: number | null, t: Translate): string {
  if (retryAfterMs === null || retryAfterMs <= 15_000) return t('add.search.pause.seconds');
  if (retryAfterMs <= 90_000) return t('add.search.pause.minute');
  return t('add.search.pause.minutes');
}

/** Empty-state copy for the search step, keyed on whether there's a query and any history. Never shown while throttled — see `describeSearchPause`. */
export function searchEmptyMessage({
  query,
  hasAnyRecent,
  t,
}: {
  query: string;
  hasAnyRecent: boolean;
  t: Translate;
}): string {
  if (query !== '') return t('add.search.empty.noMatches', { query });
  if (hasAnyRecent) return t('add.search.empty.startTyping');
  return t('add.search.empty.firstTime');
}

/**
 * What the polite live region says once a SPOKEN search has settled.
 *
 * Speech is the one path where the person may not be looking at the screen, so
 * the count is spoken rather than merely rendered — and the transcript is
 * repeated back with it, because "no results" is useless without knowing which
 * word the recogniser actually heard.
 *
 * Three keys rather than an i18next `count` plural: the German and English
 * forms here differ only in the one/many split, and three flat keys keep the
 * catalog readable and this function trivially testable.
 *
 * @param input.count - how many candidates the settled search produced.
 * @param input.transcript - what the recogniser heard, as it was put in the field.
 */
export function speechResultsMessage({
  count,
  transcript,
  t,
}: {
  count: number;
  transcript: string;
  t: Translate;
}): string {
  if (count === 0) return t('add.speak.results.none', { transcript });
  if (count === 1) return t('add.speak.results.one', { transcript });
  // `n`, not `count`: an i18next `count` option switches the lookup into
  // plural-suffix resolution, and these three keys carry the plural split
  // themselves.
  return t('add.speak.results.many', { n: count, transcript });
}

/** Splits the federated candidate list into its three source buckets, preserving each bucket's existing (already relevance-ordered) order — one labeled section per bucket instead of one long undifferentiated list. */
export function groupCandidatesBySource(candidates: readonly AddSearchCandidate[]) {
  return {
    recent: candidates.filter((candidate) => candidate.source === 'recent'),
    custom: candidates.filter((candidate) => candidate.source === 'custom'),
    curated: candidates.filter((candidate) => candidate.source === 'curated'),
  };
}

/** One labeled group of result rows; renders nothing when empty. */
function CandidateSection({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: AddSearchCandidate[];
  onSelect: (candidate: AddSearchCandidate) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionEyebrow>{title}</SectionEyebrow>
      <div className="space-y-2">
        {items.map((candidate) => (
          <SearchResultRow
            key={`${candidate.source}:${candidate.name}`}
            candidate={candidate}
            onSelect={() => onSelect(candidate)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The search step: an autofocused, debounced search box over the federated
 * result rows (grouped by source) + a manual-entry escape hatch + the "Your
 * foods" management sheet. Recents and custom foods always come from the
 * on-device store (works offline); only the curated database results need a
 * connection, so the offline banner/messaging below is scoped to that (never
 * a "recents degraded" state — the local store has no such concept).
 */
function SearchStep({
  query,
  returnTo,
  logContext,
  candidates,
  customFoods,
  hasAnyRecent,
  throttled,
  retryAfterMs,
  speak,
  manualResult,
  onSelect,
}: {
  query: string;
  returnTo: string;
  logContext: LogDateContext;
  candidates: AddSearchCandidate[];
  customFoods: LocalPersonalFood[];
  hasAnyRecent: boolean;
  throttled: boolean;
  retryAfterMs: number | null;
  speak: boolean;
  manualResult: SubmissionResult<string[]> | undefined;
  onSelect: (candidate: AddSearchCandidate) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [searchValue, setSearchValue] = useState(query);
  const [showManual, setShowManual] = useState(manualResult !== undefined);

  // Debounced navigation to `/add?q=…` — same-route, so the client loader
  // refreshes without a full-page flash and focus stays in the input. The
  // active back-dating day rides along so the date context survives every
  // keystroke. Skipped while offline: the curated lookup would just fail-open
  // to nothing, so there's no point re-running the loader for it (recents/
  // custom results are already current — they never depend on network).
  useEffect(() => {
    if (!isOnline) return;
    const trimmed = searchValue.trim();
    if (trimmed === query) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (logContext.date) params.set('date', logContext.date);
      // Only emit returnTo when it differs from the natural (date-derived)
      // default the loader would reconstruct — keeps the URL clean while still
      // preserving an explicit onboarding returnTo.
      const naturalReturnTo = logContext.date ? `/diary?date=${logContext.date}` : DEFAULT_RETURN_TO;
      if (returnTo !== naturalReturnTo) params.set('returnTo', returnTo);
      const queryString = params.toString();
      navigate(queryString ? `/add?${queryString}` : '/add', { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchValue, query, returnTo, logContext.date, navigate, isOnline]);

  // Speech is a way to TYPE into the field below — never a way to log. The
  // button only exists once hydration confirms this browser has a recogniser
  // (`null` while that is still unknown), so a Firefox visitor and the server
  // render see the same plain field.
  const speechAvailable = useSpeechInputAvailable();
  const [speakArmed, setSpeakArmed] = useState(speak);
  const isSpeakArmed = speakArmed && speechAvailable === true;
  const [speechNotice, setSpeechNotice] = useState('');
  const [spokenQuery, setSpokenQuery] = useState<string | null>(null);

  // The search field is the whole point of this step, and reaching it is the
  // navigation the person just made — so focus moves there once, on mount,
  // rather than being reclaimed on every keystroke-driven re-render. The one
  // exception is `/add?speak=1`: there the microphone button claims focus
  // instead (it focuses itself on mount), so this waits for the availability
  // answer before deciding and then never runs again.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasClaimedInitialFocus = useRef(false);
  useEffect(() => {
    if (hasClaimedInitialFocus.current) return;
    if (speechAvailable === null) return;
    hasClaimedInitialFocus.current = true;
    if (speak && speechAvailable) return;
    searchInputRef.current?.focus();
  }, [speak, speechAvailable]);

  // A transcript lands as an ordinary edit of the field, and the caret goes to
  // its end so the person can correct a misheard ending by typing. Focus and
  // caret move in an effect rather than in the callback because the controlled
  // input only carries the new text after this render.
  const isCaretMovePending = useRef(false);
  useEffect(() => {
    if (!isCaretMovePending.current) return;
    isCaretMovePending.current = false;
    const field = searchInputRef.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [searchValue]);

  // The result count is announced only for a SPOKEN search, and only once the
  // debounced navigation has actually produced results for that transcript —
  // announcing on every keystroke would make the live region unusable.
  useEffect(() => {
    if (spokenQuery === null) return;
    if (query !== spokenQuery.trim()) return;
    setSpeechNotice(speechResultsMessage({ count: candidates.length, transcript: spokenQuery, t }));
    setSpokenQuery(null);
  }, [spokenQuery, query, candidates.length, t]);

  const applyTranscript = useCallback((transcript: string): void => {
    setSearchValue(transcript);
    setSpokenQuery(transcript);
    isCaretMovePending.current = true;
  }, []);

  const disarmSpeak = useCallback((): void => {
    setSpeakArmed(false);
  }, []);

  const grouped = groupCandidatesBySource(candidates);
  const scanHref = logContext.date ? `/scan?date=${logContext.date}` : '/scan';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <OfflineBanner message={t('add.search.offlineBanner')} />

      <div className="grid gap-2">
        <Label htmlFor="food-search">{t('add.search.label')}</Label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="food-search"
              ref={searchInputRef}
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={t('add.search.placeholder')}
              className="h-11 pl-9"
            />
          </div>
          {speechAvailable === true && (
            <SpeechInputButton
              armed={speakArmed}
              onTranscript={applyTranscript}
              onNotice={setSpeechNotice}
              onListenStart={disarmSpeak}
            />
          )}
        </div>
        {isSpeakArmed && <p className="text-xs text-muted-foreground">{t('add.speak.hint')}</p>}
        {/* One polite region for everything speech says back: the settled
            result count, and the three failure messages. `sr-only` because
            each of those is already visible on screen — the transcript in the
            field, the results below it — for anyone who is looking. */}
        <output aria-live="polite" className="sr-only">
          {speechNotice}
        </output>
        {!isOnline && searchValue.trim() !== query && (
          <p className="text-xs text-muted-foreground">{t('add.search.offlinePending')}</p>
        )}
        {throttled && (
          <output className="block text-xs text-muted-foreground">
            {t('add.search.throttled', { when: describeSearchPause(retryAfterMs, t) })}
          </output>
        )}
      </div>

      {logContext.date && logContext.label && (
        <LoggingToBanner label={logContext.label} switchToTodayHref={logContext.switchToTodayHref} />
      )}

      <Button asChild variant="outline" className="h-11 w-full justify-center gap-2 text-muted-foreground">
        <Link to={scanHref}>
          <Camera className="h-4 w-4" /> {t('add.search.scanInstead')}
        </Link>
      </Button>

      {candidates.length > 0 && (
        <div className="space-y-4">
          <CandidateSection title={t('add.search.sections.recent')} items={grouped.recent} onSelect={onSelect} />
          <CandidateSection title={t('add.search.sections.custom')} items={grouped.custom} onSelect={onSelect} />
          <CandidateSection title={t('add.search.sections.curated')} items={grouped.curated} onSelect={onSelect} />
        </div>
      )}

      {!throttled && candidates.length === 0 && (
        // Same placeholder treatment as the diary's empty day: a dashed
        // brand-tinted panel with the plate mark at a legible size, so "no
        // results yet" reads as a designed state instead of a gap in the page.
        <div className="surface-brand-soft flex flex-col items-center gap-4 rounded-2xl border border-dashed border-primary/30 px-5 py-8 text-center">
          <PlateGlyph className="h-14 w-14 text-primary/60" />
          <p className="text-sm text-muted-foreground">{searchEmptyMessage({ query, hasAnyRecent, t })}</p>
          {query === '' && (
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_SEARCH_SUGGESTION_KEYS.map((suggestionKey) => {
                const term = t(suggestionKey);
                return (
                  <button
                    key={suggestionKey}
                    type="button"
                    onClick={() => setSearchValue(term)}
                    className="inline-flex min-h-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                  >
                    {term}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowManual((open) => !open)}
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {t('add.search.addManually')}
        </button>
        <ManageCustomFoodsSheet foods={customFoods} />
      </div>
      {showManual && <ManualAddForm returnTo={returnTo} logDate={logContext.date} lastResult={manualResult} />}
    </div>
  );
}

/** Stable identity for a selected candidate, so switching selections remounts the portion form. */
function candidateKey(candidate: AddSearchCandidate): string {
  return `${candidate.source}:${candidate.name}`;
}

export default function AddFood({ loaderData, actionData }: Route.ComponentProps) {
  const {
    query,
    returnTo,
    defaultMealType,
    candidates,
    customFoods,
    hasAnyRecent,
    logDate,
    logDateLabel,
    throttled,
    retryAfterMs,
    speak,
  } = loaderData;
  const [selected, setSelected] = useState<AddSearchCandidate | null>(null);
  const logResult = actionData?.intent === 'log' ? actionData.submission : undefined;
  const manualResult = actionData?.intent === 'manual' ? actionData.submission : undefined;

  // "Switch to today" strips the date param but keeps the current search query.
  const logContext: LogDateContext = {
    date: logDate,
    label: logDateLabel,
    switchToTodayHref: query ? `/add?q=${encodeURIComponent(query)}` : '/add',
  };

  if (selected) {
    return (
      <PortionStep
        key={candidateKey(selected)}
        candidate={selected}
        defaultMealType={defaultMealType}
        returnTo={returnTo}
        logContext={logContext}
        lastResult={logResult}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <SearchStep
      query={query}
      returnTo={returnTo}
      logContext={logContext}
      candidates={candidates}
      customFoods={customFoods}
      hasAnyRecent={hasAnyRecent}
      throttled={throttled}
      retryAfterMs={retryAfterMs}
      speak={speak}
      manualResult={manualResult}
      onSelect={setSelected}
    />
  );
}
