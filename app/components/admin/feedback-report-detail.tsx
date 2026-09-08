/**
 * One reported estimate: the photograph beside the figures it was produced
 * from, the consent that let both be kept, and the one action.
 *
 * ── This is the screen the whole feature exists for ──────────────────────
 *
 * "A queue nobody reads is worse than no queue." The reviewer's question is
 * always the same, does the picture match the numbers, so the two sit side by
 * side at any width wide enough to hold them and stack in that order below it.
 *
 * ── Every figure is drawn, including the ones there are none of ──────────
 *
 * Seven rows, always. A macro the model gave no answer for says so, because
 * "the model returned nothing for fibre" is exactly the kind of report this
 * screen exists to make visible, and an absent row would read as a zero.
 *
 * ── Presentational ───────────────────────────────────────────────────────
 *
 * The report, the photograph's state and the callbacks all come in as props.
 * The route owns the reads, the object URL and the delete, which is what lets
 * every state here be a render test.
 */
import { useTranslation } from 'react-i18next';

import { FeedbackPhoto, type FeedbackPhotoState } from '#app/components/admin/feedback-photo';
import { ConfirmButton } from '#app/components/admin/person-actions';
import { Link } from '#app/components/link';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import type { AdminFeedbackReportDetail } from '#app/lib/admin/admin-wire';
import { reportDeletesAt, reportedFigures, type ReportedFigure } from '#app/lib/admin/feedback-console';

export interface FeedbackReportViewProps {
  report: AdminFeedbackReportDetail;
  photo: FeedbackPhotoState;
  retentionDays: number;
  isDeleting: boolean;
  onDelete: () => void;
}

export function FeedbackReportView({ report, photo, retentionDays, isDeleting, onDelete }: FeedbackReportViewProps) {
  const { t } = useTranslation();
  const deletesAt = reportDeletesAt({ createdAt: report.createdAt, retentionDays });

  return (
    <div className="space-y-4">
      <Link to="/admin/feedback" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t('admin.feedback.back')}
      </Link>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>{t('admin.feedback.reportTitle', { id: report.id })}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('admin.feedback.person', { id: report.accountId })}</p>
          <p className="text-sm text-muted-foreground">
            {t('admin.feedback.reportedAt', { date: new Date(report.createdAt).toLocaleDateString() })}
          </p>
          {deletesAt !== null && (
            <p className="text-sm text-muted-foreground">
              {t('admin.feedback.deletesAt', { date: deletesAt.toLocaleDateString() })}
            </p>
          )}
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <FeedbackPhoto reportId={report.id} state={photo} />
          <Figures report={report} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.feedback.consentTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t('admin.feedback.consentAgreed', {
              date: new Date(report.consent.agreedAt).toLocaleDateString(),
            })}
          </p>
          <p>{t('admin.feedback.consentWording', { version: report.consent.wordingVersion })}</p>
        </CardContent>
      </Card>

      <ConfirmButton
        label={t('admin.feedback.deleteCta')}
        title={t('admin.feedback.deleteConfirmTitle', { id: report.id })}
        body={t('admin.feedback.deleteConfirmBody')}
        confirmLabel={t('admin.feedback.deleteConfirmCta')}
        isBusy={isDeleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

/** What the model said about this one entry: what it was, how much of it, and the seven figures. */
function Figures({ report }: { report: AdminFeedbackReportDetail }) {
  const { t } = useTranslation();
  const { measurements } = report;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="font-medium">{measurements.name === '' ? t('admin.feedback.noName') : measurements.name}</p>
        {measurements.quantityGrams !== null && (
          <p className="text-sm text-muted-foreground">
            {t('admin.feedback.grams', { value: measurements.quantityGrams })}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {measurements.aiEstimated ? t('admin.feedback.aiEstimated') : t('admin.feedback.notAiEstimated')}
        </p>
        {measurements.source !== '' && (
          <p className="text-sm text-muted-foreground">{t('admin.feedback.source', { source: measurements.source })}</p>
        )}
      </div>
      <dl className="space-y-1 text-sm">
        {reportedFigures(measurements).map((figure) => (
          <div key={figure.labelKey} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t(figure.labelKey)}</dt>
            <dd>
              <FigureValue figure={figure} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One figure's value, in its own unit, or the words for "the model gave none". */
function FigureValue({ figure }: { figure: ReportedFigure }) {
  const { t } = useTranslation();
  if (figure.value === null) return <>{t('admin.feedback.figureNone')}</>;
  if (figure.unit === 'calorie') return <>{t('admin.feedback.calories', { value: figure.value })}</>;
  return <>{t('admin.feedback.grams', { value: figure.value })}</>;
}
