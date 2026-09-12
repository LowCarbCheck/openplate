/**
 * settings.fasting.tsx: the fasting ROUTINE, on a settings page of its own.
 *
 * `/fasting` is where a fast is started, adjusted and ended. It is a timer, and
 * a timer is a thing you look at while it runs. The two questions on THIS page
 * are not about a running fast at all: "which window do I usually do" and "what
 * hour do I usually start", both of them preferences that outlive any one fast.
 * They live beside the eating targets, in settings, for the same reason the
 * carb ceiling does.
 *
 * What the two answers buy on `/fasting`: the routine preselects the window in
 * the picker, and a usual start time gives a one-tap start at that hour. Both
 * are HINTS. Nothing here ever starts a fast on its own, because a fast is an
 * event the person decides to begin (see `app/models/fasting.ts`).
 *
 * ── The record is a singleton, and a save MERGES ───────────────────────────
 *
 * `putLocalFastingSettings` takes a PATCH and re-stamps `updatedAt`, so this
 * page never has to read the record first the way `/settings/life-phase` does.
 * The care acknowledgement is the fourth field of the same record and is
 * written by its own intent, never by the routine form, so saving a window can
 * not silently re-arm a note the person already read.
 *
 * Local-first like every other tracker surface: no server loader, no server
 * action, nothing on this page ever leaves the device.
 */
import type { Route } from './+types/settings.fasting';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { getLocalFastingSettings, putLocalFastingSettings } from '#app/lib/local-store';
import type { LocalFastingSettings } from '#app/lib/local-store';
import type { FastProtocolId } from '#app/lib/local-store/schema';
import {
  FAST_MAX_CUSTOM_HOURS,
  FAST_MIN_CUSTOM_HOURS,
  FAST_PROTOCOLS,
  isValidCustomHours,
  isValidRoutineStartMinute,
  protocolById,
} from '#app/models/fasting';
import type { FastProtocol, Translate } from '#app/models/fasting';
import { settingsChipClass } from '#app/components/settings/chip-class';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import i18nSingleton from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.fastingSettings') },
];

export const handle = {
  title: 'Fasting',
  titleKey: 'settings.fasting.title',
  backTo: '/settings',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** Form intents multiplexed onto the single route action. The routine form is the default (no intent). */
const INTENT = {
  /** Clear `extendedAcknowledgedAt`, so the 24 h+ note is shown once more. */
  RESET_CARE: 'reset-care',
} as const;

/** "None", the answer that means there is no routine at all. Not a `FastProtocolId`, so it can never be stored. */
const ROUTINE_NONE = 'none';

/**
 * Every answer the routine chips offer: the seven named presets, `custom`, and
 * the "None" sentinel above.
 *
 * Written out rather than mapped off `FAST_PROTOCOLS`, because `z.enum` wants
 * literal types and a `.map()` gives it `string[]`. The duplication is pinned:
 * `tests/unit/settings-fasting.test.ts` fails if the model gains a preset this
 * list does not offer.
 */
export const ROUTINE_CHOICE_IDS = ['16:8', '18:6', '20:4', '24h', '36h', '48h', '72h', 'custom', 'none'] as const;

export type RoutineChoice = (typeof ROUTINE_CHOICE_IDS)[number];

/** Minutes in one hour, so the time field's arithmetic reads as arithmetic. */
const MINUTES_PER_HOUR = 60;

/** The shape a native `<input type="time">` submits: "20:00", always zero-padded, always 24 h. */
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

//////////////////////////////////////////////////////////////////////////////
// Pure helpers (shared with the settings hub, which prints the same routine)
//////////////////////////////////////////////////////////////////////////////

/**
 * A stored minute-after-midnight as a 24 h wall clock, "20:00".
 *
 * Zero-padded by hand rather than through `Intl`, because this string is also
 * the `value` of an `<input type="time">`, which accepts exactly one format
 * regardless of the reader's locale.
 *
 * @param minute - minutes after local midnight, 0..1439.
 * @returns the "HH:MM" the time input renders and submits.
 */
export function formatRoutineMinute(minute: number): string {
  const hours = Math.floor(minute / MINUTES_PER_HOUR);
  const minutes = minute % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The visible name of one preset.
 *
 * A DAILY window is its own id, "16:8", which the schema's own comment records
 * is written the same in every language. An extended fast is not: "24h" is a
 * file name, not a label, so those four read out of the catalog.
 *
 * @param protocol - the preset being drawn.
 * @param t - translation lookup.
 * @returns the chip label.
 */
export function protocolLabel(protocol: FastProtocol, t: Translate): string {
  return protocol.daily ? protocol.id : t(`fasting.plan.protocol.${protocol.id}`);
}

/**
 * The routine in one phrase, or `null` when there is no routine at all.
 *
 * @param settings - the stored record, or null on a device with none.
 * @param t - translation lookup.
 * @returns "16:8", "20 h" for a custom routine, or null.
 */
export function fastingRoutineLabel({
  settings,
  t,
}: {
  settings: LocalFastingSettings | null;
  t: Translate;
}): string | null {
  const id = settings?.routineProtocolId ?? null;
  if (id === null) return null;

  const protocol = protocolById(id);
  if (protocol !== null) return protocolLabel(protocol, t);

  // `custom`: the hours are the label. A custom routine with no hours stored is
  // a half-written record, and naming it "Custom" would print a word that says
  // nothing, so it reads as no routine at all.
  const hours = settings?.routineCustomHours ?? null;
  if (hours === null) return null;
  return t('settings.fasting.routine.customHours', { hours });
}

/**
 * The settings hub row's status line: the live routine off the device.
 *
 * `null` while the read is in flight, so the row never flashes a wrong value,
 * exactly as the nutrition row does.
 *
 * @param settings - the stored record, `null` for none and `undefined` while reading.
 * @param t - translation lookup.
 * @returns "16:8, starts 20:00", "16:8", "No usual fast", or null.
 */
export function fastingRowStatus({
  settings,
  t,
}: {
  settings: LocalFastingSettings | null | undefined;
  t: Translate;
}): string | null {
  if (settings === undefined) return null;

  const routine = fastingRoutineLabel({ settings, t });
  if (routine === null) return t('settings.hub.fasting.none');

  const minute = settings?.routineStartMinute ?? null;
  if (minute === null || !isValidRoutineStartMinute(minute)) return routine;
  return t('settings.hub.fasting.description', { routine, time: formatRoutineMinute(minute) });
}

//////////////////////////////////////////////////////////////////////////////
// Schema
//////////////////////////////////////////////////////////////////////////////

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx`, only the server render uses a clone).
 */
const actionT: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

/**
 * The custom hour count, which only the `custom` chip opens. Blank is `null`
 * (the field is rendered for nobody else), and any supplied value must be a
 * whole number the model accepts.
 */
function _customHoursField(t: Translate): z.ZodType<number | null> {
  return z.preprocess(
    (value) => {
      const raw = z.string().safeParse(value);
      if (value === undefined || value === null) return null;
      return raw.success && raw.data.trim() === '' ? null : value;
    },
    z.coerce
      .number()
      .refine(
        isValidCustomHours,
        t('fasting.errors.customHours', { min: FAST_MIN_CUSTOM_HOURS, max: FAST_MAX_CUSTOM_HOURS }),
      )
      .nullable(),
  );
}

/**
 * The usual start time, submitted as "HH:MM" by a native time input and stored
 * as minutes after LOCAL midnight (see `LocalFastingSettings.routineStartMinute`
 * for why a minute-of-day rather than an instant).
 *
 * An empty field is `null`, which is how the routine's hour is cleared. A value
 * the pattern does not recognise, or an hour past 23:59, becomes `NaN` here and
 * is refused below rather than being rounded into something plausible.
 */
function _startMinuteField(t: Translate): z.ZodType<number | null> {
  return z.preprocess(
    (value) => {
      const raw = z.string().safeParse(value);
      if (!raw.success) return null;
      const trimmed = raw.data.trim();
      if (trimmed === '') return null;
      const match = TIME_PATTERN.exec(trimmed);
      if (match === null) return Number.NaN;
      return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
    },
    z.number().refine(isValidRoutineStartMinute, t('settings.fasting.startTime.invalid')).nullable(),
  );
}

/**
 * The routine form's schema. The window is always answered, because "None" is
 * one of the answers; the hour count is required only by the `custom` window,
 * which is why that rule is a `superRefine` rather than a `.min()`.
 *
 * @param t - translation lookup, resolved against the active language by the caller.
 * @returns the schema `parseWithZod` validates the submission against.
 */
export function makeFastingRoutineSchema(t: Translate) {
  return z
    .object({
      routineProtocolId: z.enum(ROUTINE_CHOICE_IDS),
      routineCustomHours: _customHoursField(t),
      routineStartMinute: _startMinuteField(t),
    })
    .superRefine((value, ctx) => {
      if (value.routineProtocolId !== 'custom') return;
      if (value.routineCustomHours !== null) return;
      ctx.addIssue({
        code: 'custom',
        path: ['routineCustomHours'],
        message: t('fasting.errors.customHours', { min: FAST_MIN_CUSTOM_HOURS, max: FAST_MAX_CUSTOM_HOURS }),
      });
    });
}

/** What a successful submission carries, before it is turned into a store patch. */
export type FastingRoutineSubmission = z.infer<ReturnType<typeof makeFastingRoutineSchema>>;

/** The three routine fields of `LocalFastingSettings`, as one write. */
export interface FastingRoutinePatch {
  routineProtocolId: FastProtocolId | null;
  routineCustomHours: number | null;
  routineStartMinute: number | null;
}

/**
 * The pure step from a parsed submission to the patch the store is given.
 *
 * "None" clears all THREE fields, the window, the hours and the hour of day. A
 * start time with no window behind it would preselect nothing and offer a
 * one-tap start of nothing, so keeping it would leave a setting on the device
 * that no screen could act on.
 *
 * @param value - the successfully parsed submission.
 * @returns the patch for `putLocalFastingSettings`.
 */
export function fastingRoutinePatch(value: FastingRoutineSubmission): FastingRoutinePatch {
  if (value.routineProtocolId === ROUTINE_NONE) {
    return { routineProtocolId: null, routineCustomHours: null, routineStartMinute: null };
  }
  return {
    routineProtocolId: value.routineProtocolId,
    // The hours belong to `custom` alone, so any number typed before another
    // chip was tapped is dropped rather than stored beside a named window.
    routineCustomHours: value.routineProtocolId === 'custom' ? value.routineCustomHours : null,
    routineStartMinute: value.routineStartMinute,
  };
}

//////////////////////////////////////////////////////////////////////////////
// Loaders
//////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

export async function clientLoader() {
  return { settings: await getLocalFastingSettings() };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the stored record off the device. */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('fasting.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store write, no server round-trip)
//////////////////////////////////////////////////////////////////////////////

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();

  if (formData.get('_intent') === INTENT.RESET_CARE) {
    await putLocalFastingSettings({ extendedAcknowledgedAt: null });
    return redirectWithLocalToast('/settings/fasting', {
      type: 'success',
      description: actionT('settings.fasting.care.resetSaved'),
    });
  }

  const submission = parseWithZod(formData, { schema: makeFastingRoutineSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();

  // A PATCH, never a whole record: `extendedAcknowledgedAt` is the fourth field
  // and is not on this form, so it survives every save here untouched.
  await putLocalFastingSettings(fastingRoutinePatch(submission.value));
  return redirectWithLocalToast('/settings/fasting', {
    type: 'success',
    description: actionT('settings.fasting.saved'),
  });
}

//////////////////////////////////////////////////////////////////////////////
// Components
//////////////////////////////////////////////////////////////////////////////

/** The stored routine as a chip answer: the window, `custom`, or "None". */
function storedRoutineChoice(settings: LocalFastingSettings): RoutineChoice {
  return settings.routineProtocolId ?? ROUTINE_NONE;
}

export function FastingRoutineCard({ settings }: { settings: LocalFastingSettings }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  // React state for the chips, because the hour field is only rendered by one
  // of them. Conform still owns the names, the ids and the errors; the chosen
  // chip rides to the action in a hidden input, the shape `/fasting`'s own
  // picker uses.
  const [choice, setChoice] = useState<RoutineChoice>(storedRoutineChoice(settings));

  const [form, fields] = useForm({
    id: 'fasting-routine',
    // SAFETY: this route's `clientAction` only ever resolves to a
    // `parseWithZod(...).reply()` or a redirect.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeFastingRoutineSchema(t) });
    },
    // Nothing is red before you ask for it, but a corrected value clears its
    // own error as it is typed rather than at the next submit.
    shouldRevalidate: 'onInput',
    defaultValue: {
      routineProtocolId: storedRoutineChoice(settings),
      routineCustomHours: settings.routineCustomHours === null ? '' : String(settings.routineCustomHours),
      routineStartMinute: settings.routineStartMinute === null ? '' : formatRoutineMinute(settings.routineStartMinute),
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.fasting.title')}</CardTitle>
        <CardDescription>{t('settings.fasting.lead')}</CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-6">
          <input type="hidden" name={fields.routineProtocolId.name} value={choice} />

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('settings.fasting.routine.label')}</p>
            <fieldset className="flex flex-wrap gap-2" aria-label={t('fasting.plan.protocolGroup')}>
              {FAST_PROTOCOLS.map((protocol) => (
                <button
                  key={protocol.id}
                  type="button"
                  aria-pressed={choice === protocol.id}
                  // The visible "16:8" would otherwise be read out as a time.
                  aria-label={t('fasting.plan.protocolAria', {
                    fastingHours: protocol.fastingHours,
                    eatingHours: protocol.eatingHours,
                  })}
                  onClick={() => setChoice(protocol.id)}
                  className={settingsChipClass(choice === protocol.id)}
                >
                  {protocolLabel(protocol, t)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={choice === 'custom'}
                onClick={() => setChoice('custom')}
                className={settingsChipClass(choice === 'custom')}
              >
                {t('fasting.plan.custom')}
              </button>
              <button
                type="button"
                aria-pressed={choice === ROUTINE_NONE}
                onClick={() => setChoice(ROUTINE_NONE)}
                className={settingsChipClass(choice === ROUTINE_NONE)}
              >
                {t('settings.fasting.routine.none')}
              </button>
            </fieldset>
          </div>

          {choice === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor={fields.routineCustomHours.id}>{t('fasting.plan.customLabel')}</Label>
              <Input
                {...getInputProps(fields.routineCustomHours, { type: 'text' })}
                inputMode="numeric"
                placeholder={t('fasting.plan.customPlaceholder')}
                className="h-11 sm:h-9"
              />
              <p className="text-xs text-muted-foreground">
                {t('fasting.plan.customHint', { min: FAST_MIN_CUSTOM_HOURS, max: FAST_MAX_CUSTOM_HOURS })}
              </p>
              <FieldError id={fields.routineCustomHours.errorId} errors={fields.routineCustomHours.errors} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={fields.routineStartMinute.id}>{t('settings.fasting.startTime.label')}</Label>
            <Input {...getInputProps(fields.routineStartMinute, { type: 'time' })} className="h-11 w-40 sm:h-9" />
            <p className="text-xs text-muted-foreground">{t('settings.fasting.startTime.help')}</p>
            <FieldError id={fields.routineStartMinute.errorId} errors={fields.routineStartMinute.errors} />
          </div>

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSaving} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {t('settings.fasting.save')}
          </SubmitButton>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

/**
 * The 24 h+ care note's acknowledgement, read-only apart from one button.
 *
 * It is a fact ABOUT a note rather than the note itself, so this card never
 * repeats the note's own words (DESIGN.md section 10.7, one phrasing per idea).
 * Its own form, not a field on the routine form: this writes the fourth field
 * of the record, and a person who wants the note back has not necessarily
 * changed their window.
 */
export function FastingCareCard({ settings }: { settings: LocalFastingSettings }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  const hasAcknowledged = settings.extendedAcknowledgedAt !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.fasting.care.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {hasAcknowledged ? t('settings.fasting.care.acknowledged') : t('settings.fasting.care.pending')}
        </p>
        {hasAcknowledged && (
          <fetcher.Form method="post">
            <input type="hidden" name="_intent" value={INTENT.RESET_CARE} />
            <Button type="submit" variant="outline" disabled={isSaving} className="h-11 sm:h-9">
              {t('settings.fasting.care.reset')}
            </Button>
          </fetcher.Form>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsFasting({ loaderData }: Route.ComponentProps) {
  const { settings } = loaderData;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* KEYED off the stored record, for the same reason the life-phase card
          is: the chips are seeded once from the store, so only a remount can
          show what a save just wrote. */}
      <FastingRoutineCard key={settings.updatedAt} settings={settings} />
      <FastingCareCard settings={settings} />
    </div>
  );
}
