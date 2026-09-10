/**
 * settings.profile.tsx: the body facts, the weigh-in log and the life phase row
 * (M215 spec 03).
 *
 * This page and `/settings/nutrition` were one route at the old goals
 * address, which put "how tall are you" and "how many carbs a day" under a single title
 * called "Goals". A height is not a goal. The two questions are asked at
 * different times and changed at different rates, so they are two pages now.
 *
 * What lives HERE: height, biological sex, birth year, the weigh-in log with
 * its unit toggle, and one row pointing at the life phase page. What lives on
 * `/settings/nutrition`: the eating style and the four targets. What lives on
 * `/settings/life-phase`: the pregnancy and breastfeeding fieldset itself.
 *
 * The life phase is a ROW here rather than the fieldset, for the reason spec 01
 * gave it a page of its own: the question has its own answer and its own dates,
 * and it is the same shared component onboarding renders. A second mount of it
 * on this page would be a fork by another name.
 *
 * Local-first like every other tracker surface: no server loader, no server
 * action, nothing on this page ever leaves the device.
 */
import type { Route } from './+types/settings.profile';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { ChevronRight, HeartPulse } from 'lucide-react';
import { Link } from '#app/components/link';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { trackGoalsSaved, trackWeightLogged } from '#app/lib/matomo-events';
import { cn } from '#app/lib/utils';
import { toGoalInputValue } from '#app/lib/goal-input-value';
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
  putLocalBodyMetrics,
  resolveLocalTimezone,
  upsertLocalWeightEntryForDay,
} from '#app/lib/local-store';
import { BIOLOGICAL_SEX_VALUES, bodyMetricsFormKey, hasAnyBodyMetric } from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import { makeBodyMetricsSchema } from '#app/lib/body-metrics-schema';
import type { Translate } from '#app/lib/body-metrics-schema';
import { reproductiveStatusLine } from '#app/lib/reproductive-status-line';
import { makeLogWeightSchema } from '#app/lib/weight-log-schema';
import { readStoredWeightUnit, writeStoredWeightUnit } from '#app/lib/weight-unit-preference';
import { settingsChipClass } from '#app/components/settings/chip-class';
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
// loader through `matches`, never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.profile') },
];

export const handle = {
  title: 'About you',
  titleKey: 'profile.title',
  backTo: '/settings',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** Rows shown in the recent-weigh-ins list. */
const RECENT_ENTRY_DISPLAY_LIMIT = 30;

/** Form intents multiplexed onto the single route action. */
const INTENT = {
  LOG_WEIGHT: 'log-weight',
  DELETE_WEIGHT: 'delete-weight',
  SAVE_BODY_METRICS: 'save-body-metrics',
  /** Wipes all body metrics in one action, the "take it back" affordance (M135). */
  CLEAR_BODY_METRICS: 'clear-body-metrics',
} as const;

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx`, only the server render uses a clone).
 */
const actionT: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

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
  // The person's OWN calendar day, not the browser's: the weigh-in belongs to
  // that day, and the life phase row derives a gestation week against it.
  const today = todayInTimezone(resolveLocalTimezone(profile));

  const entries = await listLocalWeightEntries();
  // Newest calendar day first. The local `dayKey` IS the calendar day a
  // weigh-in belongs to (one entry per day, same invariant as the server's
  // unique index).
  const weighIns: WeightEntryRow[] = entries
    .toSorted((a, b) =>
      a.dayKey < b.dayKey ? 1
      : a.dayKey > b.dayKey ? -1
      : 0,
    )
    .map((entry) => ({ id: entry.id, measuredAt: entry.dayKey, weightKg: entry.weightKg }));

  const todayWeightKg = weighIns.find((entry) => entry.measuredAt === today)?.weightKg ?? null;

  // No chart data here: the weight TREND lives on `/trends` (one home per
  // idea). This page owns entering, listing and deleting weigh-ins.
  const bodyMetrics = await getLocalBodyMetrics();

  return { weighIns, todayWeightKg, bodyMetrics, today };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the stored record off the device (M117/03). */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('profile.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store writes, no server round-trip)
//////////////////////////////////////////////////////////////////////////////

async function _logWeight(formData: FormData) {
  const submission = parseWithZod(formData, { schema: makeLogWeightSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const profile = await getLocalProfileGoals();
  const measuredAt = todayInTimezone(resolveLocalTimezone(profile));
  await upsertLocalWeightEntryForDay({ dayKey: measuredAt, weightKg: submission.value.weightKg });
  trackWeightLogged();
  return redirectWithLocalToast('/settings/profile', {
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
  return redirectWithLocalToast('/settings/profile', {
    type: 'success',
    description: actionT('goals.toast.weightRemoved'),
  });
}

/**
 * Saves the body metrics as one record. A blank field CLEARS that metric, that
 * is how the person takes an answer back, but a field they filled in that
 * cannot be read comes back as an inline error rather than clearing silently.
 *
 * Conform-shaped (a `SubmissionResult`, not a bespoke `{ bodyMetricsErrors }`
 * bag) so the card's `useForm` owns the error state end to end, which is what
 * lets `shouldRevalidate: 'onInput'` clear a reported error as it is corrected.
 */
async function _saveBodyMetrics(formData: FormData) {
  const submission = parseWithZod(formData, {
    schema: makeBodyMetricsSchema(actionT, { currentYear: new Date().getFullYear(), today: new Date() }),
  });
  if (submission.status !== 'success') return submission.reply();
  // The life phase lives at `/settings/life-phase` (M215 spec 01), so this card
  // does not render those three fields and this submission never carries them.
  // `putLocalBodyMetrics` writes the WHOLE record and a `null` in it CLEARS, so
  // the stored status and its date are read back and carried over: without this
  // merge, saving a height here would silently end a pregnancy. The invariant
  // still holds either way, because `normalizeBodyMetrics` drops a status the
  // sex answer below contradicts.
  const stored = await getLocalBodyMetrics();
  await putLocalBodyMetrics({
    ...stored,
    heightCm: submission.value.heightCm,
    birthYear: submission.value.birthYear,
    biologicalSex: submission.value.biologicalSex,
  });
  trackGoalsSaved('body-metrics');
  return redirectWithLocalToast('/settings/profile', {
    type: 'success',
    description: actionT('bodyMetrics.toast.saved'),
  });
}

/** Removes every stored body metric at once. */
async function _clearBodyMetrics() {
  await clearLocalBodyMetrics();
  return redirectWithLocalToast('/settings/profile', {
    type: 'success',
    description: actionT('bodyMetrics.toast.cleared'),
  });
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === INTENT.LOG_WEIGHT) return _logWeight(formData);
  if (intent === INTENT.DELETE_WEIGHT) return _deleteWeight(formData);
  if (intent === INTENT.CLEAR_BODY_METRICS) return _clearBodyMetrics();
  return _saveBodyMetrics(formData);
}

//////////////////////////////////////////////////////////////////////////////
// Component
//////////////////////////////////////////////////////////////////////////////

/** Small pill toggle for the weigh-in log and the list under it. */
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

/**
 * The life phase, as a row rather than a fieldset.
 *
 * The same status line the settings hub shows, derived from the same stored
 * record through `reproductiveStatusLine`, so the two surfaces cannot disagree
 * about what week somebody is in. Rendered for EVERY account: the fieldset
 * behind the row has its own rule about who is asked, but a person who never
 * answered the sex question still has to be able to find the page.
 */
function LifePhaseRow({ metrics, today }: { metrics: BodyMetrics; today: string }) {
  const { t } = useTranslation();
  const status = reproductiveStatusLine({
    reproductiveStatus: metrics.reproductiveStatus,
    pregnancyDueDate: metrics.pregnancyDueDate ?? null,
    lactationStartDate: metrics.lactationStartDate ?? null,
    today,
    t,
  });

  return (
    <Link
      to="/settings/life-phase"
      className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <HeartPulse className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{t('lifePhase.title')}</span>
        <span className="block line-clamp-2 text-xs text-muted-foreground">{status}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
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
  // Might Not Need an Effect": comparing this render's props against a
  // stored previous value, rather than an effect, avoids an extra
  // stale-then-corrected render):
  //  - `todayWeightKg` changes (a save just landed), reset to the fresh value.
  //  - only `weightUnit` changes, convert whatever is currently typed, in place.
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
    // SAFETY: as on the card below, this route's `clientAction` only ever
    // resolves to a `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLogWeightSchema(t) });
    },
    defaultValue: {
      weightKg: todayWeightKg !== null ? toGoalInputValue(todayWeightKg) : '',
    },
  });

  // A filled-but-unreadable field submits its raw text so `makeLogWeightSchema`
  // answers with "Enter a valid number" rather than the misleading "Enter your
  // weight" a blank submission produced.
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
 * The optional body metrics (M135): height, birth year and biological sex.
 * Pregnancy and breastfeeding used to be asked here too; they have their own
 * page and their own settings row now (M215 spec 01), and a save here carries
 * the stored answer over untouched.
 *
 * Three things this card is careful about, all deliberate:
 *  - **Every field explains why it is asked**, because this is health data and
 *    a person handing it over deserves to know what it buys them.
 *  - **Everything clears.** A blank field removes that metric, "prefer not to
 *    say" removes the sex, and one button removes the lot. An answer you cannot
 *    withdraw is not optional.
 *  - **Nothing here is sent anywhere.** It lives in this browser, rides the
 *    JSON backup and the encrypted sync payload, and is never part of a food
 *    lookup, that request only ever carries a food name.
 */
function BodyMetricsCard({ metrics }: { metrics: BodyMetrics }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  // A local mirror ONLY for the sex radio group, and only because the chips
  // paint from its live value. The two text fields have no such need, so
  // Conform owns them outright (see the inputs).
  const [biologicalSex, setBiologicalSex] = useState<string>(metrics.biologicalSex ?? '');

  const [form, fields] = useForm({
    id: 'body-metrics',
    // SAFETY: as above, this route's `clientAction` only ever resolves to a
    // `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, {
        schema: makeBodyMetricsSchema(t, { currentYear: new Date().getFullYear(), today: new Date() }),
      });
    },
    // `shouldValidate` stays at Conform's `onSubmit` default, nothing is red
    // before you ask for it, but REVALIDATION is `onInput`, which is what lets
    // a corrected height clear its own error as it is typed. Left at the
    // default (`shouldRevalidate` falls back to `shouldValidate`), a reported
    // error would sit under the field, `aria-invalid` and all, until the NEXT
    // submit. Same pattern as `fasting.tsx`'s custom-hours and `AdjustStartInline`.
    shouldRevalidate: 'onInput',
    defaultValue: {
      heightCm: metrics.heightCm === null ? '' : String(metrics.heightCm),
      birthYear: metrics.birthYear === null ? '' : String(metrics.birthYear),
      biologicalSex,
    },
  });

  const sexOptions = [
    ...BIOLOGICAL_SEX_VALUES.map((value) => ({ value, label: t(`bodyMetrics.sex.${value}`) })),
    { value: '', label: t('bodyMetrics.sex.unset') },
  ];

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
              Conform owns this field end to end: `getInputProps` supplies the
              id, the name, the seeded `defaultValue` and the
              `aria-invalid`/`aria-describedby` pair from the SAME metadata
              `FieldError` reads. Bound to local React state with hand-rolled
              `aria-invalid` instead (the shape this had), the input kept its own
              value while the error lived elsewhere, so a corrected height still
              read as invalid until the next submit. Presentation-only props go
              AFTER the spread so they are not clobbered by it.
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
                <label key={option.value} className={cn('cursor-pointer', settingsChipClass(biologicalSex === option.value))}>
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

          {/*
            THE LIFE PHASE IS NOT ASKED HERE (M215 spec 01). Pregnancy and
            breastfeeding have their own page at `/settings/life-phase`, which
            the row at the top of this page opens, and the same shared
            `ReproductiveStatusFields` renders it there. The sex answer above
            still gates the fieldset, and `normalizeBodyMetrics` still drops a
            status the answer contradicts, so saving "male" on this card clears
            a stored pregnancy exactly as it did before.
          */}

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

export default function SettingsProfile({ loaderData }: Route.ComponentProps) {
  const { weighIns, todayWeightKg, bodyMetrics, today } = loaderData;
  // Device-local display preference only (not synced), SHARED with the Progress
  // page's weight card and with the target weight field on
  // `/settings/nutrition` (see `#app/lib/weight-unit-preference`). One storage
  // key, one reader, so no two screens can disagree about what a number means.
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(readStoredWeightUnit);
  const setWeightUnit = (unit: WeightUnit): void => {
    setWeightUnitState(unit);
    writeStoredWeightUnit(unit);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* KEYED off the stored metrics: the card's fields are uncontrolled
          (Conform seeds them once from `defaultValue`), so when "Remove these
          details" wipes the store and the client loader revalidates, only a
          remount can clear what is on screen, otherwise the inputs keep
          showing the values that no longer exist. React's own reset-on-prop-
          change answer, and no `useEffect` (.claude/react-rules.md). */}
      <BodyMetricsCard key={bodyMetricsFormKey(bodyMetrics)} metrics={bodyMetrics} />
      {/* The life phase is one row, not a fieldset: the question has its own
          page, and this page is where somebody editing their body facts looks
          for it. */}
      <LifePhaseRow metrics={bodyMetrics} today={today} />
      <WeightCard
        weighIns={weighIns}
        todayWeightKg={todayWeightKg}
        weightUnit={weightUnit}
        onWeightUnitChange={setWeightUnit}
      />
    </div>
  );
}
