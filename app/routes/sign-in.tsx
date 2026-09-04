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

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { FirstPullStatus } from '#app/components/first-pull-status';
import { SignInPanel } from '#app/components/sign-in-panel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { useFirstPull, type FirstPullPhase } from '#app/hooks/use-first-pull';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { consumeSyncInvite } from '#app/lib/join-link';
import type { SignInDestination } from '#app/lib/sign-in-flow';
import { clearAccountHint, readAccountHint } from '#app/lib/sync/sync-session';

export { RouteErrorBoundary as ErrorBoundary };

// Top-level, so nothing above supplies a `<title>`. Same pure `meta-title`
// seam every other route uses.
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.signIn') }];

export default function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const serverUrl = useSyncServerUrl();
  // THE PULL, and its two screens, shared with `/reset` (M192/06 fix). Both
  // routes open a session and then have to wait for the same snapshot; the
  // rule that they must wait lives in the hook, not in either of them.
  const { phase, start: startFirstPull } = useFirstPull({
    onArrived: useCallback(
      (path: SignInDestination) => {
        // A SIGN-IN SPENDS THE PARKED INVITE, whatever the destination.
        // Somebody who followed an invitation and turned out to already have
        // an account has answered the invitation; leaving it parked would
        // offer them the signup screen again on the next visit, for an account
        // that exists. `/reset` has no invitation to spend, which is why this
        // is a callback rather than part of the hook.
        consumeSyncInvite();
        void navigate(path);
      },
      [navigate],
    ),
  });
  // The remembered sign-in name, or `''`. Read in an effect: `localStorage`
  // does not exist during SSR. It also seeds an uncontrolled Conform field, so
  // clearing it has to REMOUNT the panel — see the `key` below.
  const [knownEmail, setKnownEmail] = useState('');
  useEffect(() => setKnownEmail(readAccountHint() ?? ''), []);

  /**
   * The repair ceremony finishing is also a finished sign-in.
   *
   * An account with no key records is completed by `SignInPanel`'s own
   * `SyncSetupFlow`, which ends on the account card. Without this the person
   * saves their recovery code and is left standing on the sign-in page.
   *
   * Driven by the wizard's COMPLETE event rather than by the `false` edge of
   * its active flag: that flag is re-reported by an effect cleanup whenever
   * the callback's identity changes, so the edge can arrive mid-flight.
   * Acting on it would pull the person off their own
   * code — the same defect that hit `/settings/sync` on 2026-09-04.
   */
  const handleCeremonyComplete = useCallback((): void => {
    startFirstPull();
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
              knownEmail={knownEmail}
              onForgot={() => void navigate('/forgot')}
              onForgetName={() => {
                clearAccountHint();
                setKnownEmail('');
              }}
              onSignedIn={startFirstPull}
              onCeremonyComplete={handleCeremonyComplete}
              onRetryPull={startFirstPull}
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
  knownEmail,
  onForgot,
  onForgetName,
  onSignedIn,
  onCeremonyComplete,
  onRetryPull,
}: {
  phase: FirstPullPhase;
  serverUrl: string;
  knownEmail: string;
  onForgot: () => void;
  onForgetName: () => void;
  onSignedIn: () => void;
  onCeremonyComplete: () => void;
  onRetryPull: () => void;
}) {
  if (phase.status !== 'idle') return <FirstPullStatus phase={phase} onRetry={onRetryPull} />;

  return (
    <SignInPanel
      // Conform seeds the name box once, on mount, from `defaultValue`. "Not
      // you?" therefore has to bring a NEW form rather than a changed prop —
      // see `.claude/conform-to-react.md`.
      key={knownEmail}
      serverUrl={serverUrl}
      initialEmail={knownEmail}
      onForgot={onForgot}
      onForgetName={onForgetName}
      onSignedIn={onSignedIn}
      onCeremonyComplete={onCeremonyComplete}
    />
  );
}
