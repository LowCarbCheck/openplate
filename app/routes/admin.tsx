/**
 * `/admin` — the layout, and the one decision it makes.
 *
 * ── The role is read BEFORE anything is fetched ──────────────────────────
 *
 * Not because the server would leak anything (it answers `403` to everybody
 * else), but because a page that asks first and renders the refusal afterwards
 * shows a loading state, then an error, to the many people who are simply not
 * administrators. The session already carries `role`. Reading it costs nothing
 * and gets the right screen first time.
 *
 * ── `account === null` is not yet an answer ──────────────────────────────
 *
 * It is also what a reload looks like for the half second the cached session
 * takes to reopen. Deciding "not an administrator" from it would say something
 * false, on every reload, to the one person it is most alarming to. The
 * snapshot's `isResuming` is what tells the two apart, and it is settled by
 * `SyncController` on every path — including the offline one, where the cache
 * is kept and the session still does not open.
 *
 * ── Client-only past the loader ──────────────────────────────────────────
 *
 * The loader answers one question, "does this instance have a server at all",
 * and 404s when it does not. Everything else happens in the browser against
 * that server: this app's own server never sees an administrator's token and
 * has no admin endpoints of its own.
 */
import { Outlet, useLoaderData } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';

import { CONFIG } from '#app/config';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { useSyncSession } from '#app/components/sync-status';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.admin') }];

export const handle = {
  titleKey: 'admin.title',
  title: 'Administration',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no server configured, where nobody has an account to administer. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

export default function AdminLayout() {
  const { t } = useTranslation();
  // Read for its side effect on the loader: this route does not exist unless
  // the instance has a server, and the loader is what enforces that.
  useLoaderData<typeof loader>();
  const session = useSyncSession();

  if (session.isResuming) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">{t('admin.people.loading')}</p>
      </div>
    );
  }

  if (session.account === null || session.account.role !== 'admin') {
    return (
      <div className="mx-auto max-w-xl">
        <NotAnAdministratorCard />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.subtitle')}</p>
      </header>
      <Outlet />
    </div>
  );
}
