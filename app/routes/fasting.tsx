/**
 * Fasting (M132), the timer screen.
 *
 * One card at the top, in whichever of three states applies: PLAN (no fast),
 * SCHEDULED (a start instant still ahead) or ACTIVE (running). That card is
 * this screen's single `.surface-brand` hero (DESIGN.md §2, one hero per
 * screen); the history card below is plain `bg-card`, and the just-ended
 * summary is a LINE inside the plan card rather than a card of its own, which
 * is what keeps the one-hero invariant trivially true in every state.
 *
 * ELAPSED IS THE PRIMARY FIGURE, remaining is tier 2, the inverse of the
 * diary hero, deliberately. A carb ceiling is a budget you spend down; a fast
 * is an achievement you build up, and "7h 48m still owed" turns it into a debt
 * (DESIGN.md §10.1). See `app/models/fasting.ts`'s header. Do not harmonise
 * the two.
 *
 * Nothing here computes status in the loader: a status resolved in
 * `clientLoader` is already stale by first paint. The loader returns raw rows
 * and every derived figure comes from `resolveFastTimeline(fast, nowMs)` in the
 * component, with `nowMs` from a 1 s tick (`useNow`). That is also why a
 * scheduled fast auto-activates with no job, no notification and no write ,
 * time alone is the trigger.
 */
import type { ReactElement } from 'react';
import type { Route } from './+types/fasting';
import { useEffect, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Trash2 } from 'lucide-react';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { formatClockTime } from '#app/lib/format-clock-time';
import { formatDayLabel } from '#app/lib/format-day-label';
import { trackFastEnded, trackFastStarted } from '#app/lib/matomo-events';
import { todayInTimezone } from '#app/lib/user-days';
import { cn } from '#app/lib/utils';
import {
  createLocalFast,
  deleteLocalFast,
  endLocalFast,
  FastConflictError,
  FastNoteTooLongError,
  getLocalBodyMetrics,
  getLocalFastingSettings,
  getLocalProfileGoals,
  listLocalFasts,
  putLocalFastingSettings,
  resolveLocalTimezone,
  setLocalFastPlannedStart,
  setLocalFastStart,
} from '#app/lib/local-store';
import type { FastProtocolId, LocalFast, LocalFastingSettings, ReproductiveStatus } from '#app/lib/local-store';
import {
  customHoursToMs,
  defaultPlannedStartLocal,
  FAST_MAX_BACKDATE_MS,
  FAST_MAX_SCHEDULE_AHEAD_MS,
  FAST_MIN_CUSTOM_HOURS,
  FAST_NOTE_MAX_LENGTH,
  fastTargetLabel,
  formatFastClock,
  formatFastDuration,
  formatFastOvertime,
  parseLocalDateTimeInput,
  protocolTargetMs,
  resolveFastTimeline,
  selectCurrentFast,
  selectFastHistory,
  selectRecentlyEndedFast,
  toLocalDateTimeInputValue,
  validateStartInstant,
} from '#app/models/fasting';
import type { FastTimeline, PlannedStartProblem, Translate } from '#app/models/fasting';
import {
  isAllowedCustomHours,
  isCareStatus,
  maxCustomHoursForStatus,
  needsCareSheet,
  nextRoutineOccurrenceMs,
  presetsForStatus,
  protocolLabelKey,
} from '#app/models/fasting-care';
import { selectFastingStats } from '#app/models/fasting-stats';
import { useNow } from '#app/hooks/use-now';
import { ConfirmAction } from '#app/components/confirm-action';
import { FieldError } from '#app/components/field-error';
import { CareSheet, PregnancyNotice } from '#app/components/fasting/care-notice';
import { fastingChipClass } from '#app/components/fasting/chip-class';
import { EndFastSheet, endLabelKey } from '#app/components/fasting/end-fast-sheet';
import type { EndFastReflection } from '#app/components/fasting/end-fast-sheet';
import { FastingStatsRow } from '#app/components/fasting/fasting-stats-row';
import { StageLines, StageList } from '#app/components/fasting/stage-panel';
import { PulseFastingLineSlot } from '#app/components/pulse-fasting-line';
import { RingProgress } from '#app/components/ring-progress';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { SectionEyebrow } from '#app/components/typography';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import i18n from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.fasting') }];

export const handle = {
  // No `backTo`: `/fasting` is a top-level catalog destination like `/trends`.
  title: 'Fasting',
  titleKey: 'fasting.title',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** The countdown renders seconds, so the clock is re-read every second. */
const FAST_TICK_MS = 1_000;
/** How often a visible tab re-reads the store, so a fast ended elsewhere lands here. */
const FAST_REVALIDATE_POLL_MS = 15_000;
/** Rows shown in the history list, matching the goals page's recent-weigh-ins cap. */
const HISTORY_DISPLAY_LIMIT = 30;

/** Form intents multiplexed onto the single client action. */
const INTENT = {
  START: 'start',
  CANCEL_PLAN: 'cancel-plan',
  ADJUST_START: 'adjust-start',
  ADJUST_PLANNED: 'adjust-planned',
  END: 'end',
  DELETE: 'delete',
  ACKNOWLEDGE_CARE: 'acknowledge-care',
} as const;

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx`, only the server render uses a clone).
 */
const actionT: Translate = (key, params) => i18n.t(key, params ?? {});

/** One message per bound violation, one map, rather than branches inlined into each schema. */
const START_PROBLEM_MESSAGE = {
  'too-far-back': (t: Translate) => t('fasting.errors.startTooFarBack'),
  'too-far-ahead': (t: Translate) => t('fasting.errors.startTooFarAhead'),
  'in-future': (t: Translate) => t('fasting.errors.startInFuture'),
} satisfies Record<PlannedStartProblem, (t: Translate) => string>;

//////////////////////////////////////////////////////////////////////////////
// Schemas (built per-call against the active language, like `makeGoalsSchema`)
//////////////////////////////////////////////////////////////////////////////

/**
 * The message a chosen start instant earns, or null when it is acceptable.
 * Returns a string rather than pushing onto a zod `ctx` so both schemas below
 * share one implementation without either of them owning the other's path.
 */
function startInstantMessage(
  value: string | undefined,
  { t, nowMs, allowFuture }: { t: Translate; nowMs: number; allowFuture: boolean },
): string | null {
  const at = parseLocalDateTimeInput(value ?? '');
  if (at === null) return t('fasting.errors.startUnreadable');
  const problem = validateStartInstant(at, { nowMs, allowFuture });
  return problem === null ? null : START_PROBLEM_MESSAGE[problem](t);
}

/**
 * The start schema. `reproductiveStatus` is a PARAMETER rather than something
 * read inside, because the same ceiling has to hold in two places that never
 * see each other: the browser's optimistic Conform pass and `_startFast`. A
 * cap enforced only in the component is a cap a second tab walks straight
 * past.
 */
function makeStartFastSchema(t: Translate, nowMs: number, status: ReproductiveStatus) {
  return z
    .object({
      protocolId: z.enum(['16:8', '18:6', '20:4', '24h', '36h', '48h', '72h', 'custom']),
      customHours: z.string().optional(),
      startMode: z.enum(['now', 'later']),
      plannedStartLocal: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.protocolId === 'custom') {
        const hours = Number((value.customHours ?? '').trim());
        if (!isAllowedCustomHours(hours, status)) {
          ctx.addIssue({
            code: 'custom',
            path: ['customHours'],
            message: t('fasting.errors.customHours', {
              min: FAST_MIN_CUSTOM_HOURS,
              max: maxCustomHoursForStatus(status),
            }),
          });
        }
      }
      if (value.startMode !== 'later') return;
      const message = startInstantMessage(value.plannedStartLocal, { t, nowMs, allowFuture: true });
      if (message !== null) ctx.addIssue({ code: 'custom', path: ['plannedStartLocal'], message });
    });
}

/** Shared by both adjust forms. `allowFuture` is the only difference. */
function makeStartInstantSchema(t: Translate, { nowMs, allowFuture }: { nowMs: number; allowFuture: boolean }) {
  return z.object({ startLocal: z.string() }).superRefine((value, ctx) => {
    const message = startInstantMessage(value.startLocal, { t, nowMs, allowFuture });
    if (message !== null) ctx.addIssue({ code: 'custom', path: ['startLocal'], message });
  });
}

//////////////////////////////////////////////////////////////////////////////
// Server loader, none needed (this route's data is entirely on-device)
//////////////////////////////////////////////////////////////////////////////

/** No server work. Present so an offline client-side navigation resolves without a `.data` fetch. */
export async function loader() {
  return {};
}

//////////////////////////////////////////////////////////////////////////////
// Client loader
//////////////////////////////////////////////////////////////////////////////

export interface FastingData {
  /**
   * The RAW rows, in store order. No status, no elapsed, no remaining: a figure
   * computed here would already be stale by first paint.
   */
  fasts: LocalFast[];
  /**
   * The resolved profile time zone, used ONLY for the day/clock labels in
   * history and on the scheduled card, exactly as the rest of the app labels
   * instants. The `datetime-local` INPUTS deliberately do not use it (see
   * `parseLocalDateTimeInput`, the widget must mean what it displays).
   */
  timezone: string;
  /**
   * The routine and the one-time care acknowledgement. A SETTING, not a
   * derivation, so it is read here rather than resolved per render: the plan
   * card preselects from it and the care gate reads it once per start.
   */
  fastingSettings: LocalFastingSettings;
  /**
   * The profile's reproductive status, `'none'` when it was never answered.
   * It decides the notice above the plan card and the preset ceiling, and it
   * never decides whether a fast may start.
   */
  reproductiveStatus: ReproductiveStatus;
}

export async function clientLoader(): Promise<FastingData> {
  const [fasts, profile, fastingSettings, bodyMetrics] = await Promise.all([
    listLocalFasts(),
    getLocalProfileGoals(),
    getLocalFastingSettings(),
    getLocalBodyMetrics(),
  ]);

  return {
    fasts,
    timezone: resolveLocalTimezone(profile),
    fastingSettings,
    reproductiveStatus: bodyMetrics.reproductiveStatus ?? 'none',
  };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the fasts from the on-device primary store. */
export function HydrateFallback(): ReactElement {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('fasting.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store writes, no server round-trip)
//////////////////////////////////////////////////////////////////////////////

/** The one place a form's `fastId` becomes a usable id. Fail fast, a blank id is a bug, not a no-op. */
function requireFastId(formData: FormData): string {
  const id = z
    .string()
    .refine((value) => value.trim() !== '')
    .safeParse(formData.get('fastId'));
  if (!id.success) throw new Response('Invalid fast id', { status: 400 });
  return id.data;
}

/** The authoritative target length for a submitted protocol choice. */
function resolveTargetMs(protocolId: FastProtocolId, customHours: string | undefined): number {
  if (protocolId === 'custom') return customHoursToMs(Number((customHours ?? '').trim()));
  const preset = protocolTargetMs(protocolId);
  if (preset === null) throw new Error(`No target duration for protocol ${protocolId}.`);
  return preset;
}

/** The profile's status, read fresh on every write path that has to respect the cap. */
async function readReproductiveStatus(): Promise<ReproductiveStatus> {
  return (await getLocalBodyMetrics()).reproductiveStatus ?? 'none';
}

async function _startFast(formData: FormData) {
  const nowMs = Date.now();
  const submission = parseWithZod(formData, {
    schema: makeStartFastSchema(actionT, nowMs, await readReproductiveStatus()),
  });
  if (submission.status !== 'success') return submission.reply();
  const value = submission.value;

  const startsNow = value.startMode === 'now';
  // A backdated `plannedStartAt` needs no special handling: the model reads it
  // as already-passed and the fast is active on first render.
  const plannedStartAt = startsNow ? null : parseLocalDateTimeInput(value.plannedStartLocal ?? '');

  try {
    await createLocalFast({
      protocolId: value.protocolId,
      targetDurationMs: resolveTargetMs(value.protocolId, value.customHours),
      plannedStartAt,
      startedAt: startsNow ? nowMs : null,
    });
  } catch (error) {
    // The ONLY way to see this is a double submit or a second tab, and nothing
    // is broken when it happens, so it is a neutral message, not an error.
    if (error instanceof FastConflictError) {
      return redirectWithLocalToast('/fasting', {
        type: 'message',
        description: actionT('fasting.errors.alreadyRunning'),
      });
    }
    throw error;
  }

  const isScheduled = plannedStartAt !== null && plannedStartAt > nowMs;
  // The same flag the toast reads, not the submitted `startMode`: a BACKDATED
  // `later` start is already running, so it is a 'now' fast, not a scheduled one.
  trackFastStarted(isScheduled ? 'scheduled' : 'now');
  return redirectWithLocalToast('/fasting', {
    type: 'success',
    description: actionT(isScheduled ? 'fasting.toast.scheduled' : 'fasting.toast.started'),
  });
}

async function _cancelPlan(formData: FormData) {
  // A plan you never started is not a fast you did, so the row is DELETED
  // rather than kept as a `cancelled` entry, a history list logging every plan
  // you backed out of is a shame ledger (DESIGN.md §10.1).
  await deleteLocalFast(requireFastId(formData));
  return redirectWithLocalToast('/fasting', {
    type: 'success',
    description: actionT('fasting.toast.planCancelled'),
  });
}

async function _adjustStart(formData: FormData, { allowFuture }: { allowFuture: boolean }) {
  const nowMs = Date.now();
  const submission = parseWithZod(formData, {
    schema: makeStartInstantSchema(actionT, { nowMs, allowFuture }),
  });
  if (submission.status !== 'success') return submission.reply();
  const at = parseLocalDateTimeInput(submission.value.startLocal);
  if (at === null) return submission.reply();

  const id = requireFastId(formData);
  if (allowFuture) await setLocalFastPlannedStart(id, { plannedStartAt: at });
  else await setLocalFastStart(id, { startedAt: at });

  return redirectWithLocalToast('/fasting', {
    type: 'success',
    description: actionT('fasting.toast.startAdjusted'),
  });
}

/**
 * The reflection the end sheet submitted. Both answers are optional, and an
 * unanswered one is `null` rather than absent: this is the END path, where
 * there is nothing stored to preserve, so "nothing was said" and "it was
 * cleared" are the same fact.
 */
function readReflection(formData: FormData): EndFastReflection {
  const mood = z.enum(['rough', 'ok', 'good']).safeParse(formData.get('mood'));
  const note = z.string().trim().min(1).safeParse(formData.get('note'));
  return { mood: mood.success ? mood.data : null, note: note.success ? note.data : null };
}

async function _endFast(formData: FormData) {
  const id = requireFastId(formData);
  const endedAt = Date.now();
  const { mood, note } = readReflection(formData);

  let ended: LocalFast;
  try {
    ended = await endLocalFast(id, { endedAt, mood, note });
  } catch (error) {
    // The sheet already caps the field at `FAST_NOTE_MAX_LENGTH`, so this is
    // the paste-past-the-cap and the second-tab case. REFUSED, never
    // truncated: the fast stays running and the person keeps their words.
    if (error instanceof FastNoteTooLongError) {
      return {
        status: 'error',
        error: { note: [actionT('fasting.errors.noteTooLong', { max: FAST_NOTE_MAX_LENGTH })] },
      } satisfies SubmissionResult<string[]>;
    }
    throw error;
  }
  trackFastEnded();
  return redirectWithLocalToast('/fasting', {
    type: 'success',
    description: actionT('fasting.toast.ended', {
      achieved: formatFastDuration(resolveFastTimeline(ended, endedAt).elapsedMs, actionT),
    }),
  });
}

/**
 * Records that the long-fast sheet was seen. ONCE PER PERSON: the instant
 * rides the synced settings record, so a second device does not ask again.
 * It returns nothing, the start it precedes is a submission of its own and
 * owns the toast.
 */
async function _acknowledgeCare() {
  await putLocalFastingSettings({ extendedAcknowledgedAt: Date.now() });
  return {};
}

async function _deleteFast(formData: FormData) {
  await deleteLocalFast(requireFastId(formData));
  return redirectWithLocalToast('/fasting', { type: 'success', description: actionT('fasting.toast.deleted') });
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  if (intent === INTENT.CANCEL_PLAN) return _cancelPlan(formData);
  if (intent === INTENT.ADJUST_START) return _adjustStart(formData, { allowFuture: false });
  if (intent === INTENT.ADJUST_PLANNED) return _adjustStart(formData, { allowFuture: true });
  if (intent === INTENT.END) return _endFast(formData);
  if (intent === INTENT.DELETE) return _deleteFast(formData);
  if (intent === INTENT.ACKNOWLEDGE_CARE) return _acknowledgeCare();
  return _startFast(formData);
}

//////////////////////////////////////////////////////////////////////////////
// Live data plumbing
//////////////////////////////////////////////////////////////////////////////

/**
 * Cross-tab convergence, the same shape `useLiveDiaryRevalidation` has in
 * `diary.tsx`: the 1 s tick re-renders `now` but never re-READS the store, so
 * a fast ended on the laptop would leave the phone tab counting forever.
 * Copied rather than shared, extracting the diary's version is a refactor of a
 * shipped route and belongs in its own round.
 */
function useLiveFastRevalidation(): void {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (globalThis.document === undefined) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (revalidator.state === 'idle') revalidator.revalidate();
      }, FAST_REVALIDATE_POLL_MS);
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

//////////////////////////////////////////////////////////////////////////////
// Shared bits
//////////////////////////////////////////////////////////////////////////////

/** Day label + wall-clock time for an instant, "Sat 12 Jul 20:00". */
function formatFastMoment(atMs: number, { timezone, language }: { timezone: string; language: string }): string {
  const dayKey = todayInTimezone(timezone, new Date(atMs));
  return `${formatDayLabel(dayKey, language)} ${formatClockTime(atMs, { timezone, language })}`;
}

/** The one brand-filled card on this screen, whichever state it is in. */
function HeroCard({ children }: { children: ReactElement }): ReactElement {
  return (
    <Card className="surface-brand overflow-hidden rounded-2xl border-primary/30 shadow-md">
      <CardContent className="space-y-5 p-5 sm:p-6">{children}</CardContent>
    </Card>
  );
}

/**
 * The disclosure that changes a start instant, shared by the scheduled card
 * (`allowFuture`) and the active card (past-only). A text button reveals a
 * one-field form; nothing is a `<details>`, so the open state is ordinary React
 * state and the form can submit through a fetcher.
 *
 * `inlinePrefix` is the active card's "Started 20:04" (DESIGN.md §3.4): the
 * sentence and the trigger are ONE line, `Started 20:04 · Adjust`, rather than
 * two stacked blocks. It lives here rather than as a sibling because only the
 * closed state has a line to share, once the form is open the seeded field
 * says the same thing, and a dangling "·" would be left behind.
 */
function AdjustStartInline({
  fast,
  intent,
  allowFuture,
  linkLabel,
  fieldLabel,
  saveLabel,
  seededValue,
  inlinePrefix,
}: {
  fast: LocalFast;
  intent: string;
  allowFuture: boolean;
  linkLabel: string;
  fieldLabel: string;
  saveLabel: string;
  seededValue: string;
  inlinePrefix?: string;
}): ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const [isOpen, setIsOpen] = useState(false);
  const isSaving = fetcher.state !== 'idle';

  const [form, fields] = useForm({
    id: `adjust-${fast.id}`,
    // SAFETY: `fetcher.data` is this route's own `clientAction` return value,
    // and every branch of it returns `parseWithZod(...).reply()`, Conform's
    // submission result for string[] errors, or nothing at all.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeStartInstantSchema(t, { nowMs: Date.now(), allowFuture }) });
    },
    // Same reasoning as `PlanFastCard`: `shouldValidate` stays at Conform's
    // `onSubmit` default so nothing is red before the first submit, but
    // REVALIDATION is `onInput` so a corrected instant clears its own error as
    // it is picked. Left at the default (`shouldRevalidate` falls back to
    // `shouldValidate`), a reported error would sit under the field ,
    // `aria-invalid` and all, until the NEXT submit.
    shouldRevalidate: 'onInput',
    defaultValue: { startLocal: seededValue },
  });

  // `min`/`max` seed the NATIVE picker with the same bounds the schema
  // enforces, so the widget helps before an error message has to.
  const nowMs = Date.now();
  const min = toLocalDateTimeInputValue(nowMs - FAST_MAX_BACKDATE_MS);
  const max = toLocalDateTimeInputValue(allowFuture ? nowMs + FAST_MAX_SCHEDULE_AHEAD_MS : nowMs);

  if (!isOpen) {
    return (
      <p className="flex flex-wrap items-baseline gap-1 text-sm text-muted-foreground">
        {inlinePrefix !== undefined && (
          <>
            <span>{inlinePrefix}</span>
            {/* Decorative: the separator carries no meaning a screen reader needs. */}
            <span aria-hidden="true">·</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {linkLabel}
        </button>
      </p>
    );
  }

  return (
    <fetcher.Form method="post" {...getFormProps(form)} className="space-y-2">
      <input type="hidden" name="_intent" value={intent} />
      <input type="hidden" name="fastId" value={fast.id} />
      <Label htmlFor={fields.startLocal.id}>{fieldLabel}</Label>
      {/*
        Conform owns this field end to end, `getInputProps` supplies the id,
        the name, the seeded `defaultValue` (from the `defaultValue` above) and
        the `aria-invalid`/`aria-describedby` pair from the SAME metadata
        `FieldError` reads. `min`/`max` come after the spread so the native
        picker still carries the bounds the schema enforces.
      */}
      <Input
        {...getInputProps(fields.startLocal, { type: 'datetime-local' })}
        min={min}
        max={max}
        className="h-11 sm:h-9"
      />
      <FieldError id={fields.startLocal.errorId} errors={fields.startLocal.errors} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={isSaving} pendingLabel={t('fasting.plan.saving')} className="h-11 sm:h-9">
          {saveLabel}
        </SubmitButton>
        <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setIsOpen(false)}>
          {t('confirm.cancel')}
        </Button>
      </div>
    </fetcher.Form>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Idle, the plan card
//////////////////////////////////////////////////////////////////////////////

/**
 * The one-line report on a fast that just ended. No pulse, no badge, no colour
 * change: someone on 16:8 completes a fast DAILY, and DESIGN.md §7 rules that
 * anything which could fire weekly is not a celebration. It disappears on its
 * own once the summary window closes, because the 1 s tick re-evaluates
 * `selectRecentlyEndedFast`, no timer, no dismiss button, no state.
 *
 * `onScheduleNext` is the one thing on it that acts. It appears only when a
 * routine start minute exists, because "schedule the next one" needs an hour
 * the person already named; inventing 20:00 for somebody who never said so
 * would be the app deciding their evening.
 */
function FastSummaryLine({
  fast,
  nowMs,
  scheduleNextLabel,
  onScheduleNext,
}: {
  fast: LocalFast;
  nowMs: number;
  scheduleNextLabel: string | null;
  onScheduleNext: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const timeline = resolveFastTimeline(fast, nowMs);
  const achieved = formatFastDuration(timeline.elapsedMs, t);
  const target = fastTargetLabel(fast, t);

  return (
    <div className="space-y-1">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{t('fasting.summary.line', { achieved })}</span>{' '}
        <span className="text-muted-foreground">
          {timeline.status === 'completed' ?
            t('fasting.summary.metTarget', { target })
          : t('fasting.summary.targetWas', { target })}
        </span>
      </p>
      {scheduleNextLabel !== null && (
        <p>
          <button
            type="button"
            onClick={onScheduleNext}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {scheduleNextLabel}
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The protocol the picker opens on: the person's routine when they have one
 * and it is still offered, otherwise the conventional 16:8.
 *
 * The second condition is the care case. A routine of 48 h on a profile that
 * now says pregnant would otherwise preselect a chip that is not on the row,
 * leaving the picker with nothing lit and a hidden value about to be
 * submitted.
 */
function initialProtocolId(settings: LocalFastingSettings, status: ReproductiveStatus): FastProtocolId {
  const routine = settings.routineProtocolId;
  if (routine === null) return '16:8';
  if (routine === 'custom') return 'custom';
  return presetsForStatus(status).some((protocol) => protocol.id === routine) ? routine : '16:8';
}

function PlanFastCard({
  recentlyEnded,
  nowMs,
  timezone,
  fastingSettings,
  reproductiveStatus,
}: {
  recentlyEnded: LocalFast | null;
  nowMs: number;
  timezone: string;
  fastingSettings: LocalFastingSettings;
  reproductiveStatus: ReproductiveStatus;
}): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  // A fetcher OF ITS OWN for the acknowledgement: it writes a setting and
  // returns nothing, while the start beside it redirects with a toast. One
  // fetcher would make the second submission cancel the first.
  const careFetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';

  const [protocolId, setProtocolId] = useState<FastProtocolId>(() =>
    initialProtocolId(fastingSettings, reproductiveStatus),
  );
  const [startMode, setStartMode] = useState<'now' | 'later'>('now');
  // Seeded ONCE in a lazy initialiser. Recomputing it on every tick would
  // retype the field out from under the person once a second.
  const [plannedStartLocal, setPlannedStartLocal] = useState<string>(() => defaultPlannedStartLocal(Date.now()));
  const [isCareOpen, setIsCareOpen] = useState(false);
  // The start the care sheet interrupted, held until the sheet is answered.
  // A ref rather than state: nothing renders from it, and putting a FormData
  // in state would re-render the card for a value nobody looks at.
  const pendingStartRef = useRef<FormData | null>(null);
  // The custom-hours field only exists once its chip is chosen, so moving focus
  // there answers that click, it is not the unprompted, page-load focus steal
  // `autoFocus` would be.
  const customHoursRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (protocolId === 'custom') customHoursRef.current?.focus();
  }, [protocolId]);

  const presets = presetsForStatus(reproductiveStatus);
  const maxCustomHours = maxCustomHoursForStatus(reproductiveStatus);
  const routineStartMinute = fastingSettings.routineStartMinute;

  const [form, fields] = useForm({
    id: 'start-fast',
    // SAFETY: as above, `fetcher.data` is this route's own `clientAction`
    // result, which is always a `parseWithZod(...).reply()` or nothing.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeStartFastSchema(t, Date.now(), reproductiveStatus) });
    },
    // `shouldValidate` stays at Conform's `onSubmit` default (as on
    // `settings.goals.tsx`), nothing is red until you ask for it. But
    // REVALIDATION is `onInput`, which is what makes a corrected custom-hours
    // value clear its own error as it is typed. Left at the default, an
    // already-reported error would sit under the field, `aria-invalid` and all,
    // until the NEXT submit.
    shouldRevalidate: 'onInput',
    // Read once, on the first render, purely so Conform knows the field set.
    // `customHours` is Conform's own uncontrolled field (see below); the other
    // three are mirrored from React state. The routine's own hour count seeds
    // it, so a person whose routine IS a custom length does not retype it.
    defaultValue: {
      protocolId,
      customHours: fastingSettings.routineCustomHours === null ? '' : String(fastingSettings.routineCustomHours),
      startMode,
      plannedStartLocal,
    },
  });

  /** The submission the three start affordances all build, so they cannot diverge. */
  const buildStartFormData = (plannedStartOverride: string | null): FormData => {
    const data = new FormData();
    data.set('_intent', INTENT.START);
    data.set(fields.protocolId.name, protocolId);
    data.set(fields.customHours.name, customHoursRef.current?.value ?? '');
    data.set(fields.startMode.name, plannedStartOverride === null ? startMode : 'later');
    data.set(fields.plannedStartLocal.name, plannedStartOverride ?? plannedStartLocal);
    return data;
  };

  /** The care decision for a built submission. NaN custom hours read as "no sheet", the schema refuses them instead. */
  const isCareSheetDue = (data: FormData): boolean => {
    const submitted = z.string().safeParse(data.get(fields.customHours.name));
    return needsCareSheet({
      targetMs: resolveTargetMs(protocolId, submitted.success ? submitted.data : ''),
      extendedAcknowledgedAt: fastingSettings.extendedAcknowledgedAt,
    });
  };

  /** Starts, or opens the care sheet first and starts once it is answered. */
  const startWithCare = (plannedStartOverride: string | null) => {
    const data = buildStartFormData(plannedStartOverride);
    if (isCareSheetDue(data)) {
      pendingStartRef.current = data;
      setIsCareOpen(true);
      return;
    }
    void fetcher.submit(data, { method: 'post' });
  };

  const acknowledgeAndStart = () => {
    void careFetcher.submit({ _intent: INTENT.ACKNOWLEDGE_CARE }, { method: 'post' });
    setIsCareOpen(false);
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    if (pending !== null) void fetcher.submit(pending, { method: 'post' });
  };

  const routineOccurrenceMs =
    routineStartMinute === null ? null : nextRoutineOccurrenceMs({ nowMs, routineStartMinute });
  const routineTime =
    routineOccurrenceMs === null ? null : (
      formatClockTime(routineOccurrenceMs, { timezone, language: i18next.language })
    );

  const parsedStart = parseLocalDateTimeInput(plannedStartLocal);
  // Three-way and DERIVED, never stateful. The backdated label is the whole
  // affordance for starting from a past time: it says what the button will do
  // before the person commits, so an already-running fast is never a surprise.
  const submitLabel =
    startMode === 'now' ? t('fasting.plan.submitNow')
    : parsedStart !== null && parsedStart <= Date.now() ? t('fasting.plan.submitBackdated')
    : t('fasting.plan.submitScheduled');

  const bounds = {
    min: toLocalDateTimeInputValue(Date.now() - FAST_MAX_BACKDATE_MS),
    max: toLocalDateTimeInputValue(Date.now() + FAST_MAX_SCHEDULE_AHEAD_MS),
  };

  return (
    // The sheet is a SIBLING of the hero rather than a child of it: `HeroCard`
    // takes one element, and a Radix portal has no business rendering from
    // inside the card's padding either way.
    <>
      <HeroCard>
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-5">
          <input type="hidden" name="_intent" value={INTENT.START} />
          <input type="hidden" name={fields.protocolId.name} value={protocolId} />
          <input type="hidden" name={fields.startMode.name} value={startMode} />

          <div className="space-y-1.5">
            <SectionEyebrow>{t('fasting.plan.eyebrow')}</SectionEyebrow>
            <CardTitle>{t('fasting.plan.title')}</CardTitle>
          </div>

          {recentlyEnded !== null && (
            <FastSummaryLine
              fast={recentlyEnded}
              nowMs={nowMs}
              scheduleNextLabel={routineTime === null ? null : t('fasting.summary.scheduleNext', { time: routineTime })}
              onScheduleNext={() => {
                if (routineOccurrenceMs === null) return;
                startWithCare(toLocalDateTimeInputValue(routineOccurrenceMs));
              }}
            />
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('fasting.plan.description')}</p>
            <fieldset className="flex flex-wrap gap-2" aria-label={t('fasting.plan.protocolGroup')}>
              {presets.map((protocol) => (
                <button
                  key={protocol.id}
                  type="button"
                  aria-pressed={protocolId === protocol.id}
                  // The visible "16:8" would otherwise be read out as a time.
                  // A long fast names no eating window, so it gets the plain
                  // hour count rather than an invented "0 hours eating".
                  aria-label={
                    protocol.daily ?
                      t('fasting.plan.protocolAria', {
                        fastingHours: protocol.fastingHours,
                        eatingHours: protocol.eatingHours,
                      })
                    : t('fasting.stages.fromHours', { hours: protocol.fastingHours })
                  }
                  onClick={() => setProtocolId(protocol.id)}
                  className={fastingChipClass(protocolId === protocol.id)}
                >
                  {/*
                  `nsSeparator: false` is load-bearing: three of the seven ids
                  contain a colon, which i18next otherwise reads as the
                  namespace separator and resolves against a namespace called
                  `fasting.plan.protocol.16`.
                */}
                  {t(protocolLabelKey(protocol.id), { nsSeparator: false })}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={protocolId === 'custom'}
                onClick={() => setProtocolId('custom')}
                className={fastingChipClass(protocolId === 'custom')}
              >
                {t('fasting.plan.custom')}
              </button>
            </fieldset>
          </div>

          {protocolId === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor={fields.customHours.id}>{t('fasting.plan.customLabel')}</Label>
              {/*
              Conform owns this field end to end, `getInputProps` supplies the
              name, the `defaultValue` and the `aria-invalid`/`aria-describedby`
              pair from the SAME metadata `FieldError` reads. Bound to local
              React state instead (the shape this had), the input kept its own
              value while Conform kept the error, so a corrected value still
              rendered red until the next submit.
            */}
              <Input
                {...getInputProps(fields.customHours, { type: 'text' })}
                ref={customHoursRef}
                inputMode="numeric"
                placeholder={t('fasting.plan.customPlaceholder')}
                className="h-11 sm:h-9"
              />
              <p className="text-xs text-muted-foreground">
                {t('fasting.plan.customHint', { min: FAST_MIN_CUSTOM_HOURS, max: maxCustomHours })}
              </p>
              <FieldError id={fields.customHours.errorId} errors={fields.customHours.errors} />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('fasting.plan.startModeLabel')}</p>
            <fieldset
              className="inline-flex shrink-0 rounded-full border p-0.5 text-xs font-medium"
              aria-label={t('fasting.plan.startModeLabel')}
            >
              {(['now', 'later'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={startMode === mode}
                  onClick={() => setStartMode(mode)}
                  className={cn(
                    'min-h-8 min-w-11 rounded-full px-3 py-1 transition-colors',
                    startMode === mode ?
                      'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'now' ? t('fasting.plan.startNow') : t('fasting.plan.startLater')}
                </button>
              ))}
            </fieldset>
          </div>

          {startMode === 'later' && (
            <div className="space-y-2">
              <Label htmlFor={fields.plannedStartLocal.id}>{t('fasting.plan.plannedStartLabel')}</Label>
              <Input
                id={fields.plannedStartLocal.id}
                name={fields.plannedStartLocal.name}
                type="datetime-local"
                value={plannedStartLocal}
                onChange={(event) => setPlannedStartLocal(event.target.value)}
                min={bounds.min}
                max={bounds.max}
                aria-describedby={fields.plannedStartLocal.errorId}
                aria-invalid={fields.plannedStartLocal.errors?.length ? true : undefined}
                className="h-11 sm:h-9"
              />
              <FieldError id={fields.plannedStartLocal.errorId} errors={fields.plannedStartLocal.errors} />
            </div>
          )}

          <FieldError id={form.errorId} errors={form.errors} />

          <div className="flex flex-wrap gap-2">
            <SubmitButton
              pending={isSaving}
              pendingLabel={t('fasting.plan.saving')}
              className="h-11 w-full sm:h-9 sm:w-auto"
              // The care sheet REPLACES this submit rather than following it:
              // the fast must not start behind a sheet the person has not read.
              // `buildStartFormData` reproduces what the native submit would
              // send, so the two paths can never send different things.
              onClick={(event) => {
                const data = buildStartFormData(null);
                if (!isCareSheetDue(data)) return;
                event.preventDefault();
                pendingStartRef.current = data;
                setIsCareOpen(true);
              }}
            >
              {submitLabel}
            </SubmitButton>

            {routineTime !== null && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={isSaving}
                onClick={() => {
                  if (routineOccurrenceMs === null) return;
                  startWithCare(toLocalDateTimeInputValue(routineOccurrenceMs));
                }}
              >
                {t('fasting.plan.startAtRoutine', { time: routineTime })}
              </Button>
            )}
          </div>

          {/* Said once, in the whole app (DESIGN.md §10.2 meets §10.7). Not an
            Alert, not a dialog, one quiet line. */}
          <p className="text-xs text-muted-foreground">{t('fasting.plan.honesty')}</p>
        </fetcher.Form>
      </HeroCard>

      <CareSheet
        isOpen={isCareOpen}
        // A DISMISS drops the pending start and records nothing: backing out
        // of the sheet is not an acknowledgement, and it must not leave a fast
        // running that the person never confirmed.
        onOpenChange={(open) => {
          setIsCareOpen(open);
          if (!open) pendingStartRef.current = null;
        }}
        onUnderstood={acknowledgeAndStart}
      />
    </>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Scheduled
//////////////////////////////////////////////////////////////////////////////

function ScheduledFastCard({
  fast,
  timeline,
  timezone,
}: {
  fast: LocalFast;
  timeline: FastTimeline;
  timezone: string;
}): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const when = formatFastMoment(timeline.startAt, { timezone, language: i18next.language });

  return (
    <HeroCard>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SectionEyebrow>{t('fasting.scheduled.eyebrow')}</SectionEyebrow>
          {/*
            No ring here, deliberately: a ring needs an honest denominator, and
            "time until start" has none, inventing one (planned start minus
            created-at) would be exactly the fabricated goal the hero rules
            exist to prevent. A plain figure is the truthful shape.
          */}
          <p className="text-3xl font-semibold tabular-nums tracking-tight">
            {timeline.startsInMs === 0 ?
              t('fasting.scheduled.startsNow')
            : t('fasting.scheduled.startsIn', { duration: formatFastDuration(timeline.startsInMs, t) })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('fasting.scheduled.detail', { protocol: fastTargetLabel(fast, t), when })}
          </p>
        </div>

        <AdjustStartInline
          fast={fast}
          intent={INTENT.ADJUST_PLANNED}
          allowFuture
          linkLabel={t('fasting.scheduled.adjust')}
          fieldLabel={t('fasting.active.adjustLabel')}
          saveLabel={t('fasting.scheduled.adjustSave')}
          seededValue={toLocalDateTimeInputValue(timeline.startAt)}
        />

        <div>
          <ConfirmAction
            trigger={
              <Button variant="ghost" size="sm">
                {t('fasting.scheduled.cancel')}
              </Button>
            }
            title={t('fasting.scheduled.cancelTitle')}
            description={t('fasting.scheduled.cancelBody')}
            confirmText={t('fasting.scheduled.cancel')}
            // NOT destructive: nothing that ever ran is being destroyed, and a
            // red button here would read as "you failed".
            confirmVariant="default"
            formData={{ _intent: INTENT.CANCEL_PLAN, fastId: fast.id }}
          />
        </div>
      </div>
    </HeroCard>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Active
//////////////////////////////////////////////////////////////////////////////

/** The three-tier stack inside the ring, modelled on `HeroStat`. */
function FastClockStat({ timeline, target }: { timeline: FastTimeline; target: string }): ReactElement {
  const { t } = useTranslation();

  return (
    <>
      {/*
        `aria-live="off"`, never `polite`: a live region that changes once a
        second is unusable with a screen reader. The spoken sentence lives on
        the ring's own `label`, at minute resolution.
      */}
      <span
        role="timer"
        aria-live="off"
        className="text-2xl font-semibold leading-none tracking-tight tabular-nums text-foreground sm:text-3xl"
      >
        {formatFastClock(timeline.elapsedMs)}
      </span>
      <span className="mt-1.5 text-xs font-medium leading-none tabular-nums text-muted-foreground">
        {timeline.hasReachedTarget ?
          t('fasting.active.overtime', { duration: formatFastOvertime(timeline.overtimeMs, t), target })
        : t('fasting.active.remaining', { duration: formatFastDuration(timeline.remainingMs, t) })}
      </span>
      {/* Tier 3 is what makes the elapsed-first framing legible: the big number
          is labelled, so nobody has to guess which way it counts. */}
      <span className="mt-1 text-[10px] font-medium uppercase leading-none tracking-[0.1em] text-muted-foreground">
        {t('fasting.active.elapsedLabel')}
      </span>
    </>
  );
}

function ActiveFastCard({
  fast,
  timeline,
  timezone,
}: {
  fast: LocalFast;
  timeline: FastTimeline;
  timezone: string;
}): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const [isEndOpen, setIsEndOpen] = useState(false);
  const elapsed = formatFastDuration(timeline.elapsedMs, t);
  const target = fastTargetLabel(fast, t);

  // SAFETY: `fetcher.data` is this route's own `clientAction` return value,
  // and the END branch either redirects or returns the `SubmissionResult`
  // literal `_endFast` builds for a refused note.
  const endResult = fetcher.data as SubmissionResult<string[]> | undefined;
  const noteErrors = endResult?.error?.note ?? undefined;

  const submitEnd = ({ mood, note }: EndFastReflection) => {
    const data = new FormData();
    data.set('_intent', INTENT.END);
    data.set('fastId', fast.id);
    // An unanswered question is an ABSENT field rather than an empty one, so
    // the action never has to tell "said nothing" from "typed nothing".
    if (mood !== null) data.set('mood', mood);
    if (note !== null) data.set('note', note);
    void fetcher.submit(data, { method: 'post' });
  };

  return (
    <>
      <HeroCard>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
          {/*
          A CLAMPED percentage, deliberately. `RingProgress` reports the raw
          value/max through `aria-valuenow`/`aria-valuemax`, which is right for
          a carb ceiling ("120 of 100") and wrong here: passing a fast's goal is
          not an overrun to report as a number. The arc caps and the spoken
          sentence lives in `label`.
        */}
          <RingProgress
            value={Math.min(timeline.progress, 1) * 100}
            max={100}
            size={220}
            strokeWidth={14}
            className="[--ring-box:180px] sm:[--ring-box:220px]"
            trackClassName="text-primary/20"
            // Never amber: amber means over a ceiling you set as a limit, and a
            // fast target is a floor you are clearing.
            progressClassName="text-primary"
            // MINUTE resolution: the ring re-renders every second, and
            // recomputing a seconds-bearing accessible name that often would
            // churn the accessibility tree for nothing.
            label={t('fasting.active.srLabel', { elapsed, target })}
          >
            <FastClockStat timeline={timeline} target={target} />
          </RingProgress>

          <div className="w-full min-w-0 flex-1 space-y-3">
            <SectionEyebrow>{t('fasting.active.eyebrow')}</SectionEyebrow>
            {timeline.hasReachedTarget && (
              <p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {t('fasting.active.goalReached')}
                </span>
              </p>
            )}
            {/* What is happening right now, under the clock that says how long.
              The hedge travels with it: these hours are population averages,
              not a measurement of this person. */}
            <StageLines
              elapsedMs={timeline.elapsedMs}
              startAtMs={timeline.startAt}
              timezone={timezone}
              language={i18next.language}
            />
            {/* One sentence, and only above the floor of three: the line is
                absent rather than reading "0 others are fasting" (M222 spec
                04). Fetched client-side, so this card renders at the same
                moment it always did. */}
            <PulseFastingLineSlot />
            <AdjustStartInline
              fast={fast}
              intent={INTENT.ADJUST_START}
              allowFuture={false}
              linkLabel={t('fasting.active.adjustStart')}
              fieldLabel={t('fasting.active.adjustLabel')}
              saveLabel={t('fasting.active.adjustSave')}
              seededValue={toLocalDateTimeInputValue(timeline.startAt)}
              inlinePrefix={t('fasting.active.startedAt', {
                time: formatClockTime(timeline.startAt, { timezone, language: i18next.language }),
              })}
            />
            {/*
            ONE button, two words. "Complete" once the target is cleared and
            the plain end label before it: the same act reads as finishing
            something or as stopping it, and the person, not the app, decides
            which. Never a confirm dialog now, the sheet IS the confirmation,
            and it asks something worth asking on the way through.
          */}
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:h-9 sm:w-auto"
              onClick={() => setIsEndOpen(true)}
            >
              {t(endLabelKey(timeline.hasReachedTarget))}
            </Button>
          </div>
        </div>
      </HeroCard>

      <EndFastSheet
        isOpen={isEndOpen}
        onOpenChange={setIsEndOpen}
        isSaving={fetcher.state !== 'idle'}
        noteErrors={noteErrors}
        onConfirm={submitEnd}
      />
    </>
  );
}

//////////////////////////////////////////////////////////////////////////////
// History
//////////////////////////////////////////////////////////////////////////////

function FastHistoryRow({ fast, nowMs, timezone }: { fast: LocalFast; nowMs: number; timezone: string }): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const timeline = resolveFastTimeline(fast, nowMs);
  const when = formatFastMoment(timeline.startAt, { timezone, language: i18next.language });
  const achieved = formatFastDuration(timeline.elapsedMs, t);
  const target = fastTargetLabel(fast, t);
  // Only ever reachable as a restore orphan: `selectCurrentFast` already took
  // the one open fast, so a SECOND open row can only have arrived from a backup.
  const isStillOpen = timeline.status === 'active' || timeline.status === 'scheduled';

  const mood = fast.mood ?? null;
  const note = fast.note ?? null;

  return (
    <div className="border-b border-border/60 py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">
          {isStillOpen ? t('fasting.history.stillOpenHint', { when }) : when}
        </span>
        {/* One small word, never a colour and never an icon. How a fast felt is
          the person's own reading, and grading it with a face would hand it
          back to them as a score (DESIGN.md section 10.1). */}
        {mood !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">{t(`fasting.end.mood.${mood}`)}</span>
        )}
        {/*
        A completed fast reads in the brand colour; an early end reads the SAME
        sentence in plain foreground, not amber, not destructive. Ending early
        is a choice, not an overrun, and the two numbers speak for themselves.
        The colour is applied to the whole "9h of 16:8" phrase rather than to
        the achieved figure alone, because splitting a translated sentence to
        style one interpolation is how a locale ends up with a stray space.
      */}
        <span className="shrink-0 text-sm tabular-nums">
          {timeline.status === 'cancelled' ?
            <span className="text-muted-foreground">{target}</span>
          : isStillOpen ?
            <span className="text-muted-foreground">{t('fasting.history.stillOpen')}</span>
          : <span className={timeline.status === 'completed' ? 'font-medium text-primary' : 'text-foreground'}>
              {t('fasting.history.achieved', { achieved, target })}
            </span>
          }
        </span>
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={t('fasting.history.deleteLabel', { when })}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          }
          title={t('fasting.history.deleteTitle')}
          description={t('fasting.history.deleteBody')}
          // This one really does destroy the record, so it earns the red button.
          confirmVariant="destructive"
          formData={{ _intent: INTENT.DELETE, fastId: fast.id }}
        />
      </div>
      {/* The person's own words, under the row rather than truncated into it:
          a note is a sentence, and a sentence cut at a column boundary is a
          sentence nobody can read. */}
      {note !== null && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function FastHistoryCard({
  fasts,
  nowMs,
  timezone,
}: {
  fasts: LocalFast[];
  nowMs: number;
  timezone: string;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('fasting.history.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {fasts.length === 0 ?
          <p className="text-sm text-muted-foreground">{t('fasting.history.empty')}</p>
        : <div>
            {fasts.slice(0, HISTORY_DISPLAY_LIMIT).map((fast) => (
              <FastHistoryRow key={fast.id} fast={fast} nowMs={nowMs} timezone={timezone} />
            ))}
          </div>
        }
      </CardContent>
    </Card>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Page
//////////////////////////////////////////////////////////////////////////////

export default function Fasting({ loaderData }: Route.ComponentProps) {
  const { t, i18n: i18next } = useTranslation();
  const { fasts, timezone, fastingSettings, reproductiveStatus } = loaderData;
  const nowMs = useNow({ intervalMs: FAST_TICK_MS });
  useLiveFastRevalidation();

  const current = selectCurrentFast(fasts);
  const timeline = current === null ? null : resolveFastTimeline(current, nowMs);
  const history = selectFastHistory(fasts);
  const stats = selectFastingStats({ fasts, nowMs, timezone });

  // Keyed on the STATUS, so it announces on a transition (plan → scheduled →
  // active) and stays silent through every tick in between.
  const announcement =
    timeline === null ? ''
    : timeline.status === 'scheduled' ?
      t('fasting.scheduled.srAnnounce', {
        when: formatFastMoment(timeline.startAt, { timezone, language: i18next.language }),
      })
    : t('fasting.active.srAnnounce');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* ABOVE the plan card, not inside it: it is a fact about the person's
          situation, not a property of the fast they are about to plan. It
          never blocks a start. */}
      {isCareStatus(reproductiveStatus) && <PregnancyNotice />}

      {timeline === null || current === null ?
        <PlanFastCard
          recentlyEnded={selectRecentlyEndedFast(fasts, nowMs)}
          nowMs={nowMs}
          timezone={timezone}
          fastingSettings={fastingSettings}
          reproductiveStatus={reproductiveStatus}
        />
      : timeline.status === 'scheduled' ?
        <ScheduledFastCard fast={current} timeline={timeline} timezone={timezone} />
      : <ActiveFastCard fast={current} timeline={timeline} timezone={timezone} />}

      {/* Only while something is running: the list marks where you are, and
          "where you are" is a question a fast has to be open to answer. */}
      {timeline !== null && timeline.status === 'active' && <StageList elapsedMs={timeline.elapsedMs} />}

      <FastingStatsRow stats={stats} />

      <FastHistoryCard fasts={history} nowMs={nowMs} timezone={timezone} />
    </div>
  );
}
