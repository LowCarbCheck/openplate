/**
 * `/join#server=…&invite=si_…` — one link, one screen, one service.
 *
 * A person is handed one address and it admits them to an account on this
 * instance. This route reads what the link carries, asks the service who the
 * invite was written to, and hands the rest to the account ceremony.
 *
 * ── WHAT M192 REMOVED FROM THIS FILE ─────────────────────────────────────
 *
 * The gateway half, and everything it needed: a second token with its own
 * prefix, a `GET /v1/gateway/info` probe, a redeem POST whose answer had to be
 * parked before two local writes, a CSP-blocked-versus-unreachable
 * distinction, an audit disclosure, and a "sync first, then the gateway"
 * ordering that existed only because one link admitted somebody to two
 * services.
 *
 * There is one service now. The invite is redeemed by the signup request
 * itself, in one transaction, so there is nothing on this screen to burn and
 * nothing to park between two writes.
 *
 * CLIENT-ONLY, and deliberately so — this route exports no `loader`, `action`,
 * `clientLoader` or `clientAction`. The openplate server must never see the
 * invite token: it rides in the FRAGMENT, which no browser sends anywhere, so
 * there is nothing here a loader could read even if one existed.
 *
 * ── Token hygiene ────────────────────────────────────────────────────────
 *
 * The mount effect strips the fragment with `history.replaceState` before a
 * single request is made, so nothing is left in the address bar for a
 * screenshot or a screen share. What was read is parked in the pending slot
 * (`app/lib/sync/invite-link.ts`), because clearing the fragment destroys the
 * only copy and the production first visit reloads the whole document when the
 * service worker takes control.
 *
 * ── The lookup is idempotent; the redemption is not ──────────────────────
 *
 * `POST /v1/auth/invite-lookup` reads and spends nothing, which is what makes
 * it safe to run on load: invite links get fetched by mail scanners, link
 * previewers and prefetchers, and a bare GET of this URL must burn nothing.
 * The signup that actually redeems waits for a person to choose a password.
 *
 * ── The address in the link is a CHECK ───────────────────────────────────
 *
 * This client posts its passphrase-derived verifier to the server ITS OPERATOR
 * configured. A link cannot redirect that; a link naming a different server is
 * reported and nothing is dialled. See `isForeignSyncServer`.
 */
import { useEffect, useRef, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { CreateAccountPanel } from '#app/components/create-account-panel';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { isForeignSyncServer, isJoinLinkEmpty, takeJoinLinkFromUrl } from '#app/lib/join-link';
import { useSyncSession } from '#app/components/sync-status';
import { signOutOfSync } from '#app/lib/sync/sync-actions';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { readSyncInvite, type SyncInviteDetails } from '#app/lib/sync/sync-actions';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { resolveSignInDestination } from '#app/lib/sign-in-flow';

export { RouteErrorBoundary as ErrorBoundary };

// This route is top-level, so nothing above it supplies a `<title>` — without
// this export the document head carried an empty one. Title via the pure
// `meta-title` seam, like every other route (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.join') }];

export const handle = {
  title: 'Join',
  titleKey: 'join.title',
};

/**
 * Every screen this route can be on.
 *
 * `invite-invalid` is a RETURN from the lookup rather than a thrown error, and
 * it covers unknown, spent, revoked and expired as one outcome — the service
 * refuses to tell them apart, and the person's next step is the same for all
 * four. `unreachable` is the genuinely different case: we do not know.
 */
type Phase =
  | { status: 'reading' }
  /** The link named a different service than this app is configured for. Nothing was dialled. */
  | { status: 'foreign-server'; linkOrigin: string }
  /** No invite in the link at all. */
  | { status: 'invalid-link' }
  | { status: 'invite-invalid' }
  | { status: 'unreachable' }
  /**
   * This device is signed in as somebody ELSE.
   *
   * A separate phase rather than a silent sign-out: two people share a laptop,
   * and redeeming the second one's invitation over the first one's open
   * session would move a diary out from under somebody who is still using it.
   */
  | { status: 'signed-in-elsewhere'; signedInAs: string; invitedEmail: string }
  /** The service answered `409`: the invited address already has an account. */
  | { status: 'already-registered'; email: string }
  | { status: 'ready'; inviteToken: string; invite: SyncInviteDetails };

export default function Join() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const configuredSyncUrl = useSyncServerUrl();
  const session = useSyncSession();
  const [phase, setPhase] = useState<Phase>({ status: 'reading' });
  // The session as it was when the lookup ran. Read into a ref rather than
  // listed as an effect dependency: `createSyncAccount` opens a session as
  // part of provisioning, and re-running this effect on that change would
  // re-read a fragment that has already been stripped.
  const signedInAs = useRef(session.account?.email ?? null);
  signedInAs.current = session.account?.email ?? null;

  useEffect(() => {
    let isMounted = true;
    // The fragment is read and stripped in the same call, and the token is
    // parked — so this effect running twice (a remount, or the service
    // worker's first-install reload) reads the parked copy rather than
    // nothing.
    const link = takeJoinLinkFromUrl({ configuredSyncUrl });

    if (isForeignSyncServer({ linkServerUrl: link.serverUrl, configuredSyncUrl })) {
      setPhase({ status: 'foreign-server', linkOrigin: originOf(link.serverUrl) });
      return;
    }
    if (isJoinLinkEmpty(link) || link.invite === null || configuredSyncUrl === null) {
      setPhase({ status: 'invalid-link' });
      return;
    }

    const inviteToken = link.invite;
    const look = async (): Promise<void> => {
      try {
        const invite = await readSyncInvite({ serverUrl: configuredSyncUrl, inviteToken });
        if (!isMounted) return;
        if ('status' in invite) {
          setPhase({ status: 'invite-invalid' });
          return;
        }
        // SIGNED IN AS SOMEBODY ELSE. Checked after the lookup so the card can
        // name both addresses: "you are signed in as X, this invitation is for
        // Y" is actionable, and "you are signed in" is not.
        const current = signedInAs.current;
        if (current !== null && current !== invite.email) {
          setPhase({ status: 'signed-in-elsewhere', signedInAs: current, invitedEmail: invite.email });
          return;
        }
        setPhase({ status: 'ready', inviteToken, invite });
      } catch {
        if (!isMounted) return;
        // "We could not reach the server" is NOT "your invitation is not
        // valid", and showing the second for the first is how somebody throws
        // away a live invitation over a flaky connection.
        setPhase({ status: 'unreachable' });
      }
    };
    void look();

    return () => {
      isMounted = false;
    };
  }, [configuredSyncUrl]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('join.title')}</CardTitle>
          <CardDescription>{t('join.description')}</CardDescription>
        </CardHeader>
        {phase.status === 'reading' && <LoadingCard />}
        {phase.status === 'foreign-server' && <ForeignServerCard linkOrigin={phase.linkOrigin} />}
        {phase.status === 'invalid-link' && <InvalidLinkCard />}
        {phase.status === 'invite-invalid' && <InviteInvalidCard onContinue={() => void navigate('/diary')} />}
        {phase.status === 'unreachable' && <UnreachableCard />}
        {phase.status === 'signed-in-elsewhere' && (
          <SignedInElsewhereCard signedInAs={phase.signedInAs} invitedEmail={phase.invitedEmail} />
        )}
        {phase.status === 'already-registered' && (
          <AlreadyRegisteredCard email={phase.email} onSignIn={() => void navigate('/sign-in')} />
        )}
        {phase.status === 'ready' && configuredSyncUrl !== null && (
          <CardContent className="space-y-4">
            {/* The address is SHOWN, never asked for: an admin wrote it on the
                invitation, and a field would let somebody create an account at
                one nobody invited. */}
            <p className="text-sm">{t('join.invitedAs', { email: phase.invite.email })}</p>
            <CreateAccountPanel
              serverUrl={configuredSyncUrl}
              initialInvite={phase.inviteToken}
              onAlreadyRegistered={() => setPhase({ status: 'already-registered', email: phase.invite.email })}
              onCeremonyComplete={() => void landAfterJoin(navigate)}
            />
          </CardContent>
        )}
      </Card>
    </main>
  );
}

/**
 * Where a finished invitation lands: exactly where a finished sign-in lands.
 *
 * IT USED TO BE `/`, and `/` is the marketing landing page. Walking 0.10.0 on
 * 2026-09-04, somebody who had just created an account was shown "No account"
 * and "Photo scans use your own AI key" — a page written for a stranger, about
 * an instance they were not on. The home hint would have carried them into the
 * app on the NEXT visit, which is no help on this one.
 *
 * The two flows ask the same question ("does this account already hold a
 * diary?") and must not answer it twice, so this calls the same pair
 * `/sign-in` does: read the gate, resolve the destination.
 *
 * @param navigate - the router's navigate, passed in so this stays testable.
 */
async function landAfterJoin(navigate: (path: string) => void): Promise<void> {
  navigate(resolveSignInDestination({ gate: await readOnboardingGateKind() }));
}

/** The origin of a link's address, or `''` when it is not parseable — the card words the two differently. */
function originOf(url: string | null): string {
  if (url === null) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function LoadingCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="flex flex-col items-center gap-3 py-8 text-center" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('join.working')}</p>
    </CardContent>
  );
}

/**
 * The link names a DIFFERENT service than this app is configured for.
 *
 * Nothing was dialled, and nothing will be: this client posts its credentials
 * to the server its own operator configured, and a link cannot redirect that.
 * The likeliest cause is an ordinary mistake rather than an attack — an invite
 * for a different instance, or an app opened at the wrong address — and the
 * same link opened on the right instance works. Naming the origin is what
 * makes that actionable.
 */
function ForeignServerCard({ linkOrigin }: { linkOrigin: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.foreignServer.title')}</p>
      <p className="text-sm text-muted-foreground">
        {linkOrigin === '' ? t('join.foreignServer.bodyUnknown') : t('join.foreignServer.body', { origin: linkOrigin })}
      </p>
      <BackToWelcomeLink />
    </CardContent>
  );
}

function BackToWelcomeLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/welcome"
      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {t('welcome.title')}
    </Link>
  );
}

function InvalidLinkCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.invalidLink.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.invalidLink.body')}</p>
      <BackToWelcomeLink />
    </CardContent>
  );
}

/**
 * The service refused the invite — a dead end, but not a dead end on this
 * screen.
 *
 * Continue is the primary action because whoever followed this link wanted into
 * the app. It goes to `/diary`, which is inside `_personal` and therefore
 * behind the onboarding gate: a device that is already in the app lands on its
 * diary, a blank one is routed on to `/welcome`, and neither can come back
 * here. Reusing the gate is what keeps that decision in one place.
 */
function InviteInvalidCard({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.inviteInvalid.title')}</p>
      {/* Generic by design — the service never tells us which of invalid /
          expired / revoked / already-used it was, and this page would not
          repeat it if it did. */}
      <p className="text-sm text-muted-foreground">{t('join.inviteInvalid.body')}</p>
      <Button type="button" className="h-11 w-full" onClick={onContinue}>
        {t('join.inviteInvalid.continue')}
      </Button>
      <BackToWelcomeLink />
    </CardContent>
  );
}

/**
 * The service did not answer.
 *
 * A SEPARATE SCREEN from the refused invite, because the invitation may be
 * perfectly good and the person must not be told it is dead over a flaky
 * connection. The link still works, later, from here.
 */
function UnreachableCard() {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.unreachable.title')}</p>
      {/* THE SERVICE'S OWN WORDS ARE NOT SHOWN. A transport failure's message
          is a browser string, and "Failed to fetch" tells nobody anything. The
          sentence below is the one true thing: the invitation is probably fine
          and the link is worth trying again. */}
      <p className="text-sm text-muted-foreground">{t('join.unreachable.retry')}</p>
      <BackToWelcomeLink />
    </CardContent>
  );
}

/**
 * This device is signed in as somebody else.
 *
 * SIGN OUT IS OFFERED, never performed. Two people share a laptop and the one
 * holding the invitation is not necessarily the one whose diary is open; doing
 * it for them would move somebody else's session out from under them with no
 * warning. Signing out leaves the invite parked, so this page picks it up
 * again on the very next render.
 */
function SignedInElsewhereCard({ signedInAs, invitedEmail }: { signedInAs: string; invitedEmail: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.signedInElsewhere.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.signedInElsewhere.body', { signedInAs, invitedEmail })}</p>
      <Button type="button" className="h-11 w-full" onClick={() => void signOutOfSync().catch(() => undefined)}>
        {t('join.signedInElsewhere.signOut')}
      </Button>
    </CardContent>
  );
}

/**
 * The invited address already has an account (`409`).
 *
 * An ordinary thing to arrive at: an admin re-sent an invitation to somebody
 * who had already used the first one. So the card offers the door that DOES
 * work, with the address prefilled on the other side.
 */
function AlreadyRegisteredCard({ email, onSignIn }: { email: string; onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.alreadyRegistered.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.alreadyRegistered.body', { email })}</p>
      <Button type="button" className="h-11 w-full" onClick={onSignIn}>
        {t('join.alreadyRegistered.signIn')}
      </Button>
    </CardContent>
  );
}
