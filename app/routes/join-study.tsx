/**
 * `/join-study#k=<key>&a=<account>&n=<name>` — where a study's join link lands
 * on a contributor's device (M163/02).
 *
 * CLIENT-ONLY, and it exports no `loader`, `action`, `clientLoader` or
 * `clientAction` — deliberately, like `connect-clinician.tsx` beside it. The
 * payload lives in the URL FRAGMENT, which no browser sends to any server, so
 * a loader could not read it even if one existed.
 *
 * ── A key in the query string is REFUSED ──────────────────────────────────
 *
 * Not read-anyway-with-a-warning. Mail providers rewrite links for tracking,
 * and a rewrite that moved the fragment into the query string would downgrade
 * the design while every screen kept working. The refusal is loud, it is
 * final, and it asks for the link again — see `app/lib/study-link.ts`. Those
 * parameters are also stripped from the address bar: they have already reached
 * a server once, and a reload would send them again.
 *
 * ── Two independent channels, or the ceremony is theatre ──────────────────
 *
 * The key arrives in the link. The fingerprint is typed from the study's
 * PRINTED CONSENT DOCUMENT. This screen never displays the fingerprint it
 * computed from the received key — if it did, both halves of the ceremony
 * would come from the same source and a substituted key would pass. The only
 * thing the form learns from the key is a boolean
 * (`use-typed-fingerprint-match.ts`), which is why it cannot show one.
 *
 * ── An account with no compartment is refused, not degraded ───────────────
 *
 * `runEnrolmentCeremony` returns three outcomes and this screen adds none:
 * `JoinStudyPhase` is a union WITH that result type. `compartment-missing`
 * gets the recovery path and no way to enrol anyway — ADR-0003 prohibition 4.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { FlaskConical, Loader2, ShieldQuestion } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { StudyCompartmentMissing } from '#app/components/study-compartment-missing';
import { StudyVerifyStep, type StudyEnrolmentDraft } from '#app/components/study-verify-step';
import { useSyncSession } from '#app/components/sync-status';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  joinStudyViewFor,
  parseStudyLink,
  type JoinStudyPhase,
  type StudyInvite,
  type StudyLinkParse,
} from '#app/lib/study-link';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { enrolInStudyAction } from '#app/lib/sync/research-actions';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.joinStudy') }];

export const handle = {
  titleKey: 'research.join.title',
  title: 'Join a study',
};

/** What the link said, or that it has not been read yet. */
type LinkState = StudyLinkParse | { status: 'loading' };

export default function JoinStudy() {
  const { t } = useTranslation();
  const [link, setLink] = useState<LinkState>({ status: 'loading' });
  const hasReadRef = useRef(false);

  useEffect(() => {
    // StrictMode double-mount guard: the refusal path rewrites the address bar,
    // and a second read would see a clean URL and report a truncated link
    // instead of the leak that actually happened.
    if (hasReadRef.current) return;
    hasReadRef.current = true;

    const parsed = parseStudyLink({ hash: window.location.hash, search: window.location.search });
    if (parsed.status === 'query-string') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    }
    setLink(parsed);
  }, []);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" aria-hidden="true" /> {t('research.join.title')}
          </CardTitle>
          <CardDescription>{t('research.join.description')}</CardDescription>
        </CardHeader>
        {link.status === 'loading' && <LoadingCard />}
        {link.status === 'query-string' && <QueryStringCard parameters={link.parameters} />}
        {link.status === 'invalid' && <InvalidLinkCard />}
        {link.status === 'ok' && <JoinSection invite={link.invite} />}
      </Card>
    </div>
  );
}

function LoadingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('research.join.reading')}</p>
    </CardContent>
  );
}

/**
 * The refusal.
 *
 * It names what happened — the key travelled in the part of the address that
 * is sent to servers — and it asks for the link again rather than offering a
 * way to continue. There is no "use it anyway" control here, and adding one
 * would make the fragment a suggestion.
 */
function QueryStringCard({ parameters }: { parameters: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <Alert variant="warning">
        <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{t('research.join.queryString.title')}</AlertTitle>
        <AlertDescription>{t('research.join.queryString.body')}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        {t('research.join.queryString.parameters', { parameters: parameters.join(', ') })}
      </p>
      <p className="text-sm">{t('research.join.queryString.askAgain')}</p>
      <BackToResearchLink />
    </CardContent>
  );
}

function InvalidLinkCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('research.join.invalidLink.title')}</p>
      <p className="text-sm text-muted-foreground">{t('research.join.invalidLink.body')}</p>
      <BackToResearchLink />
    </CardContent>
  );
}

function BackToResearchLink() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <Link
        to="/settings/research"
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('research.join.backToResearch')}
      </Link>
    </div>
  );
}

/**
 * The ceremony, once the link parsed.
 *
 * Two gates come first, both client-side: an instance with no sync server has
 * no research lane to contribute to, and enrolment needs the owner-private
 * compartment, which needs an unlocked session. Neither is a server check —
 * this route has no loader.
 */
function JoinSection({ invite }: { invite: StudyInvite }) {
  const { t } = useTranslation();
  const syncServerUrl = useSyncServerUrl();
  const session = useSyncSession();
  const [phase, setPhase] = useState<JoinStudyPhase>({ status: 'verify' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSubmit(draft: StudyEnrolmentDraft): Promise<void> {
    setIsSubmitting(true);
    setFailure(null);
    try {
      setPhase(
        await enrolInStudyAction({
          studyAccountId: invite.studyAccountId,
          // The bytes THIS DEVICE received, not anything the form re-typed.
          publicKeyBase64: invite.publicKeyBase64,
          typedFingerprint: draft.typedFingerprint,
          label: draft.label.trim() === '' ? invite.claimedLabel : draft.label.trim(),
        }),
      );
    } catch (caught) {
      setFailure(describeErrorForUser(caught, t('research.join.failed')));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (syncServerUrl === null) return <NoSyncCard />;
  if (session.account === null) return <SignedOutCard />;

  // The ONLY branch on the ceremony's outcome, and it is a pure function
  // (`study-link.ts`) so what an account with no compartment sees is one
  // assertion rather than a reading of this JSX.
  const view = joinStudyViewFor(phase);
  if (view === 'compartment-missing') {
    return (
      <CardContent className="py-6">
        <StudyCompartmentMissing />
      </CardContent>
    );
  }
  if (view === 'enrolled' && phase.status === 'enrolled') return <EnrolledCard pseudonym={phase.pseudonym} />;

  return (
    <CardContent className="space-y-4 py-6">
      <StudyVerifyStep
        invite={invite}
        onSubmit={(draft) => void handleSubmit(draft)}
        isSubmitting={isSubmitting}
        message={failure ?? (phase.status === 'fingerprint-mismatch' ? t('research.join.mismatch') : null)}
      />
    </CardContent>
  );
}

/**
 * Joined.
 *
 * The pseudonym is shown because it is the only identifier the study will ever
 * have for this person: without it she cannot later ask a researcher whether a
 * withdrawal was honoured. Nothing has been sent yet — sending a window is a
 * separate, deliberate act on `/settings/research`.
 */
function EnrolledCard({ pseudonym }: { pseudonym: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-sm font-medium">{t('research.join.enrolled.title')}</p>
      <div className="space-y-1">
        <p className="text-xs font-medium">{t('research.enrolments.pseudonymLabel')}</p>
        <p className="break-all font-mono text-sm">{pseudonym}</p>
      </div>
      <p className="text-sm text-muted-foreground">{t('research.join.enrolled.body')}</p>
      <Button asChild className="h-11 w-full">
        <Link to="/settings/research">{t('research.join.enrolled.cta')}</Link>
      </Button>
    </CardContent>
  );
}

/** An instance with no sync server has no research lane at all — there is nothing here to switch on. */
function NoSyncCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('research.join.noSync.title')}</p>
      <p className="text-sm text-muted-foreground">{t('research.join.noSync.body')}</p>
    </CardContent>
  );
}

/** Enrolling writes into the owner-private compartment, and that needs an unlocked session. */
function SignedOutCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-sm text-muted-foreground">{t('research.join.signedOut.body')}</p>
      <Button asChild variant="outline" className="h-11 w-full">
        <Link to="/settings/account">{t('research.needsSessionCta')}</Link>
      </Button>
    </CardContent>
  );
}
