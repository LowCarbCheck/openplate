/**
 * `/forgot` — an address, and a mail on its way.
 *
 * ── The one property this page has, and it is a refusal ──────────────────
 *
 * IT ANSWERS THE SAME WAY WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT. The
 * service returns `202` either way, deliberately, so that this form cannot be
 * used to ask whether a colleague is a member of the organization. The screen
 * has to match: one confirmation sentence, shown after every submission, with
 * nothing in it that differs between the two cases. A "we could not find that
 * address" would be the oracle the endpoint exists to refuse, rebuilt in the
 * UI.
 *
 * A FAILURE IS SAID, BECAUSE IT SAYS NOTHING ABOUT THE ADDRESS. A request
 * that never reached the service, or one the service refused, fails the same
 * way for every address, so the page says which of the two it was. It used to
 * swallow both, and a person on an unreachable instance was told a link was
 * on its way.
 *
 * AN INSTANCE WITH NO MAIL IS TOLD APART, before anything is sent. Its
 * `/health` says `mail: false`, and there the only way back in is a link the
 * administrator makes in the console. See `#app/lib/sync/forgot-schema` for
 * both decisions and the report that found the form never submitting at all.
 *
 * NOTHING MOVES WHEN THE FORM TURNS INTO ITS ANSWER. The form and the two
 * answers share one grid cell, as tall as the tallest of them from the first
 * paint, the same recipe `/sign-up` uses (DESIGN.md section 7).
 *
 * CLIENT-ONLY and TOP-LEVEL, like `/sign-in` and `/welcome`. It exports no
 * loader and no action: the address is typed here, the request goes to the
 * sync service's own origin, and none of it is this server's business. It sits
 * outside `_personal` because that layout's gate redirects to screens like
 * this one, and a route nested inside it would be redirected away from itself.
 */
import { useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Check, Loader2 } from 'lucide-react';

import { AccountsNeedHttps } from '#app/components/accounts-need-https';
import { CredentialSubmitButton } from '#app/components/credential-submit-button';
import { FieldError } from '#app/components/field-error';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useCanRunAccounts } from '#app/hooks/use-can-run-accounts';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { trackPasswordResetRequested } from '#app/lib/matomo-events';
import { canonicalizeEmail } from '#app/lib/sync/email';
import { decideForgotRequest, describeForgotFailure, makeForgotPasswordSchema } from '#app/lib/sync/forgot-schema';
import { requestSyncPasswordReset } from '#app/lib/sync/sync-actions';
import { readAccountHint } from '#app/lib/sync/sync-session';
import { cn } from '#app/lib/utils';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.forgot') }];

export default function Forgot() {
  const { t } = useTranslation();
  const serverUrl = useSyncServerUrl();
  // The link a reset mails lands on `/reset` at this same address, and setting
  // a password there needs `crypto.subtle`, which a plain-http page off this
  // computer does not have. Asking for a link that cannot be used is the
  // doomed attempt the notice replaces.
  const canRunAccounts = useCanRunAccounts();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('forgot.title')}</CardTitle>
          <CardDescription>{t('forgot.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {serverUrl === null && <p className="text-sm text-muted-foreground">{t('signIn.unavailable')}</p>}
          {serverUrl !== null && !canRunAccounts && <AccountsNeedHttps />}
          {serverUrl !== null && canRunAccounts && <ForgotForm serverUrl={serverUrl} />}
        </CardContent>
      </Card>
    </main>
  );
}

/** Where the one request is. `sent` and `no-mail` are terminal: the answer stays until the page is left. */
type ForgotState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'no-mail' }
  | { kind: 'problem'; problem: 'unreachable' | 'failed' };

function ForgotForm({ serverUrl }: { serverUrl: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ForgotState>({ kind: 'idle' });
  // The remembered address, so somebody who has signed in on this device
  // before does not retype it. Read once, at mount, from the same hint the
  // sign-in form uses.
  const [initialEmail] = useState(() => readAccountHint() ?? '');
  const isAnswered = state.kind === 'sent' || state.kind === 'no-mail';

  const [form, fields] = useForm({
    id: 'forgot-password',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeForgotPasswordSchema(t) });
    },
    shouldRevalidate: 'onInput',
    defaultValue: { email: initialEmail },
    onSubmit(event, { submission }) {
      // No action to post to: the request goes to the sync service's own
      // origin, from this browser.
      event.preventDefault();
      if (submission?.status !== 'success') return;
      void send(canonicalizeEmail(submission.value.email));
    },
  });

  async function send(email: string): Promise<void> {
    setState({ kind: 'sending' });
    // The tab's `/health` answer, usually in hand long before anybody has
    // typed an address; awaited here for the rare submit that is faster.
    const instance = await readCachedServerInstance(serverUrl);
    if (decideForgotRequest(instance) === 'no-mail') {
      setState({ kind: 'no-mail' });
      return;
    }
    try {
      await requestSyncPasswordReset({ serverUrl, email });
      trackPasswordResetRequested();
      setState({ kind: 'sent' });
    } catch (cause) {
      setState({ kind: 'problem', problem: describeForgotFailure(cause) });
    }
  }

  return (
    <div className="space-y-4">
      {/* ONE CELL, THREE LAYERS: see the file header. `inert` keeps a hidden
          layer out of the tab order and away from a screen reader.
          `[&_*]:transition-none` hides the form's button in the same frame as
          the form: the button's own `transition-all` would otherwise animate
          the inherited `visibility` and keep it drawn for 150 ms under the
          answer. The same fix as `ReturnState` in `settings.plan.tsx`, whose
          comment has the mechanism; `invisible-button-flash.spec.ts` watches
          every frame of the change. */}
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        <form
          {...getFormProps(form)}
          className={cn('space-y-3', isAnswered && 'invisible [&_*]:transition-none')}
          inert={isAnswered}
        >
          <div className="space-y-2">
            <Label htmlFor={fields.email.id}>{t('sync.emailLabel')}</Label>
            <Input
              {...getInputProps(fields.email, { type: 'email' })}
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              className="h-11"
            />
            {/* One reserved line, so a message that appears while typing
                moves nothing under it. */}
            <div className="min-h-5">
              <FieldError id={fields.email.errorId} errors={fields.email.errors} />
            </div>
          </div>
          {/* THE PROBLEM LINE, two lines reserved: the service could not be
              reached, or it refused. */}
          <output data-slot="forgot-problem" className="block min-h-10 text-sm text-red-600 dark:text-red-400">
            {state.kind === 'problem' && t(state.problem === 'unreachable' ? 'forgot.unreachable' : 'forgot.failed')}
          </output>
          {/* Disabled in the server-rendered markup, like every other credential
              form's submit. This one carries no passphrase, but the leak is the
              same shape: a native pre-hydration GET puts the address in the bar,
              in history and in the next `Referer`, on the one page whose whole
              design is to reveal nothing about who has an account. It would also
              be a silent failure, because the request that mails the link is
              fired from this browser and a native submit abandons it. See
              `credential-submit-button.tsx`. */}
          <CredentialSubmitButton className="h-11 w-full" disabled={state.kind === 'sending'}>
            {state.kind === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('forgot.submit')}
          </CredentialSubmitButton>
        </form>
        <output
          data-slot="forgot-sent"
          className={cn('space-y-2 self-center text-sm', state.kind !== 'sent' && 'invisible')}
        >
          <span className="flex items-start gap-2 text-primary">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('forgot.sent')}
          </span>
          <span className="block text-muted-foreground">{t('forgot.sentHint')}</span>
        </output>
        <output
          data-slot="forgot-no-mail"
          className={cn('space-y-2 self-center text-sm', state.kind !== 'no-mail' && 'invisible')}
        >
          <span className="block font-medium">{t('forgot.noMail')}</span>
          <span className="block text-muted-foreground">{t('forgot.noMailHint')}</span>
        </output>
      </div>
      <Link
        to="/sign-in"
        className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('forgot.backToSignIn')}
      </Link>
    </div>
  );
}
