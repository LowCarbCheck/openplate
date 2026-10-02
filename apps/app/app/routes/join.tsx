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
 *
 * ── A device that holds another account's diary (ADR-0023) ──────────────
 *
 * On a managed instance a sign-out without an erase leaves the last account's
 * diary on the device behind a lock that names that account, and "Sign out and
 * continue" below is exactly such a sign-out. An invitation always creates a
 * NEW account, so on a locked device the form is replaced by the
 * account-switch step unless the lock's address is the invitation's own (the
 * service then answers `409`, and the already-registered card sends the
 * person to sign in). The step's erase reloads this page, and the invitation
 * comes back from the tab's pending slot.
 */
import { useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { AccountSwitchCard } from '#app/components/account-switch-card';
import { AccountsNeedHttps } from '#app/components/accounts-need-https';
import { Link } from '#app/components/link';
import { CreateAccountPanel } from '#app/components/create-account-panel';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { isForeignSyncServer, isJoinLinkEmpty, takeJoinLinkFromUrl } from '#app/lib/join-link';
import { judgeDeviceSession } from '#app/lib/join-device-session';
import { readHeldDiaryNotice } from '#app/lib/sync/account-switch';
import type { EraseNoticeLine } from '#app/lib/sync/erase-notice';
import { clearSessionCache, readDeviceSessionIdentity, readSessionCache } from '#app/lib/sync/session-cache';
import { isDeviceHeldFromEmail, readDeviceLock, type DeviceLockOwner } from '#app/lib/sync/sync-state';
import { defaultSignOutSteps, runSignOut } from '#app/lib/sync/sign-out-flow';
import { useCanRunAccounts } from '#app/hooks/use-can-run-accounts';
import { useInstancePolicy, useSyncServerUrl } from '#app/hooks/use-public-config';
import { readSyncInvite, signOutOfDeviceSession, type SyncInviteDetails } from '#app/lib/sync/sync-actions';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { trackJoinCompleted } from '#app/lib/matomo-events';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { resolveJoinDestination } from '#app/lib/sign-in-flow';
import { useAppNavigate } from '#app/hooks/use-app-navigate';
import { readCachedServerInstance, readFreshServerInstance } from '#app/hooks/use-server-instance';
import type { InstanceHealthConsent } from '#app/lib/sync/engine/protocol';
import { withTimeout } from '#app/lib/with-timeout';
import { captureIntendedPlan, readIntendedPlan } from '#app/lib/plans/intended-plan';
import { hasPlansDoor } from '#app/lib/plans/plans-door';
import { addressWithoutLanguage, applyLanguageLink, decideLanguageLink, languageParamOf } from '#app/i18n/language-link';
import { browserLanguageLinkEffects } from '#app/hooks/use-language-from-link';

export { RouteErrorBoundary as ErrorBoundary };

// This route is top-level, so nothing above it supplies a `<title>` — without
// this export the document head carried an empty one. Title via the pure
// `meta-title` seam, like every other route (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.join') }];

export const handle = {
  title: 'Join',
  titleKey: 'join.title',
};

/** The longest the form waits for the handshake that says whether to draw the consent box. */
const HANDSHAKE_WAIT_MS = 5_000;

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
  /**
   * The link named a different service than this app is configured for.
   * Nothing was dialled. Both origins are kept, because the card names both:
   * the one without the other tells nobody which side is wrong.
   */
  | { status: 'foreign-server'; linkOrigin: string; appServerOrigin: string }
  /** No invite in the link at all. */
  | { status: 'invalid-link' }
  | { status: 'invite-invalid' }
  | { status: 'unreachable' }
  /**
   * This device is signed in as somebody ELSE on this app's server.
   *
   * A separate phase rather than a silent sign-out: two people share a laptop,
   * and redeeming the second one's invitation over the first one's open
   * session would move a diary out from under somebody who is still using it.
   * The rules for which saved session counts are in `join-device-session.ts`.
   */
  | { status: 'signed-in-elsewhere'; signedInAs: string; invitedEmail: string }
  /** The service answered `409`: the invited address already has an account. */
  | { status: 'already-registered'; email: string }
  /**
   * This device holds ANOTHER account's diary (ADR-0023), so the form is not
   * offered until it is erased. `lines` are what the erase would lose, read
   * before this phase is set, so the step is drawn once, settled.
   */
  | { status: 'account-switch'; owner: DeviceLockOwner | null; lines: EraseNoticeLine[]; invitedEmail: string }
  /**
   * The form. `healthConsent` is the consent the instance asks of a new
   * account, read off a FRESH handshake beside the invite lookup, or `null`
   * when it asks for none or the handshake could not be read. Read before the
   * form is drawn, so the box is there from the form's first paint.
   */
  | { status: 'ready'; inviteToken: string; invite: SyncInviteDetails; healthConsent: InstanceHealthConsent | null };

export default function Join() {
  const { t, i18n } = useTranslation();
  const shownLanguage = i18n.resolvedLanguage ?? i18n.language;
  const navigate = useAppNavigate();
  const configuredSyncUrl = useSyncServerUrl();
  const { signOutClosesTheDiary } = useInstancePolicy();
  const [phase, setPhase] = useState<Phase>({ status: 'reading' });
  // Creating an account is a key ceremony in `crypto.subtle`, which a
  // plain-http page off this computer does not have. The link is still read
  // and taken out of the address bar below; only the cards are withheld, and
  // `shown` is the one value the markup reads.
  const canRunAccounts = useCanRunAccounts();
  const shown: Phase | { status: 'needs-https' } = canRunAccounts ? phase : { status: 'needs-https' };
  const linkArrivals = useLinkArrivals();

  useEffect(() => {
    let isMounted = true;
    // A SECOND LINK IN THE SAME TAB starts from the top, so the first link's
    // card never stands beside the second link's answer.
    setPhase({ status: 'reading' });
    // A SNAPSHOT, taken before the strip below rewrites the live `location`.
    const { pathname, search, hash } = globalThis.window.location;
    // THE PLAN CHOSEN ON THE PRICING PAGE rides in the same fragment when the
    // core mailed the link (`&plan=yearly`), or in the query string. It is
    // stored BEFORE the strip below destroys the only copy, and it is not a
    // capability, so it goes to `localStorage` rather than the pending slot
    // (`intended-plan.ts`). A second run of this effect finds no parameter and
    // reads it back from storage.
    captureIntendedPlan({ search, hash });
    // THE LANGUAGE the person signed up in rides in the same fragment
    // (`&lang=fr`), so it too is read before the strip.
    const linkLanguage = languageParamOf({ search, hash });
    // The fragment is read and stripped in the same call, and the token is
    // parked — so this effect running twice (a remount, or the service
    // worker's first-install reload) reads the parked copy rather than
    // nothing.
    const link = takeJoinLinkFromUrl({ configuredSyncUrl });
    // A DIFFERENT LANGUAGE RELOADS THE DOCUMENT, the way the language switch
    // does, and it reloads BEFORE a single request: the invite is parked, so
    // the reloaded page reads it back, and the address it reloads carries no
    // fragment, so the token does not come back to the bar.
    const isReloading = applyLanguageLink(
      decideLanguageLink({
        code: linkLanguage,
        shownLanguage,
        address: addressWithoutLanguage({ pathname, search, hash: '' }),
      }),
      browserLanguageLinkEffects(),
    );
    if (isReloading) return;

    if (isForeignSyncServer({ linkServerUrl: link.serverUrl, configuredSyncUrl })) {
      setPhase({
        status: 'foreign-server',
        linkOrigin: originOf(link.serverUrl),
        appServerOrigin: originOf(configuredSyncUrl),
      });
      return;
    }
    if (isJoinLinkEmpty(link) || link.invite === null || configuredSyncUrl === null) {
      setPhase({ status: 'invalid-link' });
      return;
    }

    const inviteToken = link.invite;
    const look = async (): Promise<void> => {
      // THE HANDSHAKE, BESIDE THE LOOKUP, not after it: whether this instance
      // asks for a consent to health data decides whether the form draws a
      // box (`PROTOCOL.md` §5.6). FRESH, because it decides a door. It never
      // rejects, and it is waited for no longer than `HANDSHAKE_WAIT_MS`: an
      // unreadable or silent one is `null`, the form is drawn without a box,
      // and the core's refusal brings the box back if it was needed after all.
      const instanceRead = withTimeout(readFreshServerInstance(configuredSyncUrl), HANDSHAKE_WAIT_MS);
      try {
        const invite = await readSyncInvite({ serverUrl: configuredSyncUrl, inviteToken });
        if (!isMounted) return;
        if ('status' in invite) {
          setPhase({ status: 'invite-invalid' });
          return;
        }
        // SIGNED IN AS SOMEBODY ELSE. Checked after the lookup so the card can
        // name both addresses: "you are signed in as X, this invitation is for
        // Y" is actionable, and "you are signed in" is not. The session is read
        // from the DEVICE, open or cached, and not from the snapshot: this
        // route sits outside `_personal`, so on a document load, which is how
        // a link from a mail app arrives, nothing has resumed it yet and the
        // snapshot says "signed out" about a device that is not.
        const verdict = judgeDeviceSession({
          session: await readDeviceSessionIdentity(),
          configuredSyncUrl,
          invitedEmail: invite.email,
        });
        if (!isMounted) return;
        if (verdict.kind === 'other-account') {
          setPhase({ status: 'signed-in-elsewhere', signedInAs: verdict.signedInAs, invitedEmail: invite.email });
          return;
        }
        // A session saved for ANOTHER server never blocks an invitation. It is
        // forgotten here, the way a reload would discard it, so nothing about
        // the old server outlives the new one's invitation.
        if (verdict.kind === 'stale') await clearSessionCache();
        // A DEVICE THAT HOLDS ANOTHER ACCOUNT'S DIARY: the step, not the form.
        // Asked after the signed-in check, because a device with a session is
        // not locked; "Sign out and continue" above is what locks it.
        const lock = readDeviceLock();
        if (isDeviceHeldFromEmail({ lock, email: invite.email, isNewAccount: true })) {
          const owner = lock.kind === 'locked' ? lock.owner : null;
          const lines = await readHeldDiaryNotice({ owner });
          if (!isMounted) return;
          setPhase({ status: 'account-switch', owner, lines, invitedEmail: invite.email });
          return;
        }
        const instance = await instanceRead;
        if (!isMounted) return;
        setPhase({ status: 'ready', inviteToken, invite, healthConsent: instance?.healthConsent ?? null });
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
  }, [configuredSyncUrl, linkArrivals, shownLanguage]);

  return (
    // TOP-ALIGNED, NOT CENTRED (M253/11). The card starts on the small
    // "reading" body and becomes the form when the lookup answers; a centred
    // card grew both ways and its top jumped up by half the growth, a layout
    // shift of 0.107 on a phone. Anchored at the top, only its bottom edge moves.
    <main className="mx-auto flex min-h-dvh max-w-md items-start px-4 py-10 sm:py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('join.title')}</CardTitle>
          <CardDescription>{t('join.description')}</CardDescription>
          {/* WHAT THE ESCROW MEANS, before the password is chosen (2026-09-28). Every
              openplate-core server keeps a sealed copy of the recovery code so a
              forgotten password restores the diary, and whoever runs it can read the
              diary with it. Said here, where the person decides, and from the first
              paint, so it moves nothing. */}
          <p className="text-sm">{t('join.operatorKey')}</p>
        </CardHeader>
        {shown.status === 'needs-https' && (
          <CardContent>
            <AccountsNeedHttps />
          </CardContent>
        )}
        {shown.status === 'reading' && <LoadingCard />}
        {shown.status === 'foreign-server' && (
          <ForeignServerCard linkOrigin={shown.linkOrigin} appServerOrigin={shown.appServerOrigin} />
        )}
        {shown.status === 'invalid-link' && <InvalidLinkCard />}
        {shown.status === 'invite-invalid' && <InviteInvalidCard onContinue={() => void navigate('/diary')} />}
        {shown.status === 'unreachable' && <UnreachableCard />}
        {shown.status === 'signed-in-elsewhere' && configuredSyncUrl !== null && (
          <SignedInElsewhereCard
            signedInAs={shown.signedInAs}
            invitedEmail={shown.invitedEmail}
            onSignOut={() => signOutAndContinue({ serverUrl: configuredSyncUrl, locksDevice: signOutClosesTheDiary })}
          />
        )}
        {shown.status === 'already-registered' && (
          <AlreadyRegisteredCard email={shown.email} onSignIn={() => void navigate('/sign-in')} />
        )}
        {shown.status === 'account-switch' && (
          <CardContent>
            <AccountSwitchCard
              owner={shown.owner}
              lines={shown.lines}
              incomingEmail={shown.invitedEmail}
              destination="/join"
              onCancel={() => void navigate('/welcome')}
            />
          </CardContent>
        )}
        {shown.status === 'ready' && configuredSyncUrl !== null && (
          <CardContent className="space-y-4">
            {/* The address is SHOWN, never asked for: an admin wrote it on the
                invitation, and a field would let somebody create an account at
                one nobody invited. */}
            <p className="text-sm">{t('join.invitedAs', { email: shown.invite.email })}</p>
            <CreateAccountPanel
              serverUrl={configuredSyncUrl}
              initialInvite={shown.inviteToken}
              healthConsent={shown.healthConsent}
              onAlreadyRegistered={() => setPhase({ status: 'already-registered', email: shown.invite.email })}
              onDeviceHeld={(owner) => {
                // The guard's own refusal, for a lock another tab wrote after
                // this form was drawn: the same step, before the invite is spent.
                const invitedEmail = shown.invite.email;
                void readHeldDiaryNotice({ owner }).then((lines) =>
                  setPhase({ status: 'account-switch', owner, lines, invitedEmail }),
                );
              }}
              onCeremonyComplete={() => void landAfterJoin({ navigate, serverUrl: configuredSyncUrl })}
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
 * diary?") and must not answer it twice, so this reads the same gate
 * `/sign-in` does and resolves it through the same rule.
 *
 * ONE DOOR IN FRONT (2026-09-28): somebody who chose a plan on the pricing
 * page before they had an account lands on the order page with that plan
 * picked (`resolveJoinDestination`). The handshake is read only then, because
 * only then does it matter whether this instance sells plans.
 *
 * @param input.navigate - the router's navigate, passed in so this stays testable.
 * @param input.serverUrl - the core server the account was created on.
 */
async function landAfterJoin({
  navigate,
  serverUrl,
}: {
  navigate: (path: string) => void;
  serverUrl: string;
}): Promise<void> {
  // The ceremony reports completion once, so this runs once per redeemed
  // invitation rather than once per render of the panel.
  trackJoinCompleted();
  const intendedPlan = readIntendedPlan();
  const sellsPlans = intendedPlan !== null && hasPlansDoor(await readCachedServerInstance(serverUrl));
  navigate(resolveJoinDestination({ gate: await readOnboardingGateKind(), intendedPlan, sellsPlans }));
}

/**
 * Signs this device out and comes back to this page with the same invitation.
 *
 * The same sign-out the settings page runs (`runSignOut`): revoke, lock where
 * this instance requires it, and leave by a DOCUMENT LOAD, so no in-memory
 * diary or persister from the old session outlives it. Two steps differ. The
 * revoke works without an open session (`signOutOfDeviceSession`), because a
 * document load of `/join` has none. And the page it leaves for is this one:
 * the invitation is parked in the tab's pending slot (`takeJoinLinkFromUrl`),
 * so the fresh load reads it back with no second link. Nothing is erased; that
 * stays the settings dialog's opt-in.
 *
 * THE LOCK NAMES WHO SIGNED OUT (ADR-0023). A document load of this page has
 * no open session, so the account is read from the CACHED session before the
 * sign-out forgets it. The reloaded page then finds the lock and, for an
 * invitation to another account, offers the account-switch step.
 */
async function signOutAndContinue({ serverUrl, locksDevice }: { serverUrl: string; locksDevice: boolean }): Promise<void> {
  const cached = await readSessionCache();
  const owner = cached === null ? null : { accountId: cached.accountId, email: cached.email };
  await runSignOut(
    { eraseDevice: false, locksDevice },
    {
      ...defaultSignOutSteps({ owner }),
      revokeAndCloseSession: () => signOutOfDeviceSession({ serverUrl }),
      leaveTheApp: () => globalThis.window.location.assign('/join'),
    },
  );
}

/**
 * Counts the links that arrive while this page stays on screen.
 *
 * A link opened in a tab that is already on `/join` changes only the
 * fragment, and a fragment change is a same-document navigation: no reload,
 * no remount, and the mount effect above never runs again. The install
 * rehearsal of 2026-09-27 met exactly that, a first link for another server,
 * then the right one in the same tab, and the first link's "this link is for
 * another openplate" stayed until a reload. The count is what the effect
 * lists, so every new fragment is read the way the first one was.
 *
 * An EMPTY fragment is not a link. The read itself strips the fragment with
 * `history.replaceState`, which fires no `hashchange`, but a person pressing
 * Back past the page's own entry can produce one.
 */
function useLinkArrivals(): number {
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => {
    const onHashChange = (): void => {
      if (globalThis.window.location.hash === '') return;
      setArrivals((count) => count + 1);
    };
    globalThis.window.addEventListener('hashchange', onHashChange);
    return () => globalThis.window.removeEventListener('hashchange', onHashChange);
  }, []);
  return arrivals;
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
 * The likeliest cause is an ordinary mistake rather than an attack: an invite
 * for a different instance, an app opened at the wrong address, or an app
 * whose `CORE_URL` does not match the address its server writes into
 * invitations. The same link opened on the right instance works.
 *
 * BOTH ADDRESSES ARE NAMED. This card used to name only the link's server and
 * say "open it there", which is a core server and not a page anybody can
 * open, and it never said which server this app uses. With both on screen the
 * person can tell which side is wrong, and so can whoever runs the server.
 */
function ForeignServerCard({ linkOrigin, appServerOrigin }: { linkOrigin: string; appServerOrigin: string }) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.foreignServer.title')}</p>
      <p className="text-sm text-muted-foreground">
        {linkOrigin === '' && t('join.foreignServer.bodyUnknown')}
        {linkOrigin !== '' && appServerOrigin === '' && t('join.foreignServer.bodyNoServer', { linkOrigin })}
        {linkOrigin !== '' && appServerOrigin !== '' && t('join.foreignServer.body', { linkOrigin, appServerOrigin })}
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
 * warning. The press signs out and brings this page back by a document load
 * with the same invitation (`signOutAndContinue`), so the way on is one press.
 *
 * Until 2026-09-27 this button called a sign-out that needed an open session,
 * and a document load of this page never has one, so it did nothing.
 */
function SignedInElsewhereCard({
  signedInAs,
  invitedEmail,
  onSignOut,
}: {
  signedInAs: string;
  invitedEmail: string;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  return (
    <CardContent data-slot="join-signed-in-elsewhere" className="space-y-4 py-6 text-center">
      <p className="text-sm font-medium">{t('join.signedInElsewhere.title')}</p>
      <p className="text-sm text-muted-foreground">{t('join.signedInElsewhere.body', { signedInAs, invitedEmail })}</p>
      <Button
        type="button"
        className="h-11 w-full"
        disabled={isSigningOut}
        onClick={() => {
          setIsSigningOut(true);
          // The page is replaced by a document load when this settles, so
          // only a failure ever comes back here, and it gives the button back.
          void onSignOut().catch(() => setIsSigningOut(false));
        }}
      >
        {isSigningOut && <Loader2 className="animate-spin" aria-hidden="true" />}
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
