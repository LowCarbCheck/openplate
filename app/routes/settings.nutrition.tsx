/**
 * settings.nutrition.tsx: the eating style and the four targets (M215 spec 03).
 *
 * This page and `/settings/profile` were one 1200-line route at the old goals
 * address, which asked for a body fact (how tall are you) and an
 * eating target (how many carbs a day) on the same screen under one title.
 * They are different questions, asked at different times, so they are two
 * pages now. That old address still resolves, as a redirect to this one.
 *
 * What lives HERE: the style card, which decides which of the numbers below
 * survive at all, and then the four targets, carb ceiling, protein floor,
 * calories and target weight. What lives on `/settings/profile`: height, sex,
 * birth year and the weigh-in log. What lives on `/settings/life-phase`:
 * pregnancy and breastfeeding.
 *
 * The suggestion contract is unchanged by the move: a chip is a TAP, never an
 * auto-fill, and the line under it names which method produced the number.
 *
 * Local-first like every other tracker surface: no server loader, no server
 * action, nothing on this page ever leaves the device.
 */
import type { Route } from './+types/settings.nutrition';
import { useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { trackGoalsSaved } from '#app/lib/matomo-events';
import { selectGoalRings, storedTrackingFocusFor } from '#app/lib/goal-rings';
import { cn } from '#app/lib/utils';
import { toGoalInputValue } from '#app/lib/goal-input-value';
import {
  formatKgForDisplay,
  parseDisplayWeightToKg,
  toWeightSubmitValue,
  type WeightUnit,
} from '#app/lib/weight-units';
import {
  getLocalBodyMetrics,
  getLocalProfileGoals,
  listLocalWeightEntries,
  patchLocalProfileGoals,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import {
  computeReferenceProteinFloor,
  hasAnyBodyMetric,
  selectLatestWeighInKg,
  suggestDailyKcal,
  suggestProteinFloor,
} from '#app/models/body-metrics';
import type { ProteinFloorSuggestion } from '#app/models/body-metrics';
import type { ReproductiveStatus } from '#app/lib/local-store/schema';
import { CARB_PRESETS as ONBOARDING_CARB_PRESETS, type CarbPreset } from '#app/lib/onboarding';
import { effectiveEatingStyle, reconcileEatingStyle, styleCaution, type EatingStyleId } from '#app/lib/eating-style';
import { makeEatingStyleSchema, planEatingStyleSave, CARB_SUB_PRESETS, styleNeedsWeight } from '#app/lib/eating-style-form';
import { eatingStyleCardKey, goalsCardKey } from '#app/lib/goals-form-key';
import { EatingStyleCautionNote, EatingStylePicker } from '#app/components/eating-style-picker';
import type { Translate } from '#app/lib/body-metrics-schema';
import { resolveGestation, resolveLactationMonths } from '#app/lib/reproductive-stage';
import { readStoredWeightUnit } from '#app/lib/weight-unit-preference';
import { settingsChipClass } from '#app/components/settings/chip-class';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import i18nSingleton from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.nutrition') },
];

export const handle = {
  title: 'Eating and targets',
  titleKey: 'nutrition.title',
  backTo: '/settings',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** Form intents multiplexed onto the single route action. The targets are the default (no intent). */
const INTENT = {
  /** The eating style card (M210 spec 05), one pick and the numbers it owns. */
  SAVE_EATING_STYLE: 'save-eating-style',
} as const;

/**
 * One-tap net-carb ceiling presets rendered as chips above the field.
 *
 * The SAME table onboarding offers, minus its "decide later" entry: this page
 * already has an empty field for that. It used to be a second, parallel table
 * with its own `goals.carbs.presets.*` keys, and the two screens drifted: the
 * wizard said "Keto, unter 20 g" and this page said "Keto (<20g)" for the very
 * same choice. One source of presets, one source of wording.
 */
const CARB_PRESETS = ONBOARDING_CARB_PRESETS.filter(
  (preset): preset is CarbPreset & { ceiling: number } => preset.ceiling !== null,
);

//////////////////////////////////////////////////////////////////////////////
// Schemas
//////////////////////////////////////////////////////////////////////////////

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx`, only the server render uses a clone).
 */
const actionT: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

/**
 * A goal field that is optional and clearable: blank input becomes `null` (clear
 * the goal) rather than `0`, and any supplied value must be a positive number.
 * The `.nullable()` short-circuits before `coerce` so a cleared field never
 * fabricates a `0` target.
 */
function _clearableGoalField(t: Translate): z.ZodType<number | null> {
  return z.preprocess(
    (value) => {
      const raw = z.string().safeParse(value);
      return raw.success && raw.data.trim() === '' ? null : value;
    },
    z.coerce.number().positive(t('goals.errors.positiveOrBlank')).nullable(),
  );
}

function makeGoalsSchema(t: Translate) {
  return z.object({
    goalNetCarbsCeilingG: _clearableGoalField(t),
    goalProteinFloorG: _clearableGoalField(t),
    goalKcalTarget: _clearableGoalField(t),
    targetWeightKg: _clearableGoalField(t),
  });
}

//////////////////////////////////////////////////////////////////////////////
// Server loader: none needed (M117/04, accounts optional and health data is
// local-only, so there is no auth invariant left to enforce or echo here)
//////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

//////////////////////////////////////////////////////////////////////////////
// Client loader
//////////////////////////////////////////////////////////////////////////////

export async function clientLoader() {
  const profile = await getLocalProfileGoals();

  const goals = {
    netCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
    proteinFloorG: profile?.goalProteinFloorG ?? null,
    kcalTarget: profile?.goalKcalTarget ?? null,
    targetWeightKg: profile?.targetWeightKg ?? null,
  };

  // The latest weigh-in, read but never LISTED here: the log itself lives on
  // `/settings/profile` now. Both suggestions below need the figure.
  const entries = await listLocalWeightEntries();
  const currentWeightKg = selectLatestWeighInKg(entries);

  const bodyMetrics = await getLocalBodyMetrics();
  // A SUGGESTION, computed here so the component stays clock-free: `null`
  // whenever any input is missing, which is the normal state for anyone who
  // has not filled in the body metrics card on `/settings/profile`. Never
  // auto-applied, it renders as a chip to tap, exactly like the protein
  // recommendation above it.
  const suggestedKcalTarget = suggestDailyKcal({
    weightKg: currentWeightKg,
    heightCm: bodyMetrics.heightCm,
    biologicalSex: bodyMetrics.biologicalSex,
    birthYear: bodyMetrics.birthYear,
    currentYear: new Date().getFullYear(),
  });

  // The protein figure and the NAME of the method behind it, computed here for
  // the same reason as the calorie suggestion above: the component stays pure
  // arithmetic-free. Height and sex first, the latest weigh-in as the fallback,
  // `null` when neither basis has anything to work from (M200 spec 03).
  const proteinSuggestion = suggestProteinFloor({
    heightCm: bodyMetrics.heightCm,
    biologicalSex: bodyMetrics.biologicalSex,
    latestWeighInKg: currentWeightKg,
  });

  // The style in effect: the stored pick, or the one derived from the numbers
  // for an account written before schema v20. Derived for DISPLAY only,
  // nothing here writes `eatingStyle` back, so a legacy profile stays legacy
  // until the person saves the card themselves (M210 spec 05).
  const style = effectiveEatingStyle({
    goalNetCarbsCeilingG: goals.netCarbsCeilingG,
    goalKcalTarget: goals.kcalTarget,
    goalProteinFloorG: goals.proteinFloorG,
    eatingStyle: profile?.eatingStyle ?? null,
  });

  return {
    goals,
    suggestedKcalTarget,
    proteinSuggestion,
    style,
    // The card asks for a weight rather than silently falling back, and the
    // caution note reads the stored status. Both ride the loader so the card
    // stays a pure render of what is on file.
    latestWeightKg: currentWeightKg,
    reproductiveStatus: bodyMetrics.reproductiveStatus,
  };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the targets off the device (M117/03). */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('nutrition.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store writes, no server round-trip)
//////////////////////////////////////////////////////////////////////////////

async function _saveGoals(formData: FormData) {
  const submission = parseWithZod(formData, { schema: makeGoalsSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const value = submission.value;
  // The stored focus follows the numbers on this page (M200 spec 02). Both
  // targets can be set here at once, and the rings are derived from the values,
  // but `trackingFocus` still has to say something an OLDER build can render:
  // `storedTrackingFocusFor` is the one place that reduces both goals down to
  // the single value the store has room for. Without this write, someone who
  // adds a carb ceiling here would keep a stale `calories` focus, and their
  // food list would stay ordered for a metric they no longer track.
  const trackingFocus = storedTrackingFocusFor(
    selectGoalRings({ netCarbsCeiling: value.goalNetCarbsCeilingG, kcalTarget: value.goalKcalTarget }),
  );
  // The stored style follows the numbers too. Typing a carb limit here while
  // `low-kcal` is stored used to leave the style card reading "Calories" and
  // the day graded by the kcal lens; `reconcileEatingStyle` re-derives the
  // style from the numbers about to be written, keeping `high-protein` only
  // while its floor is still set (M210).
  const current = await getLocalProfileGoals();
  const nextGoals = {
    goalNetCarbsCeilingG: value.goalNetCarbsCeilingG,
    goalProteinFloorG: value.goalProteinFloorG,
    goalKcalTarget: value.goalKcalTarget,
  };
  await patchLocalProfileGoals({
    trackingFocus,
    ...nextGoals,
    targetWeightKg: value.targetWeightKg,
    eatingStyle: reconcileEatingStyle({ storedStyle: current?.eatingStyle ?? null, goals: nextGoals }),
  });
  trackGoalsSaved('targets');
  return redirectWithLocalToast('/settings/nutrition', { type: 'success', description: actionT('goals.toast.saved') });
}

/**
 * Applies one eating style (M210 spec 05).
 *
 * The style decides which of the three goal numbers survive: `applyEatingStyle`
 * writes what it owns and NULLS what it does not, so switching away from a carb
 * style really removes the ceiling instead of leaving it live in every export,
 * sync blob and future derivation.
 *
 * The two body figures it needs are read here, not asked for on the card: the
 * weight is the latest weigh-in already on file, and the reference protein
 * intake is the same figure the day view falls back to. With no body data at
 * all the reference is `null`, so a style change never invents a protein goal
 * for someone who gave the app nothing to compute one from.
 */
async function _saveEatingStyle(formData: FormData) {
  const submission = parseWithZod(formData, { schema: makeEatingStyleSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();

  const profile = await getLocalProfileGoals();
  const entries = await listLocalWeightEntries();
  const latestWeightKg = selectLatestWeighInKg(entries);
  const metrics = await getLocalBodyMetrics();
  const today = todayInTimezone(resolveLocalTimezone(profile));
  const referenceProteinFloorG =
    hasAnyBodyMetric(metrics) || latestWeightKg !== null ?
      computeReferenceProteinFloor({
        latestWeighInKg: latestWeightKg,
        heightCm: metrics.heightCm,
        biologicalSex: metrics.biologicalSex,
        reproductiveStatus: metrics.reproductiveStatus,
        trimester: resolveGestation({ dueDate: metrics.pregnancyDueDate, today })?.trimester ?? null,
        lactationMonths: resolveLactationMonths({ startDate: metrics.lactationStartDate, today }),
      }).grams
    : null;

  const { patch } = planEatingStyleSave({
    values: submission.value,
    currentGoals: {
      goalNetCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
      goalKcalTarget: profile?.goalKcalTarget ?? null,
      goalProteinFloorG: profile?.goalProteinFloorG ?? null,
      eatingStyle: profile?.eatingStyle ?? null,
    },
    latestWeightKg,
    referenceProteinFloorG,
  });

  // `trackingFocus` follows the resulting numbers for the same reason
  // `_saveGoals` writes it: an older build renders that field, and a stale one
  // would order the food list for a metric this person no longer tracks.
  const trackingFocus = storedTrackingFocusFor(
    selectGoalRings({ netCarbsCeiling: patch.goalNetCarbsCeilingG, kcalTarget: patch.goalKcalTarget }),
  );
  await patchLocalProfileGoals({ trackingFocus, ...patch });
  trackGoalsSaved('targets');
  return redirectWithLocalToast('/settings/nutrition', {
    type: 'success',
    description: actionT('settings.style.saved'),
  });
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === INTENT.SAVE_EATING_STYLE) return _saveEatingStyle(formData);
  return _saveGoals(formData);
}

//////////////////////////////////////////////////////////////////////////////
// Component
//////////////////////////////////////////////////////////////////////////////

/**
 * The eating style card (M210 spec 05), above the numbers.
 *
 * Five styles as a radio list, the same list and the same `onboarding.style.*`
 * copy the wizard shows, so the two screens cannot drift about what a style is.
 * Only the chrome has `settings.style.*` keys of its own.
 *
 * The sub questions follow the SELECTION, not the stored profile: pick a carb
 * style and the 20/50/100 step appears, pick a calorie style and the target
 * field does. React state drives that reveal while Conform still owns the
 * values and the errors, the same division the body metrics card on
 * `/settings/profile` uses for its radio-driven fieldset.
 *
 * Saving redirects, so the goals card below re-reads the store and shows the
 * numbers this style just wrote, including the ones it removed.
 */
function EatingStyleCard({
  style,
  goals,
  latestWeightKg,
  reproductiveStatus,
}: {
  style: EatingStyleId;
  goals: Route.ComponentProps['loaderData']['goals'];
  latestWeightKg: number | null;
  reproductiveStatus: ReproductiveStatus | null;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  const [selectedStyle, setSelectedStyle] = useState<EatingStyleId>(style);
  // Seeded from the stored ceiling only when it IS one of the three presets: a
  // hand-typed 45 g has no chip to light up, and pretending otherwise would
  // submit a value the person cannot see selected.
  const [carbPresetCeiling, setCarbPresetCeiling] = useState<string>(() =>
    CARB_SUB_PRESETS.some((preset) => preset.ceiling === goals.netCarbsCeilingG) ?
      String(goals.netCarbsCeilingG)
    : '',
  );
  const [kcalTarget, setKcalTarget] = useState<string>(toGoalInputValue(goals.kcalTarget));

  const [form, fields] = useForm({
    id: 'eating-style',
    // SAFETY: as on the card below, this route's `clientAction` only ever
    // resolves to a `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeEatingStyleSchema(t) });
    },
    // A required answer supplied after the error was reported clears it as it
    // is given, rather than sitting red until the next submit.
    shouldRevalidate: 'onInput',
    defaultValue: {
      eatingStyle: style,
      carbPresetCeiling,
      kcalTarget,
    },
  });

  const caution = styleCaution(selectedStyle, reproductiveStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.style.title')}</CardTitle>
        <CardDescription>{t('settings.style.lead')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-6">
          <input type="hidden" name="_intent" value={INTENT.SAVE_EATING_STYLE} />

          <EatingStylePicker
            selectedStyle={selectedStyle}
            onSelectStyle={setSelectedStyle}
            styleFieldName={fields.eatingStyle.name}
            carbField={{
              name: fields.carbPresetCeiling.name,
              id: fields.carbPresetCeiling.id,
              errorId: fields.carbPresetCeiling.errorId,
              errors: fields.carbPresetCeiling.errors,
            }}
            carbPresetCeiling={carbPresetCeiling}
            onCarbPresetCeilingChange={setCarbPresetCeiling}
            kcalField={{
              name: fields.kcalTarget.name,
              id: fields.kcalTarget.id,
              errorId: fields.kcalTarget.errorId,
              errors: fields.kcalTarget.errors,
            }}
            kcalTarget={kcalTarget}
            onKcalTargetChange={setKcalTarget}
            needsWeight={styleNeedsWeight({ style: selectedStyle, latestWeightKg })}
          />

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSaving} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {t('settings.style.save')}
          </SubmitButton>
        </fetcher.Form>

        {/* Under the card, and only for the combinations `styleCaution` names.
            A note, never a block and never a number (M210 spec 04). */}
        {caution !== null && <EatingStyleCautionNote />}
      </CardContent>
    </Card>
  );
}

function GoalsCard({
  goals,
  proteinSuggestion,
  weightUnit,
  suggestedKcalTarget,
}: {
  goals: Route.ComponentProps['loaderData']['goals'];
  proteinSuggestion: ProteinFloorSuggestion | null;
  weightUnit: WeightUnit;
  suggestedKcalTarget: number | null;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  const carbInputRef = useRef<HTMLInputElement>(null);
  const [carbCeiling, setCarbCeiling] = useState<string>(toGoalInputValue(goals.netCarbsCeilingG));
  const [proteinFloor, setProteinFloor] = useState<string>(toGoalInputValue(goals.proteinFloorG));
  const [kcalTarget, setKcalTarget] = useState<string>(toGoalInputValue(goals.kcalTarget));

  // The same "adjust state during render" pattern the weigh-in field on
  // `/settings/profile` uses, inlined here since only one field on this card
  // needs it.
  const [syncedTarget, setSyncedTarget] = useState<{ unit: WeightUnit; targetWeightKg: number | null }>({
    unit: weightUnit,
    targetWeightKg: goals.targetWeightKg,
  });
  const [targetWeightText, setTargetWeightText] = useState<string>(() =>
    formatKgForDisplay(goals.targetWeightKg, weightUnit),
  );
  if (weightUnit !== syncedTarget.unit || goals.targetWeightKg !== syncedTarget.targetWeightKg) {
    const dataChanged = goals.targetWeightKg !== syncedTarget.targetWeightKg;
    const kgFromCurrentText =
      dataChanged ? goals.targetWeightKg : parseDisplayWeightToKg(targetWeightText, syncedTarget.unit);
    setSyncedTarget({ unit: weightUnit, targetWeightKg: goals.targetWeightKg });
    setTargetWeightText(formatKgForDisplay(kgFromCurrentText, weightUnit));
  }

  const [form, fields] = useForm({
    id: 'goals',
    // SAFETY: `fetcher.data` is this route's own `clientAction` return value,
    // and every branch of it returns `parseWithZod(...).reply()`, Conform's
    // submission result for string[] errors, or nothing at all.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeGoalsSchema(t) });
    },
    defaultValue: {
      goalNetCarbsCeilingG: toGoalInputValue(goals.netCarbsCeilingG),
      goalProteinFloorG: toGoalInputValue(goals.proteinFloorG),
      goalKcalTarget: toGoalInputValue(goals.kcalTarget),
      targetWeightKg: toGoalInputValue(goals.targetWeightKg),
    },
  });

  const trimmedCarb = carbCeiling.trim();
  const carbNumber = trimmedCarb === '' ? null : Number(trimmedCarb);
  const isCustomSelected =
    carbNumber !== null && Number.isFinite(carbNumber) && !CARB_PRESETS.some((preset) => preset.ceiling === carbNumber);
  const isSuggestedProteinSelected =
    proteinSuggestion !== null && proteinFloor.trim() !== '' && Number(proteinFloor.trim()) === proteinSuggestion.grams;
  const isSuggestedKcalSelected =
    suggestedKcalTarget !== null && kcalTarget.trim() !== '' && Number(kcalTarget.trim()) === suggestedKcalTarget;
  // Kilograms when the typed text reads as a weight, the raw text when it does
  // not, so a filled-but-unreadable field reaches `makeGoalsSchema` and comes
  // back as an inline error, instead of submitting blank and silently CLEARING
  // the target goal (see `toWeightSubmitValue`).
  const targetWeightKgForSubmit = toWeightSubmitValue(targetWeightText, weightUnit);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('goals.card.title')}</CardTitle>
        <CardDescription>{t('goals.card.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor={fields.goalNetCarbsCeilingG.id}>{t('goals.carbs.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('goals.carbs.hint')}</p>
            <div className="flex flex-wrap gap-2">
              {CARB_PRESETS.map((preset) => {
                const isSelected = carbNumber === preset.ceiling;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setCarbCeiling(String(preset.ceiling))}
                    className={settingsChipClass(isSelected)}
                  >
                    {t('onboarding.carbPreset.chipWithCeiling', { label: t(preset.labelKey), ceiling: preset.ceiling })}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={isCustomSelected}
                onClick={() => {
                  setCarbCeiling('');
                  carbInputRef.current?.focus();
                }}
                className={settingsChipClass(isCustomSelected)}
              >
                {t('goals.carbs.custom')}
              </button>
            </div>
            <Input
              ref={carbInputRef}
              id={fields.goalNetCarbsCeilingG.id}
              name={fields.goalNetCarbsCeilingG.name}
              inputMode="decimal"
              placeholder={t('goals.carbs.placeholder')}
              value={carbCeiling}
              onChange={(event) => setCarbCeiling(event.target.value)}
              aria-describedby={fields.goalNetCarbsCeilingG.errorId}
              aria-invalid={fields.goalNetCarbsCeilingG.errors?.length ? true : undefined}
              className="h-11 sm:h-9"
            />
            <FieldError id={fields.goalNetCarbsCeilingG.errorId} errors={fields.goalNetCarbsCeilingG.errors} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.goalProteinFloorG.id}>{t('goals.protein.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('goals.protein.hint')}</p>
            {/* A suggestion the person taps, never an auto-fill, and never an
                unnamed number: the line under the chip says which of the two
                methods produced it and that it is an estimate, so a target that
                changes because the basis changed is visible rather than silent
                (M200 spec 03). No chip at all when neither method can answer. */}
            {proteinSuggestion !== null ?
              <div className="space-y-2">
                <button
                  type="button"
                  aria-pressed={isSuggestedProteinSelected}
                  onClick={() => setProteinFloor(String(proteinSuggestion.grams))}
                  className={cn(settingsChipClass(isSuggestedProteinSelected), 'tabular-nums')}
                >
                  {t('goals.protein.recommended', { grams: proteinSuggestion.grams })}
                </button>
                <p className="text-xs text-muted-foreground">
                  {t('goals.protein.method', { basis: t(`goals.protein.basis.${proteinSuggestion.method}`) })}
                </p>
              </div>
            : <p className="text-xs text-muted-foreground">{t('goals.protein.suggestionUnavailable')}</p>}
            <Input
              id={fields.goalProteinFloorG.id}
              name={fields.goalProteinFloorG.name}
              inputMode="decimal"
              placeholder={t('goals.protein.placeholder')}
              value={proteinFloor}
              onChange={(event) => setProteinFloor(event.target.value)}
              aria-describedby={fields.goalProteinFloorG.errorId}
              aria-invalid={fields.goalProteinFloorG.errors?.length ? true : undefined}
              className="h-11 sm:h-9"
            />
            <FieldError id={fields.goalProteinFloorG.errorId} errors={fields.goalProteinFloorG.errors} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.goalKcalTarget.id}>{t('goals.kcal.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('goals.kcal.hint')}</p>
            {/* Suggestion, never auto-fill, the same contract the protein chip
                above already keeps. It only appears when a weight AND all three
                body metrics are on file; missing any of them means no chip at
                all, never a figure built on a guessed height. */}
            {suggestedKcalTarget !== null ?
              <button
                type="button"
                aria-pressed={isSuggestedKcalSelected}
                onClick={() => setKcalTarget(String(suggestedKcalTarget))}
                // `tabular-nums` because the chip carries a LIVE figure, it
                // moves with every weigh-in, and DESIGN.md section 4 keeps
                // changing numbers in `font-sans` with tabular digits. Same
                // treatment the fasting summary line gives its interpolated
                // number.
                className={cn(settingsChipClass(isSuggestedKcalSelected), 'tabular-nums')}
              >
                {t('goals.kcal.suggested', { kcal: suggestedKcalTarget })}
              </button>
            : <p className="text-xs text-muted-foreground">{t('goals.kcal.suggestionUnavailable')}</p>}
            <Input
              id={fields.goalKcalTarget.id}
              name={fields.goalKcalTarget.name}
              inputMode="numeric"
              placeholder={t('goals.kcal.placeholder')}
              value={kcalTarget}
              onChange={(event) => setKcalTarget(event.target.value)}
              aria-describedby={fields.goalKcalTarget.errorId}
              aria-invalid={fields.goalKcalTarget.errors?.length ? true : undefined}
              className="h-11 sm:h-9"
            />
            <p className="text-xs text-muted-foreground">{t('goals.kcal.approximateNote')}</p>
            <FieldError id={fields.goalKcalTarget.errorId} errors={fields.goalKcalTarget.errors} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.targetWeightKg.id}>{t('goals.targetWeight.label', { unit: weightUnit })}</Label>
            <p className="text-xs text-muted-foreground">{t('goals.targetWeight.hint')}</p>
            <Input
              id={fields.targetWeightKg.id}
              inputMode="decimal"
              placeholder={
                weightUnit === 'kg' ? t('goals.targetWeight.placeholderKg') : t('goals.targetWeight.placeholderLb')
              }
              value={targetWeightText}
              onChange={(event) => setTargetWeightText(event.target.value)}
              aria-describedby={fields.targetWeightKg.errorId}
              aria-invalid={fields.targetWeightKg.errors?.length ? true : undefined}
              className="h-11 sm:h-9"
            />
            <input type="hidden" name={fields.targetWeightKg.name} value={targetWeightKgForSubmit} />
            <FieldError id={fields.targetWeightKg.errorId} errors={fields.targetWeightKg.errors} />
          </div>

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSaving} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {t('goals.save')}
          </SubmitButton>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export default function SettingsNutrition({ loaderData }: Route.ComponentProps) {
  const { goals, suggestedKcalTarget, proteinSuggestion, style, latestWeightKg, reproductiveStatus } = loaderData;
  // Device-local display preference only (not synced), and READ ONLY here: the
  // toggle that writes it stands beside the weigh-in log on `/settings/profile`,
  // which is the page where a weight is entered. One storage key, one reader
  // (see `#app/lib/weight-unit-preference`), so the target weight field below
  // can never disagree with the log about what a number means.
  const [weightUnit] = useState<WeightUnit>(readStoredWeightUnit);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* First on the page: the style decides which of the numbers below are
          kept at all, so it is asked before them. KEYED off the stored style
          AND the stored goals: a save that changes the style resets the card's
          own selection to what was written, and a save on the goals card below
          re-derives the preselected style, the carb chip and the calorie
          field from the new numbers. */}
      <EatingStyleCard
        key={eatingStyleCardKey({ style, goals })}
        style={style}
        goals={goals}
        latestWeightKg={latestWeightKg}
        reproductiveStatus={reproductiveStatus}
      />
      {/* KEYED for the same reason the style card is: the fields are
          uncontrolled, Conform seeds them from `defaultValue` once, and a save
          on the style card above rewrites these very numbers. Before this key,
          saving "low calorie" left a removed 50 g carb limit on screen until
          the person navigated away and back. The key moves only when the STORE
          moves, so nobody is remounted mid-typing. */}
      <GoalsCard
        key={goalsCardKey(goals)}
        goals={goals}
        proteinSuggestion={proteinSuggestion}
        weightUnit={weightUnit}
        suggestedKcalTarget={suggestedKcalTarget}
      />
    </div>
  );
}
