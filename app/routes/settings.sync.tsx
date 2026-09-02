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
import { KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { CONFIG } from '#app/config';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { consumePendingInvite, takeInviteFromUrl } from '#app/lib/sync/invite-link';
import { classifySignupFailure } from '#app/lib/sync/signup-error';
import type { SignupMode } from '#app/lib/sync/engine/protocol';
import { RecoveryCodeStep, SyncSetupFlow } from '#app/components/sync-setup-flow';
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
  regenerateRecoveryCode,
  requestSyncReset,
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
      {screen === 'connected' && session.account !== null ?
        <ConnectedPanel email={session.account.email} />
      : <SignedOutPanel serverUrl={syncServerUrl} onCeremonyActiveChange={setIsCeremonyActive} />}
    </div>
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
  // A returning visitor's address, kept on the device so the screen says
  // "unlock" rather than presenting a sign-up form that reads like their data
  // is gone. Read in an effect: `localStorage` does not exist during SSR.
  const [knownEmail, setKnownEmail] = useState<string | null>(null);
  useEffect(() => setKnownEmail(readAccountHint()), []);
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
                {knownEmail === null ? t('sync.signIn.cta') : t('sync.signIn.ctaKnown', { email: knownEmail })}
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
            initialEmail={knownEmail ?? ''}
            onCancel={() => setMode('choose')}
            onForgot={() => setMode('forgot')}
            onCeremonyActiveChange={onCeremonyActiveChange}
          />
        )}
        {mode === 'forgot' && (
          <ForgotPassphrasePanel
            serverUrl={serverUrl}
            initialEmail={knownEmail ?? ''}
            onCancel={() => setMode('sign-in')}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Account creation, in two steps: the address, then the ceremony.
 *
 * Splitting them is deliberate. The passphrase step carries the warnings that
 * matter ("we cannot reset this for you", the recovery code), and burying them
 * under an email field on a combined form is how they get skimmed. It also
 * keeps `SyncSetupFlow` a pure ceremony component, reusable anywhere setup has
 * to happen.
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
  const [email, setEmail] = useState('');
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  // Seeded from the link, still editable: the field is also the paste target
  // for a code that arrived as text rather than as a link.
  const [invite, setInvite] = useState(initialInvite);

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

  if (confirmedEmail !== null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('sync.create.forEmail', { email: confirmedEmail })}</p>
        <SyncSetupFlow
          onCeremonyActiveChange={onCeremonyActiveChange}
          provision={async ({ passphrase }) => {
            let result: SyncSetupOutcome;
            try {
              result = await createSyncAccount({
                serverUrl,
                email: confirmedEmail,
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
            // No session and no key material exist on this branch, so there is
            // nothing to sync and nothing to show yet — the ceremony moves to
            // the sign-in that follows confirmation.
            if (result.status === 'awaiting-email-verification') return result;
            // The first push is fired but deliberately NOT awaited. Awaiting it
            // put a network round trip between "the account and its key records
            // exist" and "the user is shown the recovery code" — so a transient
            // failure there threw, the wizard fell into its error branch, and a
            // code that had already been written to the server was never
            // displayed. Retrying then failed with "an account already exists".
            // A failed first sync is recoverable and surfaces on the status
            // line; a recovery code nobody saw is not recoverable at all.
            void syncNow().catch(() => undefined);
            return result;
          }}
        />
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        // The person has acted on the prefilled code, so the pending slot has
        // done its job and is emptied here rather than on mount: until this
        // moment a reload still has to be able to bring the token back, and
        // after it a later visit to this page must not resurrect a spent one.
        consumePendingInvite();
        setConfirmedEmail(email.trim());
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="sync-email">{t('sync.emailLabel')}</Label>
        <Input
          id="sync-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">{t('sync.emailHint')}</p>
      </div>
      {wantsInvite && (
        <div className="space-y-2">
          <Label htmlFor="sync-invite">{t('sync.create.inviteLabel')}</Label>
          <Input
            id="sync-invite"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">{t('sync.create.inviteHint')}</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full">
          {t('sync.create.continue')}
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.cancel')}
        </Button>
      </div>
    </form>
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
  if (failure === 'email-taken') return t('sync.create.emailTaken');
  return describeErrorForUser(cause, t('sync.setup.setupFailed'));
}

/**
 * Turns a sign-in failure into copy the user can act on.
 *
 * The `403` case is the one that matters: the credentials were correct and the
 * address simply has not been confirmed yet. Falling through to "check the
 * address and passphrase" there sends someone to retype something that already
 * worked, when the thing they need is a link sitting in their inbox.
 */
function describeSignInError(cause: unknown, t: (key: string) => string): string {
  const failure = classifySignInFailure(cause);
  if (failure === 'email-unverified') return t('sync.signIn.unverified');
  if (failure === 'rejected') return t('sync.signIn.failed');
  return describeErrorForUser(cause, t('sync.signIn.failed'));
}

/**
 * Sign in — and, when the account turns out to have no key records, finish the
 * setup that never completed.
 *
 * ── Why the repair lives HERE and not behind "create an account" ──────────
 *
 * A verification-required instance creates the account at signup and withholds
 * the session, so the key hierarchy cannot be written until the address is
 * confirmed. Sending the user back to "create an account" afterwards answers
 * `409` (the account exists) and always will — the only door left open is a
 * sign-in, which is exactly where the missing key records become visible. That
 * made this the deadlock: neither door worked, and the account was permanently
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
  initialEmail,
  onCancel,
  onForgot,
  onCeremonyActiveChange,
}: {
  serverUrl: string;
  initialEmail: string;
  onCancel: () => void;
  onForgot: () => void;
  onCeremonyActiveChange: (isActive: boolean) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [passphrase, setPassphrase] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repair, setRepair] = useState<{
    passphrase: string;
    completeSetup: (input: { passphrase: string }) => Promise<SyncSetupOutcome>;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      const result = await signInToSync({ serverUrl, email: email.trim(), passphrase });
      if (result.status === 'setup-incomplete') {
        setRepair({ passphrase, completeSetup: result.completeSetup });
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
          resume={{ passphrase: repair.passphrase }}
          onCeremonyActiveChange={onCeremonyActiveChange}
          provision={async (input) => {
            const outcome = await repair.completeSetup(input);
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
        <Label htmlFor="sync-signin-email">{t('sync.emailLabel')}</Label>
        <Input
          id="sync-signin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11"
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

/**
 * Requests the reset email. Always reports the same thing back, whether or not
 * the address has an account — the service answers `202` either way, and
 * echoing anything more specific would turn this form into an account
 * enumeration oracle the protocol deliberately closes.
 */
function ForgotPassphrasePanel({
  serverUrl,
  initialEmail,
  onCancel,
}: {
  serverUrl: string;
  initialEmail: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [isSent, setIsSent] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    try {
      await requestSyncReset({ serverUrl, email: email.trim() });
    } finally {
      setIsBusy(false);
      setIsSent(true);
    }
  }

  if (isSent) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t('sync.forgot.sent')}</p>
        <p className="text-xs text-muted-foreground">{t('sync.forgot.sentNote')}</p>
        <Button type="button" variant="ghost" className="h-11 w-full" onClick={onCancel}>
          {t('sync.forgot.back')}
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <p className="text-sm text-muted-foreground">{t('sync.forgot.intro')}</p>
      <div className="space-y-2">
        <Label htmlFor="sync-forgot-email">{t('sync.emailLabel')}</Label>
        <Input
          id="sync-forgot-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11 w-full" disabled={isBusy}>
          {t('sync.forgot.submit')}
        </Button>
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

function ConnectedPanel({ email }: { email: string }) {
  const { t } = useTranslation();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sync.connected.title')}
          </CardTitle>
          <CardDescription>{t('sync.connected.description', { email })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SyncStatus onSyncNow={() => void syncNow().catch(() => undefined)} />
          {/* Said plainly, because "where are my photos on my other device?"
              is otherwise the first support question this feature generates. */}
          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {t('sync.connected.photosStayHere')}
          </p>
        </CardContent>
      </Card>

      <RecoveryCodeCard />
      <ChangePassphraseCard />
      <DangerZoneCard email={email} />
    </>
  );
}

/**
 * Replaces the account's recovery code.
 *
 * This is the answer to "the tab died during setup" and to the far more common
 * "I lost the piece of paper". In both cases the account is fine and the data
 * is intact — what is broken is the BACKUP, silently: there is a recovery
 * record on file that no known code opens.
 *
 * Change-passphrase does not help, despite the intuition that it should. It
 * deliberately leaves the recovery record alone, because that record wraps the
 * same unchanged data key and survives a passphrase rotation. Replacing the
 * recovery code is a separate operation, and this is the only one.
 *
 * It reuses `RecoveryCodeStep` — the same warning, the same "I've saved this"
 * gate — rather than printing the code in a corner of a settings page. A code
 * treated as unmissable in one place and casual in another is the same bug
 * twice.
 */
function RecoveryCodeCard() {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [hasConfirmedSaved, setHasConfirmedSaved] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate(): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      const result = await regenerateRecoveryCode();
      setHasConfirmedSaved(false);
      setCode(result.recoveryCode);
    } catch (caught) {
      setError(describeErrorForUser(caught, t('sync.recoveryCode.failed')));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" aria-hidden="true" /> {t('sync.recoveryCode.title')}
        </CardTitle>
        <CardDescription>{t('sync.recoveryCode.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {code !== null ?
          <RecoveryCodeStep
            recoveryCode={code}
            hasConfirmedSaved={hasConfirmedSaved}
            onConfirmToggle={setHasConfirmedSaved}
            onFinish={() => setCode(null)}
            finishLabel={t('sync.recoveryCode.done')}
          />
        : <>
            {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={isBusy}
              onClick={() => void handleRegenerate()}
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('sync.recoveryCode.regenerate')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('sync.recoveryCode.note')}</p>
          </>
        }
      </CardContent>
    </Card>
  );
}

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
function DangerZoneCard({ email }: { email: string }) {
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
              <AlertDialogDescription>{t('sync.delete.confirmBody', { email })}</AlertDialogDescription>
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
