import type { Route } from './+types/scan';
import { useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react';
import { Form, redirect, useFetcher, useNavigation, useRevalidator } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { FieldMetadata } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import type { SubmissionResult } from '@conform-to/react';
import type { AiProviderType, MealType } from '#types/enums';
import { formatMonthlyUsageLine } from '#app/models/ai-usage';
import type { MonthlyAiUsage } from '#app/models/ai-usage';
import { createVisionProvider, VisionProviderError, VisionProviderFailure } from '#app/services/vision';
import type {
  ConfidenceLevel,
  IdentifiedFood,
  PlateIdentification,
  ScanTokenUsage,
  VisionFailureCause,
} from '#app/services/vision';
import { MACRO_SOURCE_VALUES, PHOTO_INTAKE_TASK, TEXT_INTAKE_TASK } from '#app/services/vision';
import type { PlateImageInput, VisionProvider } from '#app/services/vision';
import { INTAKE_SOURCES } from '#app/lib/intake-source';
import type { IntakeSource, TypedIntakeSource } from '#app/lib/intake-source';
import { parseCarbBasis } from '#app/lib/net-carbs';
import { estimateScanCostUsd, formatScanCost, formatTokenCount } from '#app/services/vision/cost';
import type { FoodMatch } from '#app/services/food-resolution';
import {
  matchMacrosToFormValues,
  resolveAppliedMatchSnapshot,
  toCuratedSource,
} from '#app/services/food-resolution/apply-match';
import { fetchFoodMatches } from '#app/lib/food-matches-client';
import { randomUuid } from '#app/lib/uuid';
import { useInstanceInferencePreset, useInstancePolicy } from '#app/hooks/use-public-config';
import { useEffectiveAiSettings } from '#app/hooks/use-effective-ai-settings';
import {
  managedAiCredential,
  resolveAllowanceDoor,
  type AllowanceDoor,
  type ManagedAiSettings,
} from '#app/lib/ai/managed-ai-settings';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { OAuthConnectButton } from '#app/components/oauth-connect-button';
import { InstancePresetConnect } from '#app/components/instance-preset-connect';
import { LoadingDots } from '#app/components/app-loading';
import { supportsOauthPkce } from '#app/services/vision/registry';
import { scaleMacrosPer100gToServing, type Macros } from '#app/lib/macros';
import { authoritativeNetCarbsField, encodeAuthoritativeNetCarbs } from '#app/lib/authoritative-net-carbs';
import { cloneMicronutrients, encodeMicronutrients, micronutrientsField } from '#app/lib/micronutrients';
import { toStoredAttribution } from '#app/lib/attribution';
import {
  PORTION_SCALE_OPTIONS,
  SCAN_GRAMS_STEP,
  computeMacroPreview,
  derivePortionMultiplier,
  scalePortionGrams,
  stepPortionGrams,
  summarizeIncludedPortions,
  type MacroPreview,
} from '#app/lib/portion-preview';
import {
  ANONYMOUS_USER_ID,
  getLocalAiSettings,
  getLocalMonthlyAiUsage,
  getLocalProfileGoals,
  putLocalFood,
  putLocalFoodLog,
  recordLocalAiUsageEvent,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import type { LocalFoodLog, LocalPersonalFood } from '#app/lib/local-store';
import { instantOnDate, parseDateParam, todayInTimezone } from '#app/lib/user-days';
import { formatDayLabel } from '#app/lib/format-day-label';
import { createOptionalNonNegativeNumberSchema, createRequiredNonNegativeNumberSchema } from '#app/lib/zod-numeric';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { checkMacroSanity } from '#app/lib/macro-sanity';
import { isConfidentTier, matchTier, matchTierChipClass, type MatchTier } from '#app/lib/match-quality';
import { ALLOWED_MIME_TYPES, downscaleToJpeg, validatePhoto } from '#app/lib/photo-constraints';
import { buildUrlWithoutSharedParam, hasSharedPhotoFlag, readSharedPhoto } from '#app/lib/shared-photo';
import { savePlatePhoto } from '#app/lib/local-store/photos';
import { dropPlatePhoto, offerPlatePhoto, takePlatePhoto } from '#app/lib/plate-photo-handoff';
import {
  analyzeReducer,
  initialAnalyzeState,
  LIBRARY_GRACE_MS,
  type AnalyzePhase,
  type PickSource,
} from '#app/lib/scan-analyze';
import { takeIntakeHandoff } from '#app/lib/scan-handoff';
import { MEAL_LABEL_KEYS, mealTypeFormField } from '#app/lib/meal-choice';
import { mealTypeForCapture } from '#app/lib/scan-capture-time';
import { MealSelectField } from '#app/components/meal-select-field';
import { showFoodAddedToast } from '#app/lib/food-added-toast';
import { readDayCarbTotals } from '#app/lib/day-carb-totals';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
import { cn } from '#app/lib/utils';
import { hasPlansDoor, PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import i18nSingleton from '#app/i18n/i18n';
import type { Translate } from '#app/lib/macro-sanity';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { OfflineBanner } from '#app/components/offline-banner';
import { LoggingToBanner } from '#app/components/logging-to-banner';
import { SubmitButton } from '#app/components/submit-button';
import { useSyncSession } from '#app/components/sync-status';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import type { SyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '#app/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { AlertTriangle, Camera, Check, ChevronDown, Loader2, Minus, Plus, Type as TypeIcon, X } from 'lucide-react';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  trackFoodLogged,
  trackScanFailed,
  trackScanFoundNothing,
  trackScanStartedFromShare,
  trackScanSucceeded,
} from '#app/lib/matomo-events';
import type { LogInputPath } from '#app/lib/matomo-events';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.scan') }];

export const handle = {
  title: 'Scan plate',
  titleKey: 'scan.title',
  backTo: '/diary',
};

/**
 * Translator for this route's client-only, non-React code paths (`clientAction`
 * and the module-scope form schemas it parses). Reaching for the i18next
 * singleton is safe HERE and nowhere else in this file: none of these run on
 * the server, where that singleton is shared by every concurrent request (see
 * `I18nProvider`). Components below take their `t` from `useTranslation`.
 */
const translate: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

/**
 * Active UI language for those same client-only paths — day labels and token
 * counts are display text and must follow the language around them.
 */
function currentLanguage(): string {
  return i18nSingleton.language;
}

/**
 * Shown while the client loader reads the on-device BYOK settings + local
 * usage stats (M117/02) — that read can only happen in the browser, so the
 * server-rendered markup is discarded and this fallback covers the gap until
 * `clientLoader` resolves. React Router requires this on any route where
 * `clientLoader.hydrate` is true.
 */
export function HydrateFallback() {
  return <ScanLoading />;
}

/**
 * The screen's one "not yet" state, shared by two waits: the client loader
 * reading the device (above), and a managed instance still reopening its
 * session (`ConnectCard`). Both are the same fact to the person in front of
 * it, the answer has not arrived, and a card that guessed at one of them
 * would be wrong for a second.
 */
function ScanLoading() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('scan.loading')}
    </output>
  );
}

/**
 * The one "we billed tokens but found nothing" message. The KEY (not the
 * rendered string) is what's shared between the action that produces it and
 * the failure UI that recognizes it, so the comparison survives translation:
 * the UI can tell this generic case (friendly headline only) from a specific
 * error (file too large, provider failure) that must keep its exact wording.
 */
const NO_FOODS_ERROR_KEY = 'scan.errors.noFoods';

/**
 * Which SUBJECT a message on this screen is about: the photograph, or the
 * person's own words.
 *
 * Three ways in, two subjects. A spoken meal and a typed one are the same
 * sentence by the time any of this copy renders, and only the photo path has a
 * picture to talk about. Every sentence that names one of them has to branch
 * here or it is simply false half the time: "Couldn't identify any foods in
 * that photo. Try a clearer shot." is advice nobody can follow about a
 * sentence they typed.
 */
export type IntakeSubject = 'photo' | 'text';

/** The subject to describe, for an intake that started one of the three ways. */
export function intakeSubjectOf(source: IntakeSource): IntakeSubject {
  return source === 'photo' ? 'photo' : 'text';
}

/**
 * The "we billed tokens and found nothing" message, per subject. The KEY is
 * what the failure UI compares against (see `showSpecificError`), so the
 * comparison survives translation, and the twin has to be resolved the same
 * way on both sides or a typed meal would show its friendly headline with the
 * same sentence repeated underneath it.
 */
export function noFoodsErrorKey(subject: IntakeSubject): string {
  return subject === 'text' ? 'scan.errors.noFoodsText' : NO_FOODS_ERROR_KEY;
}

/** The generic "that did not work" message, per subject. */
export function identifyFailedErrorKey(subject: IntakeSubject): string {
  return subject === 'text' ? 'scan.errors.identifyFailedText' : 'scan.errors.identifyFailed';
}

/**
 * The schemas are FACTORIES, not module constants: a Zod message is baked in
 * when the schema is built, so a module-level schema would freeze whatever
 * language happened to be active at import time. Each parse site builds its own
 * with the `t` it already has — the component's from `useTranslation`, the
 * client action's from `translate`.
 */
function makeConfirmMacrosSchema(t: Translate) {
  return z.object({
    carbs: createRequiredNonNegativeNumberSchema(t('scan.review.errors.carbsRequired')),
    fiber: createOptionalNonNegativeNumberSchema(),
    sugars: createOptionalNonNegativeNumberSchema(),
    polyols: createOptionalNonNegativeNumberSchema(),
    protein: createOptionalNonNegativeNumberSchema(),
    fat: createOptionalNonNegativeNumberSchema(),
    kcal: createOptionalNonNegativeNumberSchema(),
  });
}

function makeConfirmItemSchema(t: Translate) {
  return z.object({
    include: z.boolean().optional(),
    name: z.string().min(1, t('scan.review.errors.nameRequired')),
    estimatedGrams: z.coerce.number().positive(t('scan.review.errors.gramsPositive')),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    /** Set (to `lowcarbcheck:<slug>`) only when the user applied a curated match to this food. */
    curatedSource: z.string().optional(),
    /**
     * The applied match's AUTHORITATIVE per-100g net carbs, carried through so it
     * survives into `LocalFoodLog.netCarbsPer100g` instead of dying at the store
     * boundary. Blank for a plain AI plate estimate — which genuinely has no
     * upstream figure, so it correctly decodes to `undefined` and the readers
     * compute from the parts. Blank ALSO once the user hand-edits the macros
     * after applying a match, since the snapshot then describes numbers that are
     * no longer there — see `resolveAppliedMatchSnapshot`, which owns that rule.
     */
    netCarbsPer100g: authoritativeNetCarbsField,
    /**
     * The applied match's per-100 g vitamins/minerals (M135), carried through so
     * they survive into `LocalFoodLog.micronutrientsPer100g`. Blank for a plain
     * AI plate estimate — the vision schema is deliberately NOT asked to
     * estimate micronutrients, since it would fabricate them — and that blank
     * decodes to `undefined`, which the daily aggregation counts as UNCOVERED
     * rather than as a plate of zeros. Unlike the figure above, this is NOT
     * withdrawn by a macro hand-edit; see `resolveAppliedMatchSnapshot`.
     */
    micronutrientsPer100g: micronutrientsField,
    /**
     * The applied match's licence credit, snapshotted at log time (CC BY requires
     * it to travel with the data). Blank for an AI plate estimate, which has no
     * source to credit. Normalized by `toStoredAttribution` on the way in.
     */
    attribution: z.string().optional(),
    /**
     * The applied match's printed-panel convention, derived from
     * `FoodMatch.origin` (M123/13 second-review finding 1) and snapshotted at
     * log time — same convention as `LocalPersonalFood.carbBasis`/
     * `LocalFoodLog.carbBasis`. Blank for a plain AI plate estimate, which has
     * no printed panel to report. Unlike `netCarbsPer100g` above, NOT withdrawn
     * by a macro hand-edit — see `resolveAppliedMatchSnapshot`'s doc for why the
     * two rules differ. Parsed with `parseCarbBasis` on the way in, so an
     * unrecognised value decodes to "unknown" rather than throwing.
     */
    carbBasis: z.string().optional(),
    /**
     * Whether this item's macros were ESTIMATED from food or TRANSCRIBED off a
     * printed panel (amends ADR-0005, 2026-09-08). It decides what the saved
     * personal food claims to be: a transcription is the manufacturer's own
     * figure and is stored `source: 'user'`, exactly as typing the panel in by
     * hand would be, while an estimate stays `'plate_ai'`.
     *
     * Parsed leniently and defaulted by `readItemMacroSource`, not here: an
     * absent or tampered value must read as the estimate, which is the weaker
     * claim of the two.
     */
    macroSource: z.string().optional(),
    /** The manufacturer, when the item came off a package. Blank for everything else. */
    brand: z.string().optional(),
    macros: makeConfirmMacrosSchema(t),
  });
}

/** One parsed plate item — the schema is built per parse, so infer off the factory. */
type ConfirmItem = z.infer<ReturnType<typeof makeConfirmItemSchema>>;

/**
 * Whether a confirmed item's macros came off a printed panel.
 *
 * `.catch('estimated')` rather than a strict parse: an absent or tampered
 * value reads as the ESTIMATE, which is the weaker of the two claims. Getting
 * this wrong in the other direction would file a guess in the diary as a
 * manufacturer's own figure.
 */
const macroSourceFieldSchema = z.enum(MACRO_SOURCE_VALUES).catch('estimated');

export function isLabelItem(item: Pick<ConfirmItem, 'macroSource'>): boolean {
  return macroSourceFieldSchema.parse(item.macroSource) === 'label';
}

/** A printed serving the review screen can actually offer as a portion. */
export interface PrintedServingChip {
  asPrinted: string;
  grams: number;
}

/**
 * The panel's own serving, as a portion chip, or `null` when there is none to
 * offer.
 *
 * TWO THINGS MUST BOTH BE TRUE: the panel printed a serving at all, and it
 * printed a WEIGHT for it. "2 pieces" with no grams is a sentence rather than
 * a portion, and a chip built from it would log nothing while looking like it
 * logged something. A zero or negative weight is refused for the same reason.
 *
 * Pure, so the rule is provable without a form.
 */
export function readPrintedServingChip(food: IdentifiedFood | undefined): PrintedServingChip | null {
  const serving = food?.servingSize;
  if (serving === undefined) return null;
  if (serving.grams === undefined || serving.grams <= 0) return null;
  if (serving.asPrinted.trim() === '') return null;
  return { asPrinted: serving.asPrinted.trim(), grams: serving.grams };
}

/**
 * Optional target day (`YYYY-MM-DD`) carried from the diary when a scan is
 * back-dated. Blank/absent → `undefined`; a present value must be a real
 * calendar date (re-validated server-side, so a tampered param can't slip in).
 */
function makeLogDateField(t: Translate) {
  return z.preprocess(
    (value) => {
      const raw = z.string().safeParse(value);
      return raw.success && raw.data.trim() !== '' ? raw.data : undefined;
    },
    z
      .string()
      .refine((value) => parseDateParam(value) !== null, t('scan.review.errors.invalidDate'))
      .optional(),
  );
}

/**
 * Optional client-generated batch id (a UUID) minted at confirm submit so the
 * device can key its on-device photo cache to the same batch the server stamps.
 * Absent/blank → `undefined`, and the server falls back to generating its own.
 * Validated for a sane length/charset so a tampered value can't slip through.
 */
function makeClientLogBatchIdField(t: Translate) {
  return z.preprocess(
    (value) => {
      const raw = z.string().safeParse(value);
      return raw.success && raw.data.trim() !== '' ? raw.data.trim() : undefined;
    },
    z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, t('scan.review.errors.invalidBatchId'))
      .optional(),
  );
}

/** Builds the confirm-draft schema against the caller's translator. */
export function makeConfirmDraftSchema(t: Translate) {
  return z.object({
    date: makeLogDateField(t),
    clientLogBatchId: makeClientLogBatchIdField(t),
    /**
     * The meal slot for the WHOLE plate (M202). One scan is one sitting, so
     * this is a single field beside `items[]` rather than one per item. See
     * `buildConfirmedBatch`, which stamps it onto every entry it builds.
     */
    mealType: mealTypeFormField,
    items: z.array(makeConfirmItemSchema(t)).min(1),
  });
}

/**
 * Exported for direct schema-behavior testing (see
 * tests/unit/authoritative-net-carbs-wiring.test.ts). Those tests assert
 * SHAPE, not message wording, so a singleton-built instance is fine here —
 * every real parse site builds its own with a live `t` instead.
 */
export const ConfirmDraftSchema = makeConfirmDraftSchema(translate);

type IdentifyResult =
  | {
      intent: 'identify';
      identification: PlateIdentification;
      /**
       * WHICH INTAKE produced this identification. A photo, a typed sentence
       * and a spoken one all land on this same arm with the same `foods[]`,
       * which is the whole point — so the only thing left that can tell them
       * apart is carried here, and its only reader is the diary's input-path
       * event on the confirm (`SCAN_LOG_PATH_BY_SOURCE`). It says nothing
       * about the food.
       */
      intakeSource: IntakeSource;
      /** Provider + model of the attempt, together — pricing resolves on the PAIR (`estimateScanCostUsd`), never on the id alone. */
      provider: AiProviderType;
      modelId: string;
      matches: FoodMatch[][];
    }
  | {
      intent: 'identify';
      error: string;
      usage?: ScanTokenUsage;
      modelId?: string;
      /** Set only for a typed `VisionProviderFailure` — drives cause-specific alert copy (see `UploadForm`). */
      failureCause?: VisionFailureCause;
      /** The server's `Retry-After` in seconds, when it sent one. Only ever set on a `rate-limit`. */
      retryAfterSeconds?: number | null;
      /** The configured provider at the time of this attempt — lets `UploadForm` phrase a `rate-limit` failure with OpenRouter-specific "free tier resets daily" copy without `failure-cause.ts` (the provider-neutral adapter layer) knowing about any one provider. */
      provider?: AiProviderType;
    };

type ConfirmResult = { intent: 'confirm'; submission: SubmissionResult<string[]> };

/**
 * No server loader at all (M128 spec 03): this route's only server-side input
 * used to be the signed-in user's id, and there are no accounts left. Every
 * value below is read from the device.
 *
 * BYOK settings + this month's usage live only in the local store since
 * M117/02 — the server never sees the key, so this data can only come from
 * the browser. `logDate`/`logDateLabel` (M117/03) are computed here too, since
 * the timezone they depend on is local-only (`LocalProfileGoals.timezone`).
 *
 * `userId` is still threaded down to the confirm step because the device-local
 * photo cache keys every row by owner (`app/lib/local-store/photos.ts`); with
 * accounts gone that owner is always the `ANONYMOUS_USER_ID` sentinel, and
 * `photo-rekey.ts` moves any row an older signed-in build wrote onto it.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const [settings, monthlyUsage, profile] = await Promise.all([
    getLocalAiSettings(),
    getLocalMonthlyAiUsage(),
    getLocalProfileGoals(),
  ]);
  const timezone = resolveLocalTimezone(profile);
  const today = todayInTimezone(timezone);
  const rawDate = parseDateParam(new URL(request.url).searchParams.get('date'));
  const logDate = rawDate !== null && rawDate !== today ? rawDate : null;
  const logDateLabel = logDate ? formatDayLabel(logDate, currentLanguage()) : null;
  // The zone travels because the confirm step reads a meal slot off the
  // PHOTO's timestamp, and a slot is a local wall-clock fact (M202).
  return { userId: ANONYMOUS_USER_ID, settings, monthlyUsage, logDate, logDateLabel, timezone };
}
clientLoader.hydrate = true as const;

/** Reads a File into a raw base64 string (no `data:...;base64,` prefix). Browser-only (`FileReader`). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if (result === null || result instanceof ArrayBuffer) {
        reject(new Error('Failed to read photo.'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read photo.')));
    reader.readAsDataURL(file);
  });
}

/**
 * A blocked `fetch` (CSP `connect-src`, CORS, or a genuinely unreachable
 * host) surfaces to JS as a `TypeError` with no further detail — browsers
 * deliberately don't distinguish these for security reasons. For
 * `openai-compatible` specifically (the only provider with a caller-supplied
 * host, so the only one the CSP's localhost carve-out can silently reject),
 * that ambiguity is worth naming rather than leaving the generic "Failed to
 * identify foods from the photo." — a one-branch message improvement, not a
 * new error-classification framework (M117/02 review fix).
 */
function refineIdentifyErrorMessage(params: { provider: AiProviderType; error: unknown; fallback: string }): string {
  const { provider, error, fallback } = params;
  if (provider !== 'openai-compatible') return fallback;
  const cause = error instanceof VisionProviderError ? error.cause : undefined;
  if (!(cause instanceof TypeError)) return fallback;
  return translate('scan.errors.endpointUnreachable');
}

/**
 * Whether this submission carries a photograph or words, parsed off the form
 * rather than inferred from which field happens to be present.
 *
 * `.catch('photo')` so a missing or tampered value falls back to the original
 * intake, whose own guards then report an empty photo honestly.
 */
const intakeKindSchema = z.enum(['photo', 'text']).catch('photo');

/**
 * How the intake started. Read here rather than derived, because a typed
 * sentence and a spoken one are byte-identical by the time they reach this
 * function — the difference is a fact about the person's tap, and only the
 * screen that took it knows.
 */
const intakeSourceSchema = z.enum(INTAKE_SOURCES).catch('photo');

/** The person's words, as the form carries them. Trimmed here so an all-space submission is refused rather than billed. */
const intakeTextSchema = z
  .string()
  .transform((value) => value.trim())
  .catch('');

/**
 * Records exactly one local usage row per attempt outcome — see
 * `handleClientIdentify`. Fail-open by contract: the recorded row is never read
 * back by the caller, so the return is `void` rather than the store's own row.
 */
type RecordScanAttempt = (params: {
  usage: ScanTokenUsage | undefined;
  outcome: 'identified' | 'no_foods' | 'error';
}) => Promise<void>;

/**
 * Maps a scan outcome to its analytics event.
 *
 * `error` reports nothing here on purpose — the outcome alone cannot say WHY,
 * and a bare 'failed' with no reason is the least useful event we could send.
 * The failure path reports its own cause where the cause is known.
 *
 * Module scope rather than a closure: it captures nothing, and hoisting it
 * keeps the per-scan setup below to the things that actually depend on the
 * user's settings.
 */
function reportScanOutcome(outcome: 'identified' | 'no_foods' | 'error'): void {
  if (outcome === 'identified') trackScanSucceeded();
  else if (outcome === 'no_foods') trackScanFoundNothing();
}

/** What every task runner below needs to attribute and price an attempt. */
interface IntakeAttemptContext {
  visionProvider: VisionProvider;
  providerType: AiProviderType;
  modelId: string;
  recordAttempt: RecordScanAttempt;
  /** How this intake started; carried onto the success arm and read only at confirm time. */
  intakeSource: IntakeSource;
}

/** An attempt that carries a photograph. */
interface ScanAttemptContext extends IntakeAttemptContext {
  image: PlateImageInput;
}

/** An attempt that carries the person's own words. */
interface TextAttemptContext extends IntakeAttemptContext {
  text: string;
}

/**
 * Everything that happens AFTER a provider answers with the plate shape,
 * whichever intake asked it.
 *
 * A photo of a plate and a typed "3 eggs, 2 toast" come back as the same
 * `foods[]`, so they get the same empty-result accounting, the same curated
 * enrichment and the same result arm. Forking here would be the beginning of
 * two review screens, which is exactly what this change exists to prevent.
 */
async function completePlateIntake({
  identification,
  context,
}: {
  identification: PlateIdentification;
  context: IntakeAttemptContext;
}): Promise<IdentifyResult> {
  const { providerType, modelId, recordAttempt, intakeSource } = context;
  const usage = identification.usage;

  // UNREADABLE IS CHECKED FIRST AND UNCONDITIONALLY. The wire schema does not
  // forbid a response carrying `unreadable: true` AND stray foods, because a
  // model that gave up halfway can send both; checking here means no such item
  // can reach a form. It is terminal, and it is its own message: "we could not
  // read that picture" is not "there was no food in it", and a person told the
  // wrong one retries the wrong thing.
  if (identification.unreadable) {
    await recordAttempt({ usage, outcome: 'no_foods' });
    return {
      intent: 'identify',
      error:
        identification.unreadableReason ?
          translate('scan.errors.photo.unreadableWithReason', { reason: identification.unreadableReason })
        : translate('scan.errors.photo.unreadable'),
      usage,
      modelId,
      provider: providerType,
    };
  }

  if (identification.foods.length === 0) {
    // The model billed tokens but found nothing — attribute that cost here
    // (this is the previously-lost case) rather than discarding the usage.
    await recordAttempt({ usage, outcome: 'no_foods' });
    return {
      intent: 'identify',
      error: translate(noFoodsErrorKey(intakeSubjectOf(intakeSource))),
      usage,
      modelId,
      provider: providerType,
    };
  }
  await recordAttempt({ usage, outcome: 'identified' });
  // Enrich with curated LowCarbCheck matches (names only, fail-open — never
  // blocks the draft). `matches` is parallel to `identification.foods` by index.
  const { matches } = await fetchFoodMatches(identification.foods.map((food) => food.name));
  return {
    intent: 'identify',
    intakeSource,
    identification,
    provider: providerType,
    modelId,
    matches,
  };
}

/**
 * A photograph → the foods worth logging, enriched with curated matches.
 *
 * ONE PHOTO RUNNER. A plate, a single item, a packet and a nutrition panel all
 * come through here and all come back as `foods[]`, because the prompt sorts
 * them out per item rather than the caller sorting them out per photograph
 * (amends ADR-0005, 2026-09-08).
 */
async function runPhotoIntake(context: ScanAttemptContext): Promise<IdentifyResult> {
  const identification = await context.visionProvider.runScan({ task: PHOTO_INTAKE_TASK, image: context.image });
  return completePlateIntake({ identification, context });
}

/**
 * The person's own words → the same foods, the same review screen.
 *
 * No photo is read, nothing is downscaled, and nothing else about the flow
 * changes: the descriptor carries the one thing that differs (see
 * `TEXT_INTAKE_TASK`), and the result rejoins the plate path immediately.
 */
async function runTextIntake(context: TextAttemptContext): Promise<IdentifyResult> {
  const identification = await context.visionProvider.runTextIntake({ task: TEXT_INTAKE_TASK, text: context.text });
  return completePlateIntake({ identification, context });
}

/**
 * Runs the plate-identity call browser -> provider directly (M117/02): the
 * BYOK key is read from the local store and never leaves this device except
 * in the request to the user's own configured provider. Replaces the old
 * server-mediated `handleIdentify` — the photo and the key no longer transit
 * the openplate server at all. Usage bookkeeping moves to the local-only
 * event log (`recordLocalAiUsageEvent`); there is no server-side rate limit
 * here anymore (there's no server round trip left to gate) — the user's own
 * provider billing is the natural throttle on their own key.
 */
/** The three form fields the screen uses to tell the action which AI it resolved. */
const MANAGED_AI_FIELDS = { source: 'aiSource', baseUrl: 'aiBaseUrl', model: 'aiModel' } as const;

/**
 * Writes the managed descriptor into a submission, or nothing at all.
 *
 * Nothing SECRET crosses: a base URL and a model id, both of which the server
 * already publishes to this browser. The bearer is never in the form — it is
 * fetched from the vault inside the action, one frame before the request.
 */
export function writeManagedAiFields(formData: FormData, managed: ManagedAiSettings | null): void {
  if (managed === null || managed.model === null) return;
  formData.append(MANAGED_AI_FIELDS.source, 'managed');
  formData.append(MANAGED_AI_FIELDS.baseUrl, managed.baseUrl);
  formData.append(MANAGED_AI_FIELDS.model, managed.model);
}

/**
 * The parse of the three fields — a form is an I/O boundary, so this is where
 * `FormDataEntryValue` becomes a domain value.
 *
 * A partial or malformed set reads as "no managed AI" rather than throwing:
 * the fields are written by one function in this same file, so anything else
 * arriving here is a submission this build did not make.
 */
const managedAiFieldsSchema = z.object({
  [MANAGED_AI_FIELDS.source]: z.literal('managed'),
  [MANAGED_AI_FIELDS.baseUrl]: z.string().min(1),
  [MANAGED_AI_FIELDS.model]: z.string().min(1),
});

/** Reads them back, or `null` when this submission is an ordinary BYOK scan. */
export function readManagedAiFields(formData: FormData): ManagedAiSettings | null {
  const parsed = managedAiFieldsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return null;
  return {
    source: 'managed',
    provider: 'managed',
    baseUrl: parsed.data[MANAGED_AI_FIELDS.baseUrl],
    model: parsed.data[MANAGED_AI_FIELDS.model],
  };
}

async function handleClientIdentify(formData: FormData): Promise<IdentifyResult> {
  const intakeKind = intakeKindSchema.parse(formData.get('intake'));
  const intakeSource = intakeSourceSchema.parse(formData.get('intakeSource'));

  // THE ONE PLACE THE TWO INTAKES DIFFER before the provider is even chosen:
  // words are already usable, a photograph has to be validated and read. Both
  // guards return the same failure arm, so everything below is shared.
  const text = intakeKind === 'text' ? intakeTextSchema.parse(formData.get('text')) : '';
  const photo = formData.get('photo');
  if (intakeKind === 'text' && text === '') {
    return { intent: 'identify', error: translate('scan.errors.text.empty') };
  }
  if (intakeKind === 'photo') {
    if (!(photo instanceof File)) {
      return { intent: 'identify', error: translate('scan.errors.photo.empty') };
    }
    const validation = validatePhoto({ type: photo.type, size: photo.size }, translate);
    if (!validation.valid) {
      return { intent: 'identify', error: validation.error };
    }
  }

  // WHICH AI, decided by the COMPONENT and carried in the form (M192).
  //
  // The rule needs the public config and the sync session, and neither is
  // reachable from a `clientAction`: this function runs outside React, and the
  // route has no server loader to read the root's data through. So the screen
  // resolves it with `useEffectiveAiSettings` and posts the answer as three
  // fields. Nothing secret travels — a base URL and a model id — and the
  // bearer is fetched from the vault here, in this frame.
  const managed = readManagedAiFields(formData);
  const settings = managed === null ? await getLocalAiSettings() : null;
  if (managed === null && !settings) {
    return {
      intent: 'identify',
      error: translate('scan.errors.connectProvider'),
    };
  }

  // A row saved before the base-URL requirement shipped (M117/02 review fix)
  // could still have `baseUrl: null` for openai-compatible. Catch it here
  // with a friendly, actionable message rather than letting
  // `createVisionProvider`'s own guard throw synchronously below.
  if (settings?.provider === 'openai-compatible' && (!settings.baseUrl || settings.baseUrl.trim() === '')) {
    return {
      intent: 'identify',
      error: translate('scan.errors.missingBaseUrl'),
    };
  }

  // The two shapes collapse into one triple here, so everything below reads
  // the same three values whichever kind of instance this is.
  const provider: AiProviderType = managed?.provider ?? settings?.provider ?? 'openrouter';
  const model = managed?.model ?? settings?.model ?? '';
  const baseUrl = managed?.baseUrl ?? settings?.baseUrl ?? null;
  if (model === '') {
    // A managed instance with an upstream key but no advertised model. The
    // proxy passes the body through untouched, so there is no model id to
    // send, and inventing one would fail upstream with a message nobody on
    // this side could explain.
    return { intent: 'identify', error: translate('scan.errors.connectProvider') };
  }

  // Records exactly one local usage row per outcome. `recordLocalAiUsageEvent`
  // is fail-open, so this never affects whether the scan itself succeeds.
  const recordAttempt = (params: {
    usage: ScanTokenUsage | undefined;
    outcome: 'identified' | 'no_foods' | 'error';
  }) => {
    // Analytics rides the usage row's own choke point: every scan outcome
    // already passes through here exactly once, so reporting here cannot
    // drift out of step with reality the way N separate call sites would.
    // No counts, no model id, nothing from the photo — see `matomo-events.ts`.
    reportScanOutcome(params.outcome);
    return recordLocalAiUsageEvent({
      provider,
      model,
      inputTokens: params.usage?.inputTokens ?? null,
      outputTokens: params.usage?.outputTokens ?? null,
      // `null` for a managed scan, and that is the honest answer rather than a
      // missing feature: the catalog prices a person's own provider key, and a
      // managed scan is spent against an allowance their organization pays
      // for. A number here would be a bill nobody receives.
      estimatedCostUsd: params.usage ? (estimateScanCostUsd(provider, model, params.usage) ?? null) : null,
      outcome: params.outcome,
    });
  };

  // Read only on the photo path. `photo instanceof File` was already proved by
  // the guard above; narrowing it again here is what keeps that fact in the
  // type system rather than in a comment.
  let image: PlateImageInput | null = null;
  if (intakeKind === 'photo' && photo instanceof File) {
    try {
      image = { base64: await fileToBase64(photo), mimeType: photo.type };
    } catch {
      return { intent: 'identify', error: translate('scan.errors.readPhoto') };
    }
  }

  try {
    const visionProvider = createVisionProvider({
      provider,
      baseUrl,
      model,
      // The MANAGED path hands over a token provider rather than a key, and
      // that is what lets the adapter refresh once on a 401 — an access token
      // lasts fifteen minutes and a tab stays open for hours.
      credential: managed === null ? { apiKey: settings?.apiKey ?? '' } : managedAiCredential(),
    });
    const attempt: IntakeAttemptContext = {
      visionProvider,
      providerType: provider,
      modelId: model,
      recordAttempt,
      intakeSource,
    };
    // The ONE branch left, and it is over what the person actually produced: a
    // picture, or words. What the picture SHOWS is no longer a branch at all
    // (amends ADR-0005, 2026-09-08), and everything the two tasks differ by as
    // data (prompt, schema, parse) is on the descriptor rather than here.
    if (image === null) return await runTextIntake({ ...attempt, text });
    return await runPhotoIntake({ ...attempt, image });
  } catch (error) {
    const usage = error instanceof VisionProviderError ? error.usage : undefined;
    const failureCause = error instanceof VisionProviderFailure ? error.failureCause : undefined;
    const retryAfterSeconds = error instanceof VisionProviderFailure ? error.retryAfterSeconds : undefined;
    // A `VisionProviderError`'s own message is authored in the provider-neutral
    // vision adapter layer (`app/services/vision/failure-cause.ts`), which this
    // route can't translate from here — see `describeFailureBody`, which
    // substitutes localized copy for every typed cause it recognizes.
    const fallbackMessage =
      error instanceof VisionProviderError ? error.message : translate(identifyFailedErrorKey(intakeKind));
    const message = refineIdentifyErrorMessage({ provider, error, fallback: fallbackMessage });
    await recordAttempt({ usage, outcome: 'error' });
    // The reason, not just the fact. The machine-readable cause lives on
    // `VisionProviderFailure.failureCause` — NOT on `VisionProviderError.cause`,
    // which is the standard `Error` cause and holds an arbitrary value.
    // `ScanFailureReason` mirrors `VisionFailureCause` exactly so nothing has
    // to be mapped; a mapping is where a real failure would quietly turn into
    // 'unknown'. A plain `VisionProviderError`, or any other throw, has no
    // machine-readable cause and lands on 'unknown' honestly.
    trackScanFailed(failureCause ?? 'unknown');
    return {
      intent: 'identify',
      error: message,
      usage,
      modelId: model,
      failureCause,
      retryAfterSeconds,
      provider,
    };
  }
}

/**
 * Builds the food-log entry one confirmed plate item persists — the pure core
 * of `handleConfirm`, split out so the whole "AI draft (± an applied curated
 * match) → stored entry" path is unit-testable without a store, a clock, or a
 * form. Same precedent as `#app/routes/add`'s `buildLoggedEntry`, which it
 * mirrors field for field; every impure input (ids, instants, day) is passed
 * in rather than generated here.
 *
 * @param options.item - one successfully parsed confirm-draft item.
 * @param options.per100g - the item's per-100g macros (already narrowed from the schema's optionals).
 * @param options.mealType - the slot the whole plate goes into, or null for "no meal".
 * @param options.id - the client-generated entry id / idempotency key.
 * @param options.foodId - the personal food created for this item.
 * @param options.loggedAtMs - the instant the entry is logged against.
 * @param options.dayKey - the device-local calendar day the entry belongs to.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @param options.logBatchId - the id grouping every entry from this one scan.
 * @returns the entry to persist.
 */
export function buildConfirmedEntry({
  item,
  per100g,
  mealType,
  id,
  foodId,
  loggedAtMs,
  dayKey,
  createdAtMs,
  logBatchId,
}: {
  item: ConfirmItem;
  per100g: Macros;
  mealType: MealType | null;
  id: string;
  foodId: string;
  loggedAtMs: number;
  dayKey: string;
  createdAtMs: number;
  logBatchId: string;
}): LocalFoodLog {
  // Provenance: non-empty only when the user applied a curated LCC match to
  // this food. It doubles as the `aiEstimated` discriminator below.
  const curatedSource = item.curatedSource && item.curatedSource.trim() !== '' ? item.curatedSource.trim() : null;
  return {
    id,
    foodId,
    name: item.name,
    quantityGrams: item.estimatedGrams,
    macros: scaleMacrosPer100gToServing(per100g, item.estimatedGrams),
    // The slot the person chose on the confirm screen, preselected from when
    // the photo was taken. This was a hardcoded `null` until M202, which put
    // every photographed food outside the diary's meal groups for good.
    mealType,
    source: 'plate_ai',
    // Curated macros aren't AI-guessed, so `aiEstimated` is false whenever a
    // match was applied (even if the user then tweaked the numbers — they're
    // still sourced from a curated entry, not an LLM estimate). `curatedSource`
    // is the single source of truth for this distinction.
    aiEstimated: curatedSource === null,
    curatedSource,
    dayKey,
    loggedAt: loggedAtMs,
    createdAt: createdAtMs,
    logBatchId,
    // Snapshotted per-100g so a later quantity edit rescales it correctly.
    // Absent for a plain AI plate estimate, which genuinely has no upstream
    // figure — the readers then compute from the parts, which is the right
    // answer there. Present ONLY for an applied curated match whose macros the
    // user hasn't since hand-edited (see `resolveAppliedMatchSnapshot`); THIS
    // is the line that stops a fibre-heavy curated food scanned off a plate
    // from reading a confident, wrong 0 g on the diary forever after.
    netCarbsPer100g: item.netCarbsPer100g,
    // The applied match's vitamins/minerals, snapshotted on the same basis and
    // for the same reason. Absent for a plain AI plate estimate, which has no
    // micronutrient dimension to claim.
    micronutrientsPer100g: item.micronutrientsPer100g,
    // The applied match's licence credit, travelling with the data it credits
    // (CC BY). Null for an AI estimate — there is no source to credit.
    attribution: toStoredAttribution(item.attribution),
    // The applied match's printed-panel convention (M123/13 second-review
    // finding 1) — see `makeConfirmItemSchema`'s `carbBasis` doc for why this
    // is NOT withdrawn by a macro edit the way `netCarbsPer100g` above is.
    // Absent for a plain AI plate estimate, which has no printed panel.
    carbBasis: parseCarbBasis(item.carbBasis) ?? undefined,
  };
}

/**
 * Builds the PERSONAL FOOD one confirmed plate item persists alongside its log
 * — the second half of `handleConfirm`'s pure core, split out for exactly the
 * reason `buildConfirmedEntry` above was: this confirm writes TWO rows from one
 * upstream fact, and a field that reaches only one of them is invisible at the
 * time and permanent afterwards.
 *
 * That is precisely what happened: the log carried `item.netCarbsPer100g` while
 * the food, built inline here, did not — so /add's "Your food" row for a
 * scanned-and-matched fibre-heavy food re-derived `carbs - fiber - polyols` and
 * showed a green 0 beside the identical food's 21.7 in the diary.
 *
 * @param options.item - one successfully parsed confirm-draft item.
 * @param options.per100g - the item's per-100g macros (already narrowed from the schema's optionals).
 * @param options.id - the client-generated food id.
 * @param options.createdAtMs - the instant the row was created on-device.
 * @returns the personal food to persist.
 */
export function buildConfirmedFood({
  item,
  per100g,
  id,
  createdAtMs,
}: {
  item: ConfirmItem;
  per100g: Macros;
  id: string;
  createdAtMs: number;
}): LocalPersonalFood {
  return {
    id,
    name: item.name,
    // THE MANUFACTURER, when the item came off a package. Hardcoded `null`
    // while a label was a separate scan writing its own row; a label item is
    // an ordinary item on this draft now, and dropping its brand here would
    // make the saved food unfindable by the name on the packet.
    brand: item.brand && item.brand.trim() !== '' ? item.brand.trim() : null,
    macrosPer100g: per100g,
    // `'user'` FOR A TRANSCRIBED PANEL, and that is a claim about provenance,
    // not about care: nothing was estimated from a photograph of food, the
    // figures are the manufacturer's own, read off the package and then
    // confirmed by the person on an editable form. That is the same provenance
    // as typing the panel in by hand, which is exactly what it replaces. An
    // estimate stays `'plate_ai'`.
    source: isLabelItem(item) ? 'user' : 'plate_ai',
    createdAt: createdAtMs,
    // The SAME figure the log gets, from the SAME upstream fact — see
    // `buildConfirmedEntry`. Present only for an applied curated match whose
    // macros the user hasn't since hand-edited (`resolveAppliedMatchSnapshot`
    // withdraws it otherwise); absent for a plain AI plate estimate, which has
    // no upstream figure to claim, so its candidate correctly computes from the
    // parts. Deliberately NOT `?? null`: absent ("never captured") and `null`
    // ("upstream consulted, genuinely unknown") are different facts.
    netCarbsPer100g: item.netCarbsPer100g,
    // The SAME snapshot the log gets, from the SAME upstream fact (v10) — and
    // the second time this exact asymmetry has been closed on this exact line:
    // the figure above was the v5 → v6 fix, these are the v9 → v10 one. Absent
    // for a plain AI plate estimate, which has no micronutrient dimension to
    // claim (the vision schema is never asked to estimate one, precisely so it
    // cannot invent it). Cloned rather than aliased so the food's snapshot and
    // the log's never share object identity.
    micronutrientsPer100g: cloneMicronutrients(item.micronutrientsPer100g),
    // The SAME basis the log gets, from the SAME upstream fact — see
    // `buildConfirmedEntry` and the M123/13 second-review finding 1 comment
    // there.
    carbBasis: parseCarbBasis(item.carbBasis) ?? undefined,
  };
}

/**
 * Turns the confirmed items of ONE scan into the exact rows that scan writes:
 * a personal food and a food log per item, paired.
 *
 * It exists so the whole write payload is reachable without a store, a clock or
 * a form. `handleConfirm` below is then a loop that persists what this
 * returned, which is what makes a plate-wide field like `mealType` provable
 * rather than merely present: a value that reaches zero of these rows passes
 * every type check while every screen stays wrong, and that is precisely the
 * shape the `mealType: null` defect had.
 *
 * EVERY ITEM TAKES THE SAME SLOT. One scan is one plate at one sitting, so the
 * meal is a property of the batch, not of a food within it.
 *
 * @param options.items - the included, successfully parsed confirm-draft items.
 * @param options.mealType - the slot the whole plate goes into, or null for "no meal".
 * @param options.loggedAtMs - the instant every entry is logged against.
 * @param options.dayKey - the device-local calendar day every entry belongs to.
 * @param options.createdAtMs - the instant the rows were created on-device.
 * @param options.logBatchId - the id grouping every entry from this one scan.
 * @param options.newId - mints a fresh id per row (`randomUuid` in production).
 * @returns one food/entry pair per item, in the order the items came.
 */
export function buildConfirmedBatch({
  items,
  mealType,
  loggedAtMs,
  dayKey,
  createdAtMs,
  logBatchId,
  newId,
}: {
  items: readonly ConfirmItem[];
  mealType: MealType | null;
  loggedAtMs: number;
  dayKey: string;
  createdAtMs: number;
  logBatchId: string;
  newId: () => string;
}): { food: LocalPersonalFood; entry: LocalFoodLog }[] {
  return items.map((item) => {
    const per100g: Macros = {
      carbs: item.macros.carbs,
      fiber: item.macros.fiber ?? null,
      sugars: item.macros.sugars ?? null,
      polyols: item.macros.polyols ?? null,
      protein: item.macros.protein ?? null,
      fat: item.macros.fat ?? null,
      kcal: item.macros.kcal ?? null,
    };
    const foodId = newId();
    return {
      food: buildConfirmedFood({ item, per100g, id: foodId, createdAtMs }),
      entry: buildConfirmedEntry({
        item,
        per100g,
        mealType,
        id: newId(),
        foodId,
        loggedAtMs,
        dayKey,
        createdAtMs,
        logBatchId,
      }),
    };
  });
}

/**
 * The diary's input path for each intake.
 *
 * A `Record` over `IntakeSource`, so a fourth way in is a compile error here
 * rather than a batch of entries quietly filed under the photo path. The
 * distinction is the whole reason `LogInputPath` exists: it says which way in
 * is worth improving, and nothing about the food (see `matomo-events.ts`).
 *
 * `speech` is a historic member of both unions (M203 removed this app's own
 * microphone; dictation is the keyboard's and arrives as `text`), so the row
 * below is unreachable and is kept only to keep the mapping exhaustive.
 */
const SCAN_LOG_PATH_BY_SOURCE = {
  photo: 'scan-plate',
  text: 'scan-text',
  speech: 'scan-speech',
} satisfies Record<IntakeSource, LogInputPath>;

/**
 * Which intake produced the batch being confirmed, read straight off the form.
 *
 * NOT part of the Conform schema: it is not a field the person edits and it
 * carries no validation error they could act on. Same treatment as the managed
 * AI descriptor above, and for the same reason. A missing or tampered value
 * reads as a photo, which is the intake this screen has always had.
 */
export function readIntakeSource(formData: FormData): IntakeSource {
  return intakeSourceSchema.parse(formData.get('intakeSource'));
}

/**
 * Confirm now writes straight to the on-device primary store (M117/03) — the
 * confirmed food logs never transit the server at all; this route has no
 * server `action` anymore (see `clientAction` below).
 */
async function handleConfirm(formData: FormData, timezone: string): Promise<ConfirmResult | Response> {
  const submission = parseWithZod(formData, { schema: makeConfirmDraftSchema(translate) });
  if (submission.status !== 'success') {
    return { intent: 'confirm', submission: submission.reply() };
  }

  const includedItems = submission.value.items.filter((item) => item.include !== false);
  if (includedItems.length === 0) {
    return {
      intent: 'confirm',
      submission: submission.reply({ formErrors: [translate('scan.review.errors.selectAtLeastOne')] }),
    };
  }

  // Back-dating: when a non-today day rode along, stamp every entry from this
  // batch onto that day (one shared instant is fine — they're one meal capture).
  const activeDate =
    submission.value.date !== undefined && submission.value.date !== todayInTimezone(timezone) ?
      submission.value.date
    : null;
  const loggedAtMs = (activeDate ? instantOnDate(activeDate, timezone) : new Date()).getTime();
  const dayKey = todayInTimezone(timezone, new Date(loggedAtMs));

  // One id per confirm groups every entry from this scan so the diary detail
  // page can surface its scan siblings. The client mints it (so it can key its
  // device-local photo cache to the same batch) and we accept it after schema
  // validation; a missing/blank one falls back here.
  const logBatchId = submission.value.clientLogBatchId ?? randomUuid();
  const now = Date.now();
  // Blank ("No meal") decodes to `undefined` and is STORED as null. The two
  // are the same fact here, unlike the macro fields above.
  const mealType = submission.value.mealType ?? null;
  const batch = buildConfirmedBatch({
    items: includedItems,
    mealType,
    loggedAtMs,
    dayKey,
    createdAtMs: now,
    logBatchId,
    newId: randomUuid,
  });
  for (const { food, entry } of batch) {
    await putLocalFood(food);
    await putLocalFoodLog(entry);
  }

  // The photograph, on the same signal as the rows and under the same batch
  // id. It is handed over by the review screen through a one-shot slot
  // (`plate-photo-handoff.ts`) because an in-memory `File` cannot ride a form.
  //
  // NOT from navigation state, which is where this used to live: a local
  // action resolves inside one React batch, so the confirm never renders a
  // `submitting` state and the effect that waited for one never fired.
  //
  // Fire-and-forget, and unreachable from a validation failure: the guards
  // above return before this line, so nothing is taken and nothing is saved.
  // A typed or spoken intake has no photograph, so the slot is simply empty.
  const offeredPhoto = takePlatePhoto(logBatchId);
  if (offeredPhoto !== null) {
    void savePlatePhoto({ userId: offeredPhoto.userId, logBatchId, file: offeredPhoto.file });
  }

  // One toast for the whole plate, through the app's shared add-toast id — a
  // four-item confirm is ONE action, not four (M129/03). The running total is
  // read after every entry is written, so it reports the day the user is about
  // to land on rather than a mid-write figure.
  // Once per confirmation, outside the per-item loop: a four-item plate is one
  // log action, exactly as the single toast below treats it. WHICH way in it
  // was travels on the form, because a photo, a typed sentence and a spoken
  // one all reach this same confirm and would otherwise be indistinguishable.
  trackFoodLogged(SCAN_LOG_PATH_BY_SOURCE[readIntakeSource(formData)]);

  const redirectTo = activeDate ? `/diary?date=${activeDate}` : '/diary';
  const totals = await readDayCarbTotals(dayKey);
  showFoodAddedToast({
    name: includedItems[0]?.name ?? translate('scan.review.plateFallbackName'),
    t: translate,
    count: includedItems.length,
    // Say which slot it landed in, exactly as /add's toast does. The person
    // asked for a meal, so the confirmation names it.
    mealLabel: mealType === null ? null : translate(MEAL_LABEL_KEYS[mealType]),
    netCarbsTotal: totals.netCarbs,
    hasEstimates: totals.hasEstimates,
    dayLabel: activeDate === null ? null : formatDayLabel(activeDate, currentLanguage()),
    language: currentLanguage(),
  });
  return redirect(redirectTo);
}

/**
 * Dispatches every submission entirely client-side (M117/03 — this route no
 * longer has a server `action`): `confirm` writes the food logs to the local
 * primary store, `identify` runs the browser -> provider vision call. Neither
 * intent ever reaches the server.
 */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<IdentifyResult | ConfirmResult | Response> {
  const formData = await request.formData();
  const intent = formData.get('_intent');

  // ONE CONFIRM INTENT. There used to be a second for a nutrition panel, with
  // its own schema, its own form and its own pair of row builders. A label
  // item is an ordinary item on the plate draft now (amends ADR-0005,
  // 2026-09-08), so a second intent would only be a second way to write the
  // same two rows.
  if (intent === 'confirm') {
    const profile = await getLocalProfileGoals();
    return handleConfirm(formData, resolveLocalTimezone(profile));
  }

  return handleClientIdentify(formData);
}

const STAGE_ANALYZING_SECONDS = 2;
const STAGE_STILL_WORKING_SECONDS = 8;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

/** Human-readable file size for the preview caption. */
function formatFileSize(bytes: number): string {
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
}

/**
 * Elapsed-time-staged status copy for the in-flight identify call
 * (DESIGN.md §7).
 *
 * TWO OF THE THREE STAGES DIFFER. A photograph is genuinely being uploaded in
 * those first seconds and a sentence is not, so a typed meal used to be told
 * "Uploading photo…" over a quote block with no photo in it. The second stage
 * had the same defect one sentence later: "Analyzing your plate…" names a
 * plate nobody photographed. The LAST stage is shared, because "still working"
 * is true of both and a second near-identical string would only be one more
 * thing to keep in step.
 *
 * `kind` is REQUIRED rather than defaulted to `'photo'`: defaulting is exactly
 * how the wrong copy reached the text path, and a new call site should have to
 * say which intake it is showing.
 */
function getIdentifyStageMessage(elapsedSeconds: number, t: Translate, kind: IntakeSubject): string {
  // The LAST stage is the one sentence that is true of both, and it says so:
  // "still working" names no photograph and no plate.
  if (elapsedSeconds >= STAGE_STILL_WORKING_SECONDS) return t('scan.analyzing.stillWorking');
  if (elapsedSeconds >= STAGE_ANALYZING_SECONDS) {
    return kind === 'text' ? t('scan.analyzing.analyzingText') : t('scan.analyzing.analyzing');
  }
  return kind === 'text' ? t('scan.analyzing.sendingText') : t('scan.analyzing.uploading');
}

/**
 * Humanized, token-free credit line under a failed identify. The user
 * explicitly wants failed attempts attributed to their API spend, but without
 * the raw token counts.
 */
function formatFailedAttemptCreditLine(estimatedCostUsd: number | null, t: Translate): string {
  if (estimatedCostUsd === null) return t('scan.errors.attemptRecorded');
  const amount = formatScanCost(estimatedCostUsd);
  // `formatScanCost` already prefixes "<" for sub-thousandth amounts — don't
  // double up with a leading "~" in that case.
  const approx = amount.startsWith('<') ? amount : `~${amount}`;
  return t('scan.errors.attemptCost', { amount: approx });
}

/**
 * The interactive scan flow for a connected user. Owns the photo pipeline, the
 * arm/dispatch state machine, and the identify `useFetcher` — auto-firing the
 * (paid) identification the moment a downscaled JPEG is ready, while keeping the
 * preview and staged overlay mounted throughout (no navigation flash). Once the
 * fetcher returns an identification it swaps to the confirm draft.
 */
function ScanFlow({
  managedAi,
  monthlyUsage,
  confirmResult,
  logDate,
  logDateLabel,
  userId,
  timezone,
}: {
  /** The instance's own AI, when this screen resolved one. `null` for an ordinary BYOK scan. */
  managedAi: ManagedAiSettings | null;
  monthlyUsage: MonthlyAiUsage;
  confirmResult?: SubmissionResult<string[]>;
  logDate: string | null;
  logDateLabel: string | null;
  /** Owner for the device-local photo cache (see `ConfirmDraftForm`). */
  userId: number;
  /** The device's IANA zone, because a meal slot is a local wall-clock fact. */
  timezone: string;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  // THE DATE THE REFUSAL WILL NAME, read here rather than in `UploadForm` so
  // that surface keeps no hooks of its own and stays renderable in a test.
  // `null` on an open instance and in the moments before the account view
  // lands, which is the dateless sentence, never a blank one.
  const allowanceEndsAt = useSyncSession().account?.allowanceExpiresAt ?? null;
  // WHETHER THE REFUSAL HAS A DOOR (M213 spec 05). Read here for the same
  // reason the date is, so `UploadForm` keeps no hooks and stays renderable in
  // a test. `false` for an unreachable or older service, which leaves the
  // refusal exactly as it was before plans existed.
  const plansAvailable = hasPlansDoor(useServerInstance());
  const [state, dispatch] = useReducer(analyzeReducer, initialAnalyzeState);
  const [file, setFile] = useState<File | null>(null);
  /**
   * The words this intake is about, or `null` when it is a photograph.
   *
   * It is the discriminator for the whole screen: `null` means the capture
   * surface, non-null means the quote block. Holding the text rather than a
   * boolean is what lets the person SEE what is being analysed, which is the
   * text path's equivalent of the photo preview.
   */
  const [typedText, setTypedText] = useState<string | null>(null);
  /** How this intake started. Only ever read at confirm time; see `SCAN_LOG_PATH_BY_SOURCE`. */
  const [intakeSource, setIntakeSource] = useState<IntakeSource>('photo');
  /**
   * The meal slot the confirm step opens on, resolved AT PICK TIME rather than
   * at render: the answer depends on `Date.now()`, and a value that moved every
   * render would fight the person editing the select. Null until a photo is
   * picked, which is also the honest answer for a confirm step reached without
   * one (a reload after a failed confirm): "No meal", never a guess.
   */
  const [captureMealType, setCaptureMealType] = useState<MealType | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  /** A dispatch that came back with neither a result nor a message. See the settle effect. */
  const [didSettleWithNothing, setDidSettleWithNothing] = useState(false);
  // The fetcher keeps its last result during a resubmit; suppress the result
  // that belonged to a superseded pick so a stale error/success can't cling to
  // a freshly-picked photo. Compared by reference — a new response is a new object.
  const [suppressedData, setSuppressedData] = useState<typeof fetcher.data>(undefined);
  const lastSubmittedDispatchId = useRef(0);
  const prevFetcherState = useRef(fetcher.state);
  // Holds the latest `processSelectedFile` so the mount-only share-target effect
  // can run the freshest closure without re-subscribing every render.
  const processSharedRef = useRef<(file: File) => void>(() => {});
  // Guards the once-only shared-photo pickup against a StrictMode double-mount.
  const sharedPhotoHandledRef = useRef(false);
  // Same pair for the tab-bar launcher's hand-off (see `scan-handoff.ts`).
  const processHandoffRef = useRef<(file: File) => void>(() => {});
  /** Same pair again for a sentence handed over by `/add` (typed or spoken). */
  const processTextHandoffRef = useRef<(text: string, source: TypedIntakeSource) => void>(() => {});
  const handoffHandledRef = useRef(false);

  const activeData = fetcher.data === suppressedData ? undefined : fetcher.data;

  // Sync the object-URL preview to the file that will actually be uploaded.
  // Creating the URL in the effect keeps it revoked on both replacement and
  // unmount and survives StrictMode remounts — this in-tab preview URL itself
  // is never written anywhere (the confirmed photo, separately, IS cached to
  // this device on save — see `handleConfirm`'s `savePlatePhoto` call).
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // A library pick's free grace window; cancel (or a fresh pick) clears the
  // timer before it can dispatch. Keyed on `pickId` so re-picking restarts it.
  useEffect(() => {
    if (state.phase !== 'grace') return;
    const timer = setTimeout(() => dispatch({ type: 'graceElapsed' }), LIBRARY_GRACE_MS);
    return () => clearTimeout(timer);
  }, [state.phase, state.pickId]);

  // Fire the identify request once per dispatch id: a retry (new id) re-submits
  // the same file, but a re-render at the same id (StrictMode) does not. This is
  // the single point where provider spend is committed.
  useEffect(() => {
    if (state.phase !== 'dispatching') return;
    // Either a prepared photograph or a sentence, never neither. The two are
    // mutually exclusive by construction: each entry point clears the other.
    if (file === null && typedText === null) return;
    if (lastSubmittedDispatchId.current === state.dispatchId) return;
    lastSubmittedDispatchId.current = state.dispatchId;
    setDidSettleWithNothing(false);
    const formData = new FormData();
    formData.append('_intent', 'identify');
    formData.append('intakeSource', intakeSource);
    if (typedText !== null) {
      formData.append('intake', 'text');
      formData.append('text', typedText);
    } else if (file !== null) {
      formData.append('intake', 'photo');
      formData.append('photo', file);
    }
    // WHICH AI, decided here where the config and the session are readable and
    // carried into the action, which can read neither. See
    // `writeManagedAiFields`.
    writeManagedAiFields(formData, managedAi);
    void fetcher.submit(formData, { method: 'post', encType: 'multipart/form-data' });
  }, [state.phase, state.dispatchId, file, typedText, intakeSource, fetcher, managedAi]);

  // Settle the machine on the fetcher's active→idle edge (not merely "idle", which
  // is also the pre-submit state) so an in-flight dispatch is never cut short.
  useEffect(() => {
    const wasActive = prevFetcherState.current !== 'idle';
    prevFetcherState.current = fetcher.state;
    if (!wasActive || fetcher.state !== 'idle') return;
    dispatch({ type: 'settled' });
    // THE SILENT FAILURE NET (M192/06). Every failure the action can SEE comes
    // back as `{ error }`, and the alert renders it. What has no owner is the
    // request that never reached the action at all — a body the dev server
    // refused, a navigation that cancelled the submission, a runtime that threw
    // before the handler. Walking 0.10.0 that produced a button that did
    // nothing: no toast, no card, nothing in the console. A round trip that
    // ends with neither a result nor a message is a failure, and this says so.
    setDidSettleWithNothing(fetcher.data === undefined);
  }, [fetcher.state, fetcher.data]);

  // Drive the staged status copy off an elapsed timer while a request is in
  // flight; reset once it settles.
  useEffect(() => {
    if (state.phase !== 'dispatching') {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [state.phase]);

  /**
   * The single entry to the capture pipeline: validate → downscale → arm.
   *
   * No scan to choose any more. Every photograph is downscaled to the one
   * ceiling and sent to the one photo task, and what the picture shows is the
   * model's problem (amends ADR-0005, 2026-09-08).
   */
  const processSelectedFile = async ({ picked, source }: { picked: File; source: PickSource }): Promise<void> => {
    const validation = validatePhoto({ type: picked.type, size: picked.size }, t);
    if (!validation.valid) {
      setSelectionError(validation.error);
      setFile(null);
      return;
    }
    setSelectionError(null);
    setIsProcessing(true);
    let nextFile: File;
    try {
      // ONE CEILING, `MAX_IMAGE_DIMENSION`. There used to be a second, higher
      // one for a nutrition panel, chosen by a mode the person picked before
      // the shutter. Merging the two photo tasks forced one answer, and the
      // operator took the cheaper one on 2026-09-08: every scan stays at
      // today's cost on the person's own key, and a panel line too small to
      // read comes back as `null` with a note rather than as a guess. See
      // ADR-0005's amendment.
      nextFile = await downscaleToJpeg(picked);
    } catch {
      // Decode failed (e.g. HEIC outside Safari). Send the original when the
      // browser will still accept it; otherwise ask for a friendlier format.
      if (!ALLOWED_MIME_TYPES.includes(picked.type)) {
        setSelectionError(t('scan.errors.photo.undecodableFormat'));
        setFile(null);
        setIsProcessing(false);
        return;
      }
      nextFile = picked;
    }
    setIsProcessing(false);
    // Drop any prior identify result, then arm: a camera capture dispatches now,
    // a library pick waits out the cancellable grace window.
    setSuppressedData(fetcher.data);
    // A photograph REPLACES any sentence that was being analysed: the two are
    // one screen's worth of state, and leaving both set would submit a form
    // carrying an intake the action does not run.
    setTypedText(null);
    setIntakeSource('photo');
    setFile(nextFile);
    // Read off the ORIGINAL picked file: `downscaleToJpeg` re-encodes through a
    // canvas and the File it returns is stamped with the current time, so the
    // downscaled copy has no memory of when the picture was taken.
    setCaptureMealType(mealTypeForCapture({ fileLastModifiedMs: picked.lastModified, nowMs: Date.now(), timezone }));
    dispatch({ type: 'pick', source });
  };

  /**
   * The text pipeline's single entry: hold the words, arm, dispatch.
   *
   * No validation, no downscale, no grace window. There is nothing to prepare
   * and nothing to reconsider — the person read their own sentence back before
   * they submitted it, which is exactly the confirmation the library-pick
   * grace window exists to provide for a photo they may have picked by
   * mistake. So it arms as a `'camera'` pick, which dispatches at once.
   */
  const processTypedText = ({ text, source }: { text: string; source: TypedIntakeSource }): void => {
    setSelectionError(null);
    setIsProcessing(false);
    setSuppressedData(fetcher.data);
    setFile(null);
    setTypedText(text);
    setIntakeSource(source);
    // No photo timestamp to read a slot off, so the slot is "now" — which is
    // what a person logging as they eat means anyway. Still editable on the
    // confirm screen, exactly as a photo's preselection is.
    setCaptureMealType(mealTypeForCapture({ fileLastModifiedMs: Date.now(), nowMs: Date.now(), timezone }));
    dispatch({ type: 'pick', source: 'camera' });
  };

  // Keep the ref pointing at the current pipeline entry (no dep array — runs
  // every render) so the mount effect below always calls the freshest closure.
  useEffect(() => {
    processSharedRef.current = (sharedFile: File) =>
      void processSelectedFile({ picked: sharedFile, source: 'library' });
    processHandoffRef.current = (handedFile: File) =>
      void processSelectedFile({ picked: handedFile, source: 'camera' });
    processTextHandoffRef.current = (text: string, source: TypedIntakeSource) => processTypedText({ text, source });
  });

  // The tab bar's launcher opened the camera itself and parked the photo for
  // us (`scan-handoff.ts`). Feed it into the SAME pipeline a capture taken on
  // this screen goes through — 'camera' dispatches at once, exactly as it does
  // when the shutter is pressed here, so the grace-window semantics are the
  // capture's, not the hand-off's. The slot empties as it is read, so a
  // remount can never re-analyse (and re-charge for) the same photo.
  useEffect(() => {
    if (handoffHandledRef.current) return;
    handoffHandledRef.current = true;
    const handed = takeIntakeHandoff();
    if (handed === null) return;
    // A SENTENCE ARRIVES THE SAME WAY A PHOTO DOES, through the same one-shot
    // slot and the same once-only guard, so a remount can never re-run (and
    // re-charge for) an intake that was already handled.
    if (handed.kind === 'text') {
      processTextHandoffRef.current(handed.text, handed.source);
      return;
    }
    processHandoffRef.current(handed.file);
  }, []);

  // Web Share Target v2: a photo shared into the app lands on /scan?shared=1. The
  // service worker stashed the file in a cache; read it back, strip the flag, and
  // feed it through the SAME library-pick path (downscale + grace + auto-analyze)
  // — never a forked pipeline. Runs once on mount.
  useEffect(() => {
    if (sharedPhotoHandledRef.current) return;
    if (globalThis.window === undefined || !('caches' in window)) return;
    if (!hasSharedPhotoFlag(window.location.search)) return;
    sharedPhotoHandledRef.current = true;

    // Clean the URL first so a reload can't reprocess a now-consumed photo.
    window.history.replaceState(null, '', buildUrlWithoutSharedParam(window.location.pathname, window.location.search));

    void (async () => {
      try {
        const sharedFile = await readSharedPhoto(window.caches);
        // Inside the ref guard above, and only once a photo was actually read:
        // an empty or unreadable cache slot is not an arrival.
        if (sharedFile) {
          trackScanStartedFromShare();
          processSharedRef.current(sharedFile);
        }
      } catch {
        // A missing/unreadable shared photo just leaves the normal picker in place.
      }
    })();
  }, []);

  const handlePick = (source: PickSource, picked: File | null) => {
    if (!picked) return;
    void processSelectedFile({ picked, source });
  };

  const handleRetry = () => {
    setSuppressedData(fetcher.data);
    dispatch({ type: 'retry' });
  };

  const identifyResult =
    activeData !== undefined && activeData.intent === 'identify' && 'identification' in activeData ?
      activeData
    : undefined;
  const failedIdentify =
    activeData !== undefined && activeData.intent === 'identify' && 'error' in activeData ? activeData : undefined;
  // See the settle effect above: a dispatch that came back with nothing at all.
  const silentFailure =
    didSettleWithNothing ? t(identifyFailedErrorKey(typedText === null ? 'photo' : 'text')) : undefined;

  // A returned identification (or a confirm-step re-validation) swaps to the
  // draft. Passing both keeps the plate's portion chips + curated matches alive
  // across a failed confirm — the identification rides the still-mounted fetcher.
  if (identifyResult || confirmResult) {
    return (
      <ConfirmDraftForm
        identification={identifyResult?.identification}
        typedText={typedText}
        provider={identifyResult?.provider}
        modelId={identifyResult?.modelId}
        matches={identifyResult?.matches}
        lastResult={confirmResult}
        logDate={logDate}
        logDateLabel={logDateLabel}
        photoFile={file}
        userId={userId}
        defaultMealType={captureMealType}
        intakeSource={identifyResult?.intakeSource ?? intakeSource}
      />
    );
  }

  return (
    <UploadForm
      phase={state.phase}
      file={file}
      typedText={typedText}
      previewUrl={previewUrl}
      isProcessing={isProcessing}
      selectionError={selectionError}
      elapsedSeconds={elapsedSeconds}
      error={failedIdentify?.error ?? silentFailure}
      failureCause={failedIdentify?.failureCause}
      retryAfterSeconds={failedIdentify?.retryAfterSeconds}
      allowanceEndsAt={allowanceEndsAt}
      plansAvailable={plansAvailable}
      provider={failedIdentify?.provider}
      usage={failedIdentify?.usage}
      modelId={failedIdentify?.modelId}
      monthlyUsage={monthlyUsage}
      logDate={logDate}
      logDateLabel={logDateLabel}
      onPick={handlePick}
      onCancel={() => dispatch({ type: 'cancel' })}
      onRetry={handleRetry}
    />
  );
}

/**
 * Cause-specific alert headline. Replaces the old one-size-fits-all "No luck
 * with that photo" — which was actively wrong for anything that isn't a
 * photo-quality problem (a wrong key, an empty provider balance, a rate
 * limit, an unrecognized model, or a malformed request all used to get the
 * same "mind trying another?" framing, telling the user to retry something
 * that could never succeed by retrying).
 */
const FAILURE_TITLE_KEY_BY_CAUSE = {
  auth: 'scan.errors.titles.auth',
  'reconsent-required': 'scan.errors.titles.reconsentRequired',
  credit: 'scan.errors.titles.credit',
  'rate-limit': 'scan.errors.titles.rateLimit',
  'model-not-found': 'scan.errors.titles.modelNotFound',
  'invalid-request': 'scan.errors.titles.invalidRequest',
  transient: 'scan.errors.titles.transient',
  'photo-too-large': 'scan.errors.titles.photoTooLarge',
  'ai-not-allowed': 'scan.errors.titles.aiNotAllowed',
  'account-suspended': 'scan.errors.titles.accountSuspended',
  // THE TWO M212 REFUSALS. Neither is about the person's key or their photo:
  // one is a date that passed on their account, the other is the operator out
  // of capacity for the day.
  'allowance-expired': 'scan.errors.titles.allowanceExpired',
  'ai-instance-ceiling': 'scan.errors.titles.instanceCeiling',
} satisfies Record<Exclude<VisionFailureCause, 'genuinely-no-food'>, string>;

/** The alert headline for a given failure cause — see `FAILURE_TITLE_KEY_BY_CAUSE`. */
export function getFailureAlertTitle(failureCause: VisionFailureCause | undefined, t: Translate): string {
  if (failureCause === undefined || failureCause === 'genuinely-no-food') return t('scan.errors.titles.noLuck');
  return t(FAILURE_TITLE_KEY_BY_CAUSE[failureCause]);
}

/**
 * OpenRouter's free-tier vision models cap out at a small daily request
 * count (M127/01 spike: 50 req/day at $0) — `failure-cause.ts` stays
 * provider-neutral (a `rate-limit` there could be ANY provider's generic
 * 429), so the "free scans reset daily, or add credits" specificity lives
 * here, gated on the provider actually being openrouter. Every other cause,
 * and a rate-limit from any other provider, keeps `failure-cause.ts`'s own
 * generic message unchanged.
 */
const OPENROUTER_RATE_LIMIT_KEY = 'scan.errors.openrouterRateLimit';

/**
 * Localized stand-ins for the messages the provider-neutral vision adapter
 * layer (`app/services/vision/failure-cause.ts`) authors in English. That layer
 * is deliberately i18n-free — it has no `t` threaded through it — so the route
 * re-states its deterministic messages here, keyed by the same typed cause the
 * adapter already carries. Only the causes whose adapter message is a single
 * fixed sentence are listed: `transient` has two possible messages (unreachable
 * host vs. 5xx) and `invalid-request` embeds the HTTP status, so neither can be
 * restated faithfully from the cause alone and both keep the adapter's English.
 */
const FAILURE_BODY_KEY_BY_CAUSE = {
  auth: 'scan.errors.provider.auth',
  // A single fixed sentence in `failure-cause.ts`, so it restates cleanly here.
  'reconsent-required': 'scan.errors.provider.reconsentRequired',
  credit: 'scan.errors.provider.credit',
  'rate-limit': 'scan.errors.provider.rateLimit',
  'model-not-found': 'scan.errors.provider.modelNotFound',
  // THE THREE A MANAGED INSTANCE ANSWERS WITH (M192/06). Each is a single
  // fixed sentence in `failure-cause.ts`, so each restates cleanly here.
  'photo-too-large': 'scan.errors.provider.photoTooLarge',
  'ai-not-allowed': 'scan.errors.provider.aiNotAllowed',
  'account-suspended': 'scan.errors.provider.accountSuspended',
  // THE DATELESS FORM of the expired sentence, which is the one this map can
  // answer: the date is not in the classification, so `describeFailureBody`
  // swaps in `allowanceExpiredOn` when the session knows it, exactly as it
  // swaps the two rate-limit sentences on `Retry-After`.
  'allowance-expired': 'scan.errors.provider.allowanceExpired',
  'ai-instance-ceiling': 'scan.errors.provider.instanceCeiling',
  // The remaining causes deliberately keep the adapter's own English (see above).
  'invalid-request': undefined,
  transient: undefined,
  'genuinely-no-food': undefined,
} satisfies Record<VisionFailureCause, string | undefined>;

/**
 * Whether the refusal a person is looking at has a page that fixes it.
 *
 * ONE CAUSE ONLY, and that is the whole rule. `allowance-expired` is the
 * refusal a payment answers; `ai-not-allowed` is an account an administrator
 * never switched on, and offering to sell a plan there would be an
 * advertisement on a screen somebody opened to log a meal. The composer's
 * notice draws the same distinction through `resolveAiIntakeDoor`, so the two
 * surfaces cannot disagree about one account.
 *
 * PURE AND EXPORTED so the branch has a test with a control on both inputs; a
 * link rendered from a `&&` inside the alert would have neither.
 */
export function shouldOfferPlansDoor(input: { failureCause?: VisionFailureCause; plansAvailable: boolean }): boolean {
  return input.plansAvailable && input.failureCause === 'allowance-expired';
}

/**
 * Under a minute, a `429` is a burst limit and the advice is "in a moment".
 * At or over it, the allowance is spent for the day and telling somebody to
 * wait a moment is simply false.
 */
const RATE_LIMIT_MINUTE_SECONDS = 60;

/** The alert body for a given failure — see `FAILURE_BODY_KEY_BY_CAUSE`. */
export function describeFailureBody(
  params: {
    failureCause?: VisionFailureCause;
    provider?: AiProviderType;
    error?: string;
    /** The server's own `Retry-After`, in seconds, when it sent one. */
    retryAfterSeconds?: number | null;
    /**
     * The account's allowance end date, when this device has read one.
     *
     * `null` FOR TWO REASONS AND THE SENTENCE IS THE SAME FOR BOTH: an open
     * instance has no such date, and a session whose account view has not
     * landed has not read it yet. Neither may print an empty date, so the
     * dateless sentence is the fallback rather than an interpolated blank.
     */
    allowanceEndsAt?: string | null;
  },
  t: Translate,
): string | undefined {
  if (params.failureCause === 'rate-limit' && params.provider === 'openrouter') return t(OPENROUTER_RATE_LIMIT_KEY);
  // THE DATE, WHEN THERE IS ONE. "Your access ended" is not checkable and a
  // date is, which is the whole reason this refusal is its own cause.
  if (params.failureCause === 'allowance-expired') {
    const endsAt = params.allowanceEndsAt;
    if (endsAt !== null && endsAt !== undefined) {
      return t('scan.errors.provider.allowanceExpiredOn', { date: new Date(endsAt).toLocaleDateString() });
    }
  }
  // A MANAGED 429 IS TWO DIFFERENT SENTENCES, and only the header tells them
  // apart: a burst limit clears within the minute, a spent daily allowance
  // does not clear until tomorrow. Saying "wait a moment" for the second is
  // the failure this branch exists to avoid.
  if (params.failureCause === 'rate-limit') {
    const retryAfter = params.retryAfterSeconds;
    if (retryAfter !== null && retryAfter !== undefined && retryAfter < RATE_LIMIT_MINUTE_SECONDS) {
      return t('scan.errors.provider.rateLimitMinute');
    }
    if (retryAfter !== null && retryAfter !== undefined) return t('scan.errors.provider.allowanceSpent');
  }
  const bodyKey = params.failureCause ? FAILURE_BODY_KEY_BY_CAUSE[params.failureCause] : undefined;
  if (bodyKey) return t(bodyKey);
  return params.error;
}

/**
 * Presentational capture surface: preview, the two pickers, the grace/analysis
 * overlays, and the failure copy. Stateless beyond the two hidden file inputs
 * it owns, all decisions flow down as props from `ScanFlow`.
 *
 * EXPORTED SO BOTH INTAKES CAN BE RENDERED IN A TEST. `ScanFlow` reads the
 * hand-off slot in an effect, and `renderToStaticMarkup` never runs effects, so
 * a text intake is unreachable through the container. Handing this component
 * `typedText` directly is the only way to prove that a typed meal hides the
 * photo controls and a photo intake still shows them.
 */
export function UploadForm({
  phase,
  file,
  typedText,
  previewUrl,
  isProcessing,
  selectionError,
  elapsedSeconds,
  error,
  failureCause,
  retryAfterSeconds,
  allowanceEndsAt,
  plansAvailable,
  provider,
  usage,
  modelId,
  monthlyUsage,
  logDate,
  logDateLabel,
  onPick,
  onCancel,
  onRetry,
}: {
  phase: AnalyzePhase;
  file: File | null;
  /** The sentence being analysed, or `null` for a photograph. Branches COPY and the preview only. */
  typedText: string | null;
  previewUrl: string | null;
  isProcessing: boolean;
  selectionError: string | null;
  elapsedSeconds: number;
  error?: string;
  /** Machine-readable reason `error` happened — picks the alert's headline (see `getFailureAlertTitle`). */
  failureCause?: VisionFailureCause;
  /** The server's `Retry-After` in seconds — tells a burst limit from a spent daily allowance. */
  retryAfterSeconds?: number | null;
  /**
   * The account's allowance end date, or `null`.
   *
   * A PROP RATHER THAN A HOOK, like everything else on this component: the
   * container reads the session snapshot and this surface stays renderable by
   * `renderToStaticMarkup` (see the header). It names the date on the one
   * refusal that is about a date.
   */
  allowanceEndsAt?: string | null;
  /**
   * Whether this instance sells a plan, so the expiry refusal has somewhere to
   * send a person (M213 spec 05).
   *
   * A PROP, LIKE THE DATE ABOVE, and defaulted to `false` here for the one
   * reason a default is safe: an instance that sells nothing is what every
   * deployment was before this milestone, and it draws exactly the sentence it
   * drew then.
   */
  plansAvailable?: boolean;
  /** The provider active for this attempt — phrases a `rate-limit` failure (see below) and keys the failed attempt's pricing lookup; never branches the alert's headline or any other cause. */
  provider?: AiProviderType;
  usage?: ScanTokenUsage;
  modelId?: string;
  monthlyUsage: MonthlyAiUsage;
  logDate: string | null;
  logDateLabel: string | null;
  onPick: (source: PickSource, file: File | null) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const monthlyUsageLine = formatMonthlyUsageLine(monthlyUsage);
  const addHref = logDate ? `/add?date=${logDate}` : '/add';
  const failedAttemptCostUsd =
    usage && modelId && provider ? (estimateScanCostUsd(provider, modelId, usage) ?? null) : null;
  const failedAttemptCreditLine = usage ? formatFailedAttemptCreditLine(failedAttemptCostUsd, t) : null;
  // A photo-quality failure (no typed cause at all — validation/read errors —
  // or the vision call succeeding but returning nothing usable) keeps the
  // original "try a clearer shot" framing, since that advice is actually
  // right there. Every OTHER typed cause (wrong key, no credit, rate limited,
  // unrecognized model, malformed request, transient outage) gets its own
  // accurate headline below instead — retrying with a different photo can
  // never fix a rejected API key.
  const isPhotoQualityFailure = failureCause === undefined || failureCause === 'genuinely-no-food';
  // TWO SUBJECTS NOW, not three. A photograph is a photograph whatever it
  // shows (amends ADR-0005, 2026-09-08), so the only copy branch left is
  // between a picture and a sentence: "we could not read that picture" is not
  // "we could not make food out of what you wrote", and a person told the
  // wrong one retries the wrong thing.
  const isTextIntake = typedText !== null;
  // WHO RECEIVES THE PHOTOGRAPH, which is the only reason this screen asks
  // anything about the instance (M201/07).
  const { aiComesFromTheInstance } = useInstancePolicy();
  // COPY ONLY. Every task-specific behaviour (prompt, schema, parse, capture
  // resolution) is on the scan-task descriptor; what changes here is what the
  // sentences say, because "no foods on that plate" is not "couldn't read that
  // panel" and a user told the wrong one retries the wrong thing.
  const captureTitle = isTextIntake ? t('scan.textIntake.title') : t('scan.capture.title');
  // THE RECIPIENT IS NAMED DIFFERENTLY on a managed instance (M192/05), and
  // that is the whole reason for the branch: "your own AI provider" is true on
  // an open instance and false here, where the photo goes to a proxy the
  // person's own organization runs. Somebody deciding whether to press the
  // shutter is deciding who sees the photo.
  const captureDescription =
    isTextIntake ?
      aiComesFromTheInstance ? t('scan.textIntake.managedDescription')
      : t('scan.textIntake.description')
    : aiComesFromTheInstance ? t('scan.capture.managedDescription')
    : t('scan.capture.description');
  const emptyTitle = t('scan.capture.emptyTitle');
  const photoLabel = isTextIntake ? t('scan.textIntake.label') : t('scan.capture.photoLabel');
  const previewAlt = t('scan.capture.previewAlt');
  const alertTitle =
    isPhotoQualityFailure && isTextIntake ? t('scan.errors.text.title') : getFailureAlertTitle(failureCause, t);
  const photoQualityBody = isTextIntake ? t('scan.errors.text.qualityBody') : t('scan.errors.photoQualityBody');
  // Only relevant for a photo-quality failure: whether there's extra detail
  // worth showing below the friendly headline (the plain NO_FOODS_ERROR case
  // has nothing more specific to add). A non-photo-quality failure shows
  // `error` as its main body instead — see the Alert render below.
  const showSpecificError = error !== undefined && error !== t(noFoodsErrorKey(isTextIntake ? 'text' : 'photo'));

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>, source: PickSource) => {
    const picked = event.target.files?.[0] ?? null;
    // Reset the trigger so re-picking the same file fires change again.
    event.target.value = '';
    onPick(source, picked);
  };

  // Picks are blocked only while preparing a photo or during a committed request;
  // the free grace window still accepts a re-pick (which re-arms it).
  const pickDisabled = isProcessing || phase === 'dispatching';
  // After a cancel or a failed attempt we rest at idle-with-an-intake and offer
  // a manual, deliberately-quiet analyze — this app never nudges the user to
  // spend. A sentence qualifies exactly as a prepared photo does.
  const canAnalyze = phase === 'idle' && (file !== null || isTextIntake) && !isProcessing;

  return (
    <div className="space-y-4">
      {logDate && logDateLabel && <LoggingToBanner label={logDateLabel} switchToTodayHref="/scan" />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isTextIntake ?
              <TypeIcon className="h-5 w-5" />
            : <Camera className="h-5 w-5" />}{' '}
            {captureTitle}
          </CardTitle>
          <CardDescription>{captureDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Two hidden trigger inputs feed the same downscale → auto-analyze pipeline. */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => handleInputChange(event, 'camera')}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => handleInputChange(event, 'library')}
            />

            <div className="grid gap-2">
              {/* Caption only — picking is driven by the two buttons below. */}
              <Label>{photoLabel}</Label>

              {/* THE TEXT PATH'S PREVIEW. A photo intake shows the picture
                  being analysed; a typed or spoken one shows the sentence, in
                  the same slot and with the same in-flight overlay, so the
                  person can see what is being read either way. A quote block
                  and not an editable field: the analysis is already running,
                  and a box you can type into while it does would be a promise
                  the screen cannot keep. */}
              {isTextIntake && (
                <figure className="relative w-full rounded-lg border bg-muted/40 p-4">
                  <blockquote className="text-sm break-words whitespace-pre-wrap">{typedText}</blockquote>
                  {phase === 'dispatching' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/60 backdrop-blur">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm font-medium">{getIdentifyStageMessage(elapsedSeconds, t, 'text')}</p>
                    </div>
                  )}
                </figure>
              )}

              {!isTextIntake && file && previewUrl && (
                <div className="relative aspect-video max-h-72 w-full overflow-hidden rounded-lg bg-zinc-100 sm:max-h-80 dark:bg-zinc-900">
                  <img src={previewUrl} alt={previewAlt} className="h-full w-full object-cover" />
                  {phase === 'grace' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 p-4 backdrop-blur">
                      {/* The grace window is the one in-flight state that used
                          to sit completely still — a frozen sentence over a
                          blurred photo, which reads as a hang. The dots carry
                          "we're on it" without competing with the spinner that
                          takes over the moment the request is actually
                          dispatched. */}
                      <LoadingDots />
                      <p className="text-sm font-medium">{t('scan.analyzing.starting')}</p>
                      <Button type="button" variant="secondary" onClick={onCancel} className="h-11 w-full">
                        {t('scan.capture.cancel')}
                      </Button>
                    </div>
                  )}
                  {phase === 'dispatching' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm font-medium">{getIdentifyStageMessage(elapsedSeconds, t, 'photo')}</p>
                    </div>
                  )}
                </div>
              )}

              {!isTextIntake && !file && (
                <div className="flex aspect-video max-h-44 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-center">
                  <Camera className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{emptyTitle}</p>
                </div>
              )}

              {/* ONE shutter. There used to be a second button here for a
                  nutrition panel, which asked the person to classify their own
                  photograph before taking it and could only be got wrong after
                  the paid call had been made. The model classifies each item
                  now (amends ADR-0005, 2026-09-08).

                  HIDDEN OUTRIGHT for a typed or spoken meal, not merely
                  disabled: these were rendering greyed out under the quote
                  block, which reads as two things the person is being stopped
                  from doing rather than as two things that do not apply. The
                  hidden inputs above stay mounted either way, because the
                  element whose `click()` lands on the gesture stack must not
                  be able to unmount. */}
              {!isTextIntake && (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={pickDisabled}
                    className="h-14 w-full text-base"
                  >
                    <Camera className="h-5 w-5" /> {t('scan.capture.takePhoto')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => libraryInputRef.current?.click()}
                    disabled={pickDisabled}
                    className="h-11 w-full"
                  >
                    {t('scan.capture.chooseLibrary')}
                  </Button>
                </div>
              )}

              {isProcessing && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('scan.capture.preparing')}
                </p>
              )}

              {!isTextIntake && file && !isProcessing && (
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {file.name} · {formatFileSize(file.size)}
                </p>
              )}

              <FieldError errors={selectionError ? [selectionError] : undefined} />
            </div>

            {error && (
              <Alert>
                {isTextIntake ?
                  <TypeIcon className="h-4 w-4" />
                : <Camera className="h-4 w-4" />}
                <AlertTitle>{alertTitle}</AlertTitle>
                <AlertDescription>
                  {
                    isPhotoQualityFailure ?
                      <>
                        {photoQualityBody}
                        {showSpecificError && <span className="mt-1 block text-xs text-muted-foreground">{error}</span>}
                      </>
                      // A non-photo-quality failure's `error` message is already
                      // the specific, actionable detail (see `failure-cause.ts`)
                      // — showing it as the main body, not a muted afterthought.
                      // `describeFailureBody` additionally swaps in OpenRouter-
                      // specific free-tier copy for a `rate-limit` failure.
                    : describeFailureBody({ failureCause, provider, error, retryAfterSeconds, allowanceEndsAt }, t)
                  }
                </AlertDescription>
              </Alert>
            )}

            {/* THE DOOR, WHERE THERE IS ONE (M213 spec 05). A link under the
                alert rather than a sentence inside it: `describeFailureBody`
                answers a string, the date sentence is already written, and a
                second copy of it carrying an anchor would be the two surfaces
                drifting apart that `shouldOfferPlansDoor` exists to stop. */}
            {error && shouldOfferPlansDoor({ failureCause, plansAvailable: plansAvailable ?? false }) && (
              <p className="text-xs">
                <Link to={PLAN_PAGE_HREF} className="text-primary underline-offset-4 hover:underline">
                  {t('aiIntake.plansLink')}
                </Link>
              </p>
            )}

            {error && failedAttemptCreditLine && (
              <p className="text-xs text-muted-foreground">{failedAttemptCreditLine}</p>
            )}

            {canAnalyze && (
              <Button type="button" variant="secondary" onClick={onRetry} className="h-11 w-full">
                {t('scan.capture.analyze')}
              </Button>
            )}

            {/* Search is always one tap from scan, keyless-friendly, carries
                the day. Not offered during a typed or spoken intake: the
                person came FROM that screen, and "add food without a photo" is
                a description of what they already did. */}
            {!isTextIntake && (
              <div className="pt-1 text-center">
                <Link
                  to={addHref}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t('scan.capture.addWithoutPhoto')}
                </Link>
              </div>
            )}
          </div>
        </CardContent>
        {monthlyUsageLine && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">{monthlyUsageLine}</p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

/**
 * Reads back a photo shared into the app from the OS share sheet for a
 * visitor with no AI provider connected. `ScanFlow` (the normal reader of
 * this cache entry) never mounts for a keyless visitor — only `ConnectCard`
 * renders — so without this, the share silently had no visible effect at
 * all: no error, no acknowledgement, nothing. This still reads (and clears)
 * the cache entry so it can't linger forever, but keeps only an in-memory
 * preview to show what was received — a keyless visitor has no AI provider
 * connected yet, so nothing has been (or can be) identified or cached to the
 * on-device photo store — then `ConnectCard` says plainly what happened and
 * what to do.
 */
function useKeylessSharedPhotoPreview(): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    if (globalThis.window === undefined || !('caches' in window)) return;
    if (!hasSharedPhotoFlag(window.location.search)) return;
    handledRef.current = true;

    window.history.replaceState(null, '', buildUrlWithoutSharedParam(window.location.pathname, window.location.search));

    void (async () => {
      try {
        const sharedFile = await readSharedPhoto(window.caches);
        if (sharedFile) setPreviewUrl(URL.createObjectURL(sharedFile));
      } catch {
        // Nothing readable — ConnectCard just shows its normal copy.
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return previewUrl;
}

/**
 * Which of the connect cards this instance shows a user who has no AI
 * connection yet.
 *
 * - `self-hosted`: nobody but the provider the user picks themselves, so the
 *   BYOK buttons are the whole answer.
 * - `instance-ai`: this instance runs an inference endpoint of its own (M138
 *   spec 06), and the recipient is NAMED — a person deciding whether to press
 *   the shutter is deciding who sees the photo.
 * - `managed-missing`: a managed instance (M187 spec 03, M192), where AI comes
 *   from the account and never from a button on this card. It wins over a
 *   preset: a person here brings no key of their own, and the answer to a
 *   missing connection is their administrator rather than a provider signup.
 * - `resuming`: the same instance while the session is still being reopened.
 *   Not a card at all; `ConnectCard` renders the screen's loading placeholder,
 *   because a managed answer picked before the resume settles could be wrong
 *   for the moment the resume takes.
 *
 * ── The incident this rule exists for (0.10.3) ────────────────────────────
 *
 * A managed instance signed people out silently: a spent refresh token in the
 * device's cache was read by the service as theft and the whole family was
 * revoked. This screen then told them their account was not switched on for
 * photo estimates and to ask their administrator, of an account with a limit
 * of 200 that was never suspended and whose owner had done nothing. The rule
 * (`resolveEffectiveAiSettings`) was right to answer `null` regardless of
 * session; naming a cause is the SCREEN's job, and this is the screen.
 *
 * ── THE SIGNED-OUT CARD IS GONE (M204 spec 07) ────────────────────────────
 *
 * A fourth variant used to name a managed instance with no session, and sent
 * the person to the screen that reopens one. It cannot happen on this screen:
 * `_personal.tsx`'s gate reads `isDeviceLocked() || no session` and sends
 * every personal route, `/scan` included, to `/welcome` before this card ever
 * renders. The identical dead state was removed from `/describe` and `/add`
 * in M204 spec 01 (`resolveAiIntakeDoor`); this is the same decision for the
 * one screen it had not reached yet. See `use-ai-connection.ts` for the full
 * reasoning, which applies here unchanged.
 */
export type ConnectCardVariant =
  | { kind: 'self-hosted' }
  | { kind: 'instance-ai'; host: string }
  | { kind: 'managed-missing' }
  | { kind: 'resuming' };

/** Whether this device holds a session, as this card has to ask it. */
export type ConnectSessionState = 'resuming' | 'signed-out' | 'signed-in';

/**
 * Reads the session snapshot as the three answers this card distinguishes.
 *
 * `account === null` alone is NOT "signed out": it is also every moment
 * between a reload and the end of the resume, which is why `isResuming` is
 * asked first (`SyncSessionSnapshot.isResuming`).
 */
export function resolveConnectSessionState(session: SyncSessionSnapshot): ConnectSessionState {
  if (session.isResuming) return 'resuming';
  return session.account === null ? 'signed-out' : 'signed-in';
}

export function resolveConnectCardVariant({
  managed,
  presetBaseUrl,
  sessionState,
}: {
  managed: boolean;
  presetBaseUrl: string | null;
  sessionState: ConnectSessionState;
}): ConnectCardVariant {
  if (managed) {
    // NOT SIGNED-IN VS SIGNED-OUT any more (M204 spec 07): the device lock
    // sends a signed-out device to `/welcome` before this ever renders, so
    // `resuming` is the only session shape left to distinguish.
    if (sessionState === 'resuming') return { kind: 'resuming' };
    return { kind: 'managed-missing' };
  }
  // An open instance's card does not depend on a session at all: the key is
  // the device's own, and there may be no account anywhere on this instance.
  if (presetBaseUrl === null) return { kind: 'self-hosted' };
  return { kind: 'instance-ai', host: new URL(presetBaseUrl).host };
}

/**
 * Keyless-friendly landing for a user without an AI provider yet — also the cold
 * open for anyone who's never scanned before, since /scan is a primary tab. Says
 * plainly, before any jargon, what this does, that it needs a paid account the
 * visitor sets up themselves, roughly what it costs, and that everything else in
 * openplate works without it — so someone who will never do this can tell in one
 * screen and move on without feeling locked out (usability-overhaul fix). Replaces
 * the old hard redirect to /settings/ai with a warm connect card that also offers a
 * photo-free path to logging. When a photo was shared in from the OS share sheet
 * before an AI provider was connected, says so honestly instead of silently
 * dropping it (see `useKeylessSharedPhotoPreview`).
 *
 * On a MANAGED instance this card is a dead end by design, and says so: AI
 * comes from the gateway the operator runs and is attached by an invite link,
 * so there is no button here that can fix a missing connection. Exported for
 * `scan-connect-card.test.ts`, which renders both shapes.
 */
export function ConnectCard({ logDate }: { logDate: string | null }) {
  // Which instance this is decides the whole card. An instance that runs AI of
  // its own cannot say openplate runs none, because on this instance it does.
  // TWO ways an instance can: its own inference endpoint (M138 spec 06), or by
  // being a managed instance whose server proxies AI for its accounts (M192).
  const { aiComesFromTheInstance } = useInstancePolicy();
  const instancePreset = useInstanceInferencePreset();
  // AND WHETHER THIS DEVICE IS STILL RESUMING A SESSION, the one session
  // question a managed instance's card still asks (M204 spec 07). See
  // `resolveConnectCardVariant`.
  const session = useSyncSession();
  // AND WHY, when the answer is "this account has no allowance". Three
  // different facts wear that one variant, and only one of them is "ask your
  // administrator" (M212 spec 04). Resolved by the shared rule, so this card,
  // the composer's notice and the account page cannot disagree.
  const instance = useServerInstance();
  const allowanceDoor = resolveAllowanceDoor({
    memberInvites: instance?.memberInvites ?? false,
    allowanceExpiresAt: session.account?.allowanceExpiresAt ?? null,
    now: new Date(),
  });
  const variant = resolveConnectCardVariant({
    managed: aiComesFromTheInstance,
    presetBaseUrl: instancePreset?.baseUrl ?? null,
    sessionState: resolveConnectSessionState(session),
  });
  // NOT A CARD YET. The resume is still running and the two managed answers
  // are opposite, so the screen waits rather than picking one and correcting
  // itself a moment later.
  if (variant.kind === 'resuming') return <ScanLoading />;
  return <ConnectCardView variant={variant} logDate={logDate} allowanceDoor={allowanceDoor} />;
}

/**
 * The card itself, given its variant.
 *
 * SPLIT FROM THE HOOKS ABOVE so every shape can be rendered in a test. The
 * session snapshot is read through `useSyncExternalStore`, whose server
 * snapshot is a constant signed-out session, and on a managed instance that
 * now resolves to `managed-missing` regardless, the same shape a signed-in
 * device gets (M204 spec 07). `self-hosted` and `instance-ai` still need
 * `ConnectCardView` rendered directly, because those depend on the instance,
 * not the session.
 */
export function ConnectCardView({
  variant,
  logDate,
  allowanceDoor,
}: {
  variant: Exclude<ConnectCardVariant, { kind: 'resuming' }>;
  logDate: string | null;
  /**
   * Why the allowance is missing, read only by the `managed-missing` shape.
   *
   * REQUIRED, with no default. A default of `{ kind: 'ask-admin' }` would keep
   * the sentence that names an administrator on the one instance where there is
   * none, and it would compile, which is how a correctness argument reaches
   * zero call sites.
   */
  allowanceDoor: AllowanceDoor;
}) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const addHref = logDate ? `/add?date=${logDate}` : '/add';
  const sharedPhotoPreviewUrl = useKeylessSharedPhotoPreview();
  // THE MANAGED SHAPE SUPPRESSES THE SAME BUTTONS the open shapes offer.
  // There is no key to bring on a managed instance, so the OAuth button, the
  // preset and the manual settings link are all wrong here.
  const isManaged = variant.kind === 'managed-missing';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" /> {t('scan.setup.title')}
        </CardTitle>
        <CardDescription>
          {isManaged ? t('scan.setup.managed.description') : t('scan.setup.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Three shapes, because the honest answer differs. On a self-hosted
            instance there is nobody but the provider the user chooses, so one
            sentence covers it. On an instance with an AI endpoint of its own
            the photo goes to an endpoint this instance's operator runs, and
            the recipient is NAMED rather than left as "an AI" — a person
            deciding whether to press the shutter is deciding who sees the
            photo. On a managed instance this card is a DEAD END by design: the
            connection arrives with an invite link, never from a button here,
            so the card explains the gap and points at the person who invited
            them. The recipient line is dropped in that case, because no photo
            goes anywhere yet. There is no fourth, signed-out shape any more
            (M204 spec 07): the device lock sends that visit to `/welcome`
            before this card renders.
            The audit line, when a gateway declared one, is rendered by
            `AuditReviewNotice` on the connected screen — it describes a
            connection that does not exist yet on this card. */}
        {variant.kind === 'self-hosted' && (
          <p className="text-sm text-muted-foreground">{t('scan.setup.crisp.selfHosted')}</p>
        )}
        {variant.kind === 'instance-ai' && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('scan.setup.crisp.managedWhat')}</p>
            <p>{t('scan.setup.crisp.managedWho', { host: variant.host })}</p>
          </div>
        )}
        {/* A DEAD END BY DESIGN, and it says so plainly: on a managed instance
            there is no key to bring and no provider to pick, so the only true
            answer is that photo estimates are not switched on for this account
            and the administrator is who switches them on. Every button that
            would suggest otherwise is suppressed below. */}
        {variant.kind === 'managed-missing' && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('scan.setup.managedMissing.body')}</p>
            {/* THE SECOND SENTENCE IS THE ONE THAT USED TO LIE. It named an
                administrator on every managed instance, and a consumer
                instance has none: there the truth is either a date that
                passed, or nothing more to say than the line above, which
                already says photo estimates are not switched on for this
                account. */}
            {allowanceDoor.kind === 'ask-admin' && <p>{t('scan.setup.managedMissing.askAdmin')}</p>}
            {allowanceDoor.kind === 'allowance-ended' && (
              <p>
                {t('scan.setup.managedMissing.expired', {
                  date: new Date(allowanceDoor.endedAt).toLocaleDateString(),
                })}
              </p>
            )}
          </div>
        )}
        {/* One tap, no key to go and get — renders nothing at all when this
            instance provides no AI of its own. Above the BYOK buttons because
            on such an instance it is the whole answer; `revalidate` re-runs
            `clientLoader`, which re-reads the device settings and swaps this
            card for the real scan flow. */}
        {/* Renders nothing when this instance provides no AI of its own, and
            is suppressed outright on a managed one: a preset button there would
            offer a second way in beside the account, which is not how the
            answer arrives. */}
        {!isManaged && <InstancePresetConnect onConnected={() => void revalidator.revalidate()} />}
        {sharedPhotoPreviewUrl && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <img
              src={sharedPhotoPreviewUrl}
              alt={t('scan.setup.sharedPhotoAlt')}
              className="h-14 w-14 shrink-0 rounded-md object-cover"
            />
            <p className="text-sm text-muted-foreground">{t('scan.setup.sharedPhotoNote')}</p>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* Primary CTA: openrouter is the only provider with a one-click OAuth
              connect (`vision/registry.ts`) — rendered off that capability,
              never a hardcoded provider check here. Absent on a managed
              instance: a user there never brings a key of their own, so
              offering one reads as "your OpenRouter connection is missing"
              when the real answer is a new invite link. */}
          {!isManaged && supportsOauthPkce('openrouter') && (
            <OAuthConnectButton className="h-11 w-full sm:flex-1">
              {t('scan.setup.connectOpenRouter')}
            </OAuthConnectButton>
          )}
          <Button asChild variant="outline" className="h-11 w-full sm:flex-1">
            <Link to={addHref}>{t('scan.capture.addWithoutPhoto')}</Link>
          </Button>
        </div>
        {!isManaged && (
          <div className="text-center">
            {/* `?next=scan` returns the user here once their key is connected.
                Dropped on a managed instance for the same reason as the OAuth
                button: there is no key for this user to set up by hand. */}
            <Link
              to="/settings/ai?next=scan"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t('scan.setup.manualSetup')}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact honest per-100g summary for a curated match — null macros are skipped, never shown as 0. */
function formatCuratedMacroSummary(match: FoodMatch, t: Translate, language: string): string {
  const { kcal, carbs, fiber } = match.macrosPer100g;
  const parts: string[] = [];
  if (kcal !== null) parts.push(t('scan.review.match.calories', { value: formatMacroNumberIn(language, kcal) }));
  if (carbs !== null) parts.push(t('scan.review.match.carbs', { value: formatMacroNumberIn(language, carbs) }));
  if (fiber !== null) parts.push(t('scan.review.match.fiber', { value: formatMacroNumberIn(language, fiber) }));
  return parts.join(' · ');
}

/** Whether a match's English canonical name is worth showing beside a localized title. */
function shouldShowCanonicalName(match: FoodMatch): boolean {
  return match.canonicalName !== '' && match.canonicalName !== match.title;
}

/** Net-carb traffic-light badge for a match, or null when net carbs are unknown. */
function MatchNetCarbBadge({ netCarbsPer100g }: { netCarbsPer100g: number | null }) {
  const { t, i18n } = useTranslation();
  if (netCarbsPer100g === null) return null;
  const carbStatus = getCarbStatus(netCarbsPer100g);
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        carbStatusBadgeClass[carbStatus],
      )}
    >
      {t('scan.review.match.netCarbs', { value: formatMacroNumberIn(i18n.language, netCarbsPer100g) })}
    </span>
  );
}

/**
 * Tier label keys. `matchTierLabel` (`#app/lib/match-quality`) is shared with
 * the /add search surface, so its English stays put and the localized wording
 * lives at this call site instead.
 */
const MATCH_TIER_LABEL_KEY = {
  strong: 'scan.review.matchTier.strong',
  likely: 'scan.review.matchTier.likely',
  weak: 'scan.review.matchTier.weak',
} satisfies Record<MatchTier, string>;

/** Subtle zinc trust chip ("Strong match" / "Possible match") — never shows the raw score. */
function MatchTierChip({ tier }: { tier: MatchTier }) {
  const { t } = useTranslation();
  return (
    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', matchTierChipClass[tier])}>
      {t(MATCH_TIER_LABEL_KEY[tier])}
    </span>
  );
}

/** The primary "Found in LowCarbCheck" card for a confident top match. */
function CuratedMatchCard({
  match,
  tier,
  applied,
  onUse,
  onDismiss,
}: {
  match: FoodMatch;
  tier: MatchTier;
  applied: boolean;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const macroSummary = formatCuratedMacroSummary(match, t, i18n.language);
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t('scan.review.match.foundIn')}</p>
          <MatchTierChip tier={tier} />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('scan.review.match.dismiss')}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Below sm: thumbnail+title row, then badge/macro row, then a right-aligned
          button row — avoids squeezing the title/badge into a sliver of width
          beside a fixed-size button. At sm+: original side-by-side layout
          (thumbnail | full text column | button). Title/canonical-name render
          twice (visibility toggled per breakpoint) since they belong to a
          different visual grouping at each size — a plain CSS reorder can't
          split "thumbnail+title" from "badge+macro" any other way. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
            {match.imageUrl && (
              <img src={match.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:hidden">
            <p className="truncate text-sm font-medium">{match.title}</p>
            {shouldShowCanonicalName(match) && (
              <p className="truncate text-xs text-muted-foreground">{match.canonicalName}</p>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="hidden truncate text-sm font-medium sm:block">{match.title}</p>
          {shouldShowCanonicalName(match) && (
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{match.canonicalName}</p>
          )}
          <MatchNetCarbBadge netCarbsPer100g={match.netCarbsPer100g} />
          {macroSummary && (
            <p className="text-xs text-muted-foreground">{t('scan.review.match.per100g', { summary: macroSummary })}</p>
          )}
          {match.url && (
            <a
              href={match.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-primary underline-offset-4 hover:underline"
            >
              {t('scan.review.match.viewOnLcc')}
            </a>
          )}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onUse}
          disabled={applied}
          className="self-end sm:self-start"
        >
          {applied && <Check className="h-4 w-4" />}
          {applied ? t('scan.review.match.applied') : t('scan.review.match.useThisData')}
        </Button>
      </div>
      {match.attribution && <p className="text-xs text-muted-foreground">{match.attribution}</p>}
    </div>
  );
}

/** Compact alternate-match row inside the "See other matches" disclosure. */
function MatchOptionRow({ match, applied, onUse }: { match: FoodMatch; applied: boolean; onUse: () => void }) {
  const { t, i18n } = useTranslation();
  const macroSummary = formatCuratedMacroSummary(match, t, i18n.language);
  return (
    // Below sm: thumbnail+text on one row, then a full-width button below —
    // the button's non-shrinking label (e.g. German "Diese Daten übernehmen")
    // otherwise starves the text column down to a sliver, truncating the
    // title and wrapping the macro line one word per line. At sm+: original
    // side-by-side layout (thumbnail + text | button).
    <div className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
          {match.imageUrl && <img src={match.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{match.title}</p>
          {shouldShowCanonicalName(match) && (
            <p className="truncate text-xs text-muted-foreground">{match.canonicalName}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <MatchNetCarbBadge netCarbsPer100g={match.netCarbsPer100g} />
            <MatchTierChip tier={matchTier(match.score)} />
          </div>
          {macroSummary && (
            <p className="text-xs text-muted-foreground">{t('scan.review.match.per100g', { summary: macroSummary })}</p>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onUse}
        disabled={applied}
        className="w-full sm:w-auto sm:shrink-0"
      >
        {applied && <Check className="h-4 w-4" />}
        {applied ? t('scan.review.match.applied') : t('scan.review.match.useThisData')}
      </Button>
    </div>
  );
}

/**
 * The value Conform reports for a form field, exactly as its own metadata
 * types it — a form string, a `defaultValue` echo, or nothing at all. Named
 * here so the two readers below can state that they parse it.
 */
type ConformFieldValue = FieldMetadata['value'];

/** A Conform field value that really is a plain form string. */
const conformStringSchema = z.string();

/**
 * Parses a Conform field's current value into a number, returning null for
 * blank/missing/non-numeric input. Conform serializes every scalar field back
 * as a form string, or leaves it absent — so the value is parsed here rather
 * than asserted.
 */
function parseNumericFieldValue(value: ConformFieldValue): number | null {
  const raw = conformStringSchema.safeParse(value);
  if (!raw.success || raw.data.trim() === '') return null;
  const parsed = Number(raw.data);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reads a Conform string field value, defaulting to `''` when the field is absent. */
function readStringFieldValue(value: ConformFieldValue): string {
  return conformStringSchema.safeParse(value).data ?? '';
}

/** Muted per-portion protein/fat/kcal line; unknown (null) fields are skipped, never shown as 0. */
function formatMacroPreviewMuted(preview: MacroPreview, t: Translate, language: string): string {
  const parts: string[] = [];
  if (preview.proteinForPortion !== null) {
    parts.push(t('scan.review.preview.protein', { value: formatMacroNumberIn(language, preview.proteinForPortion) }));
  }
  if (preview.fatForPortion !== null) {
    parts.push(t('scan.review.preview.fat', { value: formatMacroNumberIn(language, preview.fatForPortion) }));
  }
  if (preview.kcalForPortion !== null) {
    parts.push(t('scan.review.preview.calories', { value: formatMacroNumberIn(language, preview.kcalForPortion) }));
  }
  return parts.join(' · ');
}

/**
 * The 7 per-100g macro fields, in the order they render in the fine-tune
 * grid. Labels match the wording already established in `add.tsx`'s
 * `MACRO_FIELD_LABELS` / `diary.entry.$id.tsx`'s `MACRO_FIELDS`: "polyols" on
 * its own reads as jargon, so it's "Sugar alcohols (polyols)"; the bare unit
 * "kcal" is spelled out as "Calories".
 */
const MACRO_FIELD_LABEL_KEYS = [
  ['carbs', 'scan.review.macroLabels.carbs'],
  ['fiber', 'scan.review.macroLabels.fiber'],
  ['sugars', 'scan.review.macroLabels.sugars'],
  ['polyols', 'scan.review.macroLabels.polyols'],
  ['protein', 'scan.review.macroLabels.protein'],
  ['fat', 'scan.review.macroLabels.fat'],
  ['kcal', 'scan.review.macroLabels.kcal'],
] as const;

/**
 * Portion-chip label keys. `PORTION_SCALE_OPTIONS`'s own `label` is English and
 * lives in `#app/lib/portion-preview`, which /add and the diary entry editor
 * also import — so the localized wording is keyed off the multiplier here
 * rather than changing that shared module. The `hint` ("½×", "1×") is notation,
 * not copy, and stays as authored.
 */
const PORTION_SCALE_LABEL_KEY = new Map<number, string>([
  [0.5, 'scan.review.portionScale.smaller'],
  [1, 'scan.review.portionScale.asShown'],
  [1.5, 'scan.review.portionScale.bigger'],
  [2, 'scan.review.portionScale.double'],
]);

export function ConfirmDraftForm({
  identification,
  provider,
  modelId,
  matches,
  lastResult,
  logDate,
  logDateLabel,
  photoFile,
  userId,
  defaultMealType,
  intakeSource,
  typedText,
}: {
  identification?: PlateIdentification;
  /** Provider of the attempt — pairs with `modelId` for the scan's cost estimate; without it there is no honest price to show. */
  provider?: AiProviderType;
  modelId?: string;
  matches?: FoodMatch[][];
  lastResult?: SubmissionResult<string[]>;
  logDate: string | null;
  logDateLabel: string | null;
  /** The in-memory downscaled JPEG, saved device-locally on a successful confirm. */
  photoFile: File | null;
  /** Owner for the device-local photo cache, offered to the confirm action with the file. */
  userId: number;
  /**
   * The slot read off the PHOTO's own timestamp (see `#app/lib/scan-capture-time`),
   * or null when there is no picked file to read one from. One value for the
   * whole plate: a scan is one sitting.
   */
  defaultMealType: MealType | null;
  /**
   * Which way in produced this draft. Posted as a hidden field and read by
   * `handleConfirm` for the diary's input-path event, which is its only reader
   * — nothing on this screen looks or behaves differently because of it.
   */
  intakeSource: IntakeSource;
  /**
   * The sentence this draft was read from, or `null` for a photograph.
   *
   * THE WORDS HAVE TO SURVIVE THE WAIT (0.20.0 walk finding 2). A photo intake
   * carries its evidence into this screen: the plate is still on the device
   * and the person remembers it. A typed one showed the sentence only on the
   * waiting screen, blurred under the busy overlay, and by the time the food
   * list arrived there was nothing left to check the estimate against. So the
   * quote comes with it, above the list, exactly as `UploadForm` drew it.
   */
  typedText: string | null;
}) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting' && navigation.formData?.get('_intent') === 'confirm';

  // Mint the batch id client-side (post-mount, so SSR and hydration agree on an
  // empty value): it's posted as a hidden field so the server keys every entry
  // in this scan to it, and reused below to key the device-local photo cache.
  const [clientLogBatchId, setClientLogBatchId] = useState<string | null>(null);
  useEffect(() => {
    setClientLogBatchId(randomUuid());
  }, []);

  // Hand the downscaled JPEG to the confirm action, keyed by the same batch id
  // the hidden field above posts. The action saves it right after it writes the
  // diary rows (see `handleConfirm`), so the photo is kept on exactly the
  // signal that kept the entries.
  //
  // This replaced a `useNavigation()` effect that armed on a `submitting`
  // render and saved on the `loading` render after it. That render never
  // happens: the confirm is local IndexedDB work that resolves inside one
  // React batch, so the component never sees a `submitting` state and no photo
  // was ever cached. A typed or spoken intake has no `photoFile`, so it offers
  // nothing and the action finds the slot empty, which is the right answer.
  useEffect(() => {
    if (photoFile === null || clientLogBatchId === null) return;
    offerPlatePhoto({ logBatchId: clientLogBatchId, userId, file: photoFile });
    return () => dropPlatePhoto(clientLogBatchId);
  }, [photoFile, clientLogBatchId, userId]);

  const usage = identification?.usage;
  const scanCostUsd = usage && modelId && provider ? estimateScanCostUsd(provider, modelId, usage) : undefined;
  // Self-explanatory cost line, kept at the very end of the scrollable content.
  const scanCostLine =
    usage && scanCostUsd !== undefined ?
      t('scan.review.costLine', {
        cost: formatScanCost(scanCostUsd),
        inputTokens: formatTokenCount(usage.inputTokens, i18n.language),
        outputTokens: formatTokenCount(usage.outputTokens, i18n.language),
      })
    : undefined;

  // Local UI state (never submitted): which foods the user excluded and which
  // curated suggestions they dismissed. Keyed by item index — the draft list is
  // fixed for the life of this view, so the index is stable.
  const [excludedIndexes, setExcludedIndexes] = useState<ReadonlySet<number>>(() => new Set<number>());
  // Seeded once, from the capture time. Plate-wide, and editable. See the prop.
  const [mealType, setMealType] = useState<string>(defaultMealType ?? '');
  const [dismissedIndexes, setDismissedIndexes] = useState<ReadonlySet<number>>(() => new Set<number>());
  const introHeadingRef = useRef<HTMLHeadingElement>(null);

  // On entering the confirm step, jump to the top and focus the intro heading so
  // keyboard/screen-reader users land where the story starts (DOM side effect).
  useEffect(() => {
    window.scrollTo(0, 0);
    introHeadingRef.current?.focus();
  }, []);

  const handleIncludeToggle = (index: number, checked: boolean) => {
    setExcludedIndexes((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleDismiss = (index: number) => {
    setDismissedIndexes((prev) => new Set(prev).add(index));
  };

  const [form, fields] = useForm({
    id: 'confirm-plate-draft',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeConfirmDraftSchema(t) });
    },
    defaultValue:
      identification ?
        {
          items: identification.foods.map((food) => ({
            include: true,
            name: food.name,
            estimatedGrams: String(food.estimatedGrams),
            confidence: food.confidence,
            curatedSource: undefined,
            // Carried from the model's own answer so they survive the confirm
            // round trip. A label item that lost these on the way to the store
            // would be filed as an ordinary AI guess with no brand.
            macroSource: food.macroSource,
            brand: food.brand,
            macros: {
              carbs: food.macrosPer100g?.carbs !== undefined ? String(food.macrosPer100g.carbs) : undefined,
              fiber: food.macrosPer100g?.fiber !== undefined ? String(food.macrosPer100g.fiber) : undefined,
              sugars: food.macrosPer100g?.sugars !== undefined ? String(food.macrosPer100g.sugars) : undefined,
              polyols: food.macrosPer100g?.polyols !== undefined ? String(food.macrosPer100g.polyols) : undefined,
              protein: food.macrosPer100g?.protein !== undefined ? String(food.macrosPer100g.protein) : undefined,
              fat: food.macrosPer100g?.fat !== undefined ? String(food.macrosPer100g.fat) : undefined,
              kcal: food.macrosPer100g?.kcal !== undefined ? String(food.macrosPer100g.kcal) : undefined,
            },
          })),
        }
      : undefined,
  });

  const itemFields = fields.items.getFieldList();

  // Derive everything the preview-first cards + the plate summary need from the
  // live Conform field values, in one pass. The portion-chip base is the AI's
  // ORIGINAL estimate (from the identification prop) — never the grams field's
  // initialValue, which `form.update` rewrites (that caused chip drift).
  const itemViews = itemFields.map((itemField, index) => {
    const itemFieldset = itemField.getFieldset();
    const macrosFieldset = itemFieldset.macros.getFieldset();
    const originalGrams = identification?.foods[index]?.estimatedGrams;
    const hasChips = originalGrams !== undefined && originalGrams > 0;
    const baseGrams = originalGrams ?? 0;
    const currentGrams = parseNumericFieldValue(itemFieldset.estimatedGrams.value) ?? baseGrams;
    const macrosPer100g: Macros = {
      carbs: parseNumericFieldValue(macrosFieldset.carbs.value),
      fiber: parseNumericFieldValue(macrosFieldset.fiber.value),
      sugars: parseNumericFieldValue(macrosFieldset.sugars.value),
      polyols: parseNumericFieldValue(macrosFieldset.polyols.value),
      protein: parseNumericFieldValue(macrosFieldset.protein.value),
      fat: parseNumericFieldValue(macrosFieldset.fat.value),
      kcal: parseNumericFieldValue(macrosFieldset.kcal.value),
    };
    const foodMatches = matches?.[index] ?? [];
    // The applied match's own facts, re-derived from the live macro fields on
    // every render (never a second stored copy that could drift): its
    // origin-aware net carbs — which STOP applying the moment the user
    // hand-edits the macros — and its licence credit, which doesn't. See
    // `resolveAppliedMatchSnapshot` for why the two rules differ.
    const appliedSnapshot = resolveAppliedMatchSnapshot({
      appliedCuratedSource: readStringFieldValue(itemFieldset.curatedSource.value),
      matches: foodMatches,
      editedMacrosPer100g: macrosPer100g,
    });
    // Passing the authoritative figure here is what stops a bls/curated match's
    // fibre-exclusive carbs from being double-subtracted by the local
    // `carbs - fiber - polyols` formula: without it this card rendered a green
    // "0 g net carbs" while the match card directly below it read "21.7g".
    //
    // No `carbBasis` argument here, deliberately (spec 13, M123): a plate item
    // is an AI ESTIMATE off a photo of food, never a transcribed printed
    // panel, and `FoodMatch` (the only other fact this item can carry) has no
    // basis field of its own — it always brings its own authoritative figure
    // above instead, so the compute-from-parts fallback below is only ever
    // reached for a plain, unmatched estimate with no basis to report. There
    // is no "EU vs US" distinction to make on a plate of food.
    const preview = computeMacroPreview({
      macrosPer100g,
      grams: currentGrams,
      authoritativeNetCarbsPer100g: appliedSnapshot.netCarbsPer100g,
    });
    return {
      itemField,
      itemFieldset,
      macrosFieldset,
      index,
      hasChips,
      baseGrams,
      currentGrams,
      preview,
      appliedSnapshot,
      // No `carbBasis` argument, for the identical reason `computeMacroPreview`
      // above gets none: a plate item never carries one (M123/13 review
      // finding). `undefined` keeps `checkMacroSanity`'s fibre-vs-carbs
      // comparisons running, which is correct here — a plate estimate has no
      // EU/US panel to misclassify.
      sanityIssues: preview ? checkMacroSanity(macrosPer100g, t, i18n.language) : [],
      selectedMultiplier: hasChips ? derivePortionMultiplier({ baseGrams, currentGrams }) : null,
      // SAFETY: `confidence` is populated only by this route's own confirm-draft
      // schema, which parses it with the `ConfidenceLevel` enum before it ever
      // reaches the form — an absent field is the `undefined` arm.
      confidence: itemFieldset.confidence.initialValue as ConfidenceLevel | undefined,
      // The model's own answer for this item, for the three things only it
      // knows: whether the numbers were read off a panel, what that panel
      // printed as a serving, and which carb convention it used. Read from the
      // identification rather than from a form field, because none of the
      // three is editable and none of them should be.
      identifiedFood: identification?.foods[index],
      isFromLabel: identification?.foods[index]?.macroSource === 'label',
      // Only offered when the panel stated a WEIGHT. A serving printed as
      // "2 pieces" with no grams is a sentence, not a portion, and a chip that
      // logged nothing would be worse than no chip.
      printedServing: readPrintedServingChip(identification?.foods[index]),
      displayName:
        readStringFieldValue(itemFieldset.name.value) || readStringFieldValue(itemFieldset.name.initialValue),
      appliedCuratedSource: itemFieldset.curatedSource.value,
      foodMatches,
      portionHint: identification?.foods[index]?.portionHint,
    };
  });

  const summary = summarizeIncludedPortions(
    itemViews.map((view) => ({
      included: !excludedIndexes.has(view.index),
      netCarbsForPortion: view.preview?.netCarbsForPortion ?? null,
    })),
  );

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-4 pb-40 md:pb-28">
      <input type="hidden" name="_intent" value="confirm" />
      {/* Which way in this draft arrived by. Outside every collapsible for the
          same reason the date is: it must submit whatever the person expands. */}
      <input type="hidden" name="intakeSource" value={intakeSource} />
      {/* Kept outside every collapsible so the back-dated day always submits. */}
      {logDate && <input type="hidden" name="date" value={logDate} />}
      {/* Client-minted batch id, so the device photo cache and the server agree. */}
      {clientLogBatchId && <input type="hidden" name="clientLogBatchId" value={clientLogBatchId} />}
      {logDate && logDateLabel && <LoggingToBanner label={logDateLabel} switchToTodayHref="/scan" />}
      <div className="space-y-1">
        <h2 ref={introHeadingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
          {t('scan.review.heading')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('scan.review.subheading')}</p>
      </div>
      {/* WHAT THE ESTIMATE WAS READ FROM, for a typed or spoken meal. Quiet,
          above the food list, and labelled with the same words the waiting
          screen used, so the person checks the list against their own sentence
          rather than against a memory of it. Nothing is rendered for a
          photograph: `typedText` is null there, and the plate itself was the
          evidence. */}
      {typedText !== null && (
        <figure className="space-y-1">
          <figcaption className="text-xs text-muted-foreground">{t('scan.textIntake.label')}</figcaption>
          <blockquote className="rounded-lg border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap">
            {typedText}
          </blockquote>
        </figure>
      )}
      {/* Plate-wide, and above the food cards: the person sees which slot the
          photo landed in before they scroll, and changes it in one tap. */}
      <MealSelectField
        id={fields.mealType.id}
        name={fields.mealType.name}
        label={t('add.portion.meal')}
        value={mealType}
        onChange={setMealType}
        errorId={fields.mealType.errorId}
        errors={fields.mealType.errors}
      />
      {form.errors && form.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{form.errors.join(', ')}</AlertDescription>
        </Alert>
      )}

      {itemViews.map((view) => {
        const { itemFieldset, macrosFieldset, preview, foodMatches, index } = view;
        const included = !excludedIndexes.has(index);
        const dismissed = dismissedIndexes.has(index);
        const carbStatus = preview ? getCarbStatus(preview.netCarbsPer100g) : null;
        const mutedPreview = preview ? formatMacroPreviewMuted(preview, t, i18n.language) : '';

        const applyMatch = (match: FoodMatch) => {
          form.update({ name: itemFieldset.macros.name, value: matchMacrosToFormValues(match.macrosPer100g) });
          form.update({ name: itemFieldset.curatedSource.name, value: toCuratedSource(match.slug) });
        };
        const isApplied = (match: FoodMatch): boolean => view.appliedCuratedSource === toCuratedSource(match.slug);

        const topMatch = foodMatches[0];
        const hasConfidentTop = foodMatches.length > 0 && isConfidentTier(matchTier(topMatch.score));
        const primaryMatch = !dismissed && hasConfidentTop ? topMatch : undefined;
        // Alternates: the runners-up when the top is confident, otherwise every
        // (weak) match — all hidden behind the "See other matches" disclosure.
        let alternateMatches: FoodMatch[] = [];
        if (!dismissed) alternateMatches = primaryMatch ? foodMatches.slice(1) : foodMatches;

        return (
          <Card key={index} className={cn('transition-opacity', !included && 'opacity-60')}>
            <CardContent className="space-y-3 p-4">
              {/* Whole header row toggles inclusion — the label enlarges the hit area. */}
              <label className="-m-1 flex cursor-pointer items-start justify-between gap-3 rounded-md p-1 transition-colors hover:bg-muted/50">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{view.displayName || t('scan.review.unnamedFood')}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* WHERE THIS ITEM'S NUMBERS CAME FROM. A transcribed panel
                        and an estimate off a photograph of food are not the
                        same kind of number, and after the merge they sit in
                        the same list, so the one that can be checked against
                        the package in the person's hand says so. Text, not a
                        colour: a tint alone would carry the whole meaning. */}
                    {view.isFromLabel && (
                      <span className="inline-flex w-fit items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('scan.review.fromLabel')}
                      </span>
                    )}
                    {view.confidence === 'low' && (
                      <span className="inline-flex w-fit items-center rounded-full bg-accent-amber-surface px-2 py-0.5 text-xs font-medium text-accent-amber">
                        {t('scan.review.doubleCheck')}
                      </span>
                    )}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={itemFieldset.include.name}
                    checked={included}
                    onChange={(event) => handleIncludeToggle(index, event.currentTarget.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  {t('scan.review.include')}
                </span>
              </label>

              {/* Always-rendered hidden fields — kept outside the collapsible so they always submit. */}
              <input {...getInputProps(itemFieldset.confidence, { type: 'text' })} hidden readOnly />
              <input {...getInputProps(itemFieldset.curatedSource, { type: 'hidden' })} />
              {/* What kind of number this is, and whose product it is. Both are
                  the model's answer rather than the person's, so both are
                  hidden fields rather than inputs, and both are outside the
                  collapsible so they always submit. */}
              <input {...getInputProps(itemFieldset.macroSource, { type: 'hidden' })} />
              <input {...getInputProps(itemFieldset.brand, { type: 'hidden' })} />
              {/* The applied match's two snapshotted facts. DERIVED every render
                  from `curatedSource` + the live macro fields (never `form.update`d
                  like `curatedSource` is), so a later macro edit can withdraw the
                  net-carbs figure — a stored copy couldn't. Rendered
                  unconditionally, unlike the add flow's equivalent: there the
                  candidate always holds a locally-ESTIMATED figure that must not
                  be submitted, so the input itself is the gate; here the value is
                  already `undefined` unless it is genuinely upstream-authoritative,
                  and an empty value decodes straight back to "none". */}
              <input
                type="hidden"
                name={itemFieldset.netCarbsPer100g.name}
                value={encodeAuthoritativeNetCarbs(view.appliedSnapshot.netCarbsPer100g)}
              />
              <input
                type="hidden"
                name={itemFieldset.micronutrientsPer100g.name}
                value={encodeMicronutrients(view.appliedSnapshot.micronutrientsPer100g)}
              />
              <input
                type="hidden"
                name={itemFieldset.attribution.name}
                value={view.appliedSnapshot.attribution ?? ''}
              />
              {/* Same "derived every render from `curatedSource`, never withdrawn by an
                  edit" treatment as `attribution` above, not `netCarbsPer100g`'s
                  clear-on-edit treatment — see `resolveAppliedMatchSnapshot`'s doc. */}
              {/* THE ITEM'S OWN PANEL CONVENTION WINS. `appliedSnapshot` only
                  ever holds a curated match's basis, and a transcribed panel
                  has one of its own that no match can improve on: an EU
                  crispbread whose fibre legitimately exceeds its carbohydrate
                  reads as a false sanity warning, and worse as a wrong net
                  carb, without it. */}
              <input
                type="hidden"
                name={itemFieldset.carbBasis.name}
                value={view.identifiedFood?.carbBasis ?? view.appliedSnapshot.carbBasis ?? ''}
              />

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {view.portionHint ?
                    t('scan.review.portionWithHint', {
                      hint: view.portionHint,
                      grams: formatMacroNumberIn(i18n.language, view.currentGrams),
                    })
                  : t('scan.review.portionGrams', { grams: formatMacroNumberIn(i18n.language, view.currentGrams) })}
                </p>
                {(view.hasChips || view.printedServing !== null) && (
                  <div className="flex flex-wrap gap-2">
                    {/* THE PANEL'S OWN SERVING, first. It is the only portion on
                        this screen that is a printed fact rather than an
                        estimate, so it leads, and it is offered rather than
                        forced: somebody eating half a bar should not have to
                        undo a default. Rendered only when the panel actually
                        stated a weight; "2 pieces" with no grams is text we
                        cannot log against.
                        The serving reaches the person HERE and goes no
                        further. Nothing persists it, because
                        `LocalPersonalFood` has no field for one and adding one
                        would be a local-store version bump for a value that
                        has already done its work by the time they confirm. */}
                    {view.printedServing !== null && (
                      <button
                        key="printed-serving"
                        type="button"
                        aria-pressed={view.currentGrams === view.printedServing.grams}
                        onClick={() =>
                          form.update({
                            name: itemFieldset.estimatedGrams.name,
                            value: String(view.printedServing?.grams ?? view.currentGrams),
                          })
                        }
                        className={cn(
                          'inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                          view.currentGrams === view.printedServing.grams ?
                            'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
                        )}
                      >
                        {view.printedServing.asPrinted}
                      </button>
                    )}
                    {view.hasChips &&
                      PORTION_SCALE_OPTIONS.map((option) => {
                        const isSelected = view.selectedMultiplier === option.multiplier;
                        const labelKey = PORTION_SCALE_LABEL_KEY.get(option.multiplier);
                        return (
                          <button
                            key={option.multiplier}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() =>
                              form.update({
                                name: itemFieldset.estimatedGrams.name,
                                value: String(scalePortionGrams(view.baseGrams, option.multiplier)),
                              })
                            }
                            className={cn(
                              'inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                              isSelected ?
                                'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
                            )}
                          >
                            {labelKey ? t(labelKey) : option.label} ({option.hint})
                          </button>
                        );
                      })}
                  </div>
                )}

                {/* The free grams field, in the open. The chips stop at 2x of
                    the estimate, so somebody who ate 300 g of a food read off
                    a 100 g panel has to be able to say so without opening
                    anything. This is the ONLY grams input on the card: a
                    second one under the same name would post the field
                    twice. */}
                <div className="grid gap-1">
                  <Label htmlFor={itemFieldset.estimatedGrams.id}>{t('scan.review.gramsLabel')}</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label={t('entry.edit.decreaseGrams')}
                      onClick={() =>
                        form.update({
                          name: itemFieldset.estimatedGrams.name,
                          value: String(stepPortionGrams(view.currentGrams, -SCAN_GRAMS_STEP)),
                        })
                      }
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      {...getInputProps(itemFieldset.estimatedGrams, { type: 'number', step: '0.1' })}
                      inputMode="decimal"
                      className="h-11 w-28 text-center tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">g</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label={t('entry.edit.increaseGrams')}
                      onClick={() =>
                        form.update({
                          name: itemFieldset.estimatedGrams.name,
                          value: String(stepPortionGrams(view.currentGrams, SCAN_GRAMS_STEP)),
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <FieldError id={itemFieldset.estimatedGrams.errorId} errors={itemFieldset.estimatedGrams.errors} />
                </div>
              </div>

              {preview && carbStatus ?
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      carbStatusBadgeClass[carbStatus],
                    )}
                  >
                    {t('scan.review.netCarbsForPortion', {
                      value: formatMacroNumberIn(i18n.language, preview.netCarbsForPortion),
                    })}
                  </span>
                  {mutedPreview && <span className="text-xs text-muted-foreground">{mutedPreview}</span>}
                </div>
              : <p className="text-xs text-muted-foreground">{t('scan.review.macrosUnknown')}</p>}

              {preview && view.sanityIssues.length > 0 && (
                <div className="space-y-1 rounded-md border border-accent-amber-border bg-accent-amber-surface p-2 text-xs text-accent-amber">
                  {view.sanityIssues.map((issue) => (
                    <p key={issue.code}>{issue.message}</p>
                  ))}
                </div>
              )}

              {!dismissed && (primaryMatch || alternateMatches.length > 0) && (
                <div className="space-y-2">
                  {primaryMatch && (
                    <CuratedMatchCard
                      match={primaryMatch}
                      tier={matchTier(primaryMatch.score)}
                      applied={isApplied(primaryMatch)}
                      onUse={() => applyMatch(primaryMatch)}
                      onDismiss={() => handleDismiss(index)}
                    />
                  )}
                  {alternateMatches.length > 0 && (
                    <Collapsible>
                      <div className="flex items-center justify-between gap-2">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="group flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                            {t('scan.review.seeOtherMatches')}
                          </button>
                        </CollapsibleTrigger>
                        {!primaryMatch && (
                          <button
                            type="button"
                            onClick={() => handleDismiss(index)}
                            aria-label={t('scan.review.match.dismiss')}
                            className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <CollapsibleContent className="space-y-2 pt-2">
                        {alternateMatches.map((match) => (
                          <MatchOptionRow
                            key={match.slug}
                            match={match}
                            applied={isApplied(match)}
                            onUse={() => applyMatch(match)}
                          />
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              )}

              {/* Fine-tune: forceMount keeps the inputs in the DOM (so they always submit) while collapsed. */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
                    {t('scan.review.fineTune')}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent forceMount className="space-y-3 pt-1 data-[state=closed]:hidden">
                  {/* Grams is NOT here: it is the visible stepper above, and
                      one name can only be posted once. */}
                  <div className="grid gap-1">
                    <Label htmlFor={itemFieldset.name.id}>{t('scan.review.foodLabel')}</Label>
                    <Input {...getInputProps(itemFieldset.name, { type: 'text' })} />
                    <FieldError id={itemFieldset.name.errorId} errors={itemFieldset.name.errors} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {MACRO_FIELD_LABEL_KEYS.map(([macroKey, labelKey]) => (
                      <div key={macroKey} className="grid gap-1">
                        <Label htmlFor={macrosFieldset[macroKey].id}>{t(labelKey)}</Label>
                        <Input {...getInputProps(macrosFieldset[macroKey], { type: 'number', step: '0.1' })} />
                        <FieldError id={macrosFieldset[macroKey].errorId} errors={macrosFieldset[macroKey].errors} />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('scan.review.macrosPer100gNote')}</p>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        );
      })}

      {scanCostLine && <p className="text-xs text-muted-foreground">{scanCostLine}</p>}

      {/* Sticky mobile action bar. Sits above the app's bottom tab bar (h-14) on
          mobile and pins to the very bottom on desktop. The extra 1.75rem of
          mobile bottom padding is the clearance for `BottomNav`'s raised Scan
          button (M129/04), which overhangs the tab bar's top edge by ~24px and
          paints above this bar — the padding guarantees it only ever covers
          empty space, never the "Confirm & log" button. */}
      <div className="fixed inset-x-0 bottom-14 z-40 border-t bg-background/95 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] backdrop-blur md:bottom-0 md:pb-2">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-3 sm:px-6">
          <p className="text-sm font-medium">
            {summary.count > 0 ?
              t('scan.review.addingSummary', {
                count: summary.count,
                netCarbs: formatMacroNumberIn(i18n.language, summary.netCarbs),
              })
            : t('scan.review.noneSelected')}
          </p>
          <SubmitButton pending={isSaving} pendingLabel={t('scan.review.saving')} className="w-full">
            {t('scan.review.confirmAndLog')}
          </SubmitButton>
        </div>
      </div>
    </Form>
  );
}

export default function ScanPlate({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  // Scanning is inherently online (it calls the user's AI provider). Offline, an
  // honest note replaces any hope of a scan; recents-based logging via /add
  // still works. `OfflineBanner` renders nothing while online.
  const offlineNote = <OfflineBanner message={t('scan.offline')} className="mb-4" />;

  // THE ONE READ OF THE RULE on this screen (M192): the instance's own AI when
  // this is a managed instance and the account has an allowance, the device's
  // BYOK row on an open one, `null` when there is neither.
  const effective = useEffectiveAiSettings(loaderData.settings);
  const managedAi = effective?.source === 'managed' ? effective : null;

  // Keyless-friendly: a person with no AI at all gets a warm connect card
  // instead of the old hard redirect to /settings/ai.
  if (effective === null) {
    return (
      <>
        {offlineNote}
        <ConnectCard logDate={loaderData.logDate} />
      </>
    );
  }
  // The identify result now rides a fetcher inside `ScanFlow`; only confirm-step
  // re-validation failures come back through navigation `actionData`.
  const confirmResult = actionData?.intent === 'confirm' ? actionData.submission : undefined;
  return (
    <>
      {offlineNote}
      <ScanFlow
        managedAi={managedAi}
        monthlyUsage={loaderData.monthlyUsage}
        confirmResult={confirmResult}
        logDate={loaderData.logDate}
        logDateLabel={loaderData.logDateLabel}
        userId={loaderData.userId}
        timezone={loaderData.timezone}
      />
    </>
  );
}
