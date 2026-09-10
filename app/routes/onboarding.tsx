import type { ReactNode } from 'react';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { Route } from './+types/onboarding';
import type { MetaFunction } from 'react-router';
import { Form, redirect, useNavigation } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
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
  MAX_WEEKS_UNTIL_DUE_DATE,
  computeReferenceProteinFloor,
  hasBodyMetricsErrors,
  selectLatestWeighInKg,
  validateBodyMetricsForm,
} from '#app/models/body-metrics';
import { resolveGestation, resolveLactationMonths } from '#app/lib/reproductive-stage';
import type { BodyMetrics, BodyMetricsSubmission } from '#app/models/body-metrics';
import type { ReproductiveStatus } from '#app/lib/local-store/schema';
import { ReproductiveStatusFields } from '#app/components/reproductive-status-fields';
import type { ReproductiveStatusValue } from '#app/components/reproductive-status-fields';
import { todayInTimezone } from '#app/lib/user-days';
import { clearHomeHint, writeHomeHint } from '#app/lib/home-entry';
import { CONFIG } from '#app/config';
import { isAnonymousStartAllowed } from '#app/lib/onboarding-gate';
import { readInstancePolicy } from '#app/lib/read-instance-policy';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import {
  ONBOARDING_STEPS,
  STYLE_CARB_PRESETS,
  hasWeightStepErrors,
  initialCarbPresetSelection,
  initialStyleSelection,
  nextOnboardingStep,
  onboardingStepNumber,
  parseOnboardingStep,
  resolveExitDestination,
  resolveOnboardingTimezone,
  trackingFocusForPatch,
  validateStyleStep,
  validateWeightStep,
} from '#app/lib/onboarding';
import type {
  CarbPreset,
  OnboardingStep,
  StyleStepField,
  StyleStepValues,
  Translate,
  WeightStepSubmission,
} from '#app/lib/onboarding';
import {
  EATING_STYLES,
  STYLE_CAUTION_SOURCE_URL,
  applyEatingStyle,
  eatingStyle,
  styleCaution,
} from '#app/lib/eating-style';
import type { EatingStyle, EatingStyleId } from '#app/lib/eating-style';
import {
  WEIGHT_UNITS,
  formatKgForDisplay,
  fromKg,
  parseDisplayWeightToKg,
  roundWeightForDisplay,
  toWeightSubmitValue,
} from '#app/lib/weight-units';
import type { WeightUnit } from '#app/lib/weight-units';
import { WAYS_TO_LOG, WAYS_TO_LOG_SPEECH_PRIVACY_KEY } from '#app/lib/ways-to-log';
import type { WayToLog } from '#app/lib/ways-to-log';
import { FieldError } from '#app/components/field-error';
import { cn } from '#app/lib/utils';
import { ProgressBar } from '#app/components/progress-bar';
import { SubmitButton } from '#app/components/submit-button';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Badge } from '#app/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { InstallAffordanceAction } from '#app/components/install-card';
import { useInstallAffordance } from '#app/hooks/use-install-affordance';
import type { InstallAffordanceControls } from '#app/hooks/use-install-affordance';
import { APP_NAME } from '#app/lib/brand';
import { Download, Key, ShieldCheck } from 'lucide-react';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  trackOnboardingCompleted,
  trackOnboardingStepCompleted,
  trackOnboardingStepSkipped,
} from '#app/lib/matomo-events';

/**
 * The three cards' drawings, kept OUT of the main bundle.
 *
 * A returning person never reaches this step, so an offline-first PWA has no
 * business shipping first-run decoration in the chunk that boots the diary.
 * `lazy` defers the `import()` until `FirstFoodStep` actually renders, which is
 * after the step check, so the module is not fetched on `?step=focus`.
 * `tests/unit/ways-to-log-bundle.test.ts` fails the push if this becomes a
 * static import again.
 */
const WayToLogAnimation = lazy(() => import('#app/components/onboarding/ways-to-log-animation'));

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.onboarding') }];

/** Submit-button intents that drive the single onboarding action. */
const INTENT = {
  SAVE_STYLE: 'save-style',
  SAVE_WEIGHT: 'save-weight',
  SAVE_BODY: 'save-body',
  SKIP: 'skip',
  FINISH: 'finish',
} as const;

/**
 * Every step that can come back with per-field errors reports through ONE
 * shape, so `actionData?.errors` never becomes a union the component has to
 * narrow before it can read a field. Whichever step didn't run contributes
 * `{}`.
 */
interface OnboardingStepErrors {
  style: StyleStepErrors;
  weight: WeightStepErrors;
  body: BodyStepErrors;
}

/** No errors at all — the shape every non-erroring branch returns. */
const NO_STEP_ERRORS: OnboardingStepErrors = { style: {}, weight: {}, body: {} };

/** The form field the style list submits. Named once, so the action reads back what the list wrote. */
const STYLE_FIELD = 'eatingStyle';

/** The form field the carb sub step submits, unchanged from the old focus step. */
const CARB_PRESET_FIELD = 'carbPreset';

/** The form field the kcal step submits, unchanged from the old focus step. */
const KCAL_TARGET_FIELD = 'kcalTarget';

/**
 * The query flag that carries "your protein goal has no weight to scale from"
 * across the redirect into the weight step.
 *
 * It travels in the URL rather than in action data because the style step
 * REDIRECTS on success, and action data does not survive a redirect. A flag in
 * the URL also means a reload of the weight step still shows the note.
 */
const NEEDS_WEIGHT_PARAM = 'needsWeight';

////////////////////////////////////////////////////////////////////////////////
// Server loader — non-health context only (M117/03: onboarding is local-only)
////////////////////////////////////////////////////////////////////////////////

/**
 * ONE fact, and it is about the instance rather than the person: is this a
 * managed instance (M187 spec 03)?
 *
 * Onboarding completion is a LOCAL concept (a new account has no server
 * profile row at all), so the "already complete → redirect to /diary" gate and
 * every field this route reads/writes live in `clientLoader`/`clientAction`
 * below. `managed` cannot: it comes from this server's own environment, and
 * the client half of the decision — is there a profile, is a session open —
 * has to be joined to it on the device. Hence the `serverLoader()` call there.
 */
export async function loader() {
  return { managed: CONFIG.instance.managed };
}

////////////////////////////////////////////////////////////////////////////////
// Client loader
////////////////////////////////////////////////////////////////////////////////

/**
 * Renders the onboarding flow for a user who hasn't finished it (locally). An
 * already-completed user is sent to the diary rather than being re-shown
 * onboarding.
 *
 * Reaching the flow for real also CLEARS the home hint: this is the one place
 * that proves the device is not in the app, so it is where a stale hint (kept
 * cookies, wiped IndexedDB) gets destroyed. Without it the `/` → `/dashboard` →
 * `/onboarding` bounce would repeat on every visit instead of once.
 *
 * @throws a redirect to `/diary` when onboarding is already complete.
 */
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  const profile = await getLocalProfileGoals();
  if (profile !== null && profile.onboardingCompletedAt !== null) {
    throw redirect('/diary');
  }
  // On a managed instance the anonymous path is CLOSED, not merely hidden:
  // hiding "Start" on `/welcome` while leaving this address open would let
  // somebody spend ten minutes answering questions into a diary they cannot
  // keep. A device with a profile row, or with a session open — which is what
  // the create-account flow arrives here with — is never turned away. The rule
  // itself is pure and lives with the gate it belongs to.
  // `requiresAccount` IS the question this gate asks, and it is asked of the
  // policy rather than of the mode name (M201 spec 07). The parameter is still
  // called `managed` in `onboarding-gate.ts`; the value handed to it is the
  // answer to "does a person need an account before they can use this
  // instance at all", which is exactly what the branch below means.
  const { requiresAccount } = await readInstancePolicy(serverLoader);
  const isAllowed = isAnonymousStartAllowed({
    managed: requiresAccount,
    hasProfile: profile !== null,
    hasSyncAccount: getSyncSessionSnapshot().account !== null,
  });
  if (!isAllowed) throw redirect('/welcome');
  clearHomeHint();
  const url = new URL(request.url);
  const step = parseOnboardingStep(url.searchParams.get('step'));
  const entries = await listLocalWeightEntries();
  const latestWeight =
    entries.toSorted((a, b) =>
      a.dayKey < b.dayKey ? 1
      : a.dayKey > b.dayKey ? -1
      : 0,
    )[0] ?? null;
  return {
    step,
    // The style step's own state: the stored pick (absent before schema v20)
    // plus the three numbers a pre-v20 pick is derived from. All four ride the
    // loader because `initialStyleSelection` decides from the set of them, and
    // a screen that read only one would tick a style nobody chose.
    eatingStyle: profile?.eatingStyle ?? null,
    goalProteinFloorG: profile?.goalProteinFloorG ?? null,
    // Set by the style step's redirect when `high-protein` was picked with no
    // weigh-in on file, so the weight step can say why it matters now.
    needsWeight: url.searchParams.get(NEEDS_WEIGHT_PARAM) === '1',
    goalNetCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
    goalKcalTarget: profile?.goalKcalTarget ?? null,
    targetWeightKg: profile?.targetWeightKg ?? null,
    currentWeightKg: latestWeight?.weightKg ?? null,
    // Prefilled so re-entering the flow (or stepping back) shows what the
    // person already told us rather than an empty form that looks like it lost
    // their answers. Every field may be null, that is the normal case.
    bodyMetrics: await getLocalBodyMetrics(),
    // The body step turns a due date into a trimester line, and it does that
    // against the person's own calendar day rather than the browser's.
    today: todayInTimezone(resolveLocalTimezone(profile)),
  };
}
clientLoader.hydrate = true as const;

/**
 * Shown while the client loader reads onboarding state from the on-device
 * primary store (M117/03) — this route is now clientLoader-only.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('onboarding.loading')}
    </output>
  );
}

type OnboardingLoaderData = Route.ComponentProps['loaderData'];

////////////////////////////////////////////////////////////////////////////////
// Client action (local-store writes — no server round-trip)
////////////////////////////////////////////////////////////////////////////////

/**
 * Single action behind every step. `save-*` intents persist that step and
 * advance to the next one; `skip` also just advances to the next step,
 * without saving that step's (optional) data — it does NOT exit the flow.
 * `finish` is the only real exit path, reached from the last step, and stamps
 * completion (locally) before redirecting so a user who's done is never
 * re-trapped in onboarding.
 *
 * Usability-overhaul fix: `skip` used to jump straight to `/diary` regardless
 * of which step it was pressed on — so skipping the (optional) weight step
 * also skipped "Log your first food", the step that actually teaches the
 * app's core action, giving Skip and Continue two different endings to the
 * same short wizard. Now every path through `focus`/`weight` — saved or
 * skipped — converges on the same next step, and only the last step's
 * actions (`FirstFoodStep`) leave the flow.
 *
 * @throws a 400 Response for an unrecognized intent.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('_intent');
  const step = parseOnboardingStep(new URL(request.url).searchParams.get('step'));
  // Silently capture the browser's time zone on every step (see `applyBrowserTimezone`).
  await applyBrowserTimezone(formData);

  if (intent === INTENT.SAVE_STYLE) {
    const result = validateStyleStep({
      style: readField(formData, STYLE_FIELD),
      carbPresetId: readField(formData, CARB_PRESET_FIELD),
      kcalTarget: readField(formData, KCAL_TARGET_FIELD),
    });
    // Same rule as the weight and body steps: an incomplete answer stays on
    // the step. Advancing would store a style whose own number is missing, and
    // the day would then be graded by a lens with nothing behind it.
    if (!result.ok) return { errors: { ...NO_STEP_ERRORS, style: result.errors } };
    const needsWeight = await saveStyle(result.values);
    // The funnel step name is unchanged (`'focus'`): this is the same first
    // step of the same wizard, and `OnboardingStepName` in `matomo-events.ts`
    // is another module's contract. What the person answered never rides the
    // event, so nothing about the pick is reported either way.
    trackOnboardingStepCompleted('focus');
    return redirect(nextStepUrl(step, { needsWeight }));
  }
  if (intent === INTENT.SAVE_WEIGHT) {
    const submission = validateWeightStep({
      currentWeightKg: readField(formData, 'currentWeightKg'),
      targetWeightKg: readField(formData, 'targetWeightKg'),
    });
    // Stay on the step rather than advancing: a filled-in field we can't read
    // is the user's to fix, and silently skipping it is the bug this guards.
    if (hasWeightStepErrors(submission)) return { errors: { ...NO_STEP_ERRORS, weight: submission.errors } };
    await saveWeight(submission.values);
    trackOnboardingStepCompleted('weight');
    return redirect(nextStepUrl(step));
  }
  if (intent === INTENT.SAVE_BODY) {
    const submission = validateBodyMetricsForm(
      {
        heightCm: readField(formData, 'heightCm'),
        birthYear: readField(formData, 'birthYear'),
        biologicalSex: readField(formData, 'biologicalSex'),
        reproductiveStatus: readField(formData, 'reproductiveStatus'),
        // Both dates are read here as well, so a person who answers the
        // pregnancy question during onboarding keeps the date they typed. They
        // stay optional, exactly like every other field on this step.
        pregnancyDueDate: readField(formData, 'pregnancyDueDate'),
        lactationStartDate: readField(formData, 'lactationStartDate'),
      },
      { currentYear: new Date().getFullYear(), today: new Date() },
    );
    // Same rule as the weight step: stay put when a field was filled in but
    // can't be read, rather than advancing having quietly dropped it.
    if (hasBodyMetricsErrors(submission)) return { errors: { ...NO_STEP_ERRORS, body: submission.errors } };
    await putLocalBodyMetrics(submission.values);
    trackOnboardingStepCompleted('body');
    return redirect(nextStepUrl(step));
  }
  if (intent === INTENT.SKIP) {
    trackOnboardingStepSkipped();
    return redirect(nextStepUrl(step));
  }
  if (intent === INTENT.FINISH) {
    await patchLocalProfileGoals({ onboardingCompletedAt: Date.now() });
    // `finish` is the only real exit from the flow (see this action's header),
    // so it is the only honest place to call onboarding complete. Fired after
    // the stamp so a failed write is never counted as a completion.
    trackOnboardingCompleted();
    // The exit destination is unchanged (`/diary`): a just-onboarded device has
    // nothing to show on Overview, and the diary's first-ever empty state is a
    // far better first screen. The hint written here is what sends the NEXT app
    // open to Overview instead.
    writeHomeHint();
    return redirect(resolveExitDestination(readField(formData, 'destination')));
  }
  throw new Response('Invalid onboarding intent', { status: 400 });
}

/** Reads a form field as a string, or `null` when it's absent or a File. */
function readField(formData: FormData, name: string): string | null {
  return z.string().safeParse(formData.get(name)).data ?? null;
}

/**
 * The URL of the step after `current`; falls back to the diary past the last
 * step. `needsWeight` rides along as a query flag, see `NEEDS_WEIGHT_PARAM`.
 */
function nextStepUrl(current: OnboardingStep, options: { needsWeight?: boolean } = {}): string {
  const next = nextOnboardingStep(current);
  if (next === null) return '/diary';
  const suffix = options.needsWeight === true ? `&${NEEDS_WEIGHT_PARAM}=1` : '';
  return `/onboarding?step=${next}${suffix}`;
}

/**
 * Persists the browser's IANA time zone when supplied, silently resolving an
 * invalid or missing value to UTC — the user never sees a time-zone error.
 */
async function applyBrowserTimezone(formData: FormData): Promise<void> {
  const raw = readField(formData, 'timezone');
  if (raw === null || raw.trim() === '') return;
  await patchLocalProfileGoals({ timezone: resolveOnboardingTimezone(raw) });
}

/**
 * Persists the style step: the four fields the style owns, plus the stored
 * `trackingFocus` reduced from the two numbers it just wrote.
 *
 * Everything the style decides is decided by `applyEatingStyle`, including
 * NULLING the fields the style does not own, so a person who switches away
 * from a carb style does not leave a live ceiling behind. This function only
 * gathers what that pure function needs.
 *
 * The reference protein floor is passed as `null` when the device holds no
 * body data at all. `computeReferenceProteinFloor` always answers, and its
 * last fallback is the flat labelling figure, so handing it in unconditionally
 * would write a protein goal onto every first-run profile, from nothing the
 * person ever told us. That is the "never invent a target" rule this whole
 * milestone is about.
 *
 * @param values - the validated answers from the style step.
 * @returns whether the person now needs to log a weight for their protein goal.
 */
async function saveStyle(values: StyleStepValues): Promise<boolean> {
  const profile = await getLocalProfileGoals();
  const latestWeightKg = selectLatestWeighInKg(await listLocalWeightEntries());
  const bodyMetrics = await getLocalBodyMetrics();
  const today = todayInTimezone(resolveLocalTimezone(profile));
  const stage = {
    reproductiveStatus: bodyMetrics.reproductiveStatus,
    trimester: resolveGestation({ dueDate: bodyMetrics.pregnancyDueDate, today })?.trimester ?? null,
    lactationMonths: resolveLactationMonths({ startDate: bodyMetrics.lactationStartDate, today }),
  };
  const hasBodyBasis = latestWeightKg !== null || bodyMetrics.heightCm !== null;
  const referenceProteinFloorG =
    hasBodyBasis ?
      computeReferenceProteinFloor({
        ...stage,
        latestWeighInKg: latestWeightKg,
        heightCm: bodyMetrics.heightCm,
        biologicalSex: bodyMetrics.biologicalSex,
      }).grams
    : null;
  const { patch, needsWeight } = applyEatingStyle({
    style: values.style,
    currentGoals: {
      goalNetCarbsCeilingG: profile?.goalNetCarbsCeilingG ?? null,
      goalKcalTarget: profile?.goalKcalTarget ?? null,
      goalProteinFloorG: profile?.goalProteinFloorG ?? null,
      eatingStyle: profile?.eatingStyle ?? null,
    },
    carbPresetCeiling: values.carbPresetCeiling,
    kcalTarget: values.kcalTarget,
    latestWeightKg,
    referenceProteinFloorG,
  });
  await patchLocalProfileGoals({ ...patch, trackingFocus: trackingFocusForPatch(patch) });
  return needsWeight;
}

/**
 * Records today's weigh-in (if entered) and the target weight (blank clears
 * it). Takes already-validated values — see `validateWeightStep`, which is
 * where a filled-but-unreadable field is caught instead of reaching here as an
 * indistinguishable `null`.
 */
async function saveWeight(values: WeightStepSubmission['values']): Promise<void> {
  if (values.currentWeightKg !== null) {
    const profile = await getLocalProfileGoals();
    await upsertLocalWeightEntryForDay({
      dayKey: todayInTimezone(resolveLocalTimezone(profile)),
      weightKg: values.currentWeightKg,
    });
  }
  await patchLocalProfileGoals({ targetWeightKg: values.targetWeightKg });
}

////////////////////////////////////////////////////////////////////////////////
// Component
////////////////////////////////////////////////////////////////////////////////

/** Per-field i18n error keys the weight step renders after a rejected submit. */
type WeightStepErrors = WeightStepSubmission['errors'];

/** Per-field i18n error keys the style step renders after a rejected submit. */
type StyleStepErrors = Partial<Record<StyleStepField, string>>;

/**
 * The loader fields the style step reads, declared as its own shape rather
 * than taken whole from `OnboardingLoaderData`. The step needs five of them,
 * and naming those five is what lets its unit test hand in a fixture instead
 * of a cast of a route's generated loader type.
 */
export interface StyleStepData {
  eatingStyle: EatingStyleId | null;
  goalNetCarbsCeilingG: number | null;
  goalKcalTarget: number | null;
  goalProteinFloorG: number | null;
  bodyMetrics: { reproductiveStatus: ReproductiveStatus | null };
}

/** Per-field i18n error keys the body-metrics step renders after a rejected submit. */
type BodyStepErrors = BodyMetricsSubmission['errors'];

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  const { step } = loaderData;
  // The only thing the action ever returns instead of a redirect (see
  // `clientAction`): the per-field errors of whichever step rejected.
  const errors: OnboardingStepErrors = actionData?.errors ?? NO_STEP_ERRORS;
  return (
    <div className="min-h-screen bg-background">
      <ProgressBar />
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-8 sm:py-12">
        <OnboardingHeader step={step} />
        {step === 'focus' && <LocalFirstExplainer />}
        <main className="mt-8 flex-1">
          {/* The first step keeps the id `focus` (see `ONBOARDING_STEPS`): the
              question it asks changed, the URL and the funnel step name did
              not, so a bookmarked `?step=focus` still lands on the first
              screen. */}
          {step === 'focus' && <StyleStep loaderData={loaderData} errors={errors.style} />}
          {step === 'weight' && <WeightStep loaderData={loaderData} errors={errors.weight} />}
          {step === 'body' && <BodyStep loaderData={loaderData} errors={errors.body} />}
          {step === 'first-food' && <FirstFoodStep />}
        </main>
      </div>
    </div>
  );
}

function OnboardingHeader({ step }: { step: OnboardingStep }) {
  const { t } = useTranslation();
  const current = onboardingStepNumber(step);
  return (
    <header className="flex flex-col items-center gap-6">
      {/* The real brand mark, same asset and same treatment the sidebar and
          the public header already use — this was still the generic Layers
          icon in a teal square, i.e. the scaffold placeholder, on the very
          first screen a new user ever sees. */}
      <span className="flex items-center gap-2.5 font-semibold">
        <img src="/icons/icon-192.png?v=2" alt="" className="h-8 w-8 rounded-full" />
        <span className="font-display text-xl">openplate</span>
      </span>
      <p className="sr-only">{t('onboarding.stepOf', { current, total: ONBOARDING_STEPS.length })}</p>
      <div className="flex items-center gap-2">
        {ONBOARDING_STEPS.map((stepId, index) => (
          <span
            key={stepId}
            aria-hidden="true"
            className={cn('h-2 rounded-full transition-all', dotClass(index + 1, current))}
          />
        ))}
      </div>
    </header>
  );
}

/**
 * First-run trust explainer (M117/08, spec 08 item 1) — shown only on the
 * flow's first step, once, before the visitor has been asked anything.
 * Usability-overhaul fix: this used to ALSO mention connecting "an AI key"
 * for photo scanning here — jargon a first-time visitor has no reason to
 * know yet, on the very first screen they see, about a feature nobody has
 * offered them. That promise now lives where photo scanning is actually
 * offered (`FirstFoodKeyNote`, the last step) and is spelled out in plain
 * terms there. This card sticks to the one fact that matters immediately:
 * the diary itself never leaves the device.
 */
function LocalFirstExplainer() {
  // MANAGED CHANGES THE FACT, not the tone (M196). "We never see it" is true
  // where there is no server holding anything; on an instance an organization
  // runs, the diary is on the server as ciphertext and the plate photo passes
  // through that same server on its way to the AI. Saying so on the first
  // screen is the point of this card.
  const { serverHoldsTheDiary } = useInstancePolicy();
  return (
    <div className="mt-6 space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          {/* <Trans> rather than a plain t(): the emphasis sits mid-sentence, and
              splitting the sentence into three keys around it would force every
              translation into English word order. */}
          <Trans
            i18nKey={serverHoldsTheDiary ? 'onboarding.localFirstManaged' : 'onboarding.localFirst'}
            components={{ strong: <strong /> }}
          />
        </span>
      </p>
    </div>
  );
}

/** Progress-dot width/fill by position relative to the current step. */
function dotClass(position: number, current: number): string {
  if (position === current) return 'w-6 bg-primary';
  if (position < current) return 'w-2 bg-primary/60';
  return 'w-2 bg-muted';
}

/**
 * Shared step card: title, calm one-line description, and body. Every step's
 * copy reassures that choices are changeable later (DESIGN.md tone).
 */
function StepShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
        <CardDescription className="text-base">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/**
 * Hidden field carrying the browser's IANA time zone. Read on the client only
 * (after mount) so SSR and hydration agree on an empty value first, then the
 * real zone is filled in before the user can submit.
 */
function TimezoneField() {
  const [timezone, setTimezone] = useState('');
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  }, []);
  return <input type="hidden" name="timezone" value={timezone} readOnly />;
}

/**
 * Primary "Continue" submit, plus a quiet "Skip for now" on the steps that have
 * one.
 *
 * `canSkip` exists for the style step, and only for it. Skipping a step means
 * "do not answer this", and on every other step that is a real, distinct
 * outcome: no weight logged, no body metrics given, no first food. The style
 * step already SPELLS that outcome as an answer, `just-track`, which is the
 * whole point of listing it. Offering Skip beside it would put the same
 * decision on the screen twice, once as a considered pick that writes a style
 * and once as a link that writes nothing, and the two would grade a day
 * differently for no reason a reader could see.
 */
function StepActions({
  primaryIntent,
  primaryPendingLabel,
  canSkip = true,
}: {
  primaryIntent: string;
  primaryPendingLabel: string;
  canSkip?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isBusy = navigation.state !== 'idle';
  const submittedIntent = navigation.formData?.get('_intent');
  const skipLabel =
    isBusy && submittedIntent === INTENT.SKIP ? t('onboarding.actions.skipping') : t('onboarding.actions.skip');
  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <SubmitButton
        name="_intent"
        value={primaryIntent}
        pending={isBusy && submittedIntent === primaryIntent}
        pendingLabel={primaryPendingLabel}
        disabled={isBusy}
        size="lg"
        className="h-11 w-full"
      >
        {t('onboarding.actions.continue')}
      </SubmitButton>
      {canSkip && (
        <Button
          type="submit"
          name="_intent"
          value={INTENT.SKIP}
          variant="link"
          disabled={isBusy}
          className="text-muted-foreground"
        >
          {skipLabel}
        </Button>
      )}
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Step 1, the eating style (M210)
////////////////////////////////////////////////////////////////////////////////

/**
 * The first question the app asks, and the only one that decides how a day is
 * graded.
 *
 * It replaced a pair of independent switches (net carbs, calories) plus a
 * carb preset. Two switches could express "carbs and calories" but never
 * "protein", and nothing they wrote said whether a person with no numbers at
 * all had chosen that or simply skipped. The five styles say it in one pick,
 * and `applyEatingStyle` turns the pick into the numbers.
 *
 * NOTHING IS PRESELECTED on a first run. `initialStyleSelection` returns
 * `null` for a profile with nothing stored, and this component starts on that
 * answer, so a person who taps Continue without choosing is asked again rather
 * than given a style they never picked. A returning person still finds their
 * own style ticked.
 *
 * Exported for `tests/unit/onboarding-style-step.test.ts`, which renders it and
 * counts what is checked. There is no DOM in this repo's test tier, so a
 * static render of the real component is the only way to prove the control.
 */
export function StyleStep({ loaderData, errors }: { loaderData: StyleStepData; errors: StyleStepErrors }) {
  const { t } = useTranslation();
  const [style, setStyle] = useState<EatingStyleId | null>(() => initialStyleSelection(loaderData));
  const [carbPreset, setCarbPreset] = useState<string | null>(() =>
    initialCarbPresetSelection(loaderData.goalNetCarbsCeilingG),
  );
  // The two follow-up questions are read off the TABLE, never off a second
  // list of style ids here, so a style that changes what it asks for changes
  // it in one place (`app/lib/eating-style.ts`).
  const definition = style === null ? null : eatingStyle(style);
  return (
    <StepShell title={t('onboarding.style.title')} description={t('onboarding.step.style.description')}>
      <Form method="post" className="space-y-6">
        <TimezoneField />
        <div className="space-y-3">
          {EATING_STYLES.map((candidate) => (
            <StyleOptionCard
              key={candidate.id}
              style={candidate}
              isSelected={style === candidate.id}
              onSelect={() => setStyle(candidate.id)}
            />
          ))}
        </div>
        <FieldError id="eatingStyle-error" errors={errors.style === undefined ? undefined : [t(errors.style)]} />
        <StyleCautionNote style={style} reproductiveStatus={loaderData.bodyMetrics.reproductiveStatus} />
        {definition?.carbSubPreset === true && (
          <CarbPresetPicker selected={carbPreset} onSelect={setCarbPreset} errorKey={errors.carbPreset} />
        )}
        {definition?.kcalMode === 'asked' && (
          <KcalTargetField defaultValue={loaderData.goalKcalTarget} errorKey={errors.kcalTarget} />
        )}
        {/* No Skip here: `just-track` in the list above IS the "no goal"
            answer, so a second way to decline would only be a way to decline
            differently. */}
        <StepActions
          primaryIntent={INTENT.SAVE_STYLE}
          primaryPendingLabel={t('onboarding.actions.saving')}
          canSkip={false}
        />
      </Form>
    </StepShell>
  );
}

/**
 * One style in the list. A real radio carries the state, so the browser
 * submits it, assistive tech announces "selected, 1 of 5", and the five are
 * mutually exclusive without any JavaScript deciding that.
 *
 * The `onboarding.style.hint` line sits under `low-carb` only, and it is a
 * hint rather than a default: it says where most people start without ticking
 * anything on their behalf.
 */
function StyleOptionCard({
  style,
  isSelected,
  onSelect,
}: {
  style: EatingStyle;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      // The radio's own name: the detail line and the hint stay on screen but
      // would otherwise be read out as part of every option.
      aria-label={t(style.labelKey)}
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all focus-within:ring-2 focus-within:ring-primary',
        styleCardClass(isSelected),
      )}
    >
      <input
        type="radio"
        name={STYLE_FIELD}
        value={style.id}
        checked={isSelected}
        onChange={onSelect}
        className="mt-1 accent-primary"
      />
      <span className="flex-1 space-y-0.5">
        <span className="block font-medium">{t(style.labelKey)}</span>
        <span className="block text-sm text-muted-foreground">{t(style.detailKey)}</span>
        {style.id === 'low-carb' && (
          <span className="block pt-1">
            <Badge variant="secondary">{t('onboarding.style.hint')}</Badge>
          </span>
        )}
      </span>
    </label>
  );
}

/** Border/fill for a style card by selection state. */
function styleCardClass(isSelected: boolean): string {
  if (isSelected) return 'border-primary bg-accent/40';
  return 'border-border hover:border-teal-300 dark:hover:border-teal-600';
}

/**
 * The sourced caution note (M206/05), under the style list.
 *
 * `styleCaution` decides, and it returns a KEY or nothing: no block, no
 * adjusted number, no colour beyond muted text. The app has no business
 * overriding a clinician, and the hidden reference that used to move with a
 * person's bodily state is exactly what this milestone deleted.
 *
 * A FIRST RUN NEVER SEES THIS. The body step, where a pregnancy or lactation
 * status is recorded, comes AFTER this one (`ONBOARDING_STEPS`), so on a first
 * pass the status is always null and this renders nothing. It fires for a
 * person who re-enters the wizard with a status already on file; the surface
 * that carries the note for everyone else is the settings style card
 * (M210 spec 04).
 *
 * Exported for its unit test, which is the only way to prove the note appears
 * for exactly the three restricting styles.
 */
export function StyleCautionNote({
  style,
  reproductiveStatus,
}: {
  style: EatingStyleId | null;
  reproductiveStatus: ReproductiveStatus | null;
}) {
  const { t } = useTranslation();
  if (style === null) return null;
  if (styleCaution(style, reproductiveStatus) === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {/* <Trans> rather than a plain t(): the source link sits mid-sentence,
          and splitting the sentence around it would force every translation
          into English word order. */}
      <Trans
        i18nKey="onboarding.style.caution"
        components={{
          source: (
            <a
              href={STYLE_CAUTION_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t('onboarding.style.sourceLabel')}
              className="underline underline-offset-2"
            />
          ),
        }}
      />
    </p>
  );
}

/**
 * Chip text with its gram number folded in, so "Keto"/"Low-carb"/"Moderate"
 * are never shown as bare, unexplained names — the number used to appear
 * only in the preset's detail line, and only once a chip was already selected,
 * which meant picking one meant guessing first. The number comes off
 * `preset.ceiling` (data, not copy) and only the surrounding wording is
 * translated, so no locale can drop it. `t` is passed in rather than pulled
 * from a hook so this stays callable — and testable — outside React.
 */
export function carbPresetChipLabel(preset: CarbPreset, t: Translate): string {
  const label = t(preset.labelKey);
  if (preset.ceiling === null) return label;
  return t('onboarding.carbPreset.chipWithCeiling', { label, ceiling: preset.ceiling });
}

/**
 * The 20/50/100 g sub step, shown for the two carb styles and REQUIRED there.
 *
 * `STYLE_CARB_PRESETS` is the old chip list minus "Decide later": a carb style
 * with no ceiling is the state M210 removed, so the answer that used to mean
 * "no number" is now a different style rather than a fourth chip. Nothing is
 * preselected for a person with no stored ceiling, for the same reason nothing
 * is preselected in the style list above.
 */
function CarbPresetPicker({
  selected,
  onSelect,
  errorKey,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  errorKey?: string;
}) {
  const { t } = useTranslation();
  const detailKey = STYLE_CARB_PRESETS.find((preset) => preset.id === selected)?.detailKey;
  return (
    <fieldset className="space-y-2 rounded-lg border border-dashed p-4">
      <legend className="px-1 text-sm font-medium">{t('onboarding.carbPreset.legend')}</legend>
      <div className="flex flex-wrap gap-2">
        {STYLE_CARB_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={cn(
              'flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary',
              chipClass(selected === preset.id),
            )}
          >
            <input
              type="radio"
              name={CARB_PRESET_FIELD}
              value={preset.id}
              checked={selected === preset.id}
              onChange={() => onSelect(preset.id)}
              className="sr-only"
            />
            {carbPresetChipLabel(preset, t)}
          </label>
        ))}
      </div>
      {detailKey !== undefined && <p className="text-xs text-muted-foreground">{t(detailKey)}</p>}
      <FieldError id="carbPreset-error" errors={errorKey === undefined ? undefined : [t(errorKey)]} />
    </fieldset>
  );
}

/** Border/fill for a net-carb preset chip by selection state. */
function chipClass(isSelected: boolean): string {
  if (isSelected) return 'border-primary bg-primary text-primary-foreground';
  return 'border-border hover:border-teal-300 dark:hover:border-teal-600';
}

/**
 * The calorie target, shown for the two styles that ask for one and REQUIRED
 * there.
 *
 * The label is `onboarding.kcal.requiredLabel`, not `onboarding.kcal.label`:
 * that one says "(optional)" and its hint invites the reader to leave the field
 * blank, both of which are false here, because a style that asks for a target
 * does not save without one.
 */
function KcalTargetField({ defaultValue, errorKey }: { defaultValue: number | null; errorKey?: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-4">
      <Label htmlFor={KCAL_TARGET_FIELD}>{t('onboarding.kcal.requiredLabel')}</Label>
      <Input
        id={KCAL_TARGET_FIELD}
        name={KCAL_TARGET_FIELD}
        type="number"
        inputMode="numeric"
        min={1}
        max={9999}
        step={1}
        placeholder={t('onboarding.kcal.placeholder')}
        defaultValue={defaultValue ?? ''}
        aria-invalid={errorKey === undefined ? undefined : true}
        aria-describedby={errorKey === undefined ? undefined : 'kcalTarget-error'}
        className="h-11"
      />
      <FieldError id="kcalTarget-error" errors={errorKey === undefined ? undefined : [t(errorKey)]} />
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Step 2 — weight
////////////////////////////////////////////////////////////////////////////////

/**
 * Converts a raw display string from one unit to another — thin glue over
 * `#app/lib/weight-units`'s two independently-tested primitives, used only
 * when the user deliberately flips the kg/lb toggle (not while typing; see
 * `WeightField`'s doc comment for why typing stays uncontrolled-feeling).
 */
function convertWeightDisplay(display: string, fromUnit: WeightUnit, toUnit: WeightUnit): string {
  return formatKgForDisplay(parseDisplayWeightToKg(display, fromUnit), toUnit);
}

/** Segmented kg/lb toggle — both weight fields on this step share one unit. */
function WeightUnitToggle({ unit, onChange }: { unit: WeightUnit; onChange: (unit: WeightUnit) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset
      aria-label={t('onboarding.weight.unitToggleLabel')}
      className="inline-flex rounded-full border p-0.5 text-sm"
    >
      {WEIGHT_UNITS.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={unit === candidate}
          onClick={() => onChange(candidate)}
          className={cn('min-h-8 rounded-full px-3 py-1 uppercase transition-colors', chipClass(unit === candidate))}
        >
          {candidate}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * A single weight input in the currently-selected unit. The visible input is
 * controlled by the raw display STRING the user is typing (not by a
 * round-tripped kg number) so a keystroke never gets silently rewritten
 * mid-entry — only a deliberate unit-toggle click reformats it. The value
 * that actually gets submitted travels through a hidden field in kilograms
 * (`toWeightSubmitValue`), so the rest of the flow needs no changes at all.
 *
 * The visible input is deliberately `type="text"` + `inputMode="decimal"`
 * rather than `type="number"`: mobile still gets a numeric keypad, but a
 * `type="number"` input in bad-input state reports `value === ''` in Chromium,
 * so a decimal comma never even reached the parser — the keystrokes vanished
 * before any validation could see them.
 */
function WeightField({
  id,
  label,
  unit,
  display,
  onDisplayChange,
  placeholderKg,
  errorKey,
}: {
  id: string;
  label: string;
  unit: WeightUnit;
  display: string;
  onDisplayChange: (value: string) => void;
  placeholderKg: number;
  errorKey?: string;
}) {
  const { t } = useTranslation();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('onboarding.weight.fieldLabel', { label, unit })}</Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={t('onboarding.weight.placeholder', { value: roundWeightForDisplay(fromKg(placeholderKg, unit)) })}
        value={display}
        onChange={(event) => onDisplayChange(event.target.value)}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={errorKey ? errorId : undefined}
        className="h-11"
      />
      <input type="hidden" name={id} value={toWeightSubmitValue(display, unit)} />
      <FieldError id={errorId} errors={errorKey ? [t(errorKey)] : undefined} />
    </div>
  );
}

function WeightStep({ loaderData, errors }: { loaderData: OnboardingLoaderData; errors: WeightStepErrors }) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [currentDisplay, setCurrentDisplay] = useState(() => formatKgForDisplay(loaderData.currentWeightKg, 'kg'));
  const [targetDisplay, setTargetDisplay] = useState(() => formatKgForDisplay(loaderData.targetWeightKg, 'kg'));

  function changeUnit(nextUnit: WeightUnit): void {
    setCurrentDisplay((display) => convertWeightDisplay(display, unit, nextUnit));
    setTargetDisplay((display) => convertWeightDisplay(display, unit, nextUnit));
    setUnit(nextUnit);
  }

  return (
    <StepShell title={t('onboarding.step.weight.title')} description={t('onboarding.step.weight.description')}>
      <Form method="post" className="space-y-6">
        <TimezoneField />
        {/* Set by the style step when `high-protein` was picked with no
            weigh-in on file: the floor fell back to the reference, and this is
            the one place that says why a weight would change it. */}
        {loaderData.needsWeight && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t('onboarding.style.needsWeight')}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('onboarding.weight.units')}</p>
          <WeightUnitToggle unit={unit} onChange={changeUnit} />
        </div>
        <WeightField
          id="currentWeightKg"
          label={t('onboarding.weight.current')}
          unit={unit}
          display={currentDisplay}
          onDisplayChange={setCurrentDisplay}
          placeholderKg={72.5}
          errorKey={errors.currentWeightKg}
        />
        <div className="space-y-2">
          <WeightField
            id="targetWeightKg"
            label={t('onboarding.weight.target')}
            unit={unit}
            display={targetDisplay}
            onDisplayChange={setTargetDisplay}
            placeholderKg={68}
            errorKey={errors.targetWeightKg}
          />
          <p className="text-xs text-muted-foreground">{t('onboarding.weight.hint')}</p>
        </div>
        <StepActions primaryIntent={INTENT.SAVE_WEIGHT} primaryPendingLabel={t('onboarding.actions.saving')} />
      </Form>
    </StepShell>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Step 3 — body metrics (M135), entirely optional
////////////////////////////////////////////////////////////////////////////////

/**
 * A chip-styled radio group — the same affordance the carb presets already use,
 * reused here so a one-of-N answer looks the same everywhere in the flow. The
 * value travels as a plain radio, so the step needs no client JS to submit.
 */
function ChipRadioGroup({
  name,
  legend,
  hint,
  options,
  selected,
  onSelect,
}: {
  name: string;
  legend: string;
  hint: string;
  options: readonly { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              // `focus-within:ring-*` on the label, not the (visually hidden)
              // input — this codebase's convention for a "chip wraps an
              // sr-only radio" control, see `theme-selector.tsx`. Without it,
              // tabbing through these chips gave a keyboard user no visible
              // focus indicator (M123/13 second-review finding 3 — the same
              // gap `carb-basis-field.tsx` copied this component's shape from).
              'flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary',
              chipClass(selected === option.value),
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected === option.value}
              onChange={() => onSelect(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A plain optional number field with its own "why we ask" line underneath the label. */
function BodyNumberField({
  id,
  label,
  hint,
  placeholder,
  value,
  onValueChange,
  errorKey,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  errorKey?: string;
}) {
  const { t } = useTranslation();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={errorKey ? errorId : undefined}
        className="h-11"
      />
      <FieldError id={errorId} errors={errorKey ? [t(errorKey)] : undefined} />
    </div>
  );
}

/**
 * The optional body-metrics step. Every field can be left alone, Skip walks
 * straight past it, and nothing downstream breaks when all four stay unset —
 * the app behaves exactly as it did before this step existed.
 *
 * Each field carries its own one-line reason for being asked, because this is
 * the one screen in the flow where someone hands over health data, and "why"
 * is the only thing that makes that a fair request. The reassurance that it
 * stays on the device is in the step description rather than repeated per
 * field (DESIGN.md §10.7 — one phrasing per idea).
 */
function BodyStep({ loaderData, errors }: { loaderData: OnboardingLoaderData; errors: BodyStepErrors }) {
  const { t } = useTranslation();
  const stored: BodyMetrics = loaderData.bodyMetrics;
  const [heightCm, setHeightCm] = useState(stored.heightCm === null ? '' : String(stored.heightCm));
  const [birthYear, setBirthYear] = useState(stored.birthYear === null ? '' : String(stored.birthYear));
  const [biologicalSex, setBiologicalSex] = useState<string>(stored.biologicalSex ?? '');
  const [reproductive, setReproductive] = useState<ReproductiveStatusValue>({
    reproductiveStatus: stored.reproductiveStatus ?? 'none',
    pregnancyDueDate: stored.pregnancyDueDate ?? '',
    lactationStartDate: stored.lactationStartDate ?? '',
  });

  const sexOptions = [
    ...BIOLOGICAL_SEX_VALUES.map((value) => ({ value, label: t(`bodyMetrics.sex.${value}`) })),
    { value: '', label: t('bodyMetrics.sex.unset') },
  ];

  return (
    <StepShell title={t('onboarding.step.body.title')} description={t('onboarding.step.body.description')}>
      <Form method="post" className="space-y-6">
        <TimezoneField />
        <BodyNumberField
          id="heightCm"
          label={t('bodyMetrics.height.label')}
          hint={t('bodyMetrics.height.hint')}
          placeholder={t('bodyMetrics.height.placeholder')}
          value={heightCm}
          onValueChange={setHeightCm}
          errorKey={errors.heightCm}
        />
        <BodyNumberField
          id="birthYear"
          label={t('bodyMetrics.birthYear.label')}
          hint={t('bodyMetrics.birthYear.hint')}
          placeholder={t('bodyMetrics.birthYear.placeholder')}
          value={birthYear}
          onValueChange={setBirthYear}
          errorKey={errors.birthYear}
        />
        <ChipRadioGroup
          name="biologicalSex"
          legend={t('bodyMetrics.sex.legend')}
          hint={t('bodyMetrics.sex.hint')}
          options={sexOptions}
          selected={biologicalSex}
          onSelect={setBiologicalSex}
        />
        {/* The same fieldset `/settings/life-phase` shows, component and all, so the
            wizard and the settings page cannot drift about what may be entered
            here. It asks anyone who did not answer "male", it reveals one date
            beside the chosen chip, and `none` is always right there to put the
            answer back. Still optional: Skip walks past it, and a status with
            no date is a perfectly good save.

            `normalizeBodyMetrics` drops a stored status, and its date with it,
            the moment the answer stops applying, so hiding the control never
            leaves a stale answer behind in the store. */}
        <ReproductiveStatusFields
          biologicalSex={biologicalSex}
          value={reproductive}
          onChange={setReproductive}
          today={loaderData.today}
          statusName="reproductiveStatus"
          dueDateField={{
            name: 'pregnancyDueDate',
            id: 'pregnancyDueDate',
            errorId: 'pregnancyDueDate-error',
            errors:
              errors.pregnancyDueDate ?
                [t(errors.pregnancyDueDate, { weeks: MAX_WEEKS_UNTIL_DUE_DATE })]
              : undefined,
          }}
          lactationStartDateField={{
            name: 'lactationStartDate',
            id: 'lactationStartDate',
            errorId: 'lactationStartDate-error',
            errors:
              errors.lactationStartDate ?
                [t(errors.lactationStartDate, { weeks: MAX_WEEKS_UNTIL_DUE_DATE })]
              : undefined,
          }}
          chipClassName={(isSelected) =>
            cn(
              'flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary',
              chipClass(isSelected),
            )
          }
        />
        <StepActions primaryIntent={INTENT.SAVE_BODY} primaryPendingLabel={t('onboarding.actions.saving')} />
      </Form>
    </StepShell>
  );
}

////////////////////////////////////////////////////////////////////////////////
// Step 4 — first food (exit paths)
////////////////////////////////////////////////////////////////////////////////

/**
 * The wizard's last step, which is also the only lesson in the flow.
 *
 * It teaches the THREE ways a food gets into the diary, one card each, and
 * every card starts the real action instead of demonstrating it (M200 spec 01).
 * The teaching sits here rather than in a carousel in front of the wizard for
 * one reason: a carousel makes the first run longer before anyone has logged
 * anything, and the screen most likely to be skipped is the one nobody has
 * invested in yet. `ONBOARDING_STEPS` does not grow.
 *
 * Every card submits FINISH with a destination rather than opening the camera
 * on tap: the Form has to stamp onboarding completion before the user lands
 * anywhere, unlike every other add-food surface.
 *
 * Exported (it takes no props and touches no loader data) so
 * `tests/unit/first-food-install.test.ts` can render it for real through
 * `renderToStaticMarkup` and prove the install footnote's position against
 * actual markup rather than the route's source text.
 */
export function FirstFoodStep() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isBusy = navigation.state !== 'idle';
  const destination = navigation.formData?.get('destination');
  const laterLabel =
    isBusy && destination === '/diary' ? t('onboarding.firstFood.finishing') : t('onboarding.firstFood.later');
  return (
    <StepShell title={t('onboarding.step.firstFood.title')} description={t('onboarding.step.firstFood.description')}>
      <Form method="post" className="space-y-3">
        <TimezoneField />
        <input type="hidden" name="_intent" value={INTENT.FINISH} />
        {WAYS_TO_LOG.map((way) => (
          <WayToLogCard key={way.id} way={way} isBusy={isBusy} activeDestination={destination} />
        ))}
        {/* Directly under the speak card. Speaking IS a way to log now, so
            this line is no longer about what the microphone cannot do; it is
            the one privacy fact the card cannot carry in its own two lines,
            that the recording goes to the browser's maker and only TEXT ever
            leaves this app. See `ways-to-log.ts`. */}
        <p className="text-xs text-muted-foreground">{t(WAYS_TO_LOG_SPEECH_PRIVACY_KEY)}</p>
        <div className="pt-1 text-center">
          <Button
            type="submit"
            name="destination"
            value="/diary"
            variant="link"
            disabled={isBusy}
            className="text-muted-foreground"
          >
            {laterLabel}
          </Button>
        </div>
      </Form>
      <FirstFoodKeyNote />
      <FirstFoodInstallNote />
    </StepShell>
  );
}

/**
 * One way in: its drawing, its name, and one plain line saying what it does.
 *
 * The whole card is the submit button, so there is no "learn more" step
 * between reading about a way and using it.
 */
function WayToLogCard({
  way,
  isBusy,
  activeDestination,
}: {
  way: WayToLog;
  isBusy: boolean;
  /** The destination the in-flight submit carries, so only the tapped card spins. */
  activeDestination: FormDataEntryValue | null | undefined;
}) {
  const { t } = useTranslation();
  return (
    <SubmitButton
      name="destination"
      value={way.destination}
      pending={isBusy && activeDestination === way.destination}
      pendingLabel={t('onboarding.firstFood.opening')}
      disabled={isBusy}
      variant="outline"
      className="h-auto w-full justify-start gap-4 whitespace-normal px-4 py-3 text-left"
    >
      {/* The drawing is decoration around the label, so its absence while the
          chunk loads must not move the text: the fallback reserves the box. */}
      <Suspense fallback={<span className="size-10 shrink-0" aria-hidden="true" />}>
        <WayToLogAnimation way={way.id} />
      </Suspense>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t(way.titleKey)}</span>
        <span className="text-xs font-normal text-muted-foreground">{t(way.descriptionKey)}</span>
      </span>
    </SubmitButton>
  );
}

/**
 * Soft, low-key note that photo scanning needs a connection to an AI
 * provider the user sets up themselves — placed BELOW the actions on
 * purpose, because connecting one is deliberately not a step of onboarding.
 * This is also the first (and only) place onboarding mentions it at all —
 * see `LocalFirstExplainer`'s doc comment for why it was pulled off the
 * first step. Spelled out without the "API/AI key" jargon a first-time
 * reader has never heard (per the usability audit), and folds in the
 * on-device privacy promise that used to live on step 1, since it's directly
 * relevant right here. It can't just link to `/settings/ai`: that route sits
 * under the `_personal` onboarding gate, which would bounce a still-mid-
 * onboarding user (no `onboardingCompletedAt`, zero logs) straight back here.
 * So it submits the `finish` intent first — stamping local completion via the
 * same exit machinery as the other actions — and lands on settings with a
 * `?next=diary` return, so connecting a key flows on to the diary.
 */
function FirstFoodKeyNote() {
  const { t } = useTranslation();
  // There is nothing to go and set up when the estimates come with the
  // account, so the question is where the AI comes from (M201/07).
  const { aiComesFromTheInstance } = useInstancePolicy();
  const navigation = useNavigation();
  const isBusy = navigation.state !== 'idle';
  const isOpening = isBusy && navigation.formData?.get('destination') === '/settings/ai?next=diary';
  return (
    <Form
      method="post"
      className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground"
    >
      <TimezoneField />
      <input type="hidden" name="_intent" value={INTENT.FINISH} />
      <Key className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {/* ON A MANAGED INSTANCE THE ESTIMATE IS INCLUDED (M192/05), so this is
          one sentence and no link: there is nothing to go and set up, and the
          old copy sent people to a settings page whose whole content is a
          provider they do not need. */}
      {aiComesFromTheInstance ?
        <span>{t('onboarding.firstFood.managedNote')}</span>
      : <span>
          {t('onboarding.firstFood.keyNote')}{' '}
          <button
            type="submit"
            name="destination"
            value="/settings/ai?next=diary"
            disabled={isBusy}
            className="text-primary underline underline-offset-4 disabled:opacity-60"
          >
            {isOpening ? t('onboarding.firstFood.opening') : t('onboarding.firstFood.keyNoteLink')}
          </button>
        </span>
      }
    </Form>
  );
}

/**
 * The lesson's last footnote: an offer to install the app, placed after
 * `FirstFoodKeyNote` so it reads as the quietest thing on the screen — the
 * three cards above are the lesson, this is a bonus for the platforms that
 * can act on it. First-run is where teaching an install matters most: a
 * returning person who already knows the three ways never sees this step,
 * so the settings hub's `InstallCard` is their only other chance to be told.
 *
 * Renders nothing at all only for a device that ALREADY has the app
 * installed, so there is no empty box and no leftover spacing when there is
 * nothing left to say. A browser that simply cannot install (desktop Firefox,
 * desktop Safari, Chrome before `beforeinstallprompt`) is a different state
 * and gets the plain sentence instead: see `FirstFoodInstallFootnote`.
 *
 * Reuses `InstallAffordanceAction`, `InstallCard`'s own prompt-vs-iOS body,
 * and the same `install.*` copy already shipped for the settings hub, so the
 * platform branching is written in exactly one place and this component only
 * supplies its own quiet layout — matching `FirstFoodKeyNote`'s muted box
 * rather than the settings hub's bordered `Card`, which read as too heavy
 * stacked directly under three cards that are already boxed.
 *
 * Split into this thin hook-reading shell and the exported, prop-driven
 * `FirstFoodInstallFootnote` below, for exactly one reason: `useInstallAffordance`
 * reads browser globals that `renderToStaticMarkup` cannot exercise (no
 * `useEffect`, and `useSyncExternalStore` always takes the server snapshot),
 * so a test that wants real rendered markup for the `'prompt'` and
 * `'ios-instructions'` cases has to render the presentational half directly
 * with explicit props. See `tests/unit/first-food-install.test.ts`.
 */
function FirstFoodInstallNote() {
  const { affordance, promptInstall } = useInstallAffordance();
  return <FirstFoodInstallFootnote affordance={affordance} promptInstall={promptInstall} />;
}

/**
 * The footnote's actual markup, taking the hook's own return shape as props.
 *
 * Answers all four affordance states, because two of them look alike and are
 * not (see `InstallAffordance`):
 *
 * - `'already-installed'`: nothing at all, an empty string rather than an
 *   empty box. The reader is already using the installed app.
 * - `'cannot-install'`: one plain sentence saying openplate installs on a
 *   phone. It is INFORMATION, not an affordance, so it carries no button and
 *   no link: this browser cannot install, and anything pressable here would
 *   either do nothing or promise something it cannot deliver. Teaching that
 *   the app installs is the entire point of this lesson, and desktop Firefox,
 *   desktop Safari and a Chrome that has not fired `beforeinstallprompt` are
 *   the majority of first runs. Saying nothing to them, which is what the
 *   single old `'none'` value did, meant the lesson taught nothing at all.
 * - `'prompt'` and `'ios-instructions'`: the shared `InstallAffordanceAction`
 *   body, unchanged.
 */
export function FirstFoodInstallFootnote({ affordance, promptInstall }: InstallAffordanceControls) {
  const { t } = useTranslation();

  if (affordance === 'already-installed') return null;

  if (affordance === 'cannot-install') {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('install.phoneNote', { appName: APP_NAME })}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
      <Download className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col items-start gap-2">
        <p>
          <span className="font-medium text-foreground">{t('install.title', { appName: APP_NAME })}</span>{' '}
          {t('install.description', { appName: APP_NAME })}
        </p>
        <InstallAffordanceAction affordance={affordance} promptInstall={promptInstall} />
      </div>
    </div>
  );
}
