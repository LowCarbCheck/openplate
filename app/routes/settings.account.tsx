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
import { Loader2, LogOut, MailPlus, RefreshCw, Trash2, UserRound } from 'lucide-react';

import { CONFIG } from '#app/config';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ServerNoticeBanner } from '#app/components/sync-notice-banner';
import { OperatorVisibilityCard } from '#app/components/operator-visibility-card';
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
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { resolveAllowanceDoor, type AllowanceDoor } from '#app/lib/ai/managed-ai-settings';
import { hasPlansDoor, PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import { canSendMemberInvites } from '#app/lib/sync/member-invites';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { trackAccountDeleted, trackPasswordChanged } from '#app/lib/matomo-events';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { SignOutDialog } from '#app/components/sign-out-dialog';
import { makeSyncRecoverySchema } from '#app/lib/sync/recovery-schema';
import {
  changeSyncPassphrase,
  deleteSyncAccount,
  refreshSyncAccount,
  sendMemberInvite,
  setSyncDisplayName,
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
  // The allowance card exists because the photo estimates are the instance's,
  // billed to this account. That is the question, not the mode name (M201/07).
  // `operatorSeesActivity` is the second question this page asks, and it is a
  // different one: an instance could in principle bill the photos without an
  // operator who reads per-person activity, and the sentence that tells
  // somebody what an administrator sees must be gated on the seeing.
  const { aiComesFromTheInstance, operatorSeesActivity } = useInstancePolicy();
  const account = session.account;
  // WHAT THIS INSTANCE OFFERS, from the instance itself rather than from the
  // mode. `memberInvites` is a per-deployment fact, not a consequence of being
  // managed, so it cannot be an `InstancePolicy` question: two managed
  // instances answer it differently. `false` while the handshake is in flight,
  // which draws no card and keeps the sentence that names an administrator.
  const instance = useServerInstance();
  const memberInvites = instance?.memberInvites ?? false;
  // WHY the allowance is missing, in the words that are true here, resolved by
  // the same rule `/scan` and the composer's notice ask (M212 spec 04).
  const allowanceDoor = resolveAllowanceDoor({
    memberInvites,
    allowanceExpiresAt: account?.allowanceExpiresAt ?? null,
    now: new Date(),
  });
  // AND WHETHER THERE IS A PAGE THAT CHANGES IT (M213 spec 05). The same
  // handshake read, one line down: on an instance with a biller behind it the
  // allowance is a thing a person buys, so the card that explains the
  // allowance is where the link belongs. `false` while the read is in flight,
  // which draws no link and promises nothing.
  const plansAvailable = hasPlansDoor(instance);

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
              aiComesFromTheInstance && account.dailyAiLimit !== null && account.aiUsedToday !== null ?
                { usedToday: account.aiUsedToday, dailyLimit: account.dailyAiLimit }
              : null
            }
          />
          {aiComesFromTheInstance && account.dailyAiLimit !== null && account.aiUsedToday !== null && (
            <AllowanceCard
              dailyLimit={account.dailyAiLimit}
              usedToday={account.aiUsedToday}
              expiresAt={account.allowanceExpiresAt}
              door={allowanceDoor}
              plansAvailable={plansAvailable}
            />
          )}
          {/* TWO GATES, AND BOTH ARE THE SERVICE'S ANSWER (M212 spec 04). The
              instance says whether the route exists at all, and the account
              says whether this person has any left; `null` is "the cap is not
              about you", which is an administrator and an instance with the
              feature off, and it is also the unread moment after a reload. */}
          {canSendMemberInvites({ memberInvites, invitesLeft: account.invitesLeft }) && (
            <InviteCard invitesLeft={account.invitesLeft ?? 0} />
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
          {/* AFTER the devices card and before the password one, because it
              is a fact about this account rather than an action on it, and it
              answers the question the two cards above raise: this instance
              keeps a copy and reads photos for you, so who looks at that.
              Nothing renders on an open instance, which has no operator and
              nobody for the sentence to be about (M201/06). */}
          {operatorSeesActivity && <OperatorVisibilityCard />}
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
function AllowanceCard({
  dailyLimit,
  usedToday,
  expiresAt,
  door,
  plansAvailable,
}: {
  dailyLimit: number;
  usedToday: number;
  /**
   * When the allowance ends, or `null`.
   *
   * `null` IS NOT A PASSED DATE. It is an allowance with no end at all, which
   * is what every self-hosted instance keeps, and it is also the moment before
   * the account view has been read. Neither may draw an ended line.
   */
  expiresAt: string | null;
  /** Why the allowance is missing, when it is. See `resolveAllowanceDoor`. */
  door: AllowanceDoor;
  /**
   * Whether this instance sells a plan, from the handshake (M213 spec 05).
   *
   * The link goes HERE and on no other card, because this is the card that
   * states the allowance, and the plan is the thing that buys one. A row in
   * the settings hub would advertise a purchase to somebody who opened
   * settings to change the theme.
   */
  plansAvailable: boolean;
}) {
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
        {/* THE DATE, BESIDE THE NUMBER IT BOUNDS. A DATE and not a phrase: "in
            3 days" is a sentence baked in one language and computed against
            the reader's clock, and this is the one fact somebody checks when a
            scan stops working. The ended form is chosen by the door, so this
            line and the sentence below cannot disagree about the same date. */}
        {expiresAt !== null && (
          <CardDescription>
            {door.kind === 'allowance-ended' ?
              t('account.allowance.expired', { date: new Date(expiresAt).toLocaleDateString() })
            : t('account.allowance.expires', { date: new Date(expiresAt).toLocaleDateString() })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {/* THE SENTENCE THAT USED TO NAME A PERSON WHO MAY NOT EXIST. On an
            instance whose accounts invite each other there is no
            administrator, so the card stops at the description above, which
            already says photo estimates are not switched on for this account.
            The ended case has something true left to say, and it is the
            date. */}
        {door.kind === 'ask-admin' && <p className="text-xs text-muted-foreground">{t('account.allowance.askAdmin')}</p>}
        {/* THE PAGE THAT CHANGES IT, where there is one. Drawn whatever the
            door says, because a person with a working allowance also has to
            be able to reach the page that cancels it. */}
        {plansAvailable && (
          <p className="mt-2 text-xs">
            <Link to={PLAN_PAGE_HREF} className="text-primary underline-offset-4 hover:underline">
              {t('account.allowance.planLink')}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * INVITE SOMEBODY, on an instance that hands its accounts invitations.
 *
 * ── The one sentence, whatever happened ──────────────────────────────────
 *
 * The service answers one fixed `202` with an empty body for a new address,
 * for an address that already holds an invitation and for an address that
 * already holds an account (`PROTOCOL.md` §5.21). That is deliberate: a person
 * who types a colleague's address must not learn from this screen that the
 * colleague is already here. So there is ONE confirmation, it is neutral, and
 * it says so, and a refusal shows the same neutral failure sentence rather
 * than the reason.
 *
 * `refreshSyncAccount` runs after a submit because the count moved on the
 * server, and this screen is the only one that draws it.
 */
function InviteCard({ invitesLeft }: { invitesLeft: number }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setMessage(null);
    try {
      await sendMemberInvite({ email: email.trim() });
      setMessage({ kind: 'ok', text: t('account.invites.sent') });
      setEmail('');
    } catch {
      // NOT `describeErrorForUser`, and that is the point rather than laziness:
      // a transport failure and a refusal from the cap are one sentence here,
      // because the refused ones are the cases whose reason would say
      // something about the address.
      setMessage({ kind: 'error', text: t('account.invites.failed') });
    } finally {
      setIsBusy(false);
      await refreshSyncAccount();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailPlus className="h-5 w-5 text-primary" aria-hidden="true" /> {t('account.invites.title')}
        </CardTitle>
        <CardDescription>{t('account.invites.body')}</CardDescription>
        <CardDescription>
          {invitesLeft === 0 ? t('account.invites.none') : t('account.invites.left', { left: invitesLeft })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="account-invite-email">{t('account.invites.label')}</Label>
            <Input
              id="account-invite-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11"
            />
          </div>
          {message !== null && (
            <p className={message.kind === 'ok' ? 'text-sm text-primary' : 'text-sm text-red-600 dark:text-red-400'}>
              {message.text}
            </p>
          )}
          {/* DISABLED AT ZERO, and still refused by the service if a client
              believed otherwise: `invitesLeft` is drawn, never trusted. */}
          <Button type="submit" className="h-11 w-full sm:w-auto" disabled={isBusy || invitesLeft === 0}>
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('account.invites.send')}
          </Button>
        </form>
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
      trackPasswordChanged();
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
      trackAccountDeleted();
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
        {/* THE OLD DOOR, KEPT (M201 spec 02). The header menu is where sign-out
            belongs and now is, and this one stays: a person who has learned to
            look here must not find the control gone. What changed is that both
            open the SAME dialog, so the erase choice and the confirmation
            cannot mean one thing in the chrome and another on this page.
            Signing out still revokes the token family server-side, which is
            what ends a session left open on a lost phone. */}
        <SignOutDialog
          trigger={
            <Button type="button" variant="outline" className="h-11 w-full sm:w-auto">
              <LogOut className="h-4 w-4" aria-hidden="true" /> {t('account.signOut.cta')}
            </Button>
          }
        />
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
