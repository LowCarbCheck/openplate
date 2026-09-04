/**
 * `/settings/research` — the contributor's own view of the studies she
 * contributes to, and the one place she can leave one.
 *
 * ── Why the pseudonym is on screen ───────────────────────────────────────
 *
 * It is the only identifier that exists on the study's side. A contributor who
 * cannot see her own pseudonym cannot ask a researcher to confirm that her
 * withdrawal was honoured — the question would have no subject. So it is shown
 * here, derived on this device from the compartment root, never stored.
 *
 * ── The confirmation is three sentences and none of them is softened ──────
 *
 * The study is instructed to delete; a copy it already downloaded cannot be
 * taken back; no new data will be sent. `PROTOCOL.md` §5.18 is explicit that
 * honouring the tombstone is an ethics obligation this system states and
 * cannot enforce, and a screen that said "your data has been deleted" after a
 * `204` would be a lie in the common case.
 *
 * A fourth sentence rides with them: re-joining presents the SAME pseudonym,
 * because withdrawal does not mint a new root. See `research/withdraw.ts` for
 * why the alternative is worse.
 *
 * ── This route does not exist when sync is off ───────────────────────────
 *
 * The loader 404s when `SYNC_SERVER_URL` is unset, exactly as
 * `settings.sharing.tsx` does: a contribution is pushed to the sync service,
 * so on an instance with no sync there is nothing here to be a page about.
 * Everything below the loader is client-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { FlaskConical, Loader2 } from 'lucide-react';

import { CONFIG } from '#app/config';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ResearchSubmitPanel } from '#app/components/research-submit-panel';
import { ResearchWindowLine } from '#app/components/research-window-line';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import {
  loadResearchEnrolments,
  submitContributionAction,
  withdrawFromStudyAction,
  type StudyEnrolmentView,
} from '#app/lib/sync/research-actions';
import {
  submitOutcomeCopy,
  type ResearchWindowDraft,
  type SubmitOutcomeCopy,
} from '#app/lib/sync/research/submit-view';
import { DAILY_INTAKE_V1 } from '#app/lib/sync/research/tiers';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.research') }];

export const handle = {
  titleKey: 'research.title',
  title: 'Research contributions',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no sync server configured. */
export function loader() {
  if (CONFIG.sync.syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { researchRouteEnabled: true };
}

/** What the page knows about this account's studies right now. */
type EnrolmentsState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'ready'; enrolments: StudyEnrolmentView[] };

export default function SettingsResearch() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const [state, setState] = useState<EnrolmentsState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    if (session.account === null) {
      setState({ status: 'signed-out' });
      return;
    }
    const loaded = await loadResearchEnrolments();
    setState(
      loaded.status === 'unavailable' ? { status: 'unavailable' } : { status: 'ready', enrolments: loaded.value },
    );
  }, [session.account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" aria-hidden="true" /> {t('research.title')}
          </CardTitle>
          <CardDescription>{t('research.intro')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* The two caveats ride above every list state, including the empty
              one: what a study receives is pseudonymised, and a stable
              pseudonym is not the same as being unidentifiable (ADR-0003's
              first-ranked attack). */}
          <p className="text-sm text-muted-foreground">{t('research.caveats.pseudonymised')}</p>
          <p className="text-sm text-muted-foreground">{t('research.caveats.auxiliaryJoin')}</p>

          {state.status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'signed-out' && <SignedOutNotice />}
          {state.status === 'unavailable' && (
            <p className="text-sm text-muted-foreground">{t('research.unavailable')}</p>
          )}
          {state.status === 'ready' && (
            <EnrolmentsSection enrolments={state.enrolments} onChanged={() => void refresh()} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Contributing needs the sync session's transport, so nothing here works signed out — and saying so beats a dead list. */
function SignedOutNotice() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('research.needsSession')}</p>
      <Button asChild variant="outline" className="h-11">
        <Link to="/settings/account">{t('research.needsSessionCta')}</Link>
      </Button>
    </div>
  );
}

function EnrolmentsSection({
  enrolments,
  onChanged,
}: {
  enrolments: readonly StudyEnrolmentView[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);

  async function handleWithdraw(studyAccountId: number): Promise<void> {
    setWithdrawing(studyAccountId);
    setMessage(null);
    try {
      const result = await withdrawFromStudyAction(studyAccountId);
      // A dark lane withdrew NOTHING and kept the pin, so it must not read as
      // a success — `research/withdraw.ts` is where that distinction is made.
      setMessage(result.status === 'withdrawn' ? t('research.withdrawal.done') : t('research.withdrawal.unavailable'));
      onChanged();
    } catch (caught) {
      setMessage(describeErrorForUser(caught, t('research.withdrawal.failed')));
    } finally {
      setWithdrawing(null);
    }
  }

  if (enrolments.length === 0) return <p className="text-sm text-muted-foreground">{t('research.enrolments.empty')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium">{t('research.enrolments.title')}</h2>
      {enrolments.map((enrolment) => (
        <EnrolmentCard
          key={enrolment.studyAccountId}
          enrolment={enrolment}
          isBusy={withdrawing === enrolment.studyAccountId}
          onWithdraw={() => void handleWithdraw(enrolment.studyAccountId)}
          onSubmitted={onChanged}
        />
      ))}
      {message !== null && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

/** One study: its local name, what it receives, the pseudonym it sees, the way to send it a window, and the way out. */
function EnrolmentCard({
  enrolment,
  isBusy,
  onWithdraw,
  onSubmitted,
}: {
  enrolment: StudyEnrolmentView;
  isBusy: boolean;
  onWithdraw: () => void;
  /** Refreshes the list after an accepted submission, so the window line names the days that just went. */
  onSubmitted: () => void;
}) {
  const { t } = useTranslation();
  const name = enrolment.label ?? t('research.enrolments.unnamed', { studyAccountId: enrolment.studyAccountId });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{name}</h3>
        <p className="text-xs text-muted-foreground">
          {t('research.enrolments.joined', { at: new Date(enrolment.joinedAt).toLocaleDateString() })}
        </p>
      </div>

      {/* What it receives: the tier by name, the window, and the seven fields
          a day carries. The tier is the frozen one — a study never supplies a
          field list (ADR-0003 prohibition 1).

          The window NAMES DAYS once this device has sent some (M163/01), and
          describes the granularity only while `lastSubmission` is `null`. That
          `null` is "nothing sent yet" and must render as that: an empty range
          or a defaulted today would be the screen claiming days that were
          never sent, which is the failure `research/contribute.ts`'s ordering
          rule exists to prevent. */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{t('research.enrolments.tier', { tier: enrolment.server?.schemaTier ?? DAILY_INTAKE_V1 })}</p>
        <ResearchWindowLine lastSubmission={enrolment.lastSubmission} />
        <p>{t('research.enrolments.fields')}</p>
        <p>
          {enrolment.server === null ?
            t('research.enrolments.neverSent')
          : t('research.enrolments.lastSent', {
              at: new Date(enrolment.server.updatedAt).toLocaleDateString(),
              version: enrolment.server.contributionVersion,
            })
          }
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">{t('research.enrolments.pseudonymLabel')}</p>
        {enrolment.pseudonym === null ?
          <p className="text-xs text-muted-foreground">{t('research.enrolments.pseudonymUnknown')}</p>
        : <p className="break-all font-mono text-sm">{enrolment.pseudonym}</p>}
        <p className="text-xs text-muted-foreground">{t('research.enrolments.pseudonymHint')}</p>
      </div>

      {/* Sending is a separate, deliberate act — never a consequence of
          joining. The panel is hidden on a device that cannot derive the
          pseudonym, because there is no honest submission to make without it. */}
      {enrolment.pseudonym !== null && (
        <SendWindowSection studyAccountId={enrolment.studyAccountId} onSubmitted={onSubmitted} />
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="h-11" disabled={isBusy}>
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('research.withdrawal.open')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('research.withdrawal.confirmTitle', { name })}</AlertDialogTitle>
            {/* One sentence each, and the middle one is NOT softened: §5.18
                says honouring the tombstone is an obligation this system
                states and cannot enforce. */}
            <AlertDialogDescription>{t('research.withdrawal.instructedToDelete')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('research.withdrawal.alreadyDownloaded')}</p>
            <p>{t('research.withdrawal.noNewData')}</p>
            <p>{t('research.withdrawal.samePseudonymOnRejoin')}</p>
            <p>{t('research.withdrawal.rejoinNeedsCeremony')}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{t('research.withdrawal.cancel')}</AlertDialogCancel>
            <Button disabled={isBusy} onClick={onWithdraw}>
              {t('research.withdrawal.confirmCta')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * The send-a-window control for one study.
 *
 * State lives here rather than on the list so two studies cannot share an
 * outcome line: "sent 2026-08-01 to 2026-08-24" beside the wrong study would
 * be the screen naming days it did not send there.
 *
 * The picker's emptiness, the sendable check and the outcome sentences are all
 * `research/submit-view.ts`'s; this function only carries them to the action.
 */
function SendWindowSection({ studyAccountId, onSubmitted }: { studyAccountId: number; onSubmitted: () => void }) {
  const { t } = useTranslation();
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcomeCopy | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSend(window: ResearchWindowDraft): Promise<void> {
    setIsSending(true);
    setOutcome(null);
    setFailure(null);
    try {
      const result = await submitContributionAction({
        studyAccountId,
        fromDayKey: window.fromDayKey,
        toDayKey: window.toDayKey,
      });
      setOutcome(submitOutcomeCopy({ result, window }));
      // Only an accepted submission changed anything worth re-reading: the pin
      // now carries the window, and the server row a new version.
      if (result.status === 'submitted') onSubmitted();
    } catch (caught) {
      setFailure(describeErrorForUser(caught, t('research.submit.failed')));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <ResearchSubmitPanel
        studyAccountId={studyAccountId}
        onSubmit={(window) => void handleSend(window)}
        isSubmitting={isSending}
        outcome={outcome}
      />
      {failure !== null && <p className="text-sm text-destructive">{failure}</p>}
    </div>
  );
}
