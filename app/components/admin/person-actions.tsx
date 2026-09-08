/**
 * Everything an administrator DOES to somebody, in one place.
 *
 * ── Why these left the list ──────────────────────────────────────────────
 *
 * They used to live in `people-table.tsx`, five buttons deep in every row. A
 * list is for finding somebody and a detail page is for acting on them, so the
 * row became a link and these moved to `/admin/people/:id`. They live here
 * rather than in that route because `ConfirmButton` is also what withdraws an
 * invitation, and because a presentational file is the only kind this repo's
 * unit tier can render (see `admin-route.test.ts`).
 *
 * ── Presentational: they ask, they never call ────────────────────────────
 *
 * Every action is a callback. The route owns the admin client, the re-read
 * after each change, and the toasts.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

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

/** What one save carries. Role and allowance go together, so one save is one change to one account. */
export interface PersonEdit {
  role: AccountRole;
  dailyAiLimit: number;
}

export interface PersonEditorProps {
  person: AdminAccountView;
  isBusy: boolean;
  onCancel: () => void;
  onSave: (next: PersonEdit) => void;
}

/** Role and allowance, edited together. Both are sent in one request so a refusal is a refusal of one thing. */
export function PersonEditor({ person, isBusy, onCancel, onSave }: PersonEditorProps) {
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

export interface ConfirmButtonProps {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
}

/** A destructive action behind one confirmation. Suspension and invitation withdrawal both use it. */
export function ConfirmButton({ label, title, body, confirmLabel, isBusy, onConfirm }: ConfirmButtonProps) {
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

export interface DeletePersonButtonProps {
  email: string;
  isBusy: boolean;
  onConfirm: () => void;
}

/**
 * Deletion, behind the address typed out in full.
 *
 * A confirm dialog is muscle memory and gets clicked through. Typing the
 * address is the one gesture that cannot be made by accident, and it is the
 * same gesture the person's own account page asks of them, deliberately, so
 * that "irreversible" always looks the same in this app.
 */
export function DeletePersonButton({ email, isBusy, onConfirm }: DeletePersonButtonProps) {
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
