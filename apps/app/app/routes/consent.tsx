/**
 * `/consent?next=<path>`: the one time an existing account is asked for its
 * explicit consent to health data (owner decision, 2026-09-28).
 *
 * A hosted instance names Art. 9(2)(a) GDPR, explicit consent, as the legal
 * basis for the diary, because its operator holds the escrowed recovery code
 * that can open it. An account created on `/join` agreed there. An account
 * created before the instance asked, or one that agreed to an older wording,
 * is sent here by the consent gate in `_personal.tsx`'s loader
 * (`#app/lib/health-consent/consent-gate`), and nowhere else in the app opens
 * for it until it agrees.
 *
 * ── WHERE IT SITS ────────────────────────────────────────────────────────
 *
 * INSIDE `_personal`, so the header, the menu and the way to sign out stay on
 * screen, and OUTSIDE the paid lock: it is in the plan gate's exempt list, so a
 * locked account sees this first and the plan page second. The two ways out
 * that need no consent are plain links under the button, the export and the
 * account page (delete, sign out), and both are exempt from the consent gate.
 *
 * ── WHAT "AGREE AND CONTINUE" DOES ───────────────────────────────────────
 *
 * The client action sends the version the instance publishes to
 * `POST /v1/auth/account/health-consent` (`PROTOCOL.md` §5.15.1), puts the
 * account view it returns into the session, starts a sync cycle for the writes
 * the core refused while the consent was missing, and navigates to `next`. The
 * gate reads the session at that navigation, so it lets the person through,
 * and the plan gate after it decides as it always does.
 *
 * TWO ROADS LEAD HERE: the gate in `_personal.tsx`'s loader, and a data route
 * the core refused with `403 health-consent-required`, which makes the layout
 * ask that gate again with fresh facts (`ConsentGateWatcher`).
 *
 * - `400 health-consent-required`: the wording changed while the screen was
 *   open. The facts are dropped, so the next read is fresh, and the box comes
 *   back unticked with the message under it.
 * - `404`: the instance stopped asking. There is nothing to record, so the
 *   screen continues.
 * - Anything else: a line under the button says it was not saved.
 *
 * `next` is guarded twice, here and in the loader, by `safeConsentNext`: only
 * a path on this origin, and never this screen itself.
 */
import { getFormProps, getInputProps, useForm, type SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { useTranslation } from 'react-i18next';
import { Form, redirect, useActionData, useLoaderData, useNavigation, type MetaFunction } from 'react-router';
import { z } from 'zod';

import type { Route } from './+types/consent';
import { HealthConsentField } from '#app/components/health-consent-field';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SETTINGS_INSET_CLASS } from '#app/components/settings/settings-section';
import { SubmitButton } from '#app/components/submit-button';
import i18nSingleton from '#app/i18n/i18n';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  currentConsentGateSession,
  decideConsentScreen,
  forgetConsentGateFacts,
  readRequiredConsent,
} from '#app/lib/health-consent/consent-gate-facts';
import { safeConsentNext } from '#app/lib/health-consent/consent-gate';
import { isHealthConsentRefusal, isHealthConsentRouteAbsent } from '#app/lib/health-consent/health-consent';
import { TICKED_CHECKBOX_VALUE } from '#app/lib/sync/signup-schema';
import type { Translate } from '#app/lib/sync/setup-flow';
import { recordHealthConsent, syncNow } from '#app/lib/sync/sync-actions';
import { cn } from '#app/lib/utils';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.healthConsent') }];

export const handle = {
  title: 'Your consent',
  titleKey: 'healthConsent.title',
};

/**
 * Translation lookup for `clientAction`, which runs outside React. Safe:
 * `clientAction` only ever executes in the browser, where the i18next
 * singleton IS the live, language-synced instance.
 */
const actionT: Translate = (key, params) => i18nSingleton.t(key, params ?? {});

/**
 * The form: the page to continue to, and the box. An unticked box is refused
 * under the box, in the browser, and nothing is sent.
 */
function makeConsentSchema(t: Translate) {
  return z.object({
    next: z.string().default(''),
    healthConsent: z
      .string()
      .default('')
      .refine((value) => value === TICKED_CHECKBOX_VALUE, { message: t('healthConsent.requiredToContinue') }),
  });
}

/**
 * Asks, or goes straight on to `next` when there is nothing to ask: a consent
 * already on record, an instance that asks for none, no session, or a fact
 * that cannot be read (`decideConsentScreen`).
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const raw = new URL(request.url).searchParams.get('next');
  const decision = await decideConsentScreen({ next: raw });
  if (decision.kind === 'continue') throw redirect(decision.destination);
  return { next: safeConsentNext(raw) };
}
clientLoader.hydrate = true as const;

/** The server render has no session to ask about. The layout's loading screen covers the first paint; this covers a later run. */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="mx-auto max-w-xl text-sm text-muted-foreground">{t('chrome.loading')}</p>;
}

/** Records the consent and continues, or says why it could not. See the header for each answer. */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const submission = parseWithZod(await request.formData(), { schema: makeConsentSchema(actionT) });
  if (submission.status !== 'success') return submission.reply();
  const next = safeConsentNext(submission.value.next);
  const session = currentConsentGateSession();
  // Signed out underneath the screen: there is nobody to record anything for.
  if (session === null) return redirect(next);
  const required = await readRequiredConsent({ serverUrl: session.serverUrl });
  if (required.kind === 'asks-nothing') return redirect(next);
  if (required.kind === 'unknown') return submission.reply({ formErrors: [actionT('healthConsent.failed')] });
  try {
    await recordHealthConsent({ version: required.version });
  } catch (error) {
    if (isHealthConsentRefusal(error)) {
      forgetConsentGateFacts();
      return submission.reply({
        fieldErrors: { healthConsent: [actionT('healthConsent.requiredToContinue')] },
        hideFields: ['healthConsent'],
      });
    }
    if (isHealthConsentRouteAbsent(error)) {
      forgetConsentGateFacts();
      return redirect(next);
    }
    return submission.reply({ formErrors: [actionT('healthConsent.failed')] });
  }
  // THE HELD WRITES GO UP NOW. openplate-core refuses every data write to an
  // account without the consent (2026-09-29), so whatever this device changed
  // while it was missing is still pending. Fired and never awaited, the way
  // the setup ceremony does it: the consent is on record, and a round trip
  // would only hold this screen.
  void syncNow().catch(() => undefined);
  return redirect(next);
}

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { next } = useLoaderData<typeof clientLoader>();
  // SAFETY: this route's `clientAction` only ever resolves to a
  // `parseWithZod(...).reply()` or a redirect, which never reaches here.
  const lastResult = useActionData<typeof clientAction>() as SubmissionResult<string[]> | undefined;
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting' && navigation.formMethod?.toLowerCase() === 'post';

  const [form, fields] = useForm({
    id: 'health-consent',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeConsentSchema(t) });
    },
    // A tick given after the message was shown clears it at once.
    shouldRevalidate: 'onInput',
    defaultValue: { next, healthConsent: '' },
  });
  // Conform's `key` goes on the element it remounts, never into a spread.
  const { key: consentKey, ...consentInputProps } = getInputProps(fields.healthConsent, { type: 'checkbox' });
  const hasFailed = (form.errors?.length ?? 0) > 0;
  const linkClass = 'text-sm text-primary underline underline-offset-4';

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <section
        data-slot="health-consent-screen"
        aria-labelledby="health-consent-heading"
        className={cn(SETTINGS_INSET_CLASS, 'space-y-4 p-4')}
      >
        <h2 id="health-consent-heading" className="text-lg font-semibold leading-snug">
          {t('healthConsent.heading')}
        </h2>
        <p className="text-sm">{t('healthConsent.body')}</p>
        <Form method="post" {...getFormProps(form)} className="space-y-4">
          <input type="hidden" name={fields.next.name} value={next} />
          <HealthConsentField
            key={consentKey}
            inputProps={consentInputProps}
            messageId={fields.healthConsent.errorId}
            message={t('healthConsent.requiredToContinue')}
            isMessageShown={(fields.healthConsent.errors?.length ?? 0) > 0}
          />
          <SubmitButton pending={isSaving} pendingLabel={t('healthConsent.saving')} className="h-11 w-full">
            {t('healthConsent.agree')}
          </SubmitButton>
          {/* HELD FROM THE FIRST PAINT, like the line under the box: the
              sentence is always there and only shown when a save failed, so
              the links below never move. */}
          <p
            id={form.errorId}
            data-slot="health-consent-failed"
            role={hasFailed ? 'alert' : undefined}
            className={cn('text-sm text-red-600 dark:text-red-400', !hasFailed && 'invisible')}
          >
            {t('healthConsent.failed')}
          </p>
        </Form>
      </section>
      {/* THE TWO WAYS OUT THAT NEED NO CONSENT, plain links and not buttons:
          neither is what this screen asks for, and both pages stay open to an
          account that has not agreed. */}
      <nav className="flex flex-col items-start gap-3 px-4">
        <Link to="/settings/data" className={linkClass}>
          {t('healthConsent.exportDiary')}
        </Link>
        <Link to="/settings/account" className={linkClass}>
          {t('healthConsent.deleteAccount')}
        </Link>
      </nav>
    </div>
  );
}
