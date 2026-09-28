/**
 * `/admin/feedback`, the queue of reported estimates.
 *
 * ── Two gates, and this route owns the second one ────────────────────────
 *
 * The layout above 404s on an instance with no server at all. This route also
 * 404s on an instance whose server accepts no reports, because the service
 * does exactly that: `SYNC_FEEDBACK` off answers the ordinary unknown-path 404
 * on the whole `/v1/admin/feedback` subtree, to an authenticated administrator
 * as much as to anybody, so that an operator cannot tell an instance with the
 * feature switched off from one built before it existed. A console that
 * rendered an empty queue there would give that away in one screenshot.
 *
 * THE SIGNAL IS `/health`, and it is the only one a client gets:
 * `instance.feedback.retentionDays` is absent on an instance with reports off.
 * That is read in the `clientLoader` rather than in the server `loader`
 * because it belongs to the SYNC server, not to this app's server, and this
 * app's server must not start making a request per page load to answer a
 * question the browser already has cached (`use-server-instance`).
 *
 * ── The number is also the promise ───────────────────────────────────────
 *
 * Every row states when it deletes itself, and that date is the window the
 * service advertised plus the row's own timestamp. There is no such field on
 * the wire and this app must never substitute a default of its own: the number
 * a person was shown before they handed over a photograph is the number the
 * operator has to see beside it.
 *
 * ── Client-only past the loader ──────────────────────────────────────────
 *
 * Like every other admin screen: the reads happen in the browser against the
 * sync server, over the signed-in administrator's own credential. This app's
 * server never sees it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLoaderData } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { Route } from './+types/admin.feedback';
import { CONFIG } from '#app/config';
import { FeedbackQueue } from '#app/components/admin/feedback-queue';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminFeedbackReport } from '#app/lib/admin/admin-wire';
import { requireFeedbackWindow } from '#app/lib/admin/feedback-console';

/** @throws a 404 Response on an instance with no server, where nobody could have reported anything. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

/** @throws a 404 Response on an instance whose server advertises no retention window, which is one with reports off. */
export async function clientLoader({ serverLoader }: Pick<Route.ClientLoaderArgs, 'serverLoader'>): Promise<{
  retentionDays: number;
}> {
  const { syncServerUrl } = await serverLoader();
  const instance = await readCachedServerInstance(syncServerUrl);
  return { retentionDays: requireFeedbackWindow(instance) };
}
clientLoader.hydrate = true as const;

/** The server render has no answer yet: whether this instance takes reports at all is the browser's read. */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('admin.feedback.loading')}</p>;
}

/** Where the queue read is. `forbidden` is a value this page renders, never an exception that unmounts it. */
type QueueState =
  { kind: 'loading' } | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'ready'; reports: AdminFeedbackReport[] };

export default function AdminFeedback() {
  const { t } = useTranslation();
  const { retentionDays } = useLoaderData<typeof clientLoader>();
  const [queue, setQueue] = useState<QueueState>({ kind: 'loading' });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [didDeleteFail, setDidDeleteFail] = useState(false);

  const loadQueue = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setQueue({ kind: 'forbidden' });
      return;
    }
    try {
      const outcome = await client.listFeedbackReports();
      if (outcome.status === 'forbidden') {
        setQueue({ kind: 'forbidden' });
        return;
      }
      setQueue({ kind: 'ready', reports: outcome.value.reports });
    } catch {
      setQueue({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // THE LIST IS RE-READ RATHER THAN SPLICED. A delete may race a retention
  // sweep or a second administrator, so what the queue holds afterwards is the
  // service's answer and not this page's arithmetic.
  const deleteReport = useCallback(
    async (reportId: number): Promise<void> => {
      const client = currentAdminClient();
      if (client === null) {
        setQueue({ kind: 'forbidden' });
        return;
      }
      setDeletingId(reportId);
      setDidDeleteFail(false);
      try {
        const outcome = await client.deleteFeedbackReport({ id: reportId });
        if (outcome.status === 'forbidden') {
          setQueue({ kind: 'forbidden' });
          return;
        }
        await loadQueue();
      } catch {
        setDidDeleteFail(true);
      } finally {
        setDeletingId(null);
      }
    },
    [loadQueue],
  );

  if (queue.kind === 'forbidden') return <NotAnAdministratorCard />;

  if (queue.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('admin.feedback.loading')}
      </p>
    );
  }

  if (queue.kind === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.feedback.failed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="h-11" onClick={() => void loadQueue()}>
            {t('admin.feedback.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.feedback.title')}</CardTitle>
        <CardDescription>{t('admin.feedback.body', { days: retentionDays })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {didDeleteFail && <p className="text-sm text-destructive">{t('admin.feedback.deleteFailed')}</p>}
        <FeedbackQueue
          reports={queue.reports}
          retentionDays={retentionDays}
          deletingId={deletingId}
          onDelete={(reportId) => void deleteReport(reportId)}
        />
      </CardContent>
    </Card>
  );
}
