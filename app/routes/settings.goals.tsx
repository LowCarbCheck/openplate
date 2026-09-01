import type { Route } from './+types/settings.goals';
import { useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { ChevronRight, Sparkles } from 'lucide-react';
import { formatMacroNumber, formatMacroNumberIn } from '#app/lib/format-macro-number';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { cn } from '#app/lib/utils';
import {
  formatKgForDisplay,
  fromKg,
  parseDisplayWeightToKg,
  toWeightSubmitValue,
  WEIGHT_UNITS,
  type WeightUnit,
} from '#app/lib/weight-units';
import {
  clearLocalBodyMetrics,
  deleteLocalWeightEntry,
  getLocalBodyMetrics,
  getLocalProfileGoals,
  listLocalWeightEntries,
  patchLocalProfileGoals,
  putLocalBodyMetrics,
  resolveLocalTimezone,
  upsertLocalWeightEntryForDay,
} from '#app/lib/local-store';
import {
  BIOLOGICAL_SEX_VALUES,
  REPRODUCTIVE_STATUS_VALUES,
  bodyMetricsFormKey,
  hasAnyBodyMetric,
  suggestDailyKcal,
} from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import { CARB_PRESETS as ONBOARDING_CARB_PRESETS, type CarbPreset } from '#app/lib/onboarding';
import { makeBodyMetricsSchema } from '#app/lib/body-metrics-schema';
import { makeLogWeightSchema } from '#app/lib/weight-log-schema';
import { readStoredWeightUnit, writeStoredWeightUnit } from '#app/lib/weight-unit-preference';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { WeightEntryList, type WeightEntryRow } from '#app/components/weight/weight-entry-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import i18nSingleton from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.goals') }];

export const handle = {
  title: 'Goals',
  titleKey: 'goals.title',
  backTo: '/settings',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** Rows shown in the recent-weigh-ins list. */
const RECENT_ENTRY_DISPLAY_LIMIT = 30;
/** Rule-of-thumb protein target — offered as a one-tap "use my recommended amount" button, never auto-filled. */
const PROTEIN_PER_KG = 1.6;

/** Form intents multiplexed onto the single route action. Goals is the default (no intent). */
const INTENT = {
  LOG_WEIGHT: 'log-weight',
  DELETE_WEIGHT: 'delete-weight',
  SAVE_BODY_METRICS: 'save-body-metrics',
  /** Wipes all four body metrics in one action — the "take it back" affordance (M135). */
  CLEAR_BODY_METRICS: 'clear-body-metrics',
} as const;

/**
 * One-tap net-carb ceiling presets rendered as chips above the field.
 *
 * The SAME table onboarding offers, minus its "decide later" entry — this page
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
 * Translation lookup. The schemas below are built per-call rather than held as
 * module constants because their messages are user-facing copy: they have to be
 * resolved against the ACTIVE language, which isn't known at module-eval time.
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx` — only the server render uses a clone).
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
// Server loader — none needed (M117/04: accounts optional, health data is
// local-only — there is no auth invariant left to enforce or echo here)
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
  const timezone = resolveLocalTimezone(profile);
  const today = todayInTimezone(timezone);

  const goals = {
    netCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
    proteinFloorG: profile?.goalProteinFloorG ?? null,
    kcalTarget: profile?.goalKcalTarget ?? null,
    targetWeightKg: profile?.targetWeightKg ?? null,
  };

  const entries = await listLocalWeightEntries();
  // Newest calendar day first — the local `dayKey` IS the calendar day a
  // weigh-in belongs to (one entry per day, same invariant as the server's
  // unique index).
  const weighIns: WeightEntryRow[] = entries
    .toSorted((a, b) =>
      a.dayKey < b.dayKey ? 1
      : a.dayKey > b.dayKey ? -1
      : 0,
    )
    .map((entry) => ({ id: entry.id, measuredAt: entry.dayKey, weightKg: entry.weightKg }));

  const currentWeightKg = weighIns.length > 0 ? weighIns[0].weightKg : null;
  const todayWeightKg = weighIns.find((entry) => entry.measuredAt === today)?.weightKg ?? null;

  const bodyMetrics = await getLocalBodyMetrics();
  // A SUGGESTION, computed here so the component stays clock-free: `null`
  // whenever any input is missing, which is the normal state for anyone who
  // hasn't filled in the body-metrics card. Never auto-applied — it renders as
  // a chip to tap, exactly like the protein recommendation above it.
  const suggestedKcalTarget = suggestDailyKcal({
    weightKg: currentWeightKg,
    heightCm: bodyMetrics.heightCm,
    biologicalSex: bodyMetrics.biologicalSex,
    birthYear: bodyMetrics.birthYear,
    currentYear: new Date().getFullYear(),
  });

  // No chart data here: the weight TREND lives on `/trends` now (one home per
  // idea). This page owns entering, listing and deleting weigh-ins.
  return { goals, weighIns, currentWeightKg, todayWeightKg, bodyMetrics, suggestedKcalTarget };
}
clientLoader.hydrate = true as const;

/**
 * Shown while the client loader reads goals/weight from the on-device primary
 * store (M117/03) — this route is now clientLoader-only for health data.
 */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('goals.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store writes — no server round-trip)
//////////////////////////////////////////////////////////////////////////////

async function _saveGoals(formData: FormData) {
  const submission = parseWithZod(formData, { schema: makeGoalsSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const value = submission.value;
  await patchLocalProfileGoals({
    goalNetCarbsCeilingG: value.goalNetCarbsCeilingG,
    goalProteinFloorG: value.goalProteinFloorG,
    goalKcalTarget: value.goalKcalTarget,
    targetWeightKg: value.targetWeightKg,
  });
  return redirectWithLocalToast('/settings/goals', { type: 'success', description: actionT('goals.toast.saved') });
}

async function _logWeight(formData: FormData) {
  const submission = parseWithZod(formData, { schema: makeLogWeightSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const profile = await getLocalProfileGoals();
  const measuredAt = todayInTimezone(resolveLocalTimezone(profile));
  await upsertLocalWeightEntryForDay({ dayKey: measuredAt, weightKg: submission.value.weightKg });
  return redirectWithLocalToast('/settings/goals', {
    type: 'success',
    description: actionT('goals.toast.weightLogged'),
  });
}

async function _deleteWeight(formData: FormData) {
  const id = z
    .string()
    .refine((value) => value.trim() !== '')
    .safeParse(formData.get('weightEntryId'));
  if (!id.success) throw new Response('Invalid weight entry id', { status: 400 });
  await deleteLocalWeightEntry(id.data);
  return redirectWithLocalToast('/settings/goals', {
    type: 'success',
    description: actionT('goals.toast.weightRemoved'),
  });
}

/**
 * Saves all four body metrics as one record. A blank field CLEARS that metric —
 * that is how the person takes an answer back — but a field they filled in that
 * can't be read comes back as an inline error rather than clearing silently.
 *
 * Conform-shaped (a `SubmissionResult`, not a bespoke `{ bodyMetricsErrors }`
 * bag) so the card's `useForm` owns the error state end to end — that is what
 * lets `shouldRevalidate: 'onInput'` clear a reported error as it is corrected.
 * `putLocalBodyMetrics` applies the sex ↔ reproductive-status invariant itself.
 */
async function _saveBodyMetrics(formData: FormData) {
  const submission = parseWithZod(formData, {
    schema: makeBodyMetricsSchema(actionT, { currentYear: new Date().getFullYear() }),
  });
  if (submission.status !== 'success') return submission.reply();
  await putLocalBodyMetrics(submission.value);
  return redirectWithLocalToast('/settings/goals', {
    type: 'success',
    description: actionT('bodyMetrics.toast.saved'),
  });
}

/** Removes every stored body metric at once. */
async function _clearBodyMetrics() {
  await clearLocalBodyMetrics();
  return redirectWithLocalToast('/settings/goals', {
    type: 'success',
    description: actionT('bodyMetrics.toast.cleared'),
  });
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === INTENT.LOG_WEIGHT) return _logWeight(formData);
  if (intent === INTENT.DELETE_WEIGHT) return _deleteWeight(formData);
  if (intent === INTENT.SAVE_BODY_METRICS) return _saveBodyMetrics(formData);
  if (intent === INTENT.CLEAR_BODY_METRICS) return _clearBodyMetrics();
  return _saveGoals(formData);
}

//////////////////////////////////////////////////////////////////////////////
// Component
//////////////////////////////////////////////////////////////////////////////

/**
 * Blank for a missing goal, otherwise the compact string for the input.
 * Deliberately the PINNED formatter: this is a number field's value, which the
 * browser rejects and `Number()` reads as `NaN` if it carries a German comma.
 */
function _toInput(value: number | null): string {
  return value === null ? '' : formatMacroNumber(value);
}

/** Small pill toggle shared by every weight field on this page. */
function WeightUnitToggle({ unit, onChange }: { unit: WeightUnit; onChange: (unit: WeightUnit) => void }) {
  const { t } = useTranslation();

  return (
    <fieldset
      className="inline-flex shrink-0 rounded-full border p-0.5 text-xs font-medium"
      aria-label={t('goals.weight.unitToggleLabel')}
    >
      {WEIGHT_UNITS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={unit === option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-8 min-w-11 rounded-full px-3 py-1 transition-colors',
            unit === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}

/** Shared chip recipe for the one-tap suggestion buttons on this page (DESIGN.md §2/§11 — tokens only). */
function suggestionChipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
  );
}

function GoalsCard({
  goals,
  currentWeightKg,
  weightUnit,
  suggestedKcalTarget,
}: {
  goals: Route.ComponentProps['loaderData']['goals'];
  currentWeightKg: number | null;
  weightUnit: WeightUnit;
  suggestedKcalTarget: number | null;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  const carbInputRef = useRef<HTMLInputElement>(null);
  const [carbCeiling, setCarbCeiling] = useState<string>(_toInput(goals.netCarbsCeilingG));
  const [proteinFloor, setProteinFloor] = useState<string>(_toInput(goals.proteinFloorG));
  const [kcalTarget, setKcalTarget] = useState<string>(_toInput(goals.kcalTarget));

  // Same "adjust state during render" pattern as `useUnitAwareWeightText`
  // below, inlined here since only one field on this card needs it.
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
    // and every branch of it returns `parseWithZod(...).reply()` — Conform's
    // submission result for string[] errors — or nothing at all.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeGoalsSchema(t) });
    },
    defaultValue: {
      goalNetCarbsCeilingG: _toInput(goals.netCarbsCeilingG),
      goalProteinFloorG: _toInput(goals.proteinFloorG),
      goalKcalTarget: _toInput(goals.kcalTarget),
      targetWeightKg: _toInput(goals.targetWeightKg),
    },
  });

  const trimmedCarb = carbCeiling.trim();
  const carbNumber = trimmedCarb === '' ? null : Number(trimmedCarb);
  const isCustomSelected =
    carbNumber !== null && Number.isFinite(carbNumber) && !CARB_PRESETS.some((preset) => preset.ceiling === carbNumber);
  const recommendedProteinG = currentWeightKg !== null ? Math.round(PROTEIN_PER_KG * currentWeightKg) : null;
  const isRecommendedProteinSelected =
    recommendedProteinG !== null && proteinFloor.trim() !== '' && Number(proteinFloor.trim()) === recommendedProteinG;
  const isSuggestedKcalSelected =
    suggestedKcalTarget !== null && kcalTarget.trim() !== '' && Number(kcalTarget.trim()) === suggestedKcalTarget;
  // Kilograms when the typed text reads as a weight, the raw text when it
  // doesn't — so a filled-but-unreadable field reaches `makeGoalsSchema` and
  // comes back as an inline error, instead of submitting blank and silently
  // CLEARING the target goal (see `toWeightSubmitValue`).
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
                    className={cn(
                      'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                      isSelected ?
                        'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                    )}
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
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                  isCustomSelected ?
                    'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                )}
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
            {recommendedProteinG !== null ?
              <button
                type="button"
                aria-pressed={isRecommendedProteinSelected}
                onClick={() => setProteinFloor(String(recommendedProteinG))}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                  isRecommendedProteinSelected ?
                    'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                )}
              >
                {t('goals.protein.recommended', { grams: recommendedProteinG })}
              </button>
            : <p className="text-xs text-muted-foreground">{t('goals.protein.noWeightHint')}</p>}
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
            {/* Suggestion, never auto-fill — the same contract the protein chip
                above already keeps. It only appears when a weight AND all three
                body metrics are on file; missing any of them means no chip at
                all, never a figure built on a guessed height. */}
            {suggestedKcalTarget !== null ?
              <button
                type="button"
                aria-pressed={isSuggestedKcalSelected}
                onClick={() => setKcalTarget(String(suggestedKcalTarget))}
                // `tabular-nums` because the chip carries a LIVE figure — it
                // moves with every weigh-in — and DESIGN.md §4 keeps changing
                // numbers in `font-sans` with tabular digits. Same treatment
                // the fasting summary line gives its interpolated number.
                className={cn(suggestionChipClass(isSuggestedKcalSelected), 'tabular-nums')}
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

function WeightCard({
  weighIns,
  todayWeightKg,
  weightUnit,
  onWeightUnitChange,
}: {
  weighIns: WeightEntryRow[];
  todayWeightKg: number | null;
  weightUnit: WeightUnit;
  onWeightUnitChange: (unit: WeightUnit) => void;
}) {
  const { t, i18n } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isLogging = fetcher.state !== 'idle';

  // Mirrors `todayWeightKg` (converted for display) while letting the user
  // freely type and switch units. Two prop changes need handling here, both
  // via the "adjust state during render" pattern (see react.dev's "You
  // Might Not Need an Effect" — comparing this render's props against a
  // stored previous value, rather than an effect, avoids an extra
  // stale-then-corrected render):
  //  - `todayWeightKg` changes (a save just landed) → reset to the fresh value.
  //  - only `weightUnit` changes → convert whatever's currently typed, in place.
  const [synced, setSynced] = useState<{ unit: WeightUnit; todayWeightKg: number | null }>({
    unit: weightUnit,
    todayWeightKg,
  });
  const [weightLogText, setWeightLogText] = useState<string>(() => formatKgForDisplay(todayWeightKg, weightUnit));
  if (weightUnit !== synced.unit || todayWeightKg !== synced.todayWeightKg) {
    const dataChanged = todayWeightKg !== synced.todayWeightKg;
    const kgFromCurrentText = dataChanged ? todayWeightKg : parseDisplayWeightToKg(weightLogText, synced.unit);
    setSynced({ unit: weightUnit, todayWeightKg });
    setWeightLogText(formatKgForDisplay(kgFromCurrentText, weightUnit));
  }

  const [form, fields] = useForm({
    id: 'log-weight',
    // SAFETY: as above — this route's `clientAction` only ever resolves to a
    // `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLogWeightSchema(t) });
    },
    defaultValue: {
      weightKg: todayWeightKg !== null ? _toInput(todayWeightKg) : '',
    },
  });

  // As on the goals card: a filled-but-unreadable field submits its raw text so
  // `makeLogWeightSchema` answers with "Enter a valid number" rather than the
  // misleading "Enter your weight" a blank submission produced.
  const weightKgForSubmit = toWeightSubmitValue(weightLogText, weightUnit);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t('goals.weight.title')}</CardTitle>
            <CardDescription>{t('goals.weight.description')}</CardDescription>
          </div>
          <WeightUnitToggle unit={weightUnit} onChange={onWeightUnitChange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <fetcher.Form method="post" {...getFormProps(form)} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="_intent" value={INTENT.LOG_WEIGHT} />
          <div className="min-w-40 flex-1 space-y-2">
            <Label htmlFor={fields.weightKg.id}>{t('goals.weight.todayLabel', { unit: weightUnit })}</Label>
            <Input
              id={fields.weightKg.id}
              inputMode="decimal"
              placeholder={weightUnit === 'kg' ? t('goals.weight.placeholderKg') : t('goals.weight.placeholderLb')}
              value={weightLogText}
              onChange={(event) => setWeightLogText(event.target.value)}
              aria-describedby={fields.weightKg.errorId}
              aria-invalid={fields.weightKg.errors?.length ? true : undefined}
              className="h-11 sm:h-9"
            />
            <input type="hidden" name={fields.weightKg.name} value={weightKgForSubmit} />
            <FieldError id={fields.weightKg.errorId} errors={fields.weightKg.errors} />
          </div>
          <SubmitButton pending={isLogging} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {todayWeightKg !== null ? t('goals.weight.update') : t('goals.weight.log')}
          </SubmitButton>
        </fetcher.Form>

        {todayWeightKg !== null && (
          <p className="text-xs text-muted-foreground">
            {t('goals.weight.loggedToday', {
              weight: formatMacroNumberIn(i18n.language, fromKg(todayWeightKg, weightUnit)),
              unit: weightUnit,
            })}
          </p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('goals.weight.recentHeading')}</h3>
          <WeightEntryList
            entries={weighIns.slice(0, RECENT_ENTRY_DISPLAY_LIMIT)}
            deleteIntent={INTENT.DELETE_WEIGHT}
            weightUnit={weightUnit}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The optional body metrics (M135) — height, birth year, biological sex and,
 * only where it applies, pregnancy/breastfeeding status.
 *
 * Three things this card is careful about, all deliberate:
 *  - **Every field explains why it is asked**, because this is health data and
 *    a person handing it over deserves to know what it buys them.
 *  - **Everything clears.** A blank field removes that metric, "prefer not to
 *    say" removes the sex, and one button removes the lot. An answer you can't
 *    withdraw isn't optional.
 *  - **Nothing here is sent anywhere.** It lives in this browser, rides the
 *    JSON backup and the encrypted sync payload, and is never part of a food
 *    lookup — that request only ever carries a food name.
 */
function BodyMetricsCard({ metrics }: { metrics: BodyMetrics }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  // Local mirrors ONLY for the two radio groups, and only because something
  // else on this card reads their live value: the chips paint from it, and the
  // reproductive-status fieldset below appears from it. The two text fields
  // have no such need, so Conform owns them outright (see the inputs).
  const [biologicalSex, setBiologicalSex] = useState<string>(metrics.biologicalSex ?? '');
  const [reproductiveStatus, setReproductiveStatus] = useState<string>(metrics.reproductiveStatus ?? 'none');

  const [form, fields] = useForm({
    id: 'body-metrics',
    // SAFETY: as above — this route's `clientAction` only ever resolves to a
    // `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, {
        schema: makeBodyMetricsSchema(t, { currentYear: new Date().getFullYear() }),
      });
    },
    // `shouldValidate` stays at Conform's `onSubmit` default — nothing is red
    // before you ask for it — but REVALIDATION is `onInput`, which is what lets
    // a corrected height clear its own error as it is typed. Left at the
    // default (`shouldRevalidate` falls back to `shouldValidate`), a reported
    // error would sit under the field, `aria-invalid` and all, until the NEXT
    // submit. Same pattern as `fasting.tsx`'s custom-hours and `AdjustStartInline`.
    shouldRevalidate: 'onInput',
    defaultValue: {
      heightCm: metrics.heightCm === null ? '' : String(metrics.heightCm),
      birthYear: metrics.birthYear === null ? '' : String(metrics.birthYear),
      biologicalSex,
      reproductiveStatus,
    },
  });

  const sexOptions = [
    ...BIOLOGICAL_SEX_VALUES.map((value) => ({ value, label: t(`bodyMetrics.sex.${value}`) })),
    { value: '', label: t('bodyMetrics.sex.unset') },
  ];
  const statusOptions = REPRODUCTIVE_STATUS_VALUES.map((value) => ({
    value,
    label: t(`bodyMetrics.reproductive.${value}`),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bodyMetrics.card.title')}</CardTitle>
        <CardDescription>{t('bodyMetrics.card.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-6">
          <input type="hidden" name="_intent" value={INTENT.SAVE_BODY_METRICS} />

          <div className="space-y-2">
            <Label htmlFor={fields.heightCm.id}>{t('bodyMetrics.height.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('bodyMetrics.height.hint')}</p>
            {/*
              Conform owns this field end to end — `getInputProps` supplies the
              id, the name, the seeded `defaultValue` and the
              `aria-invalid`/`aria-describedby` pair from the SAME metadata
              `FieldError` reads. Bound to local React state with hand-rolled
              `aria-invalid` instead (the shape this had), the input kept its own
              value while the error lived elsewhere, so a corrected height still
              read as invalid until the next submit. Presentation-only props go
              AFTER the spread so they aren't clobbered by it.
            */}
            <Input
              {...getInputProps(fields.heightCm, { type: 'text' })}
              inputMode="numeric"
              placeholder={t('bodyMetrics.height.placeholder')}
              className="h-11 sm:h-9"
            />
            <FieldError id={fields.heightCm.errorId} errors={fields.heightCm.errors} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={fields.birthYear.id}>{t('bodyMetrics.birthYear.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('bodyMetrics.birthYear.hint')}</p>
            <Input
              {...getInputProps(fields.birthYear, { type: 'text' })}
              inputMode="numeric"
              placeholder={t('bodyMetrics.birthYear.placeholder')}
              className="h-11 sm:h-9"
            />
            <FieldError id={fields.birthYear.errorId} errors={fields.birthYear.errors} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('bodyMetrics.sex.legend')}</legend>
            <p className="text-xs text-muted-foreground">{t('bodyMetrics.sex.hint')}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {sexOptions.map((option) => (
                <label
                  key={option.value}
                  className={cn('cursor-pointer', suggestionChipClass(biologicalSex === option.value))}
                >
                  <input
                    type="radio"
                    name={fields.biologicalSex.name}
                    value={option.value}
                    checked={biologicalSex === option.value}
                    onChange={() => setBiologicalSex(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Only asked of the people it can apply to, and never sticky: the
              store's `normalizeBodyMetrics` drops any saved status the moment
              this stops holding, so switching away can't strand an answer the
              person can no longer see. */}
          {biologicalSex === 'female' && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('bodyMetrics.reproductive.legend')}</legend>
              <p className="text-xs text-muted-foreground">{t('bodyMetrics.reproductive.hint')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {statusOptions.map((option) => (
                  <label
                    key={option.value}
                    className={cn('cursor-pointer', suggestionChipClass(reproductiveStatus === option.value))}
                  >
                    <input
                      type="radio"
                      name={fields.reproductiveStatus.name}
                      value={option.value}
                      checked={reproductiveStatus === option.value}
                      onChange={() => setReproductiveStatus(option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSaving} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {t('bodyMetrics.save')}
          </SubmitButton>
        </fetcher.Form>

        {hasAnyBodyMetric(metrics) && (
          <fetcher.Form method="post" className="border-t pt-4">
            <input type="hidden" name="_intent" value={INTENT.CLEAR_BODY_METRICS} />
            <p className="text-xs text-muted-foreground">{t('bodyMetrics.clear.hint')}</p>
            <button
              type="submit"
              disabled={isSaving}
              className="mt-2 min-h-11 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
            >
              {t('bodyMetrics.clear.action')}
            </button>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

function AiSettingsLinkCard() {
  const { t } = useTranslation();

  return (
    <Card className="transition-all duration-200 hover:border-primary/40 hover:shadow-md">
      <Link to="/settings/ai" className="flex items-center justify-between gap-4 p-6">
        <span className="flex items-center gap-3">
          <Sparkles className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold">{t('goals.aiLink.title')}</span>
            <span className="block text-xs text-muted-foreground">{t('goals.aiLink.description')}</span>
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </Card>
  );
}

export default function SettingsGoals({ loaderData }: Route.ComponentProps) {
  const { goals, weighIns, currentWeightKg, todayWeightKg, bodyMetrics, suggestedKcalTarget } = loaderData;
  // Device-local display preference only (not synced), SHARED with the Progress
  // page's weight card — one storage key, one reader (see
  // `#app/lib/weight-unit-preference`), so the two screens can't disagree.
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(readStoredWeightUnit);
  const setWeightUnit = (unit: WeightUnit): void => {
    setWeightUnitState(unit);
    writeStoredWeightUnit(unit);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <GoalsCard
        goals={goals}
        currentWeightKg={currentWeightKg}
        weightUnit={weightUnit}
        suggestedKcalTarget={suggestedKcalTarget}
      />
      <WeightCard
        weighIns={weighIns}
        todayWeightKg={todayWeightKg}
        weightUnit={weightUnit}
        onWeightUnitChange={setWeightUnit}
      />
      {/* After the weight card on purpose: the energy suggestion above needs a
          weigh-in too, so the two things it depends on read in the order they
          are asked for.

          KEYED off the stored metrics: the card's fields are uncontrolled
          (Conform seeds them once from `defaultValue`), so when "Remove these
          details" wipes the store and the client loader revalidates, only a
          remount can clear what is on screen — otherwise the inputs keep
          showing the values that no longer exist. React's own reset-on-prop-
          change answer, and no `useEffect` (.claude/react-rules.md). */}
      <BodyMetricsCard key={bodyMetricsFormKey(bodyMetrics)} metrics={bodyMetrics} />
      <AiSettingsLinkCard />
    </div>
  );
}
