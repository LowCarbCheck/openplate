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
import { CreateAccountPanel } from '#app/components/create-account-panel';
import { SignInPanel } from '#app/components/sign-in-panel';
import { takeInviteFromUrl } from '#app/lib/sync/invite-link';
import { readPendingGatewayJoin } from '#app/lib/join-link';
import { Link } from '#app/components/link';
import { ServerNoticeBanner } from '#app/components/sync-notice-banner';
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
import { validateSyncPassphrase } from '#app/lib/sync/setup-flow';
import { changeSyncPassphrase, deleteSyncAccount, signOutOfSync, syncNow } from '#app/lib/sync/sync-actions';
import { clearAccountHint, readAccountHint } from '#app/lib/sync/sync-session';
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

// Both credential forms themselves live in `app/components` (M183 spec 03):
// `/sign-in` is a page of its own now, and it renders the SAME two components
// this panel does. A second copy of a sign-in form is how one of them quietly
// rots — so this file keeps the CHOICE between them, and neither form.

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
              {/* Beside the button that names the remembered handle, because
                  that is the thing it disowns (M183 spec 04). */}
              {knownHandle !== null && (
                <button
                  type="button"
                  onClick={() => {
                    clearAccountHint();
                    setKnownHandle(null);
                  }}
                  className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t('sync.signIn.notYou')}
                </button>
              )}
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
