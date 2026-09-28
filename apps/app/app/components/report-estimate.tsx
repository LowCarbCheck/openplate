/**
 * "These numbers are wrong" on a logged entry, and the separate consent step
 * that has to be passed before anything leaves the device.
 *
 * TWO TAPS, NOT ONE, AND THAT IS THE REQUIREMENT. The button opens a step that
 * names who can see the photograph, how long it is kept and that this one item
 * leaves the device unencrypted, and offers a plain way to decline. A single
 * tap that both asked and sent would be a button that uploads a photograph of
 * somebody's dinner because they were curious what it did.
 *
 * WHAT IS SHOWN DEPENDS ON WHETHER THERE IS A PHOTOGRAPH. An entry added from
 * search or typed by hand never had one, and the figures-only wording says so
 * instead of asking for consent to send an image that does not exist. The
 * cache is consulted for THIS entry's batch through the same reactive hook the
 * receipt above already uses, so the step and the picture on screen can never
 * disagree.
 *
 * THE REPORT IS QUEUED, NOT POSTED. `enqueueFeedbackReport` writes it to
 * IndexedDB and returns; the sync controller drains the queue when the device
 * has a connection. A person in a supermarket with one bar gets a report that
 * arrives later, not a spinner and a lost report.
 *
 * VISIBLE ONLY TO A SIGNED-IN ACCOUNT, because the endpoint is bearer-gated
 * and an instance with no sync server has nowhere to send one.
 *
 * AND ONLY WHEN THE SERVER HAS SAID HOW LONG IT KEEPS A PHOTOGRAPH. The step
 * below states a number of days, and that number is the server's promise, read
 * off its `/health` handshake (`instance.feedback.retentionDays`). This app
 * used to hold a matching constant of its own, which is the defect M200 spec
 * 06 repairs: an operator who moved their window left the dialog promising the
 * old one. A server that advertises no window is one with reports switched off,
 * or one older than the field, and in both cases this build knows of no
 * promise. It therefore offers no report rather than wording the step around
 * the gap: a person cannot weigh "we keep it for a while", the POST would very
 * likely 404 anyway, and the alternative is printing a number nobody made.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { publishStatus } from '#app/lib/status';
import { MessageSquareWarning } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#app/components/ui/alert-dialog';
import { useSyncSession } from '#app/components/sync-status';
import { usePlatePhoto } from '#app/hooks/use-plate-photo';
import { useFeedbackRetentionDays } from '#app/hooks/use-server-instance';
import { feedbackConsentLines, recordFeedbackConsent } from '#app/lib/feedback/feedback-consent';
import { buildFeedbackMeasurements, type FeedbackMeasurementsInput } from '#app/lib/feedback/feedback-report';
import { drainFeedbackOutboxOnce, enqueueFeedbackReport } from '#app/lib/local-store/feedback-outbox';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('report-estimate');

export interface ReportEstimateProps {
  userId: number;
  logId: string;
  logBatchId: string | null;
  entry: FeedbackMeasurementsInput;
}

export function ReportEstimate({ userId, logId, logBatchId, entry }: ReportEstimateProps) {
  const { t } = useTranslation();
  const session = useSyncSession();
  const photoDataUrl = usePlatePhoto({ userId, logBatchId });
  const retentionDays = useFeedbackRetentionDays();
  const [isOpen, setIsOpen] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);

  // No account, nowhere to send it. `isResuming` is deliberately NOT treated
  // as signed out: a reload would otherwise hide this button for a moment and
  // then pop it in, which reads as a glitch on the one screen that must look
  // deliberate.
  if (session.account === null) return null;
  // NO ADVERTISED WINDOW, NO OFFER. See the module header: this build has no
  // number it is entitled to state, and the step exists to state one.
  if (retentionDays === null) return null;

  const hasPhoto = photoDataUrl !== null;
  const consent = feedbackConsentLines({ t, hasPhoto, retentionDays });

  const handleAgree = (): void => {
    setIsQueueing(true);
    void (async () => {
      try {
        await enqueueFeedbackReport({
          userId,
          logId,
          logBatchId,
          measurements: buildFeedbackMeasurements(entry),
          // Minted HERE, at the moment the person pressed the agreeing
          // button, and never earlier: a record written when the dialog opened
          // would timestamp a decision that had not been taken.
          consent: recordFeedbackConsent(),
        });
        setIsOpen(false);
        publishStatus({ text: t('entry.report.queued') });
        // Best effort, and deliberately not awaited for the message: the report
        // is already durable, so an offline device has lost nothing.
        void drainFeedbackOutboxOnce();
      } catch (error) {
        log.warn('could not queue a feedback report', {
          error: error instanceof Error ? error.message : String(error),
        });
        publishStatus({ text: t('entry.report.failed'), tone: 'error' });
      } finally {
        setIsQueueing(false);
      }
    })();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full text-muted-foreground"
        onClick={() => setIsOpen(true)}
      >
        <MessageSquareWarning className="h-4 w-4" /> {t('entry.report.button')}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{consent.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              {consent.points.map((point) => (
                <p key={point}>{point}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{consent.decline}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // The dialog closes itself on this action; the queue write is
              // asynchronous and the toast is the confirmation, so the default
              // close is prevented and `handleAgree` closes on success.
              event.preventDefault();
              handleAgree();
            }}
            disabled={isQueueing}
          >
            {isQueueing ? t('entry.report.sending') : consent.agree}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
