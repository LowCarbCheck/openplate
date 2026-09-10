/**
 * settings.life-phase.tsx: pregnancy and breastfeeding, on a page of their own
 * (M215 spec 01).
 *
 * The question used to be a fieldset at the bottom of the body metrics card on
 * `/settings/goals`, which is a page about eating targets. A person looking for
 * "I am pregnant" had no reason to open "Ziele" and no row anywhere that said
 * the setting existed. It has a hub row now, always visible, and this page.
 *
 * ── The fieldset is the SAME component, never a fork ───────────────────────
 *
 * `ReproductiveStatusFields` is shared with the onboarding body step. Both
 * screens import the one component, so they cannot drift about what may be
 * entered about one pregnancy, and the gate ("anyone who did not answer male")
 * stays inside it rather than being restated here.
 *
 * ── A save here touches three fields, and preserves the rest ───────────────
 *
 * `putLocalBodyMetrics` writes the WHOLE record, and a `null` in it clears.
 * This page never shows the height, the birth year or the sex answer, so the
 * action reads the stored record first and merges only what this form
 * submitted. Without that read, saving a life phase would silently erase three
 * answers the person gave on another page.
 *
 * Local-first like every other tracker surface: no server loader, no server
 * action, nothing about this page ever leaves the device.
 */
import type { Route } from './+types/settings.life-phase';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, useForm } from '@conform-to/react';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { todayInTimezone } from '#app/lib/user-days';
import { redirectWithLocalToast } from '#app/lib/client-toast';
import { trackGoalsSaved } from '#app/lib/matomo-events';
import { cn } from '#app/lib/utils';
import {
  getLocalBodyMetrics,
  getLocalProfileGoals,
  putLocalBodyMetrics,
  resolveLocalTimezone,
} from '#app/lib/local-store';
import { makeLifePhaseSchema } from '#app/lib/body-metrics-schema';
import type { Translate } from '#app/lib/body-metrics-schema';
import { bodyMetricsFormKey } from '#app/models/body-metrics';
import type { BodyMetrics } from '#app/models/body-metrics';
import { ReproductiveStatusFields } from '#app/components/reproductive-status-fields';
import type { ReproductiveStatusValue } from '#app/components/reproductive-status-fields';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import i18nSingleton from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.lifePhase') },
];

export const handle = {
  title: 'Life phase',
  titleKey: 'lifePhase.title',
  backTo: '/settings',
};

/**
 * Translation lookup for `clientAction`, which runs outside React and therefore
 * has no `useTranslation`. Safe: `clientAction` only ever executes in the
 * browser, where the i18next singleton IS the live, language-synced instance
 * (see `app/i18n/I18nProvider.tsx`, only the server render uses a clone).
 */
const actionT: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

//////////////////////////////////////////////////////////////////////////////
// Loaders
//////////////////////////////////////////////////////////////////////////////

/** No server work: this route's data comes entirely from the on-device primary store via `clientLoader`. */
export async function loader() {
  return {};
}

export async function clientLoader() {
  const profile = await getLocalProfileGoals();
  // The person's OWN calendar day, not the browser's: the fieldset turns a due
  // date into a trimester against it, exactly as the dashboard does.
  const today = todayInTimezone(resolveLocalTimezone(profile));
  const bodyMetrics = await getLocalBodyMetrics();
  return { bodyMetrics, today };
}
clientLoader.hydrate = true as const;

/** Shown while the client loader reads the stored record off the device. */
export function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('lifePhase.loading')}
    </output>
  );
}

//////////////////////////////////////////////////////////////////////////////
// Action (local-store write, no server round-trip)
//////////////////////////////////////////////////////////////////////////////

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: makeLifePhaseSchema(actionT, { today: new Date() }) });
  if (submission.status !== 'success') return submission.reply();

  // Read, merge, write back: this form carries three fields and the record has
  // six. `putLocalBodyMetrics` applies the sex/status/date invariants itself.
  const stored = await getLocalBodyMetrics();
  await putLocalBodyMetrics({ ...stored, ...submission.value });
  trackGoalsSaved('body-metrics');
  return redirectWithLocalToast('/settings/life-phase', {
    type: 'success',
    description: actionT('bodyMetrics.toast.saved'),
  });
}

//////////////////////////////////////////////////////////////////////////////
// Component
//////////////////////////////////////////////////////////////////////////////

/**
 * Shared chip recipe, the same one the body metrics card on `/settings/goals`
 * uses, so the chips look identical wherever this fieldset is rendered
 * (DESIGN.md §2/§11, tokens only).
 */
function chipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
  );
}

function LifePhaseCard({ metrics, today }: { metrics: BodyMetrics; today: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const isSaving = fetcher.state !== 'idle';
  // React state for the chips and the two dates, because the fieldset paints
  // from their live value and the weeks-along helper WRITES the due date.
  // Conform still owns the names, the ids and the errors.
  const [reproductive, setReproductive] = useState<ReproductiveStatusValue>({
    reproductiveStatus: metrics.reproductiveStatus ?? 'none',
    pregnancyDueDate: metrics.pregnancyDueDate ?? '',
    lactationStartDate: metrics.lactationStartDate ?? '',
  });

  const [form, fields] = useForm({
    id: 'life-phase',
    // SAFETY: this route's `clientAction` only ever resolves to a
    // `parseWithZod(...).reply()` or a redirect.
    lastResult: fetcher.data as SubmissionResult<string[]> | undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLifePhaseSchema(t, { today: new Date() }) });
    },
    // Nothing is red before you ask for it, but a corrected date clears its own
    // error as it is typed rather than at the next submit.
    shouldRevalidate: 'onInput',
    defaultValue: {
      reproductiveStatus: reproductive.reproductiveStatus,
      pregnancyDueDate: reproductive.pregnancyDueDate,
      lactationStartDate: reproductive.lactationStartDate,
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('lifePhase.title')}</CardTitle>
        <CardDescription>{t('lifePhase.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" {...getFormProps(form)} className="space-y-6">
          {/*
            The stored sex answer, not a field on this page: this page does not
            ask for it, and the component's own gate reads it. Someone who
            answered "male" sees the card's explanation and no chips, which is
            the same behaviour the body metrics card had.
          */}
          <ReproductiveStatusFields
            biologicalSex={metrics.biologicalSex}
            value={reproductive}
            onChange={setReproductive}
            today={today}
            statusName={fields.reproductiveStatus.name}
            dueDateField={{
              name: fields.pregnancyDueDate.name,
              id: fields.pregnancyDueDate.id,
              errorId: fields.pregnancyDueDate.errorId,
              errors: fields.pregnancyDueDate.errors,
            }}
            lactationStartDateField={{
              name: fields.lactationStartDate.name,
              id: fields.lactationStartDate.id,
              errorId: fields.lactationStartDate.errorId,
              errors: fields.lactationStartDate.errors,
            }}
            chipClassName={chipClass}
          />

          <FieldError id={form.errorId} errors={form.errors} />

          <SubmitButton pending={isSaving} pendingLabel={t('goals.saving')} className="h-11 sm:h-9">
            {t('bodyMetrics.save')}
          </SubmitButton>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

export default function SettingsLifePhase({ loaderData }: Route.ComponentProps) {
  const { bodyMetrics, today } = loaderData;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* KEYED off the stored record, for the same reason the body metrics card
          is: the chips and the dates are seeded once from the store, so only a
          remount can show what a save just wrote. The key moves when the STORE
          moves, never while somebody is typing. */}
      <LifePhaseCard key={bodyMetricsFormKey(bodyMetrics)} metrics={bodyMetrics} today={today} />
    </div>
  );
}
