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
import type { AiProviderType } from '#types/enums';
import { formatMonthlyUsageLine } from '#app/models/ai-usage';
import type { MonthlyAiUsage } from '#app/models/ai-usage';
import { createVisionProvider, VisionProviderError, VisionProviderFailure } from '#app/services/vision';
import type {
  ConfidenceLevel,
  LabelReading,
  PlateIdentification,
  ScanTokenUsage,
  VisionFailureCause,
  VisionMode,
} from '#app/services/vision';
import { LABEL_SCAN_TASK, PLATE_SCAN_TASK, SCAN_TASK_BY_MODE, VISION_MODES } from '#app/services/vision';
import type { PlateImageInput, VisionProvider } from '#app/services/vision';
import {
  buildLabelConfirmView,
  buildLabelFoodName,
  buildLabelScanEntry,
  buildLabelScanFood,
  collectLabelSanityIssues,
  defaultLabelLogGrams,
  toLabelMacroFieldValues,
} from '#app/lib/label-scan-confirm';
import type { LabelConfirmView } from '#app/lib/label-scan-confirm';
import { parseCarbBasis } from '#app/lib/net-carbs';
import type { CarbBasis } from '#app/lib/net-carbs';
import { CarbBasisField, CARB_BASIS_NOT_SURE_VALUE } from '#app/components/carb-basis-field';
import { estimateScanCostUsd, formatScanCost, formatTokenCount } from '#app/services/vision/cost';
import type { FoodMatch } from '#app/services/food-resolution';
import {
  matchMacrosToFormValues,
  resolveAppliedMatchSnapshot,
  toCuratedSource,
} from '#app/services/food-resolution/apply-match';
import { fetchFoodMatches } from '#app/lib/food-matches-client';
import { randomUuid } from '#app/lib/uuid';
import { useInstanceInferencePreset } from '#app/hooks/use-public-config';
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
  computeMacroPreview,
  derivePortionMultiplier,
  scalePortionGrams,
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
import {
  analyzeReducer,
  initialAnalyzeState,
  LIBRARY_GRACE_MS,
  type AnalyzePhase,
  type PickSource,
} from '#app/lib/scan-analyze';
import { showFoodAddedToast } from '#app/lib/food-added-toast';
import { readDayCarbTotals } from '#app/lib/day-carb-totals';
import { getCarbStatus, carbStatusBadgeClass } from '#app/utils/carb-status';
import { cn } from '#app/lib/utils';
import i18nSingleton from '#app/i18n/i18n';
import type { Translate } from '#app/lib/macro-sanity';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { OfflineBanner } from '#app/components/offline-banner';
import { LoggingToBanner } from '#app/components/logging-to-banner';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '#app/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { AlertTriangle, Camera, Check, ChevronDown, Loader2, ShieldAlert, X } from 'lucide-react';
import { isAuditDisclosureRequired } from '#app/lib/gateway-invite';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { trackScanFailed, trackScanFoundNothing, trackScanSucceeded } from '#app/lib/matomo-events';

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
    macros: makeConfirmMacrosSchema(t),
  });
}

/** One parsed plate item — the schema is built per parse, so infer off the factory. */
type ConfirmItem = z.infer<ReturnType<typeof makeConfirmItemSchema>>;

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
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        t('scan.review.errors.invalidBatchId'),
      )
      .optional(),
  );
}

/** Builds the confirm-draft schema against the caller's translator. */
export function makeConfirmDraftSchema(t: Translate) {
  return z.object({
    date: makeLogDateField(t),
    clientLogBatchId: makeClientLogBatchIdField(t),
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

/**
 * The label confirm's draft: ONE product, not a plate of items.
 *
 * `carbs` is required (via the shared macro schema) because a personal food
 * can't be stored without it; every other macro is optional and a BLANK one
 * stays blank all the way to the store — `undefined`, never `0`. That is the
 * whole trust posture of this feature in one line: a panel that printed no
 * polyols row must not produce a food claiming zero sugar alcohols.
 */
export function makeLabelConfirmSchema(t: Translate) {
  return z.object({
    date: makeLogDateField(t),
    name: z.string().min(1, t('scan.review.errors.nameRequired')),
    brand: z.string().optional(),
    quantityGrams: z.coerce.number().positive(t('scan.review.errors.gramsPositive')),
    macros: makeConfirmMacrosSchema(t),
    // The three-state control's "not sure" chip submits '' — an unrecognised
    // value here, exactly like a blank/absent field, so it can't fail this
    // schema. `parseCarbBasis` (applied when building the stored rows, not
    // here) is what turns it into the persisted absent state.
    carbBasis: z.string().optional(),
  });
}

/** Exported for direct schema-behavior testing — every real parse site builds its own with a live `t`. */
export const LabelConfirmSchema = makeLabelConfirmSchema(translate);

type IdentifyResult =
  | {
      intent: 'identify';
      mode: 'plate';
      identification: PlateIdentification;
      /** Provider + model of the attempt, together — pricing resolves on the PAIR (`estimateScanCostUsd`), never on the id alone. */
      provider: AiProviderType;
      modelId: string;
      matches: FoodMatch[][];
    }
  | {
      intent: 'identify';
      mode: 'label';
      /** The panel as read. Always a READABLE one — an unreadable answer is terminal and comes back on the failure arm below. */
      reading: LabelReading;
      provider: AiProviderType;
      modelId: string;
    }
  | {
      intent: 'identify';
      /** Which scan the user asked for — the failure copy differs ("no foods on that plate" is not "couldn't read that panel"). */
      mode: VisionMode;
      error: string;
      usage?: ScanTokenUsage;
      modelId?: string;
      /** Set only for a typed `VisionProviderFailure` — drives cause-specific alert copy (see `UploadForm`). */
      failureCause?: VisionFailureCause;
      /** The configured provider at the time of this attempt — lets `UploadForm` phrase a `rate-limit` failure with OpenRouter-specific "free tier resets daily" copy without `failure-cause.ts` (the provider-neutral adapter layer) knowing about any one provider. */
      provider?: AiProviderType;
    };

type ConfirmResult = { intent: 'confirm'; submission: SubmissionResult<string[]> };

/** The label confirm's own re-validation result — a separate intent, so a failed plate confirm can never render the label form (or the reverse). */
type LabelConfirmResult = { intent: 'confirm-label'; submission: SubmissionResult<string[]> };

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
  return { userId: ANONYMOUS_USER_ID, settings, monthlyUsage, logDate, logDateLabel };
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
 * The scan the user picked, parsed off the submitted form rather than
 * asserted. `.catch('plate')` makes a missing or tampered value fall back to
 * the original scan — the cheaper one — instead of throwing.
 */
const scanModeSchema = z.enum(VISION_MODES).catch('plate');

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

/** What both task runners below need to attribute and price an attempt. */
interface ScanAttemptContext {
  visionProvider: VisionProvider;
  image: PlateImageInput;
  providerType: AiProviderType;
  modelId: string;
  recordAttempt: RecordScanAttempt;
}

/** Photo of a plate → the foods worth logging, enriched with curated matches. */
async function runPlateScan(context: ScanAttemptContext): Promise<IdentifyResult> {
  const { visionProvider, image, providerType, modelId, recordAttempt } = context;
  const identification = await visionProvider.runScan({ task: PLATE_SCAN_TASK, image });
  const usage = identification.usage;
  if (identification.foods.length === 0) {
    // The model billed tokens but found nothing — attribute that cost here
    // (this is the previously-lost case) rather than discarding the usage.
    await recordAttempt({ usage, outcome: 'no_foods' });
    return {
      intent: 'identify',
      mode: 'plate',
      error: translate(NO_FOODS_ERROR_KEY),
      usage,
      modelId,
      provider: providerType,
    };
  }
  await recordAttempt({ usage, outcome: 'identified' });
  // Enrich with curated LowCarbCheck matches (names only, fail-open — never
  // blocks the draft). `matches` is parallel to `identification.foods` by index.
  const { matches } = await fetchFoodMatches(identification.foods.map((food) => food.name));
  return { intent: 'identify', mode: 'plate', identification, provider: providerType, modelId, matches };
}

/**
 * Photo of a package nutrition panel → the manufacturer's printed figures.
 *
 * Two answers are terminal and never reach the confirm step, both routed
 * through the SAME failure arm the plate path uses (with label copy, not a new
 * `VisionFailureCause`):
 *  - the model declared the panel unreadable — checked first and
 *    unconditionally by `buildLabelConfirmView`, so a response carrying
 *    `unreadable: true` AND stray macros can never put a number on a form;
 *  - the panel was legible but held no macro column this app can use, which is
 *    "that isn't a nutrition panel", not a plate with no food on it.
 *
 * No curated-match lookup: the whole point of reading a package is that its
 * own printed figures beat any generic database record of the product.
 */
async function runLabelScan(context: ScanAttemptContext): Promise<IdentifyResult> {
  const { visionProvider, image, providerType, modelId, recordAttempt } = context;
  const reading = await visionProvider.runScan({ task: LABEL_SCAN_TASK, image });
  const usage = reading.usage;
  const view = buildLabelConfirmView(reading);
  const failed = (error: string): IdentifyResult => ({
    intent: 'identify',
    mode: 'label',
    error,
    usage,
    modelId,
    provider: providerType,
  });

  if (view.kind === 'unreadable') {
    await recordAttempt({ usage, outcome: 'no_foods' });
    return failed(
      view.reason ?
        translate('scan.errors.label.unreadableWithReason', { reason: view.reason })
      : translate('scan.errors.label.unreadable'),
    );
  }
  if (view.basis === null) {
    await recordAttempt({ usage, outcome: 'no_foods' });
    return failed(translate('scan.errors.label.noMacros'));
  }

  await recordAttempt({ usage, outcome: 'identified' });
  return { intent: 'identify', mode: 'label', reading, provider: providerType, modelId };
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
async function handleClientIdentify(formData: FormData): Promise<IdentifyResult> {
  const mode = scanModeSchema.parse(formData.get('mode'));
  const photo = formData.get('photo');
  if (!(photo instanceof File)) {
    return { intent: 'identify', mode, error: translate('scan.errors.photo.empty') };
  }
  const validation = validatePhoto({ type: photo.type, size: photo.size }, translate);
  if (!validation.valid) {
    return { intent: 'identify', mode, error: validation.error };
  }

  const settings = await getLocalAiSettings();
  if (!settings) {
    return {
      intent: 'identify',
      mode,
      error: translate('scan.errors.connectProvider'),
    };
  }

  // A row saved before the base-URL requirement shipped (M117/02 review fix)
  // could still have `baseUrl: null` for openai-compatible. Catch it here
  // with a friendly, actionable message rather than letting
  // `createVisionProvider`'s own guard throw synchronously below.
  if (settings.provider === 'openai-compatible' && (!settings.baseUrl || settings.baseUrl.trim() === '')) {
    return {
      intent: 'identify',
      mode,
      error: translate('scan.errors.missingBaseUrl'),
    };
  }


  // Records exactly one local usage row per outcome. `recordLocalAiUsageEvent`
  // is fail-open, so this never affects whether the scan itself succeeds.
  const recordAttempt = (params: { usage: ScanTokenUsage | undefined; outcome: 'identified' | 'no_foods' | 'error' }) => {
    // Analytics rides the usage row's own choke point: every scan outcome
    // already passes through here exactly once, so reporting here cannot
    // drift out of step with reality the way N separate call sites would.
    // No counts, no model id, nothing from the photo — see `matomo-events.ts`.
    reportScanOutcome(params.outcome);
    return recordLocalAiUsageEvent({
      provider: settings.provider,
      model: settings.model,
      inputTokens: params.usage?.inputTokens ?? null,
      outputTokens: params.usage?.outputTokens ?? null,
      estimatedCostUsd:
        params.usage ? (estimateScanCostUsd(settings.provider, settings.model, params.usage) ?? null) : null,
      outcome: params.outcome,
    });
  };

  let base64: string;
  try {
    base64 = await fileToBase64(photo);
  } catch {
    return { intent: 'identify', mode, error: translate('scan.errors.readPhoto') };
  }

  try {
    const visionProvider = createVisionProvider({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
    });
    const context: ScanAttemptContext = {
      visionProvider,
      image: { base64, mimeType: photo.type },
      providerType: settings.provider,
      modelId: settings.model,
      recordAttempt,
    };
    // The ONE branch the two scans need, and it is over the RESULT SHAPE: a
    // plate returns items to portion and match, a panel returns one product's
    // printed figures. Everything the two tasks DIFFER by as data — prompt,
    // schema, parse, capture resolution — is on the descriptor and never
    // branched on here (see `ScanTaskDescriptor`).
    return mode === 'label' ? await runLabelScan(context) : await runPlateScan(context);
  } catch (error) {
    const usage = error instanceof VisionProviderError ? error.usage : undefined;
    const failureCause = error instanceof VisionProviderFailure ? error.failureCause : undefined;
    // A `VisionProviderError`'s own message is authored in the provider-neutral
    // vision adapter layer (`app/services/vision/failure-cause.ts`), which this
    // route can't translate from here — see `describeFailureBody`, which
    // substitutes localized copy for every typed cause it recognizes.
    const fallbackMessage =
      error instanceof VisionProviderError ? error.message : translate('scan.errors.identifyFailed');
    const message = refineIdentifyErrorMessage({ provider: settings.provider, error, fallback: fallbackMessage });
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
      mode,
      error: message,
      usage,
      modelId: settings.model,
      failureCause,
      provider: settings.provider,
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
  id,
  foodId,
  loggedAtMs,
  dayKey,
  createdAtMs,
  logBatchId,
}: {
  item: ConfirmItem;
  per100g: Macros;
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
    mealType: null,
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
    brand: null,
    macrosPer100g: per100g,
    source: 'plate_ai',
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
  for (const item of includedItems) {
    const per100g: Macros = {
      carbs: item.macros.carbs,
      fiber: item.macros.fiber ?? null,
      sugars: item.macros.sugars ?? null,
      polyols: item.macros.polyols ?? null,
      protein: item.macros.protein ?? null,
      fat: item.macros.fat ?? null,
      kcal: item.macros.kcal ?? null,
    };

    const foodId = randomUuid();
    await putLocalFood(buildConfirmedFood({ item, per100g, id: foodId, createdAtMs: now }));

    await putLocalFoodLog(
      buildConfirmedEntry({
        item,
        per100g,
        id: randomUuid(),
        foodId,
        loggedAtMs,
        dayKey,
        createdAtMs: now,
        logBatchId,
      }),
    );
  }

  // One toast for the whole plate, through the app's shared add-toast id — a
  // four-item confirm is ONE action, not four (M129/03). The running total is
  // read after every entry is written, so it reports the day the user is about
  // to land on rather than a mid-write figure.
  const redirectTo = activeDate ? `/diary?date=${activeDate}` : '/diary';
  const totals = await readDayCarbTotals(dayKey);
  showFoodAddedToast({
    name: includedItems[0]?.name ?? translate('scan.review.plateFallbackName'),
    t: translate,
    count: includedItems.length,
    mealLabel: null,
    netCarbsTotal: totals.netCarbs,
    hasEstimates: totals.hasEstimates,
    dayLabel: activeDate === null ? null : formatDayLabel(activeDate, currentLanguage()),
    language: currentLanguage(),
  });
  return redirect(redirectTo);
}

/**
 * Persists a confirmed label reading: the reusable CUSTOM FOOD first, then the
 * diary entry that references it.
 *
 * The food is the point. Reading a package costs one paid vision call; this row
 * means the next purchase of the same product is a one-tap re-log from /add's
 * "Your foods" and never a second call. It carries every macro the panel
 * printed — `polyols` included, which no generic food source in this app can
 * supply.
 *
 * The two builders are pure and live in `#app/lib/label-scan-confirm`, so the
 * "confirmed panel → stored rows" path is unit-testable without a store, a
 * clock or a form — the same split `buildConfirmedEntry`/`buildConfirmedFood`
 * already use for the plate path.
 */
async function handleConfirmLabel(formData: FormData, timezone: string): Promise<LabelConfirmResult | Response> {
  const submission = parseWithZod(formData, { schema: makeLabelConfirmSchema(translate) });
  if (submission.status !== 'success') {
    return { intent: 'confirm-label', submission: submission.reply() };
  }
  const data = submission.value;
  // A blank macro field stays null, never 0 — see `makeLabelConfirmSchema`.
  const macrosPer100g: Macros = {
    carbs: data.macros.carbs,
    fiber: data.macros.fiber ?? null,
    sugars: data.macros.sugars ?? null,
    polyols: data.macros.polyols ?? null,
    protein: data.macros.protein ?? null,
    fat: data.macros.fat ?? null,
    kcal: data.macros.kcal ?? null,
  };

  const activeDate = data.date !== undefined && data.date !== todayInTimezone(timezone) ? data.date : null;
  const loggedAtMs = (activeDate ? instantOnDate(activeDate, timezone) : new Date()).getTime();
  const dayKey = todayInTimezone(timezone, new Date(loggedAtMs));
  const now = Date.now();

  const carbBasis = parseCarbBasis(data.carbBasis);

  const foodId = randomUuid();
  await putLocalFood(
    buildLabelScanFood({
      name: data.name,
      brand: data.brand ?? null,
      // `carbs` is required by the schema above, which is exactly the
      // personal-food invariant — narrowed here rather than asserted.
      macrosPer100g: { ...macrosPer100g, carbs: data.macros.carbs },
      carbBasis,
      id: foodId,
      createdAtMs: now,
    }),
  );
  await putLocalFoodLog(
    buildLabelScanEntry({
      name: data.name,
      quantityGrams: data.quantityGrams,
      macrosPer100g,
      carbBasis,
      foodId,
      id: randomUuid(),
      loggedAtMs,
      dayKey,
      createdAtMs: now,
    }),
  );

  const redirectTo = activeDate ? `/diary?date=${activeDate}` : '/diary';
  const totals = await readDayCarbTotals(dayKey);
  showFoodAddedToast({
    name: data.name,
    t: translate,
    count: 1,
    mealLabel: null,
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
}: Route.ClientActionArgs): Promise<IdentifyResult | ConfirmResult | LabelConfirmResult | Response> {
  const formData = await request.formData();
  const intent = formData.get('_intent');

  if (intent === 'confirm') {
    const profile = await getLocalProfileGoals();
    return handleConfirm(formData, resolveLocalTimezone(profile));
  }

  if (intent === 'confirm-label') {
    const profile = await getLocalProfileGoals();
    return handleConfirmLabel(formData, resolveLocalTimezone(profile));
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

/** Elapsed-time-staged status copy for the in-flight identify call (DESIGN.md §7). */
function getIdentifyStageMessage(elapsedSeconds: number, t: Translate): string {
  if (elapsedSeconds >= STAGE_STILL_WORKING_SECONDS) return t('scan.analyzing.stillWorking');
  if (elapsedSeconds >= STAGE_ANALYZING_SECONDS) return t('scan.analyzing.analyzing');
  return t('scan.analyzing.uploading');
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
  monthlyUsage,
  confirmResult,
  labelConfirmResult,
  logDate,
  logDateLabel,
  userId,
}: {
  monthlyUsage: MonthlyAiUsage;
  confirmResult?: SubmissionResult<string[]>;
  /** Re-validation result of a failed LABEL confirm — keeps that form mounted with its errors. */
  labelConfirmResult?: SubmissionResult<string[]>;
  logDate: string | null;
  logDateLabel: string | null;
  /** Owner for the device-local photo cache (see `ConfirmDraftForm`). */
  userId: number;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const [state, dispatch] = useReducer(analyzeReducer, initialAnalyzeState);
  // WHICH SCAN, chosen BEFORE the photo is taken. Choosing afterwards would
  // mean discovering the wrong prompt ran only once the paid call had already
  // been made — and the two captures aren't interchangeable anyway: a label is
  // downscaled to a higher ceiling (`captureMaxDimension` on the task).
  const [mode, setMode] = useState<VisionMode>('plate');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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

  const activeData = fetcher.data === suppressedData ? undefined : fetcher.data;

  // Sync the object-URL preview to the file that will actually be uploaded.
  // Creating the URL in the effect keeps it revoked on both replacement and
  // unmount and survives StrictMode remounts — this in-tab preview URL itself
  // is never written anywhere (the confirmed photo, separately, IS cached to
  // this device on save — see `ConfirmDraftForm`'s `savePlatePhoto` call).
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
    if (!file) return;
    if (lastSubmittedDispatchId.current === state.dispatchId) return;
    lastSubmittedDispatchId.current = state.dispatchId;
    const formData = new FormData();
    formData.append('_intent', 'identify');
    formData.append('mode', mode);
    formData.append('photo', file);
    void fetcher.submit(formData, { method: 'post', encType: 'multipart/form-data' });
  }, [state.phase, state.dispatchId, file, fetcher, mode]);

  // Settle the machine on the fetcher's active→idle edge (not merely "idle", which
  // is also the pre-submit state) so an in-flight dispatch is never cut short.
  useEffect(() => {
    const wasActive = prevFetcherState.current !== 'idle';
    prevFetcherState.current = fetcher.state;
    if (wasActive && fetcher.state === 'idle') {
      dispatch({ type: 'settled' });
    }
  }, [fetcher.state]);

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

  const processSelectedFile = async (picked: File, source: PickSource): Promise<void> => {
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
      // The capture ceiling is a property of the SCAN TASK, read off the
      // selected descriptor — not an `if (mode === 'label')` here. A panel's
      // 6-point "of which polyols" row needs the detail; a plate does not, and
      // would pay for it on every scan (see `ScanTaskDescriptor.captureMaxDimension`).
      nextFile = await downscaleToJpeg(picked, { maxDimension: SCAN_TASK_BY_MODE[mode].captureMaxDimension });
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
    setFile(nextFile);
    dispatch({ type: 'pick', source });
  };

  // Keep the ref pointing at the current pipeline entry (no dep array — runs
  // every render) so the mount effect below always calls the freshest closure.
  useEffect(() => {
    processSharedRef.current = (sharedFile: File) => void processSelectedFile(sharedFile, 'library');
  });

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
        if (sharedFile) processSharedRef.current(sharedFile);
      } catch {
        // A missing/unreadable shared photo just leaves the normal picker in place.
      }
    })();
  }, []);

  const handlePick = (source: PickSource, picked: File | null) => {
    if (!picked) return;
    void processSelectedFile(picked, source);
  };

  const handleRetry = () => {
    setSuppressedData(fetcher.data);
    dispatch({ type: 'retry' });
  };

  /**
   * Switching scans discards any photo already prepared: it was downscaled to
   * the OTHER task's ceiling, so sending it would quietly hand a label scan a
   * plate-resolution image — the exact detail loss the higher ceiling exists to
   * prevent. Nothing has been spent at this point; only a prepared file is lost.
   */
  const handleModeChange = (nextMode: VisionMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setSuppressedData(fetcher.data);
    setSelectionError(null);
    setFile(null);
    dispatch({ type: 'reset' });
  };

  const identifyResult =
    activeData !== undefined && activeData.intent === 'identify' && 'identification' in activeData ?
      activeData
    : undefined;
  const labelResult =
    activeData !== undefined && activeData.intent === 'identify' && 'reading' in activeData ? activeData : undefined;
  const failedIdentify =
    activeData !== undefined && activeData.intent === 'identify' && 'error' in activeData ? activeData : undefined;

  // A read panel (or a failed label confirm) swaps to the label form. Checked
  // before the plate branch: the two results are separate arms of the same
  // fetcher, and a label reading has no `foods[]` for the plate draft to render.
  if (labelResult || labelConfirmResult) {
    return (
      <LabelConfirmForm
        reading={labelResult?.reading}
        provider={labelResult?.provider}
        modelId={labelResult?.modelId}
        lastResult={labelConfirmResult}
        logDate={logDate}
        logDateLabel={logDateLabel}
      />
    );
  }

  // A returned identification (or a confirm-step re-validation) swaps to the
  // draft. Passing both keeps the plate's portion chips + curated matches alive
  // across a failed confirm — the identification rides the still-mounted fetcher.
  if (identifyResult || confirmResult) {
    return (
      <ConfirmDraftForm
        identification={identifyResult?.identification}
        provider={identifyResult?.provider}
        modelId={identifyResult?.modelId}
        matches={identifyResult?.matches}
        lastResult={confirmResult}
        logDate={logDate}
        logDateLabel={logDateLabel}
        photoFile={file}
        userId={userId}
      />
    );
  }

  return (
    <UploadForm
      phase={state.phase}
      mode={mode}
      onModeChange={handleModeChange}
      file={file}
      previewUrl={previewUrl}
      isProcessing={isProcessing}
      selectionError={selectionError}
      elapsedSeconds={elapsedSeconds}
      error={failedIdentify?.error}
      failureCause={failedIdentify?.failureCause}
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
  // The remaining causes deliberately keep the adapter's own English (see above).
  'invalid-request': undefined,
  transient: undefined,
  'genuinely-no-food': undefined,
} satisfies Record<VisionFailureCause, string | undefined>;

/** The alert body for a given failure — see `FAILURE_BODY_KEY_BY_CAUSE`. */
export function describeFailureBody(
  params: {
    failureCause?: VisionFailureCause;
    provider?: AiProviderType;
    error?: string;
  },
  t: Translate,
): string | undefined {
  if (params.failureCause === 'rate-limit' && params.provider === 'openrouter') return t(OPENROUTER_RATE_LIMIT_KEY);
  const bodyKey = params.failureCause ? FAILURE_BODY_KEY_BY_CAUSE[params.failureCause] : undefined;
  if (bodyKey) return t(bodyKey);
  return params.error;
}

/**
 * Presentational upload surface: preview, the two pickers, the grace/analysis
 * overlays, and the failure copy. Stateless beyond the two hidden file inputs it
 * owns — all decisions flow down as props from `ScanFlow`.
 */
/**
 * The "what am I photographing?" control — the entry point to label mode.
 *
 * Deliberately BEFORE the pickers and always visible: the mode has to be chosen
 * before the shutter, because choosing afterwards would mean paying for a call
 * that ran the wrong prompt. Two plain buttons rather than a select, so the
 * choice is readable at a glance on a phone; `aria-pressed` carries the state
 * to assistive tech.
 */
function ScanModeChoice({
  mode,
  onModeChange,
  disabled,
}: {
  mode: VisionMode;
  onModeChange: (mode: VisionMode) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const options: ReadonlyArray<{ value: VisionMode; labelKey: string }> = [
    { value: 'plate', labelKey: 'scan.labelScan.mode.plate' },
    { value: 'label', labelKey: 'scan.labelScan.mode.label' },
  ];
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{t('scan.labelScan.mode.legend')}</legend>
      <div className="flex gap-2">
        {options.map((option) => {
          const isSelected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onModeChange(option.value)}
              className={cn(
                'inline-flex min-h-11 flex-1 items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60',
                isSelected ?
                  'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-teal-300 hover:text-foreground dark:hover:border-teal-600',
              )}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'label' ? t('scan.labelScan.mode.labelHint') : t('scan.labelScan.mode.plateHint')}
      </p>
    </fieldset>
  );
}

function UploadForm({
  phase,
  mode,
  onModeChange,
  file,
  previewUrl,
  isProcessing,
  selectionError,
  elapsedSeconds,
  error,
  failureCause,
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
  /** Which scan is armed. Branches COPY and UI only — every task-specific datum comes off the descriptor. */
  mode: VisionMode;
  onModeChange: (mode: VisionMode) => void;
  file: File | null;
  previewUrl: string | null;
  isProcessing: boolean;
  selectionError: string | null;
  elapsedSeconds: number;
  error?: string;
  /** Machine-readable reason `error` happened — picks the alert's headline (see `getFailureAlertTitle`). */
  failureCause?: VisionFailureCause;
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
  const isLabelMode = mode === 'label';
  // COPY ONLY. Every task-specific behaviour (prompt, schema, parse, capture
  // resolution) is on the scan-task descriptor; what changes here is what the
  // sentences say, because "no foods on that plate" is not "couldn't read that
  // panel" and a user told the wrong one retries the wrong thing.
  const captureTitle = isLabelMode ? t('scan.labelScan.capture.title') : t('scan.capture.title');
  const captureDescription = isLabelMode ? t('scan.labelScan.capture.description') : t('scan.capture.description');
  const emptyTitle = isLabelMode ? t('scan.labelScan.capture.emptyTitle') : t('scan.capture.emptyTitle');
  const emptyHint = isLabelMode ? t('scan.labelScan.capture.emptyHint') : t('scan.capture.emptyHint');
  const photoLabel = isLabelMode ? t('scan.labelScan.capture.photoLabel') : t('scan.capture.photoLabel');
  const previewAlt = isLabelMode ? t('scan.labelScan.capture.previewAlt') : t('scan.capture.previewAlt');
  const alertTitle =
    isLabelMode && isPhotoQualityFailure ? t('scan.errors.label.title') : getFailureAlertTitle(failureCause, t);
  const photoQualityBody = isLabelMode ? t('scan.errors.label.photoQualityBody') : t('scan.errors.photoQualityBody');
  // Only relevant for a photo-quality failure: whether there's extra detail
  // worth showing below the friendly headline (the plain NO_FOODS_ERROR case
  // has nothing more specific to add). A non-photo-quality failure shows
  // `error` as its main body instead — see the Alert render below.
  const showSpecificError = error !== undefined && error !== t(NO_FOODS_ERROR_KEY);

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
  // After a cancel or a failed attempt we rest at idle-with-photo and offer a
  // manual, deliberately-quiet analyze — this app never nudges the user to spend.
  const canAnalyze = phase === 'idle' && file !== null && !isProcessing;

  return (
    <div className="space-y-4">
      {logDate && logDateLabel && <LoggingToBanner label={logDateLabel} switchToTodayHref="/scan" />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> {captureTitle}
          </CardTitle>
          <CardDescription>{captureDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* The mode is chosen BEFORE the shutter — see `ScanModeChoice`. Locked
                while a photo is being prepared or a paid call is in flight. */}
            <ScanModeChoice mode={mode} onModeChange={onModeChange} disabled={pickDisabled} />

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

              {file && previewUrl && (
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
                      <p className="text-sm font-medium">{getIdentifyStageMessage(elapsedSeconds, t)}</p>
                    </div>
                  )}
                </div>
              )}

              {!file && (
                <div className="flex aspect-video max-h-72 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center sm:max-h-80">
                  <Camera className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{emptyTitle}</p>
                  <p className="text-xs text-muted-foreground">{emptyHint}</p>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={pickDisabled}
                  className="h-11 w-full sm:flex-1"
                >
                  <Camera className="h-4 w-4" /> {t('scan.capture.takePhoto')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => libraryInputRef.current?.click()}
                  disabled={pickDisabled}
                  className="h-11 w-full sm:flex-1"
                >
                  {t('scan.capture.chooseLibrary')}
                </Button>
              </div>

              {isProcessing && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('scan.capture.preparing')}
                </p>
              )}

              {file && !isProcessing && (
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {file.name} · {formatFileSize(file.size)}
                </p>
              )}

              <FieldError errors={selectionError ? [selectionError] : undefined} />
            </div>

            {error && (
              <Alert>
                <Camera className="h-4 w-4" />
                <AlertTitle>{alertTitle}</AlertTitle>
                <AlertDescription>
                  {isPhotoQualityFailure ?
                    <>
                      {photoQualityBody}
                      {showSpecificError && (
                        <span className="mt-1 block text-xs text-muted-foreground">{error}</span>
                      )}
                    </>
                    // A non-photo-quality failure's `error` message is already
                    // the specific, actionable detail (see `failure-cause.ts`)
                    // — showing it as the main body, not a muted afterthought.
                    // `describeFailureBody` additionally swaps in OpenRouter-
                    // specific free-tier copy for a `rate-limit` failure.
                  : describeFailureBody({ failureCause, provider, error }, t)}
                </AlertDescription>
              </Alert>
            )}

            {error && failedAttemptCreditLine && (
              <p className="text-xs text-muted-foreground">{failedAttemptCreditLine}</p>
            )}

            {canAnalyze && (
              <Button type="button" variant="secondary" onClick={onRetry} className="h-11 w-full">
                {t('scan.capture.analyze')}
              </Button>
            )}

            {/* Search is always one tap from scan — keyless-friendly, carries the day. */}
            <div className="pt-1 text-center">
              <Link
                to={addHref}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t('scan.capture.addWithoutPhoto')}
              </Link>
            </div>
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
 */
function ConnectCard({ logDate }: { logDate: string | null }) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const addHref = logDate ? `/add?date=${logDate}` : '/add';
  const sharedPhotoPreviewUrl = useKeylessSharedPhotoPreview();
  // `null` unless this instance's operator wired up its own inference endpoint
  // (M138 spec 06) — in which case the body copy below has to stop saying
  // openplate doesn't run its own AI, because on this instance it does.
  const instancePreset = useInstanceInferencePreset();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" /> {t('scan.setup.title')}
        </CardTitle>
        <CardDescription>{t('scan.setup.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {instancePreset === null ? t('scan.setup.body') : t('scan.setup.bodyPreset')}
        </p>
        {/* One tap, no key to go and get — renders nothing at all when this
            instance provides no AI of its own. Above the BYOK buttons because
            on such an instance it is the whole answer; `revalidate` re-runs
            `clientLoader`, which re-reads the device settings and swaps this
            card for the real scan flow. */}
        <InstancePresetConnect onConnected={() => void revalidator.revalidate()} />
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
              never a hardcoded provider check here. */}
          {supportsOauthPkce('openrouter') && (
            <OAuthConnectButton className="h-11 w-full sm:flex-1">
              {t('scan.setup.connectOpenRouter')}
            </OAuthConnectButton>
          )}
          <Button asChild variant="outline" className="h-11 w-full sm:flex-1">
            <Link to={addHref}>{t('scan.capture.addWithoutPhoto')}</Link>
          </Button>
        </div>
        <div className="text-center">
          {/* `?next=scan` returns the user here once their key is connected. */}
          <Link
            to="/settings/ai?next=scan"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('scan.setup.manualSetup')}
          </Link>
        </div>
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
            <p className="text-xs text-muted-foreground">
              {t('scan.review.match.per100g', { summary: macroSummary })}
            </p>
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
          {match.imageUrl && (
            <img src={match.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
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
            <p className="text-xs text-muted-foreground">
              {t('scan.review.match.per100g', { summary: macroSummary })}
            </p>
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

/**
 * The confirm step for a LABEL scan: one product, its serving, and the seven
 * macro fields — every one of them editable, and presented as read-but-unverified.
 *
 * Three rules this form exists to hold:
 *  - A macro the panel didn't print renders BLANK, never `0`
 *    (`toLabelMacroFieldValues`). A zero here would be a claim, and for
 *    `polyols` specifically it is the claim that makes a maltitol-sweetened
 *    product look zero-carb.
 *  - The numbers are OCR off a curved, glossy package, so they are offered for
 *    correction rather than announced as fact — and the shared macro-sanity
 *    notes run on the live values, including the two-column cross-check that
 *    catches a misread digit (`collectLabelSanityIssues`).
 *  - Confirming saves a reusable custom food, which is why this is worth doing
 *    once per product instead of once per purchase.
 */
export function LabelConfirmForm({
  reading,
  provider,
  modelId,
  lastResult,
  logDate,
  logDateLabel,
}: {
  reading?: LabelReading;
  /** Provider of the attempt — pairs with `modelId` for the scan's cost estimate. */
  provider?: AiProviderType;
  modelId?: string;
  lastResult?: SubmissionResult<string[]>;
  logDate: string | null;
  logDateLabel: string | null;
}) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting' && navigation.formData?.get('_intent') === 'confirm-label';
  const introHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    introHeadingRef.current?.focus();
  }, []);

  const view: LabelConfirmView | undefined = reading ? buildLabelConfirmView(reading) : undefined;
  // UNREADABLE IS TERMINAL. `runLabelScan` already routes such a reading to the
  // failure alert, so this branch is unreachable in the normal flow — it is
  // here so that no future caller can reach the macro fields through a reading
  // the model disowned. Checked before anything reads a macro.
  const panel = view?.kind === 'reading' ? view : undefined;

  const [form, fields] = useForm({
    id: 'confirm-label-draft',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLabelConfirmSchema(t) });
    },
    defaultValue:
      panel ?
        {
          name: buildLabelFoodName(panel),
          brand: panel.brand ?? undefined,
          quantityGrams: String(defaultLabelLogGrams(panel)),
          macros: toLabelMacroFieldValues(panel.macrosPer100g),
        }
      : undefined,
  });
  const macrosFieldset = fields.macros.getFieldset();
  // Pre-filled from the model's own report (spec 13, M123) — `null` (the
  // panel's layout didn't decide it, or the model wasn't asked before this
  // spec) starts the control on "not sure" rather than guessing a basis.
  const [carbBasisValue, setCarbBasisValue] = useState<CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE>(
    panel?.carbBasis ?? CARB_BASIS_NOT_SURE_VALUE,
  );

  // Re-read from the live fields every render so the notes describe what the
  // person is about to log, not what the model first returned.
  const editedMacrosPer100g: Macros = {
    carbs: parseNumericFieldValue(macrosFieldset.carbs.value),
    fiber: parseNumericFieldValue(macrosFieldset.fiber.value),
    sugars: parseNumericFieldValue(macrosFieldset.sugars.value),
    polyols: parseNumericFieldValue(macrosFieldset.polyols.value),
    protein: parseNumericFieldValue(macrosFieldset.protein.value),
    fat: parseNumericFieldValue(macrosFieldset.fat.value),
    kcal: parseNumericFieldValue(macrosFieldset.kcal.value),
  };
  // The LIVE selector value, not `panel.carbBasis` (the model's original
  // report): a person who corrects "not sure" to "EU available" — or the
  // reverse — must see the sanity notes recompute against their own answer,
  // not keep flagging the model's first guess (M123/13 review finding).
  const liveCarbBasis = carbBasisValue === CARB_BASIS_NOT_SURE_VALUE ? undefined : carbBasisValue;
  const sanityIssues =
    panel ?
      collectLabelSanityIssues(
        { ...panel, macrosPer100g: editedMacrosPer100g, carbBasis: liveCarbBasis ?? null },
        t,
        i18n.language,
      )
    : [];

  const usage = reading?.usage;
  const scanCostUsd = usage && modelId && provider ? estimateScanCostUsd(provider, modelId, usage) : undefined;
  const scanCostLine =
    usage && scanCostUsd !== undefined ?
      t('scan.review.costLine', {
        cost: formatScanCost(scanCostUsd),
        inputTokens: formatTokenCount(usage.inputTokens, i18n.language),
        outputTokens: formatTokenCount(usage.outputTokens, i18n.language),
      })
    : undefined;

  return (
    <Form method="post" {...getFormProps(form)} className="space-y-4 pb-8">
      <input type="hidden" name="_intent" value="confirm-label" />
      {logDate && <input type="hidden" name="date" value={logDate} />}
      {logDate && logDateLabel && <LoggingToBanner label={logDateLabel} switchToTodayHref="/scan" />}

      <div className="space-y-1">
        <h2 ref={introHeadingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
          {t('scan.labelScan.review.heading')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('scan.labelScan.review.subheading')}</p>
      </div>

      {form.errors && form.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{form.errors.join(', ')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="rounded-md border border-accent-amber-border bg-accent-amber-surface p-2 text-xs text-accent-amber">
            {t('scan.labelScan.review.unverified')}
          </p>

          {panel?.servingAsPrinted && (
            <p className="text-sm text-muted-foreground">
              {t('scan.labelScan.review.servingPrinted', { serving: panel.servingAsPrinted })}
            </p>
          )}
          {panel?.basis === 'per100g' && (
            <p className="text-xs text-muted-foreground">{t('scan.labelScan.review.basisPer100g')}</p>
          )}
          {panel?.basis === 'perServing' && panel.servingGrams !== null && (
            <p className="text-xs text-muted-foreground">
              {t('scan.labelScan.review.basisPerServing', {
                grams: formatMacroNumberIn(i18n.language, panel.servingGrams),
              })}
            </p>
          )}
          {panel?.notes && (
            <p className="text-xs text-muted-foreground">
              {t('scan.labelScan.review.modelNote', { note: panel.notes })}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor={fields.name.id}>{t('scan.labelScan.review.nameLabel')}</Label>
              <Input {...getInputProps(fields.name, { type: 'text' })} />
              <FieldError id={fields.name.errorId} errors={fields.name.errors} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={fields.brand.id}>{t('scan.labelScan.review.brandLabel')}</Label>
              <Input {...getInputProps(fields.brand, { type: 'text' })} />
              <FieldError id={fields.brand.errorId} errors={fields.brand.errors} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={fields.quantityGrams.id}>{t('scan.labelScan.review.gramsLabel')}</Label>
              <Input {...getInputProps(fields.quantityGrams, { type: 'number', step: '0.1' })} />
              <FieldError id={fields.quantityGrams.errorId} errors={fields.quantityGrams.errors} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACRO_FIELD_LABEL_KEYS.map(([macroKey, labelKey]) => (
              <div key={macroKey} className="grid gap-1">
                <Label htmlFor={macrosFieldset[macroKey].id}>{t(labelKey)}</Label>
                <Input {...getInputProps(macrosFieldset[macroKey], { type: 'number', step: '0.1' })} />
                <FieldError id={macrosFieldset[macroKey].errorId} errors={macrosFieldset[macroKey].errors} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('scan.labelScan.review.macrosPer100gNote')}</p>

          <CarbBasisField
            name="carbBasis"
            legend={t('scan.labelScan.review.carbBasis.legend')}
            hint={t('scan.labelScan.review.carbBasis.hint')}
            selected={carbBasisValue}
            onSelect={setCarbBasisValue}
            totalLabel={t('scan.labelScan.review.carbBasis.total')}
            availableLabel={t('scan.labelScan.review.carbBasis.available')}
            notSureLabel={t('scan.labelScan.review.carbBasis.notSure')}
          />

          {sanityIssues.length > 0 && (
            <div className="space-y-1 rounded-md border border-accent-amber-border bg-accent-amber-surface p-2 text-xs text-accent-amber">
              {sanityIssues.map((issue) => (
                <p key={issue.code}>{issue.message}</p>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('scan.labelScan.review.savedAsCustomFood')}</p>
        </CardContent>
      </Card>

      {scanCostLine && <p className="text-xs text-muted-foreground">{scanCostLine}</p>}

      <SubmitButton pending={isSaving} pendingLabel={t('scan.review.saving')} className="w-full">
        {t('scan.review.confirmAndLog')}
      </SubmitButton>
    </Form>
  );
}

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
  /** Owner for the device-local photo cache — scopes the saved row to this account. */
  userId: number;
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

  // Save the downscaled JPEG on the one confirm-success signal, tracked in two
  // phases so it never depends on `formData` surviving into the redirect's load:
  //   1. remember a confirm POST while it's submitting (formData is present);
  //   2. on the load that follows, a SUCCESS redirects off /scan (to the diary),
  //      while a validation failure reloads /scan in place.
  // Once-only and fire-and-forget — a photo-save failure must never touch
  // logging; cancelled/failed scans never reach this branch, so they store nothing.
  const photoSavedRef = useRef(false);
  const confirmSubmittingRef = useRef(false);
  useEffect(() => {
    if (navigation.state === 'submitting') {
      if (navigation.formData?.get('_intent') === 'confirm') confirmSubmittingRef.current = true;
      return;
    }
    if (navigation.state === 'loading' && confirmSubmittingRef.current) {
      confirmSubmittingRef.current = false;
      const succeeded = navigation.location !== undefined && !navigation.location.pathname.startsWith('/scan');
      if (succeeded && !photoSavedRef.current && photoFile !== null && clientLogBatchId !== null) {
        photoSavedRef.current = true;
        void savePlatePhoto({ userId, logBatchId: clientLogBatchId, file: photoFile });
      }
      return;
    }
    // Idle with a stale flag (no load phase happened): clear it so a later,
    // unrelated navigation can't be mistaken for a confirm success.
    if (navigation.state === 'idle') confirmSubmittingRef.current = false;
  }, [navigation.state, navigation.formData, navigation.location, photoFile, clientLogBatchId, userId]);

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
                  {view.confidence === 'low' && (
                    <span className="inline-flex w-fit items-center rounded-full bg-accent-amber-surface px-2 py-0.5 text-xs font-medium text-accent-amber">
                      {t('scan.review.doubleCheck')}
                    </span>
                  )}
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
              <input
                type="hidden"
                name={itemFieldset.carbBasis.name}
                value={view.appliedSnapshot.carbBasis ?? ''}
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
                {view.hasChips && (
                  <div className="flex flex-wrap gap-2">
                    {PORTION_SCALE_OPTIONS.map((option) => {
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
              </div>

              {preview && carbStatus ?
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      carbStatusBadgeClass[carbStatus],
                    )}
                  >
                    {t('scan.review.netCarbsForPortion', { value: formatMacroNumberIn(i18n.language, preview.netCarbsForPortion) })}
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
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label htmlFor={itemFieldset.name.id}>{t('scan.review.foodLabel')}</Label>
                      <Input {...getInputProps(itemFieldset.name, { type: 'text' })} />
                      <FieldError id={itemFieldset.name.errorId} errors={itemFieldset.name.errors} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={itemFieldset.estimatedGrams.id}>{t('scan.review.gramsLabel')}</Label>
                      <Input {...getInputProps(itemFieldset.estimatedGrams, { type: 'number', step: '0.1' })} />
                      <FieldError
                        id={itemFieldset.estimatedGrams.errorId}
                        errors={itemFieldset.estimatedGrams.errors}
                      />
                    </div>
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

/**
 * Standing "somebody else can read this" line on the capture screen.
 *
 * Deliberately HERE and not only in settings: the moment of risk is the moment
 * a photo is about to be sent, and a disclosure read once during onboarding
 * weeks ago is not consent at the point of submission. Subtle by design — one
 * muted line, no colour alarm — because it describes the normal, agreed
 * arrangement of a gateway, not an error.
 *
 * Renders for the connected row's `auditEnabled` only, which today is set
 * exclusively by a gateway join (`app/lib/gateway-invite.ts`).
 */
function AuditReviewNotice() {
  const { t } = useTranslation();
  return (
    <p className="mb-4 flex items-start gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t('scan.auditNotice')}
    </p>
  );
}

export default function ScanPlate({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  // Scanning is inherently online (it calls the user's AI provider). Offline, an
  // honest note replaces any hope of a scan; recents-based logging via /add
  // still works. `OfflineBanner` renders nothing while online.
  const offlineNote = <OfflineBanner message={t('scan.offline')} className="mb-4" />;

  // Keyless-friendly: a user without an AI provider gets a warm connect card
  // instead of the old hard redirect to /settings/ai.
  if (!loaderData.settings) {
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
  const labelConfirmResult = actionData?.intent === 'confirm-label' ? actionData.submission : undefined;
  return (
    <>
      {offlineNote}
      {isAuditDisclosureRequired(loaderData.settings) && <AuditReviewNotice />}
      <ScanFlow
        monthlyUsage={loaderData.monthlyUsage}
        confirmResult={confirmResult}
        labelConfirmResult={labelConfirmResult}
        logDate={loaderData.logDate}
        logDateLabel={loaderData.logDateLabel}
        userId={loaderData.userId}
      />
    </>
  );
}
