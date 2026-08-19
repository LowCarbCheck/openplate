/**
 * `/reset-passphrase` — where the sync service's reset email lands.
 *
 * The path is fixed by the service (`openplate-sync/src/mail/messages.ts`'s
 * `RESET_PATH`), which builds `${clientBaseUrl}/reset-passphrase?token=…`.
 * Renaming this route breaks every reset link already sitting in someone's
 * inbox, so it is a coordinated change across both repos, not a local one.
 *
 * Deliberately OUTSIDE the personal layout: that layout's client loader
 * bounces anyone who has not finished onboarding to `/onboarding`, and a
 * person arriving from an email to recover an account they already have must
 * not be redirected into a first-run wizard.
 */
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { CONFIG } from '#app/config';
import { useLoaderData } from 'react-router';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SyncResetFlow } from '#app/components/sync-reset-flow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.sync') }];

/** @throws a 404 Response on an instance with no sync server configured — the same gate as `/settings/sync`. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

export default function ResetPassphrase() {
  const { syncServerUrl } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t('sync.reset.title')}</CardTitle>
          <CardDescription>{t('sync.reset.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {token === null || token === '' ?
            <p className="text-sm text-muted-foreground">{t('sync.reset.missingToken')}</p>
          : <SyncResetFlow serverUrl={syncServerUrl} token={token} />}
        </CardContent>
      </Card>
    </div>
  );
}
