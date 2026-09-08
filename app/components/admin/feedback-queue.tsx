/**
 * The queue of reported estimates: one row each, newest first.
 *
 * ── The queue carries nothing out of anybody's diary ─────────────────────
 *
 * A row names a report and an account, whether a photograph came with it, when
 * it arrived and when it deletes itself. It does NOT name the food, and it
 * does not draw the photograph. That is the service's decision rather than a
 * gap here: `feedback-admin-store.ts` leaves the figures out of the list so a
 * screenshot of the queue is not a page of other people's meals, and the
 * figures belong to the one report a reviewer opened.
 *
 * ── No thumbnails, deliberately ──────────────────────────────────────────
 *
 * Every read of a photograph is logged with the administrator who read it
 * (`admin-feedback-routes.ts`, the audit comment). A queue that drew twenty
 * thumbnails would write twenty audit lines nobody chose to create, and it
 * would bury the one line that says which meal was actually looked at. The
 * photograph is on the report's own page, one deliberate opening at a time.
 *
 * ── The row is not a link ────────────────────────────────────────────────
 *
 * Unlike the people list, where the row is one `<a>` and every action moved to
 * the person's page. A report has exactly one action, deleting it now, and it
 * is the action an operator takes from the queue after reading one line. So
 * the row carries a link and a button side by side rather than swallowing the
 * button inside the link.
 */
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, ImageOff } from 'lucide-react';

import { ConfirmButton } from '#app/components/admin/person-actions';
import { Link } from '#app/components/link';
import type { AdminFeedbackReport } from '#app/lib/admin/admin-wire';
import { reportDeletesAt } from '#app/lib/admin/feedback-console';

export interface FeedbackQueueProps {
  reports: AdminFeedbackReport[];
  /** The window this instance advertises. Every row states its own deletion date from it. */
  retentionDays: number;
  /** The report a delete is in flight for, or `null`. One at a time, so the row that is going says so. */
  deletingId: number | null;
  onDelete: (reportId: number) => void;
}

export function FeedbackQueue({ reports, retentionDays, deletingId, onDelete }: FeedbackQueueProps) {
  const { t } = useTranslation();

  if (reports.length === 0) return <p className="text-sm text-muted-foreground">{t('admin.feedback.empty')}</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {reports.map((report) => (
        <FeedbackRow
          key={report.id}
          report={report}
          retentionDays={retentionDays}
          isDeleting={deletingId === report.id}
          onDelete={() => onDelete(report.id)}
        />
      ))}
    </ul>
  );
}

/** One report: what it is, when it goes, a way in, and the one action. */
function FeedbackRow({
  report,
  retentionDays,
  isDeleting,
  onDelete,
}: {
  report: AdminFeedbackReport;
  retentionDays: number;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const deletesAt = reportDeletesAt({ createdAt: report.createdAt, retentionDays });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p className="font-medium">
          <Link to={`/admin/feedback/${report.id}`} className="underline-offset-4 hover:underline">
            {t('admin.feedback.reportTitle', { id: report.id })}
          </Link>
        </p>
        <p className="text-sm text-muted-foreground">{t('admin.feedback.person', { id: report.accountId })}</p>
      </div>
      <p className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
        {report.hasImage ?
          <>
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            {t('admin.feedback.hasPhoto')}
          </>
        : <>
            <ImageOff className="h-4 w-4" aria-hidden="true" />
            {t('admin.feedback.noPhoto')}
          </>
        }
      </p>
      <div className="shrink-0 space-y-1 text-sm text-muted-foreground sm:text-right">
        <p>{t('admin.feedback.reportedAt', { date: new Date(report.createdAt).toLocaleDateString() })}</p>
        {deletesAt !== null && <p>{t('admin.feedback.deletesAt', { date: deletesAt.toLocaleDateString() })}</p>}
      </div>
      <ConfirmButton
        label={t('admin.feedback.deleteCta')}
        title={t('admin.feedback.deleteConfirmTitle', { id: report.id })}
        body={t('admin.feedback.deleteConfirmBody')}
        confirmLabel={t('admin.feedback.deleteConfirmCta')}
        isBusy={isDeleting}
        onConfirm={onDelete}
      />
    </li>
  );
}
