/**
 * `/admin` — the console: everybody here, and everybody invited.
 *
 * ── The container half ───────────────────────────────────────────────────
 *
 * This file owns the admin client, the load, and the reload after every
 * change. The two lists are presentational components that take data and
 * callbacks and know nothing about a session or a server, which is what lets
 * the render test put two people and one invitation on screen with no network
 * at all.
 *
 * ── Every change re-reads the list ───────────────────────────────────────
 *
 * No optimistic update, deliberately. An allowance change is one request an
 * administrator makes every few weeks, and the value that matters is what the
 * SERVICE stored, not what was typed: `suspended` also revokes sessions,
 * `role` can be refused, and a stale row is how somebody gets suspended twice
 * because the first one looked as though it had not worked.
 *
 * ── A 403 replaces the page, it does not blank it ────────────────────────
 *
 * Being demoted, or suspended, mid-session is ordinary. `AdminClient` returns
 * that as a value rather than throwing, and the whole console becomes the
 * not-an-administrator card.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';

import { Link } from '#app/components/link';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { CopyableLink } from '#app/components/admin/invite-result';
import { InviteTable } from '#app/components/admin/invite-table';
import { PeopleTable } from '#app/components/admin/people-table';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminClient } from '#app/lib/admin/admin-client';
import type { AdminAccountView, AdminStats, InviteView } from '#app/lib/admin/admin-wire';

/** What the console is showing. One `kind`, so a loading spinner and an error can never be on screen together. */
type ConsoleState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'failed' }
  | { kind: 'ready'; stats: AdminStats | null; people: AdminAccountView[]; invites: InviteView[] };

export default function AdminConsole() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const [state, setState] = useState<ConsoleState>({ kind: 'loading' });
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    try {
      const [stats, accounts, invites] = await Promise.all([
        client.stats(),
        client.listAccounts({ limit: LIST_PAGE_SIZE }),
        client.listInvites({ limit: LIST_PAGE_SIZE }),
      ]);
      if (accounts.status === 'forbidden' || invites.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({
        kind: 'ready',
        // The counts are the one thing this page can do without. An instance
        // whose `/stats` is slow or absent still shows its people.
        stats: stats.status === 'ok' ? stats.value : null,
        people: accounts.value.accounts,
        invites: invites.value.invites,
      });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One change, then a reload.
   *
   * RETHROWS, so the row that asked shows its own message beside itself
   * rather than replacing the page with an error. The one exception it turns
   * into a page-level state is `forbidden`, which is not a failed change but a
   * changed relationship with the instance.
   */
  const apply = useCallback(
    async (change: (client: AdminClient) => Promise<{ status: 'ok' | 'forbidden' }>): Promise<void> => {
      const client = currentAdminClient();
      if (client === null) {
        setState({ kind: 'forbidden' });
        return;
      }
      const outcome = await change(client);
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      await load();
    },
    [load],
  );

  const sendResetMail = useCallback(
    async ({ id }: { id: number }): Promise<void> => {
      const client = currentAdminClient();
      if (client === null) {
        setState({ kind: 'forbidden' });
        return;
      }
      const person = state.kind === 'ready' ? state.people.find((candidate) => candidate.id === id) : undefined;
      const email = person?.email ?? '';
      const outcome = await client.sendResetMail({ id });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      // THE LINK IS SHOWN, never toasted: a toast disappears, and on an
      // instance with no mail this link is the only way that person gets back
      // into their account.
      if (outcome.value.link !== null) {
        setResetLink({ email, link: outcome.value.link });
        return;
      }
      setResetLink(null);
      toast(t('admin.resetMail.sent', { email }));
    },
    [state, t],
  );

  if (state.kind === 'forbidden') return <NotAnAdministratorCard />;

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('admin.people.loading')}
      </p>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.people.failed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="h-11" onClick={() => void load()}>
            {t('admin.people.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {state.stats !== null && <StatsRow stats={state.stats} />}

      <div className="flex justify-end">
        <Button asChild className="h-11">
          <Link to="/admin/invite">
            <UserPlus className="h-4 w-4" aria-hidden="true" /> {t('admin.invite.cta')}
          </Link>
        </Button>
      </div>

      {resetLink !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.resetMail.cta')}</CardTitle>
            <CardDescription>{t('admin.resetMail.noMail', { email: resetLink.email })}</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyableLink link={resetLink.link} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.people.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PeopleTable
            people={state.people}
            currentAccountId={session.account?.id ?? -1}
            onSave={({ id, role, dailyAiLimit }) => apply((client) => client.patchAccount({ id, role, dailyAiLimit }))}
            onSetSuspended={({ id, suspended }) => apply((client) => client.patchAccount({ id, suspended }))}
            onSendResetMail={sendResetMail}
            onDelete={({ id }) => apply((client) => client.deleteAccount({ id }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.invites.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteTable
            invites={state.invites}
            onResend={({ id }) => apply((client) => client.resendInvite({ id }))}
            onRevoke={({ id }) => apply((client) => client.revokeInvite({ id }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One page of people, and one of invitations.
 *
 * No pager, because an organization that outgrows this is a different product
 * decision than a "next" button, and a silently truncated list is worse than
 * either. 500 is far beyond any instance this milestone is for.
 */
const LIST_PAGE_SIZE = 500;

/** The four counts, across the top. Read-only, and the fastest answer to "is this instance healthy". */
function StatsRow({ stats }: { stats: AdminStats }) {
  const { t } = useTranslation();
  const cells: { label: string; value: number }[] = [
    { label: t('admin.stats.people'), value: stats.accounts },
    { label: t('admin.stats.admins'), value: stats.admins },
    { label: t('admin.stats.pending'), value: stats.pendingInvites },
    { label: t('admin.stats.photosToday'), value: stats.aiRequestsToday },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
