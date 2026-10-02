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
 * ── It ends where a sign-in ends ─────────────────────────────────────────
 *
 * A finished reset pulls the diary and then asks the onboarding gate, exactly
 * as `/sign-in` does and through the same hook (`use-first-pull.ts`). It used
 * to navigate to `/` the moment the ceremony returned, which is the marketing
 * page, and it arrived before the diary: on the 2026-09-04 walk an account
 * with a diary was handed the first-run questionnaire, and the entries turned
 * up afterwards behind the answers.
 *
 * ── A device that holds another account's diary (ADR-0022) ──────────────
 *
 * The link names no address, and the core cannot read a token without
 * spending it, so the account is known only once the token is spent. On a
 * device locked to another account the reset then stops BEFORE it recovers or
 * rotates anything (`device-held`): a refusal after the rotation would strand
 * the account's private compartment on doors that no longer exist. The step
 * says the link is used up and the old password still works; its erase leads
 * to `/forgot`, filled in for the address the link was for, because a new
 * link returns the same escrowed code.
 *
 * CLIENT-ONLY and TOP-LEVEL. No loader could read the fragment even if one
 * existed.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { getFormProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Loader2 } from 'lucide-react';

import { AccountSwitchCard } from '#app/components/account-switch-card';
import { FieldError } from '#app/components/field-error';
import { FirstPullStatus } from '#app/components/first-pull-status';
import { HealthConsentStep } from '#app/components/health-consent-step';
import { Link } from '#app/components/link';
import { PasswordFields } from '#app/components/password-fields';
import { AccountsNeedHttps } from '#app/components/accounts-need-https';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useCanRunAccounts } from '#app/hooks/use-can-run-accounts';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { useFirstPull } from '#app/hooks/use-first-pull';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { consumeResetToken, isForeignSyncServer, takeResetLinkFromUrl } from '#app/lib/join-link';
import { trackPasswordResetCompleted } from '#app/lib/matomo-events';
import { readHeldDiaryNotice } from '#app/lib/sync/account-switch';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import type { EraseNoticeLine } from '#app/lib/sync/erase-notice';
import type { DeviceLockOwner } from '#app/lib/sync/sync-state';
import { makeSyncRecoverySchema } from '#app/lib/sync/recovery-schema';
import type { SignInDestination } from '#app/lib/sign-in-flow';
import { resetSyncPassphrase, type ResetSyncPassphraseResult } from '#app/lib/sync/sync-actions';
import { useAppNavigate } from '#app/hooks/use-app-navigate';

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
  /**
   * The instance asks every account for a consent to health data and this one
   * does not hold it (M266). The recovery has stopped before its first write,
   * so nothing has rotated yet, and `continueWithConsent` holds the escrowed
   * code and the new password until the box is ticked. Leaving here changes
   * nothing: the old password still works and a new link still resets.
   */
  | {
      status: 'consent';
      resetToken: string;
      continueWithConsent: () => Promise<ResetSyncPassphraseResult>;
    }
  /**
   * The password is set and the session is open; the diary is on its way.
   *
   * A SEPARATE PHASE, and the one this route was missing. Without it the reset
   * ended the moment the ceremony did, and the gate was asked where to send
   * somebody whose profile row was still inside an undownloaded snapshot: it
   * answered "the first-run questionnaire", to an account with a diary.
   */
  | { status: 'pulling' }
  /**
   * The device holds another account's diary (ADR-0022). The link is spent
   * and nothing else happened: no recovery, no rotation, no session. `lines`
   * are what an erase would lose, read before this phase is set.
   */
  | { status: 'device-held'; owner: DeviceLockOwner | null; email: string; lines: EraseNoticeLine[] }
  | { status: 'invalid-token' }
  | { status: 'failed'; resetToken: string; message: string };

export default function Reset() {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const serverUrl = useSyncServerUrl();
  // Setting a password is a key ceremony in `crypto.subtle`, which a
  // plain-http page off this computer does not have. The link is still read
  // and taken out of the address bar below; only the form is withheld.
  const canRunAccounts = useCanRunAccounts();
  const [phase, setPhase] = useState<Phase>({ status: 'reading' });
  // THE SAME PULL `/sign-in` RUNS, from the same hook: wait for the snapshot,
  // then ask the gate. There is no parked invitation to spend here, which is
  // the only difference between the two call sites.
  const firstPull = useFirstPull({
    onArrived: useCallback((path: SignInDestination) => void navigate(path), [navigate]),
  });

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
    // CONSUMED HERE, on submit rather than on mount: until this moment a
    // reload has to be able to bring the token back, and after it a later
    // visit must not resurrect one the service has spent.
    consumeResetToken();
    await settle({ resetToken, run: () => resetSyncPassphrase({ serverUrl, resetToken, newPassphrase: passphrase }) });
  }

  /** Runs one step of the reset and moves to the screen its answer calls for. */
  async function settle({
    resetToken,
    run,
  }: {
    resetToken: string;
    run: () => Promise<ResetSyncPassphraseResult>;
  }): Promise<void> {
    setPhase({ status: 'working', resetToken });
    try {
      const result = await run();
      if (result.status === 'invalid') {
        setPhase({ status: 'invalid-token' });
        return;
      }
      if (result.status === 'consent-required') {
        setPhase({ status: 'consent', resetToken, continueWithConsent: result.continueWithConsent });
        return;
      }
      if (result.status === 'device-held') {
        // Read while the spinner is still up, so the step is drawn once, settled.
        const lines = await readHeldDiaryNotice({ owner: result.owner });
        setPhase({ status: 'device-held', owner: result.owner, email: result.email, lines });
        return;
      }
      // THE RESET OPENS THE SESSION, and that is only half of getting back in.
      // The profile row travels inside the encrypted snapshot, so the pull has
      // to finish before anything can ask where this person belongs. Landing
      // on `/` was doubly wrong: it is the marketing page, and it arrived
      // before the diary did.
      trackPasswordResetCompleted();
      setPhase({ status: 'pulling' });
      firstPull.start();
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
          {serverUrl !== null && !canRunAccounts && <AccountsNeedHttps />}
          {canRunAccounts && (
            <>
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
              {/* The pull, and its retry, in the same words `/sign-in` uses. A
                  failed pull leaves the new password in place and the session
                  open: only the download failed, so the retry repeats the download
                  and never asks for a password again. */}
              {phase.status === 'pulling' && firstPull.phase.status !== 'idle' && (
                <FirstPullStatus phase={firstPull.phase} onRetry={firstPull.start} />
              )}
              {/* THE CONSENT, ASKED BEFORE ANYTHING ROTATES (M266). The same
                  box and words as `/consent`; ticking it records the consent
                  and finishes the reset with the password already typed. */}
              {phase.status === 'consent' && (
                <HealthConsentStep
                  onAgree={() => void settle({ resetToken: phase.resetToken, run: phase.continueWithConsent })}
                />
              )}
              {phase.status === 'device-held' && (
                <AccountSwitchCard
                  owner={phase.owner}
                  lines={phase.lines}
                  incomingEmail={phase.email}
                  destination="/forgot"
                  isResetSpent
                  onCancel={() => void navigate('/welcome')}
                />
              )}
              {(phase.status === 'no-token' ||
                phase.status === 'invalid-token' ||
                phase.status === 'foreign-server') && <InvalidTokenCard reason={phase.status} />}
              {(phase.status === 'form' || phase.status === 'failed') && (
                <ResetForm
                  message={phase.status === 'failed' ? phase.message : null}
                  onSubmit={(passphrase) => void submit({ resetToken: phase.resetToken, passphrase })}
                />
              )}
            </>
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
