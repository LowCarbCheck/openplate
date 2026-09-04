/**
 * `/settings/account` — everything a signed-in person can do about their own
 * account, and nothing about how any of it works.
 *
 * It replaced `/settings/sync`, and the rename is the point rather than
 * cosmetic. That page was about a MECHANISM: it offered to create an account,
 * to sign in, to connect a server, and it wore the word Sync in its title on
 * an instance where syncing is not optional and not a feature anybody chose.
 * The five things left here are the five things a person comes looking for:
 * who am I, what am I called, change my password, sign out, delete me.
 *
 * ── What is NOT here, and where it went ──────────────────────────────────
 *
 *  - Creating an account. `/join` does that, from an invitation.
 *  - Signing in. `/sign-in` does that.
 *  - The recovery code. Escrowed with the service and never shown (M192).
 *  - The gateway connection. Deleted with the gateway.
 *
 * ── This route does not exist when there is no server ────────────────────
 *
 * The loader 404s when `SYNC_SERVER_URL` is unset. Rendering an explanatory
 * page would still be account UI on an instance whose operator chose to have
 * no accounts, and the requirement is literal: unset means nothing renders and
 * nothing is requested. On that instance this address really is not a page.
 *
 * Everything else is client-side. The loader returns one string; key
 * derivation, encryption and every request happen in the browser and never
 * touch this server (AGENTS.md, "Sync Architecture").
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLoaderData } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Loader2, LogOut, RefreshCw, Trash2, UserRound } from 'lucide-react';

import { CONFIG } from '#app/config';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ServerNoticeBanner } from '#app/components/sync-notice-banner';
import { PasswordFields } from '#app/components/password-fields';
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
import { getFormProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { useManagedInstance } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { makeSyncRecoverySchema } from '#app/lib/sync/recovery-schema';
import {
  changeSyncPassphrase,
  deleteSyncAccount,
  refreshSyncAccount,
  setSyncDisplayName,
  signOutOfSync,
  syncNow,
} from '#app/lib/sync/sync-actions';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.account') }];

export const handle = {
  titleKey: 'account.title',
  title: 'Account',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no server configured. */
export function loader() {
  const syncServerUrl = CONFIG.sync.syncServerUrl;
  if (syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { syncServerUrl };
}

export default function SettingsAccount() {
  const { t } = useTranslation();
  const { syncServerUrl } = useLoaderData<typeof loader>();
  const session = useSyncSession();
  const managed = useManagedInstance();
  const account = session.account;

  // ON OPEN, ONCE. The allowance and the count move on the SERVER while a tab
  // sits here, and this page is the one that shows them; the sign-in snapshot
  // would be a photograph of whatever they were that morning.
  useEffect(() => {
    void refreshSyncAccount();
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* The operator's notice, above everything: it is the one message on
          this page that did not come from us, and it may be the only warning
          somebody gets that their instance is moving or closing. */}
      <ServerNoticeBanner serverUrl={syncServerUrl} />
      {account === null ?
        <SignedOutCard />
      : <>
          <IdentityCard
            email={account.email}
            displayName={account.displayName}
            // `null` on an open instance AND while the real numbers are still
            // in flight (0.10.1 walk defect 2): a session opened before the
            // `AccountView` read must never show a borrowed `0` as this
            // account's allowance. The `useEffect` above refreshes on open,
            // so this is a loading flicker, not a dead end.
            allowance={
              managed && account.dailyAiLimit !== null && account.aiUsedToday !== null ?
                { usedToday: account.aiUsedToday, dailyLimit: account.dailyAiLimit }
              : null
            }
          />
          {managed && account.dailyAiLimit !== null && account.aiUsedToday !== null && (
            <AllowanceCard dailyLimit={account.dailyAiLimit} usedToday={account.aiUsedToday} />
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t('account.devices.title')}</CardTitle>
              <CardDescription>{t('account.devices.body')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SyncStatus onSyncNow={() => void syncNow().catch(() => undefined)} />
              <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                {t('account.devices.photosStayHere')}
              </p>
            </CardContent>
          </Card>
          <ChangePasswordCard />
          <DangerZoneCard accountEmail={account.email} />
        </>
      }
    </div>
  );
}

/** A person who reached this page signed out. One sentence and the door. */
function SignedOutCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.signedOut.title')}</CardTitle>
        <CardDescription>{t('account.signedOut.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/sign-in" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('account.signedOut.signIn')}
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Who this account is, and the one thing about it a person may edit.
 *
 * THE ADDRESS IS NOT EDITABLE, and that is a decision rather than an omission:
 * it is the identity, an admin issued the invitation that carries it, and
 * changing it would silently move an account away from the person the
 * organization invited.
 */
function IdentityCard({
  email,
  displayName,
  allowance,
}: {
  email: string;
  displayName: string | null;
  /** `null` on an open instance, where there is no allowance to have. */
  allowance: { usedToday: number; dailyLimit: number } | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(displayName ?? '');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setMessage(null);
    try {
      // TRIMMED, and an empty name is `null` rather than `''`: "no name" is
      // one state, and two spellings of it would render differently wherever a
      // name is shown beside an address.
      await setSyncDisplayName({ displayName: name.trim() === '' ? null : name.trim() });
      setMessage({ kind: 'ok', text: t('account.name.saved') });
    } catch (caught) {
      setMessage({ kind: 'error', text: describeErrorForUser(caught, t('account.name.failed')) });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-primary" aria-hidden="true" /> {t('account.title')}
        </CardTitle>
        <CardDescription>{email}</CardDescription>
        {/* UNDER THE ADDRESS, because it is the second fact about this account
            and the first one somebody comes looking for when a scan stops
            working. `AllowanceCard` below explains it; this line is the
            number (M192/06). */}
        {allowance !== null && allowance.dailyLimit > 0 && (
          <CardDescription>
            {t('account.allowance.today', { used: allowance.usedToday, limit: allowance.dailyLimit })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="account-display-name">{t('account.name.label')}</Label>
            <Input
              id="account-display-name"
              type="text"
              autoComplete="name"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">{t('account.name.hint')}</p>
          </div>
          {message !== null && (
            <p className={message.kind === 'ok' ? 'text-sm text-primary' : 'text-sm text-red-600 dark:text-red-400'}>
              {message.text}
            </p>
          )}
          <Button type="submit" className="h-11 w-full sm:w-auto" disabled={isBusy}>
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('account.name.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The photo allowance, on a managed instance only.
 *
 * A person cannot change it, and the card says who can. Showing a number
 * nobody can act on would be worse than showing nothing if it were not for the
 * one question it answers: "why did my scan stop working today".
 */
function AllowanceCard({ dailyLimit, usedToday }: { dailyLimit: number; usedToday: number }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.allowance.title')}</CardTitle>
        <CardDescription>
          {dailyLimit === 0 ?
            t('account.allowance.none')
          : t('account.allowance.body', { used: usedToday, limit: dailyLimit })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{t('account.allowance.askAdmin')}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Change the password.
 *
 * The CURRENT one is asked for, and it has to be: the service checks it, and
 * the DEK is re-wrapped under the new key in the same client moment, which
 * cannot happen without the key the old password derives. That is the whole
 * difference between this and `/reset`, where the person does not have it.
 */
function ChangePasswordCard() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [form, fields] = useForm({
    id: 'account-change-password',
    onValidate({ formData }) {
      // The RESET schema: the same two fields under the same floor. A third
      // copy of "a new password, twice" is how the three drift.
      return parseWithZod(formData, { schema: makeSyncRecoverySchema(t) });
    },
    shouldRevalidate: 'onInput',
    onSubmit(event, { submission }) {
      event.preventDefault();
      if (submission?.status !== 'success') return;
      void change(submission.value.passphrase);
    },
  });

  async function change(next: string): Promise<void> {
    setIsBusy(true);
    setMessage(null);
    try {
      await changeSyncPassphrase({ currentPassphrase: current, newPassphrase: next });
      setCurrent('');
      setIsOpen(false);
      setMessage({ kind: 'ok', text: t('account.password.done') });
    } catch (error) {
      setMessage({ kind: 'error', text: describeErrorForUser(error, t('account.password.failed')) });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.password.title')}</CardTitle>
        <CardDescription>{t('account.password.body')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message !== null && (
          <p className={message.kind === 'ok' ? 'text-sm text-primary' : 'text-sm text-red-600 dark:text-red-400'}>
            {message.text}
          </p>
        )}
        {!isOpen ?
          <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setIsOpen(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('account.password.open')}
          </Button>
        : <form {...getFormProps(form)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-current-password">{t('account.password.currentLabel')}</Label>
              <Input
                id="account-current-password"
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                className="h-11"
              />
            </div>
            <PasswordFields
              passphrase={fields.passphrase}
              confirmPassphrase={fields.confirmPassphrase}
              passwordLabel={t('account.password.newLabel')}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="h-11" disabled={isBusy}>
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('account.password.submit')}
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
 * Deletion re-asks for the password — required by the protocol, and right: a
 * session left open on a shared device must not be enough to destroy an
 * account. The dialog is the established `ConfirmAction` shape (AlertDialog,
 * destructive confirm), built inline rather than reused because that component
 * submits to a route action and this page has none.
 */
function DangerZoneCard({ accountEmail }: { accountEmail: string }) {
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
      setError(describeErrorForUser(caught, t('account.delete.failed')));
    } finally {
      setIsBusy(false);
      setPassphrase('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.danger.title')}</CardTitle>
        <CardDescription>{t('account.danger.body')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* SIGN OUT EVERYWHERE is what this button does, and the copy says so:
            `signOutOfSync` revokes the token family server-side, so a session
            left open on a lost phone ends here. The diary on THIS device
            stays; signing out is not a wipe. */}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={() => void signOutOfSync().catch(() => undefined)}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> {t('account.signOut.cta')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('account.signOut.note')}</p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" className="h-11 w-full sm:w-auto">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('account.delete.cta')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('account.delete.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('account.delete.confirmBody', { email: accountEmail })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="account-delete-password">{t('account.delete.passwordLabel')}</Label>
              <Input
                id="account-delete-password"
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
                {t('account.delete.confirmCta')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="text-xs text-muted-foreground">{t('account.delete.note')}</p>
      </CardContent>
    </Card>
  );
}
