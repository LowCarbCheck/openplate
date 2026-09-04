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
 * ── Neither is `role === null` ────────────────────────────────────────────
 *
 * A signed-in session (`account !== null`) can still have a `role` of `null`:
 * `openSyncSession` (`sync-session.ts`) publishes that whenever the auth
 * client is still carrying its PENDING placeholder rather than a real
 * `AccountView` — "not read yet", never a guessed `'member'` (0.10.1 walk
 * defect 2: an administrator was shown this card, with no `/v1/admin/*`
 * request at all, because a stale build's fallback invented that answer).
 * This is the THIRD loading state, distinct from `isResuming`: the vault is
 * open and the session is real, only the role has not arrived. It refreshes
 * once and renders the same loading copy `isResuming` does; the deny card
 * below is reached only once `role` is the known `'member'`.
 *
 * ── Client-only past the loader ──────────────────────────────────────────
 *
 * The loader answers one question, "does this instance have a server at all",
 * and 404s when it does not. Everything else happens in the browser against
 * that server: this app's own server never sees an administrator's token and
 * has no admin endpoints of its own.
 */
import { useEffect } from 'react';
import { Outlet, useLoaderData } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';

import { CONFIG } from '#app/config';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { useSyncSession } from '#app/components/sync-status';
import { refreshSyncAccount } from '#app/lib/sync/sync-actions';
import type { SyncSessionSnapshot } from '#app/lib/sync/sync-session';
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

/**
 * What this layout puts on screen, for a given snapshot. Pure, and exported
 * so the four branches are a unit test each rather than a rendered page each
 * (`useSyncSession`'s `getServerSnapshot` is a hardcoded constant by design —
 * see `sync-session.ts` — so a full render can never exercise anything BUT
 * the signed-out state; the decision has to live somewhere a test can reach
 * it directly).
 *
 * THREE LOADING STATES, ONE DENIAL:
 *  - `'resuming'`: `SyncController` may still be reopening a cached session.
 *  - `'unknown-role'`: a real, signed-in session whose `role` has not been
 *    read yet (`null` — never a guessed `'member'`, per `openSyncSession`).
 *    This is the state the 0.10.1 walk defect 2 collapsed into `'denied'`.
 *  - `'denied'`: reached ONLY once `role` is the known `'member'`, or there
 *    is genuinely no session.
 *  - `'granted'`: the known `'admin'`.
 */
export function resolveAdminViewState(
  session: Pick<SyncSessionSnapshot, 'isResuming' | 'account'>,
): 'resuming' | 'unknown-role' | 'denied' | 'granted' {
  if (session.isResuming) return 'resuming';
  const account = session.account;
  if (account !== null && account.role === null) return 'unknown-role';
  if (account === null || account.role !== 'admin') return 'denied';
  return 'granted';
}

export default function AdminLayout() {
  const { t } = useTranslation();
  // Read for its side effect on the loader: this route does not exist unless
  // the instance has a server, and the loader is what enforces that.
  useLoaderData<typeof loader>();
  const session = useSyncSession();
  const view = resolveAdminViewState(session);

  // Signed in, role not read yet — ask once. A no-op without a vault, and
  // idempotent once `role` lands (the dependency below stops firing).
  useEffect(() => {
    if (view === 'unknown-role') void refreshSyncAccount();
  }, [view]);

  // The two loading states share one screen: `isResuming` and an unread role
  // on an already-open session are the same fact from the person's side —
  // "wait, this is not settled yet" — and neither may fall through to the
  // deny card below (0.10.1 walk defect 2).
  if (view === 'resuming' || view === 'unknown-role') {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">{t('admin.people.loading')}</p>
      </div>
    );
  }

  if (view === 'denied') {
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
