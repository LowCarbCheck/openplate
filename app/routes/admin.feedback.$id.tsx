/**
 * `/admin/feedback/:id`, one reported estimate, opened on purpose.
 *
 * ── Why the report has a page of its own ─────────────────────────────────
 *
 * Because the service withholds the figures from the list, deliberately: the
 * queue is what an operator scans, and `feedback-admin-store.ts` keeps the
 * measurements out of it so a page of the queue carries nothing from anybody's
 * diary. The figures arrive only from `GET /v1/admin/feedback/:id`, which is
 * this page, and it is the only place they and the photograph are side by
 * side, which is the thing the feature exists for.
 *
 * ── Opening a photograph is an act, and it is logged ─────────────────────
 *
 * The service writes an audit line for every read of an image: who, which
 * report, when. So the photograph is read HERE, once, by an administrator who
 * navigated to one report, rather than twenty at a time behind a queue of
 * thumbnails nobody chose to open.
 *
 * ── The bytes never become a URL anybody could follow ────────────────────
 *
 * The credential is a bearer token, and an `<img src>` cannot carry one
 * without putting it in a query string, which would put a working capability
 * into a browser history, a referrer and every proxy in between. The bytes are
 * read over the admin client and turned into an object URL this component owns
 * and revokes when it goes away or when the report changes.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import type { Route } from './+types/admin.feedback.$id';
import { CONFIG } from '#app/config';
import { FeedbackReportView } from '#app/components/admin/feedback-report-detail';
import type { FeedbackPhotoState } from '#app/components/admin/feedback-photo';
import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '#app/components/ui/card';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import type { AdminFeedbackReportDetail } from '#app/lib/admin/admin-wire';
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

/** Where the report read is. One `kind`, so a spinner and a refusal can never be on screen together. */
type ReportState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'failed' }
  | { kind: 'ready'; report: AdminFeedbackReportDetail };

export default function AdminFeedbackReport() {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const { retentionDays } = useLoaderData<typeof clientLoader>();
  const [state, setState] = useState<ReportState>({ kind: 'loading' });
  const [photo, setPhoto] = useState<FeedbackPhotoState>({ kind: 'loading' });
  const [isDeleting, setIsDeleting] = useState(false);
  const [didDeleteFail, setDidDeleteFail] = useState(false);

  // A path that is not a whole number cannot be a report, and the read would
  // ask the service about `NaN`. Same answer a deleted report gets, because
  // from here they are the same thing: there is nothing at this address.
  const id = Number.parseInt(params.id ?? '', 10);
  const hasId = Number.isInteger(id);

  const load = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    if (!hasId) {
      setState({ kind: 'missing' });
      return;
    }
    try {
      const outcome = await client.getFeedbackReport({ id });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      setState({ kind: 'ready', report: outcome.value });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [hasId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // THE OBJECT URL IS CREATED AND REVOKED IN ONE PLACE. A URL left behind
  // holds the bytes of somebody's meal in the tab for as long as it lives, and
  // the whole point of reading the image this way was that it is not left
  // lying around anywhere a person did not put it.
  const hasImage = state.kind === 'ready' && state.report.hasImage;
  useEffect(() => {
    if (state.kind !== 'ready') return;
    if (!hasImage) {
      setPhoto({ kind: 'none' });
      return;
    }
    let objectUrl: string | null = null;
    let isMounted = true;
    setPhoto({ kind: 'loading' });
    const read = async (): Promise<void> => {
      const client = currentAdminClient();
      if (client === null) {
        setPhoto({ kind: 'failed' });
        return;
      }
      try {
        const outcome = await client.feedbackImage({ id });
        if (outcome.status !== 'ok') {
          setPhoto(outcome.status === 'gone' ? { kind: 'gone' } : { kind: 'failed' });
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([outcome.image.bytes], { type: outcome.image.contentType }));
        if (!isMounted) return;
        setPhoto({ kind: 'ready', src: objectUrl });
      } catch {
        setPhoto({ kind: 'failed' });
      }
    };
    void read();
    return () => {
      isMounted = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [state.kind, hasImage, id]);

  const deleteReport = useCallback(async (): Promise<void> => {
    const client = currentAdminClient();
    if (client === null) {
      setState({ kind: 'forbidden' });
      return;
    }
    setIsDeleting(true);
    setDidDeleteFail(false);
    try {
      const outcome = await client.deleteFeedbackReport({ id });
      if (outcome.status === 'forbidden') {
        setState({ kind: 'forbidden' });
        return;
      }
      await navigate('/admin/feedback');
    } catch {
      setDidDeleteFail(true);
    } finally {
      setIsDeleting(false);
    }
  }, [id, navigate]);

  if (state.kind === 'forbidden') return <NotAnAdministratorCard />;

  if (state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('admin.feedback.loading')}
      </p>
    );
  }

  if (state.kind === 'missing' || state.kind === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardDescription>
            {state.kind === 'missing' ? t('admin.feedback.notFound') : t('admin.feedback.failed')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="h-11" onClick={() => void load()}>
            {t('admin.feedback.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {didDeleteFail && <p className="text-sm text-destructive">{t('admin.feedback.deleteFailed')}</p>}
      <FeedbackReportView
        report={state.report}
        photo={photo}
        retentionDays={retentionDays}
        isDeleting={isDeleting}
        onDelete={() => void deleteReport()}
      />
    </div>
  );
}
