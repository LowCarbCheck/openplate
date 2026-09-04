/**
 * `/sign-in` — the door back into an account that already holds a diary
 * (M183 spec 03).
 *
 * WHY THIS IS A PAGE. Until now the only sign-in form in the app lived inside
 * `/settings/sync`, three taps deep behind a page about a mechanism, and
 * `/welcome` had nowhere to send "I already have an account". A page with one
 * job can be linked to, and it is: from `/welcome`, and from the skip on
 * `/join` for somebody whose invite arrived after they already had an account.
 *
 * ONE FORM, NOT A SECOND COPY. The panel below is the SAME component
 * `/settings/sync` renders (`app/components/sign-in-panel.tsx`). Two copies of
 * a credential form is how one of them quietly rots.
 *
 * THE PULL IS THE POINT. A sign-in on its own proves nothing about where the
 * person belongs: the profile row — `onboardingCompletedAt` and all — travels
 * inside the encrypted sync snapshot, so before the first pull this device
 * still looks exactly like a fresh install, and the gate would send a
 * ten-year user into the first-run questionnaire. So this screen signs in,
 * WAITS for the snapshot, and only then asks `resolveOnboardingGate` where to
 * go. The decision itself is pure and lives in `#app/lib/sign-in-flow`.
 *
 * A FAILED PULL IS NOT A FAILED SIGN-IN. The session stays open, the screen
 * says so, and the retry repeats the pull alone — it never asks for the
 * password again and it never falls through to `/onboarding`, which is the
 * exact bug this milestone exists to kill.
 *
 * CLIENT-ONLY and TOP-LEVEL, deliberately, exactly like `/welcome` above it in
 * `app/routes.ts`. It exports no `loader`, `action` or `clientLoader`: the
 * remembered name is in `localStorage`, the diary is in IndexedDB, the
 * password is turned into a key in this browser, and every request goes to the
 * sync service's own origin — none of it is this server's business. It is
 * registered outside `_personal` because that layout's gate redirects here,
 * and a route nested inside it would be redirected away from itself in a loop.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SignInPanel } from '#app/components/sign-in-panel';
import { SyncRecoveryFlow } from '#app/components/sync-recovery-flow';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { consumeSyncInvite, readPendingGatewayJoin } from '#app/lib/join-link';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { completeSignIn, resolveSignInDestination, type SignInDestination } from '#app/lib/sign-in-flow';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { syncNow } from '#app/lib/sync/sync-actions';
import { clearAccountHint, readAccountHint } from '#app/lib/sync/sync-session';

export { RouteErrorBoundary as ErrorBoundary };

// Top-level, so nothing above supplies a `<title>`. Same pure `meta-title`
// seam every other route uses.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.signIn') }];

/** What the screen is doing. The form and the recovery flow are the two doors; the other two are the pull. */
type Phase =
  | { status: 'form' }
  | { status: 'forgot' }
  | { status: 'pulling' }
  /** Signed in, snapshot missing. `message` is what went wrong, in the person's language. */
  | { status: 'pull-failed'; message: string };

/**
 * Reads the freshly pulled store and asks both authorities where this device
 * belongs: the onboarding gate, and the pending join slot.
 *
 * The gate read itself lives in `read-onboarding-gate.ts` now (M187 spec 03),
 * because `/join` ends a managed ceremony with the same question and two
 * readers would be two chances to read a different set of facts.
 */
async function readDestination(): Promise<SignInDestination> {
  return resolveSignInDestination({
    gate: await readOnboardingGateKind(),
    hasPendingGatewayJoin: readPendingGatewayJoin() !== null,
  });
}

export default function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverUrl = useSyncServerUrl();
  const [phase, setPhase] = useState<Phase>({ status: 'form' });
  // The remembered sign-in name, or `''`. Read in an effect: `localStorage`
  // does not exist during SSR. It also seeds an uncontrolled Conform field, so
  // clearing it has to REMOUNT the panel — see the `key` below.
  const [knownHandle, setKnownHandle] = useState('');
  useEffect(() => setKnownHandle(readAccountHint() ?? ''), []);

  const startFirstPull = useCallback(async (): Promise<void> => {
    setPhase({ status: 'pulling' });
    const outcome = await completeSignIn({ pull: syncNow, readDestination });
    if (outcome.status === 'pull-failed') {
      setPhase({ status: 'pull-failed', message: describeErrorForUser(outcome.cause, t('signIn.pullFailedBody')) });
      return;
    }
    // Returning to `/join` means the person spent the link's sync half by
    // signing in to the account they already had, so the SIGNUP invite is
    // moot — and leaving it parked would put `/join` straight back on its
    // sync step, which is the screen that just sent them here.
    if (outcome.path === '/join') consumeSyncInvite();
    void navigate(outcome.path);
  }, [navigate, t]);

  /**
   * The repair ceremony finishing is also a finished sign-in.
   *
   * An account with no key records is completed by `SignInPanel`'s own
   * `SyncSetupFlow`, which ends on the account card. Without this the person
   * saves their recovery code and is left standing on the sign-in page.
   *
   * Driven by the wizard's COMPLETE event rather than by the `false` edge of
   * its active flag: that flag is re-reported by an effect cleanup whenever
   * the callback's identity changes, so the edge can arrive while the card is
   * still on screen. Acting on it would pull the person off their recovery
   * code — the same defect that hit `/settings/sync` on 2026-09-04.
   */
  const handleCeremonyComplete = useCallback((): void => {
    void startFirstPull();
  }, [startFirstPull]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('signIn.title')}</CardTitle>
          <CardDescription>{t('signIn.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {serverUrl === null ?
            <p className="text-sm text-muted-foreground">{t('signIn.unavailable')}</p>
          : <SignedOutBody
              phase={phase}
              serverUrl={serverUrl}
              knownHandle={knownHandle}
              onForgot={() => setPhase({ status: 'forgot' })}
              onBackToForm={() => setPhase({ status: 'form' })}
              onForgetName={() => {
                clearAccountHint();
                setKnownHandle('');
              }}
              onSignedIn={() => void startFirstPull()}
              onCeremonyComplete={handleCeremonyComplete}
              onRetryPull={() => void startFirstPull()}
            />
          }
        </CardContent>
      </Card>
    </main>
  );
}

/** The four states of the card body, kept out of the route component so each one reads on its own. */
function SignedOutBody({
  phase,
  serverUrl,
  knownHandle,
  onForgot,
  onBackToForm,
  onForgetName,
  onSignedIn,
  onCeremonyComplete,
  onRetryPull,
}: {
  phase: Phase;
  serverUrl: string;
  knownHandle: string;
  onForgot: () => void;
  onBackToForm: () => void;
  onForgetName: () => void;
  onSignedIn: () => void;
  onCeremonyComplete: () => void;
  onRetryPull: () => void;
}) {
  const { t } = useTranslation();

  if (phase.status === 'pulling') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('signIn.pulling')}</p>
      </div>
    );
  }

  if (phase.status === 'pull-failed') {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{t('signIn.pullFailedTitle')}</p>
        <p className="text-sm text-muted-foreground">{phase.message}</p>
        <Button type="button" className="h-11 w-full" onClick={onRetryPull}>
          {t('errors.tryAgain')}
        </Button>
      </div>
    );
  }

  if (phase.status === 'forgot') {
    // The ONE recovery flow, the same component `/settings/sync` opens. There
    // is no second implementation of it and there must not be.
    return <SyncRecoveryFlow serverUrl={serverUrl} initialHandle={knownHandle} onCancel={onBackToForm} />;
  }

  return (
    <SignInPanel
      // Conform seeds the name box once, on mount, from `defaultValue`. "Not
      // you?" therefore has to bring a NEW form rather than a changed prop —
      // see `.claude/conform-to-react.md`.
      key={knownHandle}
      serverUrl={serverUrl}
      initialHandle={knownHandle}
      onForgot={onForgot}
      onForgetName={onForgetName}
      onSignedIn={onSignedIn}
      onCeremonyComplete={onCeremonyComplete}
    />
  );
}
