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
 * That is also why the request is fired and its failure swallowed. There is
 * nothing true to tell somebody about it: the answer would have been `202`.
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
import { Check } from 'lucide-react';

import { FieldError } from '#app/components/field-error';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { canonicalizeEmail } from '#app/lib/sync/email';
import { makeSyncSignInSchema } from '#app/lib/sync/sign-in-schema';
import { requestSyncPasswordReset } from '#app/lib/sync/sync-actions';
import { readAccountHint } from '#app/lib/sync/sync-session';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.forgot') }];

export default function Forgot() {
  const { t } = useTranslation();
  const serverUrl = useSyncServerUrl();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('forgot.title')}</CardTitle>
          <CardDescription>{t('forgot.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {serverUrl === null ?
            <p className="text-sm text-muted-foreground">{t('signIn.unavailable')}</p>
          : <ForgotForm serverUrl={serverUrl} />}
        </CardContent>
      </Card>
    </main>
  );
}

function ForgotForm({ serverUrl }: { serverUrl: string }) {
  const { t } = useTranslation();
  const [isSent, setIsSent] = useState(false);
  // The remembered address, so somebody who has signed in on this device
  // before does not retype it. Read once, at mount, from the same hint the
  // sign-in form uses.
  const [initialEmail] = useState(() => readAccountHint() ?? '');

  const [form, fields] = useForm({
    id: 'forgot-password',
    onValidate({ formData }) {
      // The SIGN-IN schema, deliberately: this form asks for the same one
      // field under the same rules, and a second schema for one address box is
      // how the two end up disagreeing about what an address is.
      return parseWithZod(formData, { schema: makeSyncSignInSchema(t) });
    },
    shouldRevalidate: 'onInput',
    // `passphrase` is not rendered and is never read; the shared schema wants
    // a value, and this is the honest way to say "not asked for here".
    defaultValue: { email: initialEmail, passphrase: 'not-asked-on-this-form' },
    onSubmit(event, { submission }) {
      // Client-side only: the request goes to the sync service's own origin,
      // and the default navigation would abandon it.
      event.preventDefault();
      if (submission?.status !== 'success') return;
      // Fired, never awaited, and its failure swallowed on purpose. The answer
      // is `202` whatever happened, so there is nothing for the person to do
      // differently and nothing true to tell them.
      void requestSyncPasswordReset({ serverUrl, email: canonicalizeEmail(submission.value.email) }).catch(
        () => undefined,
      );
      setIsSent(true);
    },
  });

  if (isSent) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-primary">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('forgot.sent')}
        </p>
        <p className="text-sm text-muted-foreground">{t('forgot.sentHint')}</p>
        <Link to="/sign-in" className="block text-sm text-primary underline-offset-4 hover:underline">
          {t('forgot.backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form {...getFormProps(form)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={fields.email.id}>{t('sync.emailLabel')}</Label>
        <Input
          {...getInputProps(fields.email, { type: 'email' })}
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          className="h-11"
        />
        <FieldError id={fields.email.errorId} errors={fields.email.errors} />
      </div>
      <Button type="submit" className="h-11 w-full">
        {t('forgot.submit')}
      </Button>
      <Link
        to="/sign-in"
        className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('forgot.backToSignIn')}
      </Link>
    </form>
  );
}
