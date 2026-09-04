/**
 * Everybody on this instance, and everything an administrator does to them.
 *
 * ── Presentational: it asks, it never calls ──────────────────────────────
 *
 * Every action is a callback. The route owns the admin client, the refresh
 * after each change, and the toasts; this file owns the shape. That split is
 * what lets the render test put two people and a suspended one on screen
 * without a session, a server or a network.
 *
 * ── Your own row has no controls ─────────────────────────────────────────
 *
 * The service refuses an administrator's changes to their own account with
 * `400 self-change`, and the reason is worth keeping visible: an instance
 * whose last administrator demoted or suspended themselves has nobody left who
 * can undo it. Rather than offer the buttons and explain the refusal, the row
 * is marked as yours and the controls are simply absent.
 *
 * ── Usage is shown as "used of limit" ────────────────────────────────────
 *
 * The number by itself answers nothing: 40 is heavy use against a limit of 50
 * and nothing at all against 500. An allowance of 0 is its own sentence rather
 * than "0 of 0", because it is not a person who has run out, it is one who was
 * never given any.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
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
import type { AccountRole, AdminAccountView } from '#app/lib/admin/admin-wire';

/** What a row can ask the route to do. Each resolves when the change has been stored and the list re-read. */
export interface PeopleActions {
  onSave: (input: { id: number; role: AccountRole; dailyAiLimit: number }) => Promise<void>;
  onSetSuspended: (input: { id: number; suspended: boolean }) => Promise<void>;
  onSendResetMail: (input: { id: number }) => Promise<void>;
  onDelete: (input: { id: number }) => Promise<void>;
}

export interface PeopleTableProps extends PeopleActions {
  people: AdminAccountView[];
  /** The signed-in administrator. Their own row is marked and carries no controls. */
  currentAccountId: number;
}

export function PeopleTable({ people, currentAccountId, ...actions }: PeopleTableProps) {
  const { t } = useTranslation();

  if (people.length === 0) return <p className="text-sm text-muted-foreground">{t('admin.people.empty')}</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {people.map((person) => (
        <PersonRow key={person.id} person={person} isSelf={person.id === currentAccountId} {...actions} />
      ))}
    </ul>
  );
}

/** One person: who they are, what they may do, and what has been done with it today. */
function PersonRow({ person, isSelf, ...actions }: { person: AdminAccountView; isSelf: boolean } & PeopleActions) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuspended = person.suspendedAt !== null;

  async function run(action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      setIsEditing(false);
    } catch {
      // The message is deliberately ours rather than the server's: `PROTOCOL.md`
      // §4 forbids branching on its prose, and showing it would put an English
      // sentence from another codebase into a German page.
      setError(t('admin.edit.failed'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{person.displayName ?? t('admin.noName')}</p>
          <p className="truncate text-sm text-muted-foreground">{person.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSelf && <Badge variant="outline">{t('admin.you')}</Badge>}
          <Badge variant={person.role === 'admin' ? 'default' : 'secondary'}>
            {person.role === 'admin' ? t('admin.role.admin') : t('admin.role.standard')}
          </Badge>
          <Badge variant={isSuspended ? 'destructive' : 'outline'}>
            {isSuspended ? t('admin.standing.suspended') : t('admin.standing.active')}
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t('admin.columns.usedToday')}</dt>
          <dd>
            {person.dailyAiLimit === 0 ?
              t('admin.usageNone')
            : t('admin.usage', { used: person.aiUsedToday, limit: person.dailyAiLimit })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('admin.columns.joined')}</dt>
          <dd>{new Date(person.createdAt).toLocaleDateString()}</dd>
        </div>
      </dl>

      {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isEditing ?
        <PersonEditor person={person} isBusy={isBusy} onCancel={() => setIsEditing(false)} onSave={(next) => run(() => actions.onSave({ id: person.id, ...next }))} />
      : !isSelf && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setIsEditing(true)}>
              {t('admin.edit.open')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => void run(() => actions.onSendResetMail({ id: person.id }))}
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('admin.resetMail.cta')}
            </Button>
            {isSuspended ?
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => void run(() => actions.onSetSuspended({ id: person.id, suspended: false }))}
              >
                {t('admin.reactivate.cta')}
              </Button>
            : <ConfirmButton
                label={t('admin.suspend.cta')}
                title={t('admin.suspend.confirmTitle', { email: person.email })}
                body={t('admin.suspend.confirmBody')}
                confirmLabel={t('admin.suspend.confirmCta')}
                isBusy={isBusy}
                onConfirm={() => void run(() => actions.onSetSuspended({ id: person.id, suspended: true }))}
              />
            }
            <DeletePersonButton
              email={person.email}
              isBusy={isBusy}
              onConfirm={() => void run(() => actions.onDelete({ id: person.id }))}
            />
          </div>
        )
      }
    </li>
  );
}

/** Role and allowance, edited in place. Both are sent together so one save is one change to one row. */
function PersonEditor({
  person,
  isBusy,
  onCancel,
  onSave,
}: {
  person: AdminAccountView;
  isBusy: boolean;
  onCancel: () => void;
  onSave: (next: { role: AccountRole; dailyAiLimit: number }) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<AccountRole>(person.role);
  const [limit, setLimit] = useState(String(person.dailyAiLimit));

  return (
    <div className="space-y-3 rounded-lg bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`role-${person.id}`}>{t('admin.role.label')}</Label>
          <select
            id={`role-${person.id}`}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}
          >
            <option value="member">{t('admin.role.standard')}</option>
            <option value="admin">{t('admin.role.admin')}</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`limit-${person.id}`}>{t('admin.edit.allowanceLabel')}</Label>
          <Input
            id={`limit-${person.id}`}
            type="number"
            min={0}
            step={1}
            className="h-11"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('admin.edit.allowanceHint')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isBusy}
          onClick={() => onSave({ role, dailyAiLimit: readAllowance(limit) })}
        >
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('admin.edit.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('admin.edit.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The typed field turned into an allowance.
 *
 * A blank or unparseable field becomes `0`, which is the SAFE direction: it
 * turns photo reading off rather than granting an accidental allowance, and
 * the person's next scan says so plainly instead of the operator finding out
 * from a bill.
 */
function readAllowance(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** A destructive action behind one confirmation. Suspension and invitation withdrawal both use it. */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  isBusy,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={isBusy}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('admin.edit.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isBusy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Deletion, behind the address typed out in full.
 *
 * A confirm dialog is muscle memory and gets clicked through. Typing the
 * address is the one gesture that cannot be made by accident, and it is the
 * same gesture the person's own account page asks of them — deliberately, so
 * that "irreversible" always looks the same in this app.
 */
function DeletePersonButton({ email, isBusy, onConfirm }: { email: string; isBusy: boolean; onConfirm: () => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="destructive" disabled={isBusy}>
          {t('admin.delete.cta')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.delete.confirmTitle', { email })}</AlertDialogTitle>
          <AlertDialogDescription>{t('admin.delete.confirmBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`confirm-${email}`}>{t('admin.delete.typeLabel')}</Label>
          <Input
            id={`confirm-${email}`}
            type="email"
            autoComplete="off"
            className="h-11"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('admin.edit.cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={isBusy || typed.trim().toLowerCase() !== email.toLowerCase()}
            onClick={onConfirm}
          >
            {t('admin.delete.confirmCta')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
