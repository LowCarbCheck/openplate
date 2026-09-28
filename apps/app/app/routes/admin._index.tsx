/**
 * `/admin` — the people tab: everybody here, filterable, one row each.
 *
 * ── The container half ───────────────────────────────────────────────────
 *
 * This file owns the admin client and the load. The list is a presentational
 * component that takes data and knows nothing about a session or a server,
 * which is what lets the render test put people on screen with no network at
 * all.
 *
 * ── ONE PERSON IS A ROUTE, and it used to be a state ─────────────────────
 *
 * The detail view was this page showing one person instead of the list, driven
 * by an id in state, and the argument for that was that the row was already in
 * hand so a route would re-read what was on screen a moment earlier. That
 * argument lost, for four reasons that are all about the person using this and
 * not about a round trip: the row is a link, so middle click and the back
 * button have to work; an operator wants to send a colleague the address of a
 * person; a reload has to land on the same person rather than back at the top
 * of the list; and the detail page now carries every action, so it is a place
 * somebody stays rather than glances at. `/admin/people/:id` re-reads the
 * account, which is one request and is also the fresher answer.
 *
 * ── The filter runs in the browser ───────────────────────────────────────
 *
 * The whole list is already here: `AdminClient.listAccounts` follows the
 * service's paging itself, so nothing on this page knows about a page ceiling.
 * A request per keystroke against a list already in memory would buy nothing.
 *
 * ── The strips are one request, and they are allowed to fail ─────────────
 *
 * `listActivity` reads a strip for everybody in one paged call, over the
 * window `people-table.tsx` names in its column header. A
 * service older than this client has no such endpoint and answers 404, so the
 * call throws and `activity` stays `null` and the rows are drawn WITHOUT
 * strips. A list of people must never be broken by an ornament on it.
 *
 * ── A 403 replaces the page, it does not blank it ────────────────────────
 *
 * Being demoted, or suspended, mid-session is ordinary. `AdminClient` returns
 * that as a value rather than throwing, and the whole tab becomes the
 * not-an-administrator card.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { PeopleTable, ROW_STRIP_DAYS } from '#app/components/admin/people-table';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '#app/components/ui/card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { ActivityByAccount } from '#app/lib/admin/activity-strip';
import type { AdminOutcome } from '#app/lib/admin/admin-client';
import type { AdminAccountView, AdminActivityDay, AdminActivityList } from '#app/lib/admin/admin-wire';
import { EMPTY_PEOPLE_FILTER, type PeopleFilter } from '#app/lib/admin/people-filter';

/** What the tab is showing. One `kind`, so a loading spinner and an error can never be on screen together. */
type PeopleState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'failed' }
  | { kind: 'ready'; people: AdminAccountView[]; activity: ActivityByAccount | null };

export default function AdminPeople() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const [state, setState] = useState<PeopleState>({ kind: 'loading' });
  const [filter, setFilter] = useState<PeopleFilter>(EMPTY_PEOPLE_FILTER);

  const load = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    try {
      // THE STRIPS ARE CAUGHT, THE LIST IS NOT. A failed activity read is a
      // missing ornament; a failed accounts read is a page that cannot do its
      // job. Keeping them in one `Promise.all` with one catch would have made
      // an instance without the batch endpoint render the retry card.
      const [accounts, activity] = await Promise.all([
        client.listAccounts(),
        client.listActivity({ days: ROW_STRIP_DAYS }).catch(() => null),
      ]);
      if (accounts.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({ kind: 'ready', people: accounts.value.accounts, activity: stripsByAccount(activity) });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  // NO CARD TITLE. It read "People", directly under a tab labelled "People",
  // and a heading that repeats the thing above it is a line an operator has to
  // read to learn nothing. The activity tab keeps its title, because "Who is
  // still using it" says something its tab does not.
  return (
    <Card>
      <CardContent className="pt-6">
        <PeopleTable
          people={state.people}
          currentAccountId={session.account?.id ?? -1}
          activity={state.activity}
          filter={filter}
          onFilterChange={setFilter}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The batch answer, keyed by account.
 *
 * `null` in, `null` out, deliberately: a read that never happened must not
 * become an empty map, which would draw everybody as though the service had
 * answered "nothing" for them.
 */
function stripsByAccount(outcome: AdminOutcome<AdminActivityList> | null): ActivityByAccount | null {
  if (outcome === null || outcome.status === 'forbidden') return null;
  return new Map(outcome.value.accounts.map((row): [number, readonly AdminActivityDay[]] => [row.accountId, row.days]));
}
