/**
 * `/verify-email` — where the sync service's confirmation email lands.
 *
 * The path is fixed by the service (`openplate-sync/src/mail/messages.ts`'s
 * `VERIFY_EMAIL_PATH`). Same coordination rule as `/reset-passphrase`:
 * renaming it invalidates links already in inboxes.
 *
 * Only relevant on instances that run with `REQUIRE_EMAIL_VERIFICATION` on;
 * with the default off, signup returns tokens immediately and nobody ever
 * arrives here. It still has to exist, because an operator who turns that on
 * gets a link in every signup email.
 */
import { useEffect, useRef, useState } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { AUTH_API_PREFIX } from '#app/lib/sync/engine/client/auth-wire';
import {
  hasRedeemedVerifyEmailToken,
  rememberRedeemedVerifyEmailToken,
  sessionMarkerStorage,
} from '#app/lib/sync/verify-email-guard';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.sync') }];

/** @throws a 404 Response on an instance with no sync server configured. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

type VerifyState = 'pending' | 'verified' | 'failed';

export default function VerifyEmail() {
  const { syncServerUrl } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<VerifyState>('pending');
  // The token this component has already sent. A verification token is SINGLE
  // USE, so "send it once" is a correctness requirement, not an optimisation:
  // React's development double-invoke of effects would otherwise fire two
  // POSTs, the second of which is rejected exactly like a forged one, and the
  // later response wins. A ref survives that remount; a local flag does not.
  const submittedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (token === null || token === '') {
      setState('failed');
      return;
    }
    // Already redeemed in this session: a reload of a spent link is the normal
    // case, not a failure. The account was confirmed the first time.
    if (hasRedeemedVerifyEmailToken({ token, storage: sessionMarkerStorage() })) {
      setState('verified');
      return;
    }
    if (submittedTokenRef.current === token) return;
    submittedTokenRef.current = token;

    // Straight from the browser to the sync service — this app's server is
    // never in the path, not even for a one-field POST.
    void (async () => {
      try {
        const response = await fetch(`${syncServerUrl}${AUTH_API_PREFIX}/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          setState('failed');
          return;
        }
        rememberRedeemedVerifyEmailToken({ token, storage: sessionMarkerStorage() });
        setState('verified');
      } catch {
        setState('failed');
      }
    })();
  }, [syncServerUrl, token]);

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t('sync.verifyEmail.title')}</CardTitle>
          <CardDescription>{t(`sync.verifyEmail.${state}`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('sync.verifyEmail.next')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
