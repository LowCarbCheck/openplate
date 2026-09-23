/**
 * `/sign-up`, an address and a letter on its way (M253/02).
 *
 * ── A route, not a box on `/welcome` ─────────────────────────────────────
 *
 * The header's "Sign up" sits on every public page, and a person who pressed
 * it must land on the form rather than on a screen that first asks whether
 * they have a diary. `/welcome` links here too, so the form exists once.
 *
 * ── It answers the same way for every address ────────────────────────────
 *
 * The service answers `202` for a new address, a pending one and an existing
 * account (`PROTOCOL.md` §5.8.3), and the screen matches: one sentence, "check
 * your inbox". Unlike `/forgot`, the failures are shown, because a throttle, a
 * refused challenge and a blocked domain each ask for something different, and
 * none of them says anything about the address.
 *
 * ── Nothing moves when the form turns into the sentence ──────────────────
 *
 * The form and the sentence share ONE grid cell. The cell is as tall as the
 * taller of the two from the first paint, the form turns `invisible` and the
 * sentence visible, so the link under the box stays where it was
 * (DESIGN.md §7, `tests/e2e/open-signup.spec.ts` measures it). The field's
 * error, the problem line and the challenge each reserve their own box too.
 *
 * ── The challenge is the only third-party script, and only here ─────────
 *
 * When the handshake names a Turnstile key (`instance.signupCaptcha`), this
 * page loads Cloudflare's script, explicitly rendered, and sends the token
 * with the request. No other page loads it for sign-up, and an instance with
 * no key loads nothing. The CSP names Cloudflare only on a managed instance
 * (`content-security-policy.ts`, `signupCaptchaPossible`).
 *
 * CLIENT-ONLY and TOP-LEVEL, like `/sign-in` and `/forgot`: the address goes
 * to the sync service's own origin and none of it is this server's business.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Check, Loader2 } from 'lucide-react';

import { CredentialSubmitButton } from '#app/components/credential-submit-button';
import { FieldError } from '#app/components/field-error';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useHasLegalPages, useSyncServerUrl } from '#app/hooks/use-public-config';
import { useServerInstanceRead } from '#app/hooks/use-server-instance';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { hasOpenSignup, offeredTrialScans, signupCaptchaOf } from '#app/lib/plans/signup-door';
import { canonicalizeEmail } from '#app/lib/sync/email';
import type { SignupCaptcha } from '#app/lib/sync/engine/protocol';
import { describeSignupFailure, makeSignupRequestSchema, type SignupProblem } from '#app/lib/sync/signup-request-schema';
import type { Translate } from '#app/lib/sync/setup-flow';
import { requestOpenSignup } from '#app/lib/sync/sync-actions';
import { loadTurnstile } from '#app/lib/turnstile';
import { cn } from '#app/lib/utils';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.signUp') }];

/** Where "I already have an account" goes. */
const SIGN_IN_PATH = '/sign-in';

export default function SignUp() {
  const { t } = useTranslation();
  const serverUrl = useSyncServerUrl();
  const { isSettled, instance } = useServerInstanceRead();

  return (
    // TOP-ALIGNED rather than centred like `/sign-in`: a centred card moves
    // its title up when its body grows, and this body grows once, when the
    // handshake answers and the form replaces the spinner.
    <main className="flex min-h-screen flex-col items-center bg-background px-4 pb-10 pt-16 text-foreground sm:pt-24">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('signUp.title')}</CardTitle>
          <CardDescription>{t('signUp.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {serverUrl === null && <p className="text-sm text-muted-foreground">{t('signIn.unavailable')}</p>}
          {serverUrl !== null && !isSettled && (
            <div className="flex justify-center py-4" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t('chrome.loading')}</span>
            </div>
          )}
          {serverUrl !== null && isSettled && !hasOpenSignup(instance) && (
            // AN INVITE-ONLY INSTANCE, reached by a typed or old address. The
            // same sentence the header's dialog says, and a way back.
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('chrome.requestAccessBody')}</p>
              <SignInLink />
            </div>
          )}
          {serverUrl !== null && isSettled && hasOpenSignup(instance) && (
            <SignUpForm
              serverUrl={serverUrl}
              trialScans={offeredTrialScans(instance)}
              captcha={signupCaptchaOf(instance)}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/** The link under the box. The element a layout measurement reads below the change. */
function SignInLink() {
  const { t } = useTranslation();
  return (
    <Link
      to={SIGN_IN_PATH}
      data-slot="sign-up-sign-in"
      className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {t('welcome.haveAccount')}
    </Link>
  );
}

/** Where the request is. `sent` is terminal: the sentence stays until the page is left. */
type SendState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'problem'; problem: SignupProblem };

function SignUpForm({
  serverUrl,
  trialScans,
  captcha,
}: {
  serverUrl: string;
  /** The instance's promise, or `null`, which says nothing about AI at all. */
  trialScans: number | null;
  captcha: SignupCaptcha | null;
}) {
  const { t, i18n } = useTranslation();
  const hasLegalPages = useHasLegalPages();
  const [state, setState] = useState<SendState>({ kind: 'idle' });
  const challenge = useChallenge({ captcha, language: i18n.resolvedLanguage ?? i18n.language });
  const isSent = state.kind === 'sent';
  const isSending = state.kind === 'sending';
  const isWaitingForChallenge = captcha !== null && challenge.token === null;

  const [form, fields] = useForm({
    id: 'sign-up',
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeSignupRequestSchema(t) });
    },
    shouldRevalidate: 'onInput',
    onSubmit(event, { submission }) {
      // Client-side only: the request goes to the sync service's own origin.
      event.preventDefault();
      if (submission?.status !== 'success') return;
      void send(canonicalizeEmail(submission.value.email));
    },
  });

  async function send(email: string): Promise<void> {
    setState({ kind: 'sending' });
    try {
      await requestOpenSignup({ serverUrl, email, captchaToken: challenge.token });
      setState({ kind: 'sent' });
    } catch (error) {
      setState({ kind: 'problem', problem: describeSignupFailure(error) });
    } finally {
      // A token is single-use, so every answer spends it, and a second try
      // needs a new challenge whatever the first answer was.
      challenge.reset();
    }
  }

  return (
    <div className="space-y-4">
      {/* ONE CELL, TWO LAYERS: see the file header. `inert` keeps the hidden
          layer out of the tab order and away from a screen reader. */}
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        <form {...getFormProps(form)} className={cn('space-y-3', isSent && 'invisible')} inert={isSent}>
          {trialScans !== null && (
            <p data-slot="sign-up-trial" className="text-sm font-medium">
              {t('signUp.trial', { count: trialScans })}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={fields.email.id}>{t('sync.emailLabel')}</Label>
            <Input
              {...getInputProps(fields.email, { type: 'email' })}
              autoComplete="email"
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
          {captcha !== null && (
            // RESERVED FROM THE FIRST PAINT at the widget's own height, and
            // drawn always, so the challenge arriving moves nothing.
            <div data-slot="sign-up-challenge" className="h-[65px] w-full overflow-hidden">
              <div ref={challenge.containerRef} className="h-full w-full" />
            </div>
          )}
          {/* THE PROBLEM LINE, two lines reserved: a wait, a refused
              challenge, a blocked domain, or a failure to reach the service. */}
          <output data-slot="sign-up-problem" className="block min-h-10 text-sm text-red-600 dark:text-red-400">
            {state.kind === 'problem' && describeProblem(state.problem, t)}
            {state.kind !== 'problem' && challenge.hasFailed && t('signUp.captchaUnavailable')}
          </output>
          <CredentialSubmitButton className="h-11 w-full" disabled={isSending || isWaitingForChallenge}>
            {isSending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('signUp.submit')}
          </CredentialSubmitButton>
          {hasLegalPages && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="signUp.legal"
                components={{
                  terms: (
                    <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
                      terms
                    </Link>
                  ),
                  privacy: (
                    <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
                      privacy
                    </Link>
                  ),
                }}
              />
            </p>
          )}
        </form>
        <output
          data-slot="sign-up-sent"
          className={cn('flex items-start gap-2 self-center text-sm text-primary', !isSent && 'invisible')}
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('signUp.sent')}
        </output>
      </div>
      <SignInLink />
    </div>
  );
}

/** The problem line's sentence. */
function describeProblem(problem: SignupProblem, t: Translate): string {
  if (problem.kind === 'wait') {
    return problem.minutes === null ? t('signUp.waitLater') : t('signUp.wait', { count: problem.minutes });
  }
  if (problem.kind === 'captcha') return t('signUp.captchaFailed');
  // The same sentence as a widget that never loaded: the check cannot run now.
  if (problem.kind === 'captcha-unavailable') return t('signUp.captchaUnavailable');
  // The shared address sentence, the one the field itself shows.
  if (problem.kind === 'email') return t('sync.email.invalid');
  if (problem.kind === 'domain') return t('signUp.domainBlocked');
  return t('signUp.failed');
}

/**
 * The Turnstile challenge, explicitly rendered into a reserved box.
 *
 * Does NOTHING when the handshake names no key: no script, no request to
 * Cloudflare. `appearance: 'always'` because the box is reserved anyway, and
 * an always-drawn widget is one the person can see they passed.
 */
function useChallenge({ captcha, language }: { captcha: SignupCaptcha | null; language: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const siteKey = captcha?.siteKey ?? null;

  useEffect(() => {
    if (siteKey === null) return;
    const container = containerRef.current;
    if (container === null) return;
    let isCancelled = false;
    const mount = async (): Promise<void> => {
      try {
        const turnstile = await loadTurnstile();
        if (isCancelled) return;
        widgetIdRef.current =
          turnstile.render(container, {
            sitekey: siteKey,
            language,
            theme: 'auto',
            appearance: 'always',
            size: 'flexible',
            callback: (issued) => setToken(issued),
            'error-callback': () => setToken(null),
            'expired-callback': () => setToken(null),
          }) ?? null;
      } catch {
        // Cloudflare unreachable, or blocked by an extension. The form says
        // so rather than sitting with a disabled button and no reason.
        if (!isCancelled) setHasFailed(true);
      }
    };
    void mount();
    return () => {
      isCancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId !== null) globalThis.window.turnstile?.remove(widgetId);
      widgetIdRef.current = null;
    };
  }, [siteKey, language]);

  const reset = useCallback(() => {
    const widgetId = widgetIdRef.current;
    if (widgetId === null) return;
    globalThis.window.turnstile?.reset(widgetId);
    setToken(null);
  }, []);

  return { containerRef, token: siteKey === null ? null : token, hasFailed, reset };
}
