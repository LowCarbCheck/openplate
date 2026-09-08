/**
 * `/admin/activity` — everybody's strip on one screen.
 *
 * ── The question this page exists for ────────────────────────────────────
 *
 * "Is this study participant still using it." The people tab answers it one
 * row at a time over a week; here the window is a control, so a month or a
 * quarter is one click rather than ninety opened pages.
 *
 * ── Two reads, and only one of them may break the page ───────────────────
 *
 * The accounts list is the page. The strips are what it draws, and a service
 * older than this client has no batch endpoint at all, so a failed strip read
 * leaves the names, the last sign in and the ordering, and simply draws no
 * squares. That degradation is the same one the people tab makes, on purpose.
 *
 * ── The window switch re-reads only the strips ───────────────────────────
 *
 * The people do not change when the window does. Re-reading them would be a
 * second request for an answer already in hand, and it would make the list
 * flicker on a control that is meant to be cheap to try.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { ActivityOverview, type ActivityOverviewState } from '#app/components/admin/activity-overview';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminAccountView, AdminActivityDay } from '#app/lib/admin/admin-wire';

/** The window the page opens on. A week is the one that answers "since I last looked". */
const DEFAULT_WINDOW_DAYS = 7;

/** Where the accounts read is. The strips have a state of their own, because they may fail on their own. */
type PeopleReadState =
  { kind: 'loading' } | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'ready'; people: AdminAccountView[] };

export default function AdminActivity() {
  const { t } = useTranslation();
  const [people, setPeople] = useState<PeopleReadState>({ kind: 'loading' });
  const [days, setDays] = useState(DEFAULT_WINDOW_DAYS);
  const [activity, setActivity] = useState<ActivityOverviewState>({ kind: 'loading' });

  const loadPeople = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setPeople({ kind: 'forbidden' });
      return;
    }
    try {
      const accounts = await client.listAccounts();
      if (accounts.status === 'forbidden') {
        setPeople({ kind: 'forbidden' });
        return;
      }
      setPeople({ kind: 'ready', people: accounts.value.accounts });
    } catch {
      setPeople({ kind: 'failed' });
    }
  }, []);

  const loadActivity = useCallback(async (window: number): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setPeople({ kind: 'forbidden' });
      return;
    }
    setActivity({ kind: 'loading' });
    try {
      const outcome = await client.listActivity({ days: window });
      if (outcome.status === 'forbidden') {
        setPeople({ kind: 'forbidden' });
        return;
      }
      setActivity({
        kind: 'ready',
        window: outcome.value.window,
        activity: new Map(
          outcome.value.accounts.map((row): [number, readonly AdminActivityDay[]] => [row.accountId, row.days]),
        ),
      });
    } catch {
      setActivity({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    void loadActivity(days);
  }, [loadActivity, days]);

  if (people.kind === 'forbidden') return <NotAnAdministratorCard />;

  if (people.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('admin.people.loading')}
      </p>
    );
  }

  if (people.kind === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.people.failed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="h-11" onClick={() => void loadPeople()}>
            {t('admin.people.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.activity.title')}</CardTitle>
        <CardDescription>{t('admin.activity.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityOverview
          people={people.people}
          state={activity}
          requestedDays={days}
          onRequestDays={setDays}
          onRetry={() => void loadActivity(days)}
        />
      </CardContent>
    </Card>
  );
}
