/**
 * `/admin/invitations` — who has been invited and has not arrived yet.
 *
 * ── It used to be the bottom of the people tab ───────────────────────────
 *
 * Two lists on one page meant an operator scrolled past everybody to reach the
 * invitations, and the counts at the top already answered "how many are open".
 * It is a tab of its own now. The button that creates an invitation is not on
 * it: it sits beside the console's heading in `admin.tsx`, where every tab can
 * reach it, and where it no longer holds open an empty band above this list.
 *
 * ── The container half ───────────────────────────────────────────────────
 *
 * This file owns the admin client, the load and the reload after every change.
 * `InviteTable` is presentational, and it does the one filter that matters:
 * only `pending` is listed, because a redeemed invitation is a person and a
 * revoked one is a thing that did not happen.
 *
 * ── Every change re-reads the list ───────────────────────────────────────
 *
 * No optimistic update, deliberately. A resend mints a NEW link and the old
 * one stops working, so what matters is what the service stored, not what was
 * clicked.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { InviteTable } from '#app/components/admin/invite-table';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminClient } from '#app/lib/admin/admin-client';
import type { InviteView } from '#app/lib/admin/admin-wire';

/** What the tab is showing. One `kind`, so a loading spinner and an error can never be on screen together. */
type InvitationsState =
  { kind: 'loading' } | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'ready'; invites: InviteView[] };

export default function AdminInvitations() {
  const { t } = useTranslation();
  const [state, setState] = useState<InvitationsState>({ kind: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    try {
      const invites = await client.listInvites();
      if (invites.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({ kind: 'ready', invites: invites.value.invites });
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
   * RETHROWS, so the row that asked shows its own message beside itself rather
   * than replacing the page with an error. The one exception it turns into a
   * page-level state is `forbidden`, which is not a failed change but a changed
   * relationship with the instance.
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
          <CardDescription>{t('admin.invites.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="h-11" onClick={() => void load()}>
            {t('admin.people.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // THE TITLE STAYS. It reads "Open invitations" under a tab labelled
  // "Invitations", and the extra word is the whole rule this list follows:
  // only the pending ones are here, because a redeemed invitation is a person
  // and a revoked one is a thing that did not happen. That is not something
  // the tab says.
  return (
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
  );
}
