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
 * is. What an erase would lose is named BEFORE the box can be ticked, because
 * it is the number that says how much is at stake, and when nothing is waiting
 * the dialog says so in words rather than showing a zero (`erase-notice.ts`).
 *
 * That number comes from the sync engine's own diff, the live diary against
 * the baseline this device last agreed with the account, plus the queued
 * estimate reports. It used to come from the retired log outbox, which was
 * empty on every device, so the dialog told everybody that everything had
 * reached the server. When the device cannot be checked, the dialog says that
 * instead, and it never gives the all-clear for rows the check cannot see.
 *
 * ── Two doors, one dialog ────────────────────────────────────────────────
 *
 * The header menu and `/settings/account` both render this, with their own
 * trigger. The old settings button signed out on click with no confirmation
 * and no erase; it now opens this, so the two doors cannot drift into meaning
 * different things.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
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
import { describeErrorForUser } from '#app/lib/sync/error-text';
import {
  readUnsentOnDevice,
  resolveEraseNotice,
  type EraseNoticeLine,
  type UnsentRead,
} from '#app/lib/sync/erase-notice';
import { runSignOut } from '#app/lib/sync/sign-out-flow';
import { useSyncSession } from './sync-status';

const ERASE_FIELD_ID = 'sign-out-erase';

/**
 * One sentence per named line (`erase-notice.ts`), and nothing decided here.
 *
 * `data-erase-line` names the line and `data-count` carries its number, so the
 * browser tier asserts what the dialog SAID without pinning a sentence the
 * wordsmith pass is free to rephrase.
 */
function EraseNoticeText({ line }: { line: EraseNoticeLine }) {
  const { t } = useTranslation();
  if (line.kind === 'checking') return <span data-erase-line={line.kind}>{t('signOut.unsent.checking')}</span>;
  if (line.kind === 'unchecked') return <span data-erase-line={line.kind}>{t('signOut.unsent.unchecked')}</span>;
  if (line.kind === 'all-sent') return <span data-erase-line={line.kind}>{t('signOut.unsent.allSent')}</span>;
  // TWO LINES SINCE M240/03, where one blanket sentence used to stand. Each
  // says one true thing, and `resolveEraseNotice` pushes each only when it is
  // true, so a person is never warned about saved meals the account already
  // holds.
  if (line.kind === 'saved-meals-unsent') {
    return <span data-erase-line={line.kind}>{t('signOut.unsent.savedMealsUnsent')}</span>;
  }
  if (line.kind === 'keys-not-covered') {
    return <span data-erase-line={line.kind}>{t('signOut.unsent.keysNotCovered')}</span>;
  }
  if (line.kind === 'unsent-changes') {
    return (
      <span data-erase-line={line.kind} data-count={line.count}>
        {t('signOut.unsent.changes', { count: line.count })}
      </span>
    );
  }
  return (
    <span data-erase-line={line.kind} data-count={line.count}>
      {t('signOut.unsent.reports', { count: line.count })}
    </span>
  );
}

/** A read tagged with the moment it describes, so a read from before a sync is never shown after it. */
interface KeyedRead {
  key: string;
  read: UnsentRead;
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
  const session = useSyncSession();
  const accountId = session.account?.id ?? null;
  const isSyncing = session.phase === 'syncing';
  const [open, setOpen] = useState(false);
  const [eraseDevice, setEraseDevice] = useState(false);
  const [keyedRead, setKeyedRead] = useState<KeyedRead | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WHICH MOMENT A READ DESCRIBES: this account, as of its last completed
  // cycle. A cycle that lands while the dialog is open moves the baseline, and
  // a read from before it is then a statement about a device that no longer
  // exists, so it is not shown; the line says "checking" until the next one.
  const readKey = `${accountId ?? 'none'}:${session.lastSyncedAt ?? 'never'}`;
  const unsentRead: UnsentRead = keyedRead?.key === readKey ? keyedRead.read : { status: 'pending' };
  const noticeLines = resolveEraseNotice({ read: unsentRead, isSyncing, hasSession: accountId !== null });

  // Read only while the dialog is open. This is a genuine external read with a
  // lifetime, not derived state: it reads IndexedDB, and doing so when the menu
  // merely renders would open two databases on every page.
  //
  // NOT DURING A CYCLE. The cycle's commit is about to move the baseline, so
  // the effect waits for it to settle and reads then; `isSyncing` in the deps
  // is what brings it back.
  useEffect(() => {
    if (!open || accountId === null || isSyncing) return;
    let cancelled = false;
    void (async () => {
      let read: UnsentRead;
      try {
        read = { status: 'done', unsent: await readUnsentOnDevice({ accountId }) };
      } catch {
        // The notice is an aid, not a gate. A device that cannot be read still
        // gets to sign out, and it is told that nothing could be checked,
        // never that everything was sent.
        read = { status: 'failed' };
      }
      if (!cancelled) setKeyedRead({ key: readKey, read });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, isSyncing, readKey]);

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
          // And from no read. A read kept from the last opening would be shown
          // for a moment on the next one, about a device that may have changed
          // since.
          setKeyedRead(null);
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
            <p data-slot="erase-notice" className="text-xs leading-relaxed text-muted-foreground">
              {/* One paragraph of sentences, so the spaces are text, not margin. */}
              {noticeLines.map((line, index) => (
                <Fragment key={line.kind}>
                  {index > 0 && ' '}
                  <EraseNoticeText line={line} />
                </Fragment>
              ))}
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
