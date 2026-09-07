/**
 * The one dialog behind every sign-out door (M201 spec 02).
 *
 * ── Why sign-out asks at all ─────────────────────────────────────────────
 *
 * Not because it is destructive. It asks because the erase choice lives in the
 * same act, and a choice with consequences needs somewhere to be made. The
 * confirm button is therefore NOT destructive-styled: signing out takes
 * nothing away by itself, and dressing it in red files it beside "Delete
 * account", which is exactly the mistake `/settings/account` made by placing
 * it there.
 *
 * ── The erase choice ─────────────────────────────────────────────────────
 *
 * Unchecked, always, and it is checked by the person or not at all. Wiping by
 * default destroys entries that never reached the server, and a research
 * participant's lost week is not recoverable while a diary left on a device
 * is. The outbox count is named BEFORE the box can be ticked, because it is
 * the number that says how much is at stake, and when nothing is waiting the
 * dialog says so in words rather than showing a zero (`erase-notice.ts`).
 *
 * ── Two doors, one dialog ────────────────────────────────────────────────
 *
 * The header menu and `/settings/account` both render this, with their own
 * trigger. The old settings button signed out on click with no confirmation
 * and no erase; it now opens this, so the two doors cannot drift into meaning
 * different things.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

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
import { Button } from '#app/components/ui/button';
import { Label } from '#app/components/ui/label';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { listOutboxRecords } from '#app/lib/local-store';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { resolveEraseOutboxNotice } from '#app/lib/sync/erase-notice';
import { runSignOut } from '#app/lib/sync/sign-out-flow';

const ERASE_FIELD_ID = 'sign-out-erase';

/** The dialog's own copy for the outbox line, one string per state. */
function OutboxLine({ count }: { count: number | null }) {
  const { t } = useTranslation();
  const notice = resolveEraseOutboxNotice(count);

  if (notice.kind === 'counting') return <span>{t('signOut.outbox.counting')}</span>;
  if (notice.kind === 'empty') return <span>{t('signOut.outbox.empty')}</span>;
  return <span>{t('signOut.outbox.waiting', { count: notice.count })}</span>;
}

/**
 * @param trigger - the control that opens this. A menu item in the header, a
 *   button on the settings page.
 */
export function SignOutDialog({ trigger }: { trigger: ReactNode }) {
  const { t } = useTranslation();
  // `signOutErasesDevice` is the question, never the mode name: it is the one
  // that says whether the diary belongs to the account or to the device, and
  // therefore whether this sign-out has to close it.
  const { signOutErasesDevice } = useInstancePolicy();
  const [open, setOpen] = useState(false);
  const [eraseDevice, setEraseDevice] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read only while the dialog is open. This is a genuine external read with a
  // lifetime, not derived state: the outbox is IndexedDB, and counting it when
  // the menu merely renders would open that database on every page.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const records = await listOutboxRecords();
        if (!cancelled) setPendingCount(records.length);
      } catch {
        // The count is an aid, not a gate. A device that cannot read its
        // outbox still gets to sign out, and the line keeps saying "checking".
        if (!cancelled) setPendingCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSignOut(): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await runSignOut({ eraseDevice, locksDevice: signOutErasesDevice });
    } catch (caught) {
      // Reached only when an opted-in erase failed, which in practice means a
      // second tab is holding the database. The session is already closed and
      // the device already locked by then, so this reports the erase and not
      // the sign-out.
      setError(describeErrorForUser(caught, t('signOut.eraseFailed')));
      setIsBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening starts from unchecked. A box that remembered a tick from a
        // dialog somebody cancelled is a wipe nobody asked for twice.
        if (!next) {
          setEraseDevice(false);
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('signOut.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {signOutErasesDevice ? t('signOut.bodyManaged') : t('signOut.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border border-border p-3">
          {/* Unticked on every open. Erasing is a second act inside this one,
              and it is the person's act. */}
          <input
            id={ERASE_FIELD_ID}
            type="checkbox"
            checked={eraseDevice}
            onChange={(event) => setEraseDevice(event.target.checked)}
            disabled={isBusy}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
          />
          <div className="space-y-1">
            <Label htmlFor={ERASE_FIELD_ID} className="text-sm font-normal leading-relaxed">
              {t('signOut.erase.label')}
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <OutboxLine count={pendingCount} />
            </p>
          </div>
        </div>

        {error !== null && <p className="text-sm text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('confirm.cancel')}</AlertDialogCancel>
          {/* NOT `destructive`. Signing out gives the account back its diary;
              it does not take anything away, and the erase beside it is opt-in
              and labelled for what it does. */}
          <Button type="button" onClick={() => void handleSignOut()} disabled={isBusy}>
            {isBusy && <Loader2 className="animate-spin" />}
            {t('signOut.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
