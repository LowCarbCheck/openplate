/**
 * `/connect-clinician#k=<key>&a=<account>&n=<name>` — where a clinician's
 * connect link lands on the patient's device (M160/08).
 *
 * CLIENT-ONLY, and it exports no `loader`, `action`, `clientLoader` or
 * `clientAction` — deliberately, like `connect-gateway.tsx` beside it. The
 * payload lives in the URL FRAGMENT, which no browser sends to any server, so
 * a loader could not read it even if one existed. That is the point:
 * `openplate-sync` ADR-0002 prohibition 1 says the server never stores, serves
 * or endorses a share public key, and a query parameter would put the key in
 * this server's access log, in a `Referer` header and in every proxy between.
 *
 * ── A key in the query string is REFUSED ──────────────────────────────────
 *
 * Not read-anyway-with-a-warning. Mail providers rewrite links for tracking,
 * and a rewrite that moved the fragment into the query string would downgrade
 * the design while every screen kept working. So the refusal is loud, it is
 * final, and it asks for the link again — see `app/lib/clinician-link.ts`.
 *
 * ── The link is transport. The ceremony is the trust ──────────────────────
 *
 * Nothing in the link is secret: a public key is public. What the link cannot
 * establish is that the key is HERS, so this screen shows the name as CLAIMED,
 * and the patient still types the twelve characters the clinician reads aloud.
 * `runShareCeremony` refuses before any effect when they do not match, and a
 * pinned peer offering different bytes lands in a fresh ceremony rather than
 * an auto-accept.
 *
 * ── The fragment is left in the address bar ───────────────────────────────
 *
 * Unlike the gateway invite next door, which strips its one-shot token on
 * sight. There is no credential here to strip, and keeping the fragment means
 * a reload or a back-button still works. The ONE case that is stripped is the
 * refusal above: those parameters have already been sent to a server once, and
 * a reload would send them again.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Loader2, ShieldQuestion } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ShareVerifyStep, type ShareInviteDraft } from '#app/components/share-verify-step';
import { useSyncSession } from '#app/components/sync-status';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import {
  acceptsKeyChangeIn,
  ceremonyPhaseFor,
  parseClinicianLink,
  type ClinicianCeremonyPhase,
  type ClinicianInvite,
  type ClinicianLinkParse,
} from '#app/lib/clinician-link';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { grantShare } from '#app/lib/sync/share-actions';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.connectClinician') },
];

export const handle = {
  titleKey: 'connectClinician.title',
  title: 'Connect a clinician',
};

/** What the link said, or that it has not been read yet. */
type LinkState = ClinicianLinkParse | { status: 'loading' };

export default function ConnectClinician() {
  const { t } = useTranslation();
  const [link, setLink] = useState<LinkState>({ status: 'loading' });
  const hasReadRef = useRef(false);

  useEffect(() => {
    // StrictMode double-mount guard: the refusal path rewrites the address bar,
    // and a second read would see a clean URL and report a truncated link
    // instead of the leak that actually happened.
    if (hasReadRef.current) return;
    hasReadRef.current = true;

    const parsed = parseClinicianLink({ hash: window.location.hash, search: window.location.search });
    if (parsed.status === 'query-string') {
      // Already sent to a server once, in the request line. Take it out of the
      // address bar so a reload does not send it again — and so the back
      // button and browser sync stop carrying it around.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    }
    setLink(parsed);
  }, []);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t('connectClinician.title')}</CardTitle>
          <CardDescription>{t('connectClinician.description')}</CardDescription>
        </CardHeader>
        {link.status === 'loading' && <LoadingCard />}
        {link.status === 'query-string' && <QueryStringCard parameters={link.parameters} />}
        {link.status === 'invalid' && <InvalidLinkCard />}
        {link.status === 'ok' && <ConnectSection invite={link.invite} />}
      </Card>
    </div>
  );
}

function LoadingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('connectClinician.reading')}</p>
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
        <AlertTitle>{t('connectClinician.queryString.title')}</AlertTitle>
        <AlertDescription>{t('connectClinician.queryString.body')}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        {t('connectClinician.queryString.parameters', { parameters: parameters.join(', ') })}
      </p>
      <p className="text-sm">{t('connectClinician.queryString.askAgain')}</p>
      <BackToSharingLink />
    </CardContent>
  );
}

function InvalidLinkCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('connectClinician.invalidLink.title')}</p>
      <p className="text-sm text-muted-foreground">{t('connectClinician.invalidLink.body')}</p>
      <BackToSharingLink />
    </CardContent>
  );
}

function BackToSharingLink() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <Link
        to="/settings/sharing"
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('connectClinician.backToSharing')}
      </Link>
    </div>
  );
}

/**
 * The ceremony, once the link parsed.
 *
 * Two gates come first, both client-side: an instance with no sync server has
 * no share surface to grant on, and sharing needs the data key, which needs an
 * unlocked session. Neither is a server check — this route has no loader, and
 * `useSyncServerUrl` is the same hook every other sync surface funnels through.
 */
function ConnectSection({ invite }: { invite: ClinicianInvite }) {
  const { t } = useTranslation();
  const syncServerUrl = useSyncServerUrl();
  const session = useSyncSession();
  const [phase, setPhase] = useState<ClinicianCeremonyPhase>({ status: 'verify' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSubmit(draft: ShareInviteDraft): Promise<void> {
    setIsSubmitting(true);
    setFailure(null);
    try {
      setPhase(
        ceremonyPhaseFor(
          await grantShare({
            granteeAccountId: invite.accountId,
            // The bytes THIS DEVICE received, not anything the form re-typed.
            publicKeyBase64: invite.publicKeyBase64,
            label: draft.label.trim() === '' ? invite.claimedLabel : draft.label.trim(),
            typedFingerprint: draft.typedFingerprint,
            // True only from the phase the person reached by being shown that
            // the key changed. It never skips the typed check.
            acceptsKeyChange: acceptsKeyChangeIn(phase),
          }),
        ),
      );
    } catch (caught) {
      setFailure(describeErrorForUser(caught, t('sharing.grant.failed')));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (syncServerUrl === null) return <NoSyncCard />;
  if (session.account === null) return <SignedOutCard />;
  if (phase.status === 'granted') return <GrantedCard fingerprintDisplay={phase.fingerprintDisplay} />;
  if (phase.status === 'refused' && phase.reason === 'sharing-off') return <SharingOffCard />;

  return (
    <CardContent className="space-y-4 py-6">
      <ClaimedIdentityNotice invite={invite} />
      {phase.status === 'key-changed' && (
        <Alert variant="warning">
          <AlertTitle>{t('connectClinician.keyChanged.title')}</AlertTitle>
          <AlertDescription>
            {t('connectClinician.keyChanged.body', {
              pinned: phase.pinnedFingerprintDisplay,
              offered: phase.offeredFingerprintDisplay,
            })}
          </AlertDescription>
        </Alert>
      )}
      {/* Keyed on the phase so a changed key starts a genuinely new ceremony:
          the typed field is empty again, and the twelve characters have to be
          heard and typed a second time rather than left sitting in the box. */}
      <ShareVerifyStep
        key={phase.status}
        invite={invite}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        message={failure ?? refusalMessage(phase, t)}
      />
    </CardContent>
  );
}

/** The one sentence a refusal earns. `null` while nothing has been refused. */
function refusalMessage(
  phase: ClinicianCeremonyPhase,
  t: (key: string, params?: Record<string, string>) => string,
): string | null {
  if (phase.status !== 'refused') return null;
  if (phase.reason === 'fingerprint-mismatch') return t('sharing.grant.mismatch');
  if (phase.reason === 'unknown-grantee') return t('sharing.grant.unknownGrantee');
  return t('sharing.grant.conflict');
}

/**
 * The claimed name, marked as claimed.
 *
 * Anybody who can write the link can write this string, so it is introduced as
 * something the link SAYS. The account number is shown beside it because that
 * is the only part of the link the sync server will check.
 */
function ClaimedIdentityNotice({ invite }: { invite: ClinicianInvite }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">
        {invite.claimedLabel === null ?
          t('connectClinician.claimed.unnamed')
        : t('connectClinician.claimed.named', { name: invite.claimedLabel })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('connectClinician.claimed.account', { accountId: invite.accountId })}
      </p>
      <p className="text-xs text-muted-foreground">{t('connectClinician.claimed.unverified')}</p>
    </div>
  );
}

function GrantedCard({ fingerprintDisplay }: { fingerprintDisplay: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-sm font-medium">{t('connectClinician.granted.title')}</p>
      {/* Computed by the ceremony from the key bytes this device received —
          never taken from the link, which carries no fingerprint at all. */}
      <p className="font-mono text-lg tracking-widest">{fingerprintDisplay}</p>
      <p className="text-sm text-muted-foreground">{t('connectClinician.granted.body')}</p>
      <Button asChild className="h-11 w-full">
        <Link to="/settings/sharing">{t('connectClinician.granted.cta')}</Link>
      </Button>
    </CardContent>
  );
}

/**
 * The honest degradation: the ceremony passed and the key is pinned on this
 * device, but this sync server has sharing switched off, so no grant exists.
 *
 * The verification is NOT thrown away — `runShareCeremony` pins before it
 * asks the server anything — so if the operator enables sharing, the grant is
 * one tap away and nobody repeats the fingerprint check.
 */
function SharingOffCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-sm font-medium">{t('connectClinician.sharingOff.title')}</p>
      <p className="text-sm text-muted-foreground">{t('connectClinician.sharingOff.body')}</p>
      <BackToSharingLink />
    </CardContent>
  );
}

/** An instance with no sync server has no share surface at all — there is nothing here to switch on. */
function NoSyncCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('connectClinician.noSync.title')}</p>
      <p className="text-sm text-muted-foreground">{t('connectClinician.noSync.body')}</p>
    </CardContent>
  );
}

/** Sharing seals the data key to the clinician, and the data key needs an unlocked session. */
function SignedOutCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6">
      <p className="text-sm text-muted-foreground">{t('connectClinician.signedOut.body')}</p>
      <Button asChild variant="outline" className="h-11 w-full">
        <Link to="/settings/account">{t('sharing.needsSessionCta')}</Link>
      </Button>
    </CardContent>
  );
}
