/**
 * `/welcome` — the first screen on a device that holds nothing (M183 spec 02).
 *
 * WHY THIS EXISTS. The `_personal` gate used to read "no local profile" as "new
 * person" and open the first-run questionnaire. It is not the same thing. A
 * returning user's profile row travels inside the encrypted sync snapshot, so
 * it arrives only AFTER they sign in — and until this screen existed there was
 * no door to sign in through. The likely outcomes were re-answering the
 * questionnaire, or creating a second account that never meets the first.
 *
 * So the gate stops here instead and asks. Two doors, no third option and no
 * guessing on the person's behalf: start a new diary, or sign in to the account
 * that already holds one.
 *
 * WHICH DOOR LEADS depends on what the device carries, and that decision is
 * pure (`app/lib/welcome-hint.ts`) — a remembered sign-in name, or a gateway
 * membership, tips the emphasis towards signing in. It only ever reorders the
 * buttons: neither trace proves an account exists, so neither skips this screen.
 *
 * CLIENT-ONLY and TOP-LEVEL, deliberately. It exports no `loader`, `action` or
 * `clientLoader`: both hints live in the browser (localStorage and IndexedDB),
 * and neither is any of the server's business. It is registered outside
 * `_personal` because that layout's gate is exactly what redirects here —
 * nesting it there would loop, the same reason `/recover` sits outside.
 *
 * WHAT THIS SCREEN MUST NOT DO. It does not clear the home hint cookie and it
 * touches no onboarding state. Landing here is a question, not a decision:
 * `/onboarding` still clears the hint when the person actually chooses to start
 * fresh, which is where that belongs.
 */
import { useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { getLocalAiSettings } from '#app/lib/local-store';
import { readAccountHint } from '#app/lib/sync/sync-session';
import { resolveWelcomeHint, type WelcomeHint } from '#app/lib/welcome-hint';

export { RouteErrorBoundary as ErrorBoundary };

// This route is top-level, so nothing above it supplies a `<title>`. Title via
// the pure `meta-title` seam, like every other route (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.welcome') }];

/** Where the first-run questionnaire lives. */
const START_PATH = '/onboarding';

/**
 * Where "I already have an account" goes.
 *
 * TODO(M183/03): retarget to `/sign-in` once that route exists. Until then the
 * signed-out `/settings/sync` screen is the only door in, and it already reads
 * the SAME account hint this page reads, so the sign-in name is prefilled there
 * without this link having to carry it.
 */
const SIGN_IN_PATH = '/settings/sync';

/**
 * The two device traces, read once on mount.
 *
 * `null` while the read is in flight, and the screen shows no buttons until it
 * resolves. The alternative — render the no-hint order and swap it a tick later
 * — moves a button under a thumb that is already on its way down, and the read
 * is one localStorage lookup plus one IndexedDB open.
 */
function useWelcomeHint(): WelcomeHint | null {
  const [hint, setHint] = useState<WelcomeHint | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function readHints(): Promise<void> {
      // A missing or unreadable settings row is simply no gateway hint. It
      // cannot be an error state here: this screen has to render on a device
      // that has never stored anything at all.
      const aiSettings = await getLocalAiSettings().catch(() => null);
      if (!isMounted) return;
      setHint(resolveWelcomeHint({ accountHint: readAccountHint(), connectedVia: aiSettings?.connectedVia ?? null }));
    }
    void readHints();
    return () => {
      isMounted = false;
    };
  }, []);

  return hint;
}

/** The primary door, plus the other one underneath it as a quieter button. */
function WelcomeChoices({ hint }: { hint: WelcomeHint }) {
  const { t } = useTranslation();
  const signInLabel =
    hint.accountName === null ? t('welcome.signIn') : t('welcome.signInAs', { name: hint.accountName });

  if (hint.primary === 'sign-in') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('welcome.returning')}</p>
        <Button asChild className="h-11 w-full justify-center">
          <Link to={SIGN_IN_PATH}>{signInLabel}</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 w-full justify-center">
          <Link to={START_PATH}>{t('welcome.startFresh')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button asChild className="h-11 w-full justify-center">
        <Link to={START_PATH}>{t('welcome.start')}</Link>
      </Button>
      <Button asChild variant="outline" className="h-11 w-full justify-center">
        <Link to={SIGN_IN_PATH}>{t('welcome.haveAccount')}</Link>
      </Button>
    </div>
  );
}

export default function Welcome() {
  const { t } = useTranslation();
  const hint = useWelcomeHint();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('welcome.title')}</CardTitle>
          <CardDescription>{t('welcome.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {hint === null ?
            <div className="flex justify-center py-4" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="sr-only">{t('chrome.loading')}</span>
            </div>
          : <WelcomeChoices hint={hint} />}
        </CardContent>
      </Card>
    </main>
  );
}
