/**
 * `/settings/sync` — the whole sync account surface: create, sign in, unlock,
 * change passphrase, sign out, delete.
 *
 * ── This route does not exist when sync is off ────────────────────────────
 *
 * The server loader 404s when `SYNC_SERVER_URL` is unset. Rendering an
 * explanatory "sync isn't enabled here" page would still be sync UI on an
 * instance whose operator chose not to have any, and the requirement is
 * literal: unset ⇒ nothing renders and nothing is requested. A 404 is the
 * honest answer — on that instance, this address really is not a page.
 *
 * ── Everything else is client-side ───────────────────────────────────────
 *
 * The loader returns one string and nothing else. Key derivation, encryption,
 * and every request to the sync service happen in the browser and never touch
 * this server, which is the property the whole design rests on (AGENTS.md,
 * "Sync Architecture").
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLoaderData } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Loader2, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { consumePendingInvite, takeInviteFromUrl } from '#app/lib/sync/invite-link';
import { readPendingGatewayJoin } from '#app/lib/join-link';
import { Link } from '#app/components/link';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import type { SignupMode } from '#app/lib/sync/engine/protocol';
import { ServerNoticeBanner } from '#app/components/sync-notice-banner';
import { SyncSetupFlow } from '#app/components/sync-setup-flow';
import { SyncRecoveryFlow } from '#app/components/sync-recovery-flow';
import { SyncStatus, useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
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
import { validateSyncPassphrase, type SyncSetupOutcome } from '#app/lib/sync/setup-flow';
import {
  changeSyncPassphrase,
  createSyncAccount,
  readSignupMode,
  deleteSyncAccount,
  signInToSync,
  signOutOfSync,
  syncNow,
} from '#app/lib/sync/sync-actions';
import { classifySignInFailure } from '#app/lib/sync/sign-in-error';
import { readAccountHint } from '#app/lib/sync/sync-session';
import { resolveSyncScreen } from '#app/lib/sync/setup-screen';
import { describeErrorForUser } from '#app/lib/sync/error-text';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.sync') }];

export const handle = {
  titleKey: 'sync.title',
  title: 'Sync',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no sync server configured. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

export default function SettingsSync() {
  const { syncServerUrl } = useLoaderData<typeof loader>();
  const session = useSyncSession();
  // `createSyncAccount` opens the session as PART of provisioning, so
  // `session.account` goes non-null while the setup wizard is still on its way
  // to showing the recovery code. Deciding this screen on the session alone
  // unmounted the wizard mid-ceremony and the code — shown exactly once, the
  // only data-preserving recovery path — was never displayed. The rule now
  // lives in `resolveSyncScreen`, where it has a name and a test.
  const [isCeremonyActive, setIsCeremonyActive] = useState(false);
  const screen = resolveSyncScreen({ hasAccount: session.account !== null, isCeremonyActive });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* The operator's notice, above everything: it is the one message on
          this page that did not come from us, and it may be the only warning
          a user gets that their instance is moving or closing. Pull-only —
          see `ServerNoticeBanner`. */}
      <ServerNoticeBanner serverUrl={syncServerUrl} />
      <PendingGatewayBanner />
      {screen === 'connected' && session.account !== null ?
        <ConnectedPanel accountHandle={session.account.handle} />
      : <SignedOutPanel serverUrl={syncServerUrl} onCeremonyActiveChange={setIsCeremonyActive} />}
    </div>
  );
}

/**
 * "Your link also joins a gateway."
 *
 * A join link may carry two capabilities, and the sync half is spent HERE while
 * the gateway half waits in the pending slot (`app/lib/join-link.ts`). Without
 * this line the second half is invisible: the person finishes the account
 * ceremony, closes the page, and the gateway invite quietly expires in
 * `sessionStorage`.
 *
 * Read in an effect, because the slot is web storage and there is none during
 * SSR. It renders nothing at all when there is nothing pending, which is the
 * ordinary case.
 */
function PendingGatewayBanner() {
  const { t } = useTranslation();
  const [gatewayOrigin, setGatewayOrigin] = useState<string | null>(null);
  useEffect(() => {
    const pending = readPendingGatewayJoin();
    if (pending === null) return;
    setGatewayOrigin(new URL(pending.gatewayUrl).origin);
  }, []);

  if (gatewayOrigin === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t('sync.pendingGateway.body', { origin: gatewayOrigin })}{' '}
      <Link to="/join" className="underline underline-offset-4 hover:text-foreground">
        {t('sync.pendingGateway.action')}
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Signed out: create an account, or sign in on this device
// ---------------------------------------------------------------------------

type SignedOutMode = 'choose' | 'create' | 'sign-in' | 'forgot';

function SignedOutPanel({
  serverUrl,
  onCeremonyActiveChange,
}: {
  serverUrl: string;
  onCeremonyActiveChange: (isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SignedOutMode>('choose');
  // A returning visitor's handle, kept on the device so the screen says
  // "unlock" rather than presenting a sign-up form that reads like their data
  // is gone. Read in an effect: `localStorage` does not exist during SSR.
  const [knownHandle, setKnownHandle] = useState<string | null>(null);
  useEffect(() => setKnownHandle(readAccountHint()), []);
  // The invite is read HERE, not inside the create form, and reading it opens
  // that form. This panel starts on `choose`, which does not mount
  // `CreateAccountPanel` at all — so a token read down there was never read on
  // arrival, and someone following an invite link landed on a "sign in or
  // create an account" screen with their one single-use capability still
  // sitting in the address bar. Read once, on mount: `takeInviteFromUrl`
  // CLEARS the fragment as it reads it, so it cannot be derived during render.
  // It is safe to run again on a remount or after the service worker's
  // first-install reload — the token is parked in a pending slot and the second
  // read returns it, which is the whole reason that slot exists.
  const [invite, setInvite] = useState('');
  useEffect(() => {
    const fromLink = takeInviteFromUrl();
    if (fromLink === null) return;
    setInvite(fromLink);
    setMode('create');
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sync.title')}
        </CardTitle>
        <CardDescription>{t('sync.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'choose' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('sync.promise')}</p>
            <div className="flex flex-col gap-2">
              <Button type="button" className="h-11 w-full" onClick={() => setMode('sign-in')}>
                {knownHandle === null ? t('sync.signIn.cta') : t('sync.signIn.ctaKnown', { handle: knownHandle })}
              </Button>
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setMode('create')}>
                {t('sync.create.cta')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('sync.photosStayHere')}</p>
          </div>
        )}
        {mode === 'create' && (
          <CreateAccountPanel
            serverUrl={serverUrl}
            initialInvite={invite}
            onCancel={() => setMode('choose')}
            onCeremonyActiveChange={onCeremonyActiveChange}
          />
        )}
        {mode === 'sign-in' && (
          <SignInPanel
            serverUrl={serverUrl}
            initialHandle={knownHandle ?? ''}
            onCancel={() => setMode('choose')}
            onForgot={() => setMode('forgot')}
            onCeremonyActiveChange={onCeremonyActiveChange}
          />
        )}
        {mode === 'forgot' && (
          <SyncRecoveryFlow
            serverUrl={serverUrl}
            initialHandle={knownHandle ?? ''}
            onCancel={() => setMode('sign-in')}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Account creation: the invite, if this instance wants one, wrapped around the
 * ceremony that mints the handle and shows the account card.
 *
 * ── Why the handle is NOT collected here ─────────────────────────────────
 *
 * It used to be an email field on this panel, with the passphrase warnings on
 * the next screen. The handle is not that: it is generated, not typed, and it
 * is one half of the account card the ceremony ends on. Keeping it beside the
 * passphrase — in `SyncSetupFlow` — is what lets the card show the two values
 * the ceremony actually produced, rather than one collected here and one
 * produced there.
 *
 * The invite stays, because it is a capability from outside the ceremony and
 * the field is also the paste target for a code that arrived as text rather
 * than as a link. It is hidden once provisioning starts: an invite box beside
 * an account card is asking a question that has already been answered.
 */
function CreateAccountPanel({
  serverUrl,
  initialInvite,
  onCancel,
  onCeremonyActiveChange,
}: {
  serverUrl: string;
  /** The token from an `#invite=…` link, already taken out of the URL by `SignedOutPanel`, or `''`. */
  initialInvite: string;
  onCancel: () => void;
  onCeremonyActiveChange: (isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  // Seeded from the link, still editable: the field is also the paste target
  // for a code that arrived as text rather than as a link.
  const [invite, setInvite] = useState(initialInvite);
  const [isCeremonyActive, setIsCeremonyActive] = useState(false);

  // `null` while unknown — an older service, or one that could not be reached.
  // The form stays usable either way; this only decides whether the invite
  // field is offered and which refusal message a 403 gets.
  const [signupMode, setSignupMode] = useState<SignupMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ask = async (): Promise<void> => {
      const mode = await readSignupMode(serverUrl);
      if (!cancelled) setSignupMode(mode);
    };
    // `readSignupMode` fails open and never rejects, so there is nothing here
    // for a catch to do — the unknown mode IS the failure result.
    void ask();
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  // Offered when the instance says it wants one, and also whenever a link
  // supplied one — so a person following an invite to a service that could not
  // be reached still sees their code rather than losing it silently.
  const wantsInvite = signupMode === 'invite' || invite !== '';

  return (
    <div className="space-y-4">
      {wantsInvite && !isCeremonyActive && (
        <div className="space-y-2">
          <Label htmlFor="sync-invite">{t('sync.create.inviteLabel')}</Label>
          <Input
            id="sync-invite"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">{t('sync.create.inviteHint')}</p>
        </div>
      )}
      <SyncSetupFlow
        onCeremonyActiveChange={(isActive) => {
          setIsCeremonyActive(isActive);
          onCeremonyActiveChange(isActive);
        }}
        provision={async ({ handle: accountHandle, passphrase }) => {
          // The person has acted on the prefilled code, so the pending slot
          // has done its job and is emptied HERE rather than on mount: until
          // this moment a reload still has to be able to bring the token back,
          // and after it a later visit must not resurrect a spent one.
          consumePendingInvite();
          try {
            return await createSyncAccount({
              serverUrl,
              handle: accountHandle,
              passphrase,
              inviteToken: invite === '' ? undefined : invite,
            });
          } catch (error) {
            // Translated here rather than left to `describeErrorForUser`,
            // which would surface the SERVICE's own English sentence. §4 of
            // the protocol says a client branches on the status, not the
            // prose — displaying that prose is the same mistake in the other
            // direction.
            throw new Error(describeSignupError(error, signupMode, t), { cause: error });
          }
        }}
      />
      {!isCeremonyActive && (
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      )}
    </div>
  );
}

/**
 * Turns a failure to CREATE an account into copy the user can act on.
 *
 * The `403` needs `signupMode` to be readable at all: the service answers the
 * same status whether it is closed or merely wants an invite, and it
 * deliberately will not distinguish a missing invite from an expired or
 * already-spent one. When the mode is unknown the generic refusal is the
 * honest answer — better than sending somebody to look for an invitation that
 * was never required.
 */
function describeSignupError(cause: unknown, signupMode: SignupMode | null, t: (key: string) => string): string {
  const failure = classifySignupFailure(cause, signupMode);
  if (failure === 'invite-required') return t('sync.create.inviteRequired');
  if (failure === 'signups-closed') return t('sync.create.closed');
  if (failure === 'handle-taken') return t('sync.create.handleTaken');
  return describeErrorForUser(cause, t('sync.setup.setupFailed'));
}

/**
 * Turns a sign-in failure into copy the user can act on.
 *
 * ONE message for a wrong handle and a wrong passphrase, because the service
 * answers one status for both — telling them apart would make this form an
 * account-enumeration oracle. Everything else keeps its own words: a DEK that
 * will not unwrap is not a wrong passphrase, and saying so sends people to try
 * harder at something that cannot work.
 */
function describeSignInError(cause: unknown, t: (key: string) => string): string {
  if (classifySignInFailure(cause) === 'rejected') return t('sync.signIn.failed');
  return describeErrorForUser(cause, t('sync.signIn.failed'));
}

/**
 * Sign in — and, when the account turns out to have no key records, finish the
 * setup that never completed.
 *
 * ── Why the repair lives HERE and not behind "create an account" ──────────
 *
 * An account whose device died between the signup and the key-record writes
 * exists with no key hierarchy. Sending that user back to "create an account"
 * answers `409` (the account exists) and always will — the only door left open
 * is a sign-in, which is exactly where the missing key records become visible.
 * Without the repair, neither door works and the account is permanently
 * unusable.
 *
 * The repair reuses `SyncSetupFlow` rather than printing a code inline, so the
 * un-skippable "I've saved this recovery code" gate applies identically. And
 * because provisioning opens the session mid-ceremony, `onCeremonyActiveChange`
 * has to be threaded up to the route here for the same reason it is on the
 * create path — otherwise `resolveSyncScreen` swaps in the connected panel and
 * unmounts the code.
 */
function SignInPanel({
  serverUrl,
  initialHandle,
  onCancel,
  onForgot,
  onCeremonyActiveChange,
}: {
  serverUrl: string;
  initialHandle: string;
  onCancel: () => void;
  onForgot: () => void;
  onCeremonyActiveChange: (isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const [accountHandle, setAccountHandle] = useState(initialHandle);
  const [passphrase, setPassphrase] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repair, setRepair] = useState<{
    handle: string;
    passphrase: string;
    completeSetup: (input: { passphrase: string }) => Promise<SyncSetupOutcome>;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      const result = await signInToSync({ serverUrl, handle: accountHandle.trim(), passphrase });
      if (result.status === 'setup-incomplete') {
        setRepair({ handle: accountHandle.trim(), passphrase, completeSetup: result.completeSetup });
        return;
      }
      await syncNow();
    } catch (caught) {
      setError(describeSignInError(caught, t));
    } finally {
      setIsBusy(false);
    }
  }

  if (repair !== null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('sync.signIn.finishSetup')}</p>
        <SyncSetupFlow
          resume={{ handle: repair.handle, passphrase: repair.passphrase }}
          onCeremonyActiveChange={onCeremonyActiveChange}
          provision={async (input) => {
            const outcome = await repair.completeSetup({ passphrase: input.passphrase });
            // Fired, never awaited — same reason as the create path: a network
            // round trip between "the key records exist" and "the code is on
            // screen" turns a transient failure into a lost recovery code.
            void syncNow().catch(() => undefined);
            return outcome;
          }}
        />
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <p className="text-sm text-muted-foreground">{t('sync.signIn.intro')}</p>
      <div className="space-y-2">
        <Label htmlFor="sync-signin-handle">{t('sync.handleLabel')}</Label>
        <Input
          id="sync-signin-handle"
          type="text"
          required
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          value={accountHandle}
          onChange={(event) => setAccountHandle(event.target.value)}
          className="h-11 font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sync-signin-passphrase">{t('sync.passphraseLabel')}</Label>
        <Input
          id="sync-signin-passphrase"
          type="password"
          required
          autoComplete="current-password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="h-11"
        />
      </div>
      {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full" disabled={isBusy}>
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isBusy ? t('sync.signIn.working') : t('sync.signIn.submit')}
        </Button>
        <button
          type="button"
          onClick={onForgot}
          className="min-h-11 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('sync.signIn.forgot')}
        </button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Connected
// ---------------------------------------------------------------------------

function ConnectedPanel({ accountHandle }: { accountHandle: string }) {
  const { t } = useTranslation();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sync.connected.title')}
          </CardTitle>
          <CardDescription>{t('sync.connected.description', { handle: accountHandle })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SyncStatus onSyncNow={() => void syncNow().catch(() => undefined)} />
          {/* Said plainly, because "where are my photos on my other device?"
              is otherwise the first support question this feature generates. */}
          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {t('sync.connected.photosStayHere')}
          </p>
          {/* Said on the one screen a signed-in person actually revisits: the
              account card was shown once, and this is the only later reminder
              that both halves of it are load-bearing. */}
          <p className="text-xs text-muted-foreground">{t('sync.connected.keepYourCard')}</p>
        </CardContent>
      </Card>

      <ChangePassphraseCard />
      <DangerZoneCard accountHandle={accountHandle} />
    </>
  );
}

/**
 * WHAT USED TO BE HERE: a "show a new recovery code" card.
 *
 * It rotated the `recovery` key record onto a freshly minted code. M181 made
 * the recovery code the account's SECOND AUTHENTICATOR, and the service
 * registers that verifier at signup or never — so a regenerated code would
 * still unwrap the DEK and would no longer prove anything to
 * `POST /v1/auth/recover`. A button that hands somebody a code which
 * authenticates nowhere is worse than no button, so the setup copy says
 * plainly that the code is issued once, with the handle, on the account card.
 */

function ChangePassphraseCard() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const lengthError = validateSyncPassphrase(next, t);
    if (lengthError !== null) {
      setMessage({ kind: 'error', text: lengthError });
      return;
    }
    setIsBusy(true);
    setMessage(null);
    try {
      await changeSyncPassphrase({ currentPassphrase: current, newPassphrase: next });
      setCurrent('');
      setNext('');
      setIsOpen(false);
      setMessage({ kind: 'ok', text: t('sync.changePassphrase.done') });
    } catch (error) {
      setMessage({ kind: 'error', text: describeErrorForUser(error, t('sync.changePassphrase.failed')) });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sync.changePassphrase.title')}</CardTitle>
        <CardDescription>{t('sync.changePassphrase.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message !== null && (
          <p className={message.kind === 'ok' ? 'text-sm text-primary' : 'text-sm text-red-600 dark:text-red-400'}>
            {message.text}
          </p>
        )}
        {!isOpen ?
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setIsOpen(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('sync.changePassphrase.open')}
          </Button>
        : <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="sync-current-passphrase">{t('sync.changePassphrase.currentLabel')}</Label>
              <Input
                id="sync-current-passphrase"
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sync-next-passphrase">{t('sync.changePassphrase.newLabel')}</Label>
              <Input
                id="sync-next-passphrase"
                type="password"
                required
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                className="h-11"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('sync.changePassphrase.recoveryNote')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="h-11" disabled={isBusy}>
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('sync.changePassphrase.submit')}
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setIsOpen(false)}>
                {t('sync.cancel')}
              </Button>
            </div>
          </form>
        }
      </CardContent>
    </Card>
  );
}

/**
 * Sign out and delete, together, because they are the two things a worried
 * person comes to this page looking for.
 *
 * Deletion re-asks for the passphrase — required by the protocol, and right:
 * a session left open on a shared device must not be enough to destroy an
 * account. The dialog is the established `ConfirmAction` shape (AlertDialog,
 * destructive confirm), built inline rather than reused because that component
 * submits to a route action and this page has none: sync talks to another
 * origin entirely, never through this server.
 */
function DangerZoneCard({ accountHandle }: { accountHandle: string }) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await deleteSyncAccount({ passphrase });
    } catch (caught) {
      setError(describeErrorForUser(caught, t('sync.delete.failed')));
    } finally {
      setIsBusy(false);
      setPassphrase('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sync.danger.title')}</CardTitle>
        <CardDescription>{t('sync.danger.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={() => void signOutOfSync().catch(() => undefined)}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> {t('sync.signOut.cta')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('sync.signOut.note')}</p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" className="h-11 w-full sm:w-auto">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('sync.delete.cta')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('sync.delete.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('sync.delete.confirmBody', { handle: accountHandle })}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="sync-delete-passphrase">{t('sync.delete.passphraseLabel')}</Label>
              <Input
                id="sync-delete-passphrase"
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                className="h-11"
              />
              {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>{t('sync.cancel')}</AlertDialogCancel>
              <Button variant="destructive" disabled={isBusy || passphrase === ''} onClick={() => void handleDelete()}>
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('sync.delete.confirmCta')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="text-xs text-muted-foreground">{t('sync.delete.note')}</p>
      </CardContent>
    </Card>
  );
}
