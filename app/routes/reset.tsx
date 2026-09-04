/**
 * `/reset#server=…&token=sr_…` — the screen the mailed link opens.
 *
 * It asks for a new password twice and nothing else. The token in the link
 * identifies the account, and the service hands back the escrowed recovery
 * code when that token is spent, so there is nothing for a person to remember
 * and nothing to type but the password they are choosing. It never asks for
 * the old one: somebody arriving here does not have it.
 *
 * ── Same fragment discipline as `/join` ──────────────────────────────────
 *
 * The token is a LIVE CAPABILITY: whoever holds it can set the password on an
 * account and read the diary behind it. So it rides in the fragment, which no
 * browser sends to any server; `takeResetLinkFromUrl` strips it with
 * `replaceState` the moment it is read and parks it, because clearing the
 * fragment destroys the only copy and a production first visit reloads the
 * whole document when the service worker takes control. The token is consumed
 * on SUBMIT rather than on mount, so a reload before that brings it back and a
 * later visit does not resurrect a spent one.
 *
 * The address in the link is a CHECK, never an instruction, exactly as it is
 * on `/join`: this client sets a password on the server its own operator
 * configured, and a link cannot redirect that.
 *
 * CLIENT-ONLY and TOP-LEVEL. No loader could read the fragment even if one
 * existed.
 */
import { useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Loader2 } from 'lucide-react';

import { FieldError } from '#app/components/field-error';
import { Link } from '#app/components/link';
import { PasswordFields } from '#app/components/password-fields';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { consumeResetToken, isForeignSyncServer, takeResetLinkFromUrl } from '#app/lib/join-link';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { makeSyncRecoverySchema } from '#app/lib/sync/recovery-schema';
import { resetSyncPassphrase } from '#app/lib/sync/sync-actions';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.reset') }];

/**
 * Every screen this route can be on.
 *
 * `invalid-token` covers unknown, spent and expired as ONE outcome, because
 * the service refuses to tell them apart: saying which would report whether a
 * forwarded link had already been used. It is a RETURN from
 * `resetSyncPassphrase`, not a throw, so it renders a card rather than an
 * error screen.
 */
type Phase =
  | { status: 'reading' }
  | { status: 'no-token' }
  | { status: 'foreign-server' }
  | { status: 'form'; resetToken: string }
  | { status: 'working'; resetToken: string }
  | { status: 'invalid-token' }
  | { status: 'failed'; resetToken: string; message: string };

export default function Reset() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverUrl = useSyncServerUrl();
  const [phase, setPhase] = useState<Phase>({ status: 'reading' });

  useEffect(() => {
    const link = takeResetLinkFromUrl({ configuredSyncUrl: serverUrl });
    if (isForeignSyncServer({ linkServerUrl: link.serverUrl, configuredSyncUrl: serverUrl })) {
      setPhase({ status: 'foreign-server' });
      return;
    }
    setPhase(link.resetToken === null ? { status: 'no-token' } : { status: 'form', resetToken: link.resetToken });
  }, [serverUrl]);

  async function submit({ resetToken, passphrase }: { resetToken: string; passphrase: string }): Promise<void> {
    if (serverUrl === null) return;
    setPhase({ status: 'working', resetToken });
    // CONSUMED HERE, on submit rather than on mount: until this moment a
    // reload has to be able to bring the token back, and after it a later
    // visit must not resurrect one the service has spent.
    consumeResetToken();
    try {
      const result = await resetSyncPassphrase({ serverUrl, resetToken, newPassphrase: passphrase });
      if (result.status === 'invalid') {
        setPhase({ status: 'invalid-token' });
        return;
      }
      // The reset OPENS the session, so there is nothing else to ask for. `/`
      // is behind the onboarding gate, which sends a returning person to their
      // diary and a brand-new one to the questionnaire.
      void navigate('/');
    } catch (cause) {
      setPhase({ status: 'failed', resetToken, message: describeErrorForUser(cause, t('reset.failed')) });
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('reset.title')}</CardTitle>
          <CardDescription>{t('reset.body')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {serverUrl === null && <p className="text-sm text-muted-foreground">{t('signIn.unavailable')}</p>}
          {phase.status === 'reading' && serverUrl !== null && (
            <output className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('reset.working')}
            </output>
          )}
          {phase.status === 'working' && (
            <output className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('reset.working')}
            </output>
          )}
          {(phase.status === 'no-token' || phase.status === 'invalid-token' || phase.status === 'foreign-server') && (
            <InvalidTokenCard reason={phase.status} />
          )}
          {(phase.status === 'form' || phase.status === 'failed') && (
            <ResetForm
              message={phase.status === 'failed' ? phase.message : null}
              onSubmit={(passphrase) => void submit({ resetToken: phase.resetToken, passphrase })}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * The link does not work, in one of three ways that need the same next step.
 *
 * `no-token`, `invalid-token` and `foreign-server` are separate PHASES because
 * they are separate facts, and one sentence each because the action is
 * identical: ask for a new link. Only the foreign-server case names anything
 * different, since that one is about the wrong app rather than the wrong link.
 */
function InvalidTokenCard({ reason }: { reason: 'no-token' | 'invalid-token' | 'foreign-server' }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-2 text-center">
      <p className="text-sm font-medium">{t('reset.invalid.title')}</p>
      <p className="text-sm text-muted-foreground">
        {reason === 'foreign-server' ? t('reset.invalid.otherApp') : t('reset.invalid.body')}
      </p>
      <Link to="/forgot" className="block text-sm text-primary underline-offset-4 hover:underline">
        {t('reset.invalid.askAgain')}
      </Link>
    </div>
  );
}

function ResetForm({ message, onSubmit }: { message: string | null; onSubmit: (passphrase: string) => void }) {
  const { t } = useTranslation();
  const [form, fields] = useForm({
    id: 'reset-password',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeSyncRecoverySchema(t) });
    },
    // Nothing red before the person asks for it, but a corrected field clears
    // its own error as it is typed. See `.claude/conform-to-react.md`.
    shouldRevalidate: 'onInput',
    onSubmit(event, { submission }) {
      event.preventDefault();
      if (submission?.status !== 'success') return;
      onSubmit(submission.value.passphrase);
    },
  });

  return (
    <form {...getFormProps(form)} className="space-y-4">
      {message !== null && <p className="text-sm text-red-600 dark:text-red-400">{message}</p>}
      <PasswordFields
        passphrase={fields.passphrase}
        confirmPassphrase={fields.confirmPassphrase}
        passwordLabel={t('reset.newPasswordLabel')}
      />
      <FieldError id={form.errorId} errors={form.errors} />
      <Button type="submit" className="h-11 w-full">
        {t('reset.submit')}
      </Button>
    </form>
  );
}
