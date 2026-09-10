/**
 * `/admin/people/:id` — one person, and everything an administrator does to
 * them.
 *
 * ── Why this is a route and not a state on the list ──────────────────────
 *
 * It used to be the list showing one person instead of everybody, and the
 * argument was that the row was already in hand. Four things outweighed that,
 * all of them about the person using this: the row is a link now, so the back
 * button and middle click have to work; an operator wants to send a colleague
 * the address of a person; a reload has to land on the same person; and this
 * page carries every action that left the row, so it is somewhere an
 * administrator stays rather than glances at.
 *
 * ── It re-reads the account rather than taking the row ───────────────────
 *
 * The id in the path is all it starts with. `getAccount` is one request and it
 * is the fresher answer, which matters on the page where things are changed:
 * an allowance edited from another tab, or a suspension applied by a colleague,
 * would otherwise be invisible here.
 *
 * ── Every change re-reads the account ────────────────────────────────────
 *
 * No optimistic update, deliberately. The value that matters is what the
 * SERVICE stored, not what was typed: `suspended` also revokes sessions, a
 * `role` change can be refused, and a stale row is how somebody gets suspended
 * twice because the first one looked as though it had not worked.
 *
 * ── The strip is its own read, with its own retry ────────────────────────
 *
 * It is not part of the `Promise.all` with the account: ninety integers is a
 * separate question from who this person is, and a failed strip must never
 * take the page down with it.
 *
 * ── A 403 replaces the page, it does not blank it ────────────────────────
 *
 * Being demoted, or suspended, mid-session is ordinary. `AdminClient` returns
 * that as a value rather than throwing, and the whole page becomes the
 * not-an-administrator card.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { publishStatus } from '#app/lib/status';
import { Loader2 } from 'lucide-react';

import { CopyableLink } from '#app/components/admin/invite-result';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { PersonDetail, type PersonActivityState } from '#app/components/admin/person-detail';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminClient } from '#app/lib/admin/admin-client';
import type { AdminAccountView } from '#app/lib/admin/admin-wire';
import { useAppNavigate } from '#app/hooks/use-app-navigate';

/** Where the account read is. One `kind`, so a spinner and an error can never be on screen together. */
type PersonState =
  { kind: 'loading' } | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'ready'; person: AdminAccountView };

export default function AdminPersonPage() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useAppNavigate();
  const session = useSyncSession();
  const [state, setState] = useState<PersonState>({ kind: 'loading' });
  const [activity, setActivity] = useState<PersonActivityState>({ kind: 'loading' });
  const [resetLink, setResetLink] = useState<string | null>(null);

  // A path that is not a number cannot be an account, and the read below would
  // ask the service about `NaN`. It is reported as the same failure a deleted
  // person is, because from here they are the same thing: there is nobody at
  // this address.
  const id = Number.parseInt(params.id ?? '', 10);
  const hasId = Number.isInteger(id);

  const load = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null || !hasId) {
      setState(client === null ? { kind: 'forbidden' } : { kind: 'failed' });
      return;
    }
    try {
      const outcome = await client.getAccount({ id });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({ kind: 'ready', person: outcome.value });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [hasId, id]);

  /**
   * Reads this person's strip.
   *
   * A `forbidden` here is the same changed relationship the account read
   * reports, so it replaces the page rather than the strip. Anything else is a
   * failed read of one card and stays inside that card with its own retry.
   */
  const loadActivity = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null || !hasId) return;
    setActivity({ kind: 'loading' });
    try {
      const outcome = await client.accountActivity({ id });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setActivity({ kind: 'ready', activity: outcome.value });
    } catch {
      setActivity({ kind: 'failed' });
    }
  }, [hasId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  /**
   * One change, then a re-read.
   *
   * RETHROWS, so the page shows its own message beside the buttons rather than
   * replacing itself with an error. The one exception it turns into a
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

  const sendResetMail = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    const email = state.kind === 'ready' ? state.person.email : '';
    const outcome = await client.sendResetMail({ id });
    if (outcome.status === 'forbidden') {
      setState({ kind: 'forbidden' });
      return;
    }
    // THE LINK IS SHOWN, never announced: a status disappears, and on an instance
    // with no mail this link is the only way that person gets back into their
    // account.
    if (outcome.value.link !== null) {
      setResetLink(outcome.value.link);
      return;
    }
    setResetLink(null);
    publishStatus({ text: t('admin.resetMail.sent', { email }) });
  }, [id, state, t]);

  /** Deletion leaves nothing to show, so the page it was is the list it came from. */
  const deletePerson = useCallback(async (): Promise<void> => {
    await apply((client) => client.deleteAccount({ id }));
    navigate('/admin');
  }, [apply, id, navigate]);

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
          <CardDescription>{t('admin.person.notFound')}</CardDescription>
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
      {resetLink !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.resetMail.cta')}</CardTitle>
            <CardDescription>{t('admin.resetMail.noMail', { email: state.person.email })}</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyableLink link={resetLink} />
          </CardContent>
        </Card>
      )}

      <PersonDetail
        person={state.person}
        activity={activity}
        isSelf={session.account?.id === state.person.id}
        onRetryActivity={() => void loadActivity()}
        onSave={(next) => apply((client) => client.patchAccount({ id, ...next }))}
        onSetSuspended={({ suspended }) => apply((client) => client.patchAccount({ id, suspended }))}
        onSendResetMail={sendResetMail}
        onDelete={deletePerson}
      />
    </div>
  );
}
