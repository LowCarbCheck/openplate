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
 * is. What an erase would lose is named BEFORE AN ERASE CAN BE CONFIRMED,
 * because it is the number that says how much is at stake, and when nothing is
 * waiting the dialog says so in words rather than showing a zero
 * (`erase-notice.ts`).
 *
 * It is named when the box is ticked and not before (ADR-0016, amended
 * 2026-10-02). A plain sign-out deletes nothing: on a managed instance it hides
 * the diary and on an open one it leaves it alone. A warning about lost data
 * above a box nobody had touched read as if signing out removed something, and
 * the operator found it confusing. The tick can be undone and the confirm
 * cannot, so the cost has to be on screen before the second and not the first.
 *
 * ── Nothing moves ────────────────────────────────────────────────────────
 *
 * The notice appears after a tap, and a tap may not shift what is on screen
 * (DESIGN.md section 7). Three decisions keep that true:
 *
 *  - The dialog is anchored at the TOP (`top-4`, `sm:top-[10vh]`, no centring
 *    translate), so a box that grows pushes only what is below it. The centred
 *    default would move the title when the notice arrived.
 *  - The erase region is one grid cell with two layers, the notice and the
 *    error sentence. The inactive one is `invisible`, `inert` and `aria-hidden`
 *    and the cell keeps the taller layer's height, so a failed erase moves
 *    nothing either. The error is always the one fixed sentence, because a free
 *    message would not fit the box reserved for it; the real cause is logged.
 *  - The spinner is always in the confirm button, `invisible` when idle, so the
 *    button never changes width.
 *
 * The notice is FROZEN at the tick. From then until the dialog closes the lines
 * the person saw stay, whatever the session does: a later sync can only make
 * them over-warn, which this confirm is allowed to do, and a session that ends
 * under a running sign-out must not turn them into "could not be checked".
 *
 * That number comes from the sync engine's own diff, the live diary against
 * the baseline this device last agreed with the account, plus the queued
 * estimate reports. It used to come from the retired log outbox, which was
 * empty on every device, so the dialog told everybody that everything had
 * reached the server. When the device cannot be checked, the dialog says that
 * instead, and it never gives the all-clear for rows the check cannot see.
 *
 * ── Two doors, one dialog, mounted once ──────────────────────────────────
 *
 * The header menu and `/settings/account` both open this, by calling
 * `openSignOutDialog()`. The old settings button signed out on click with no
 * confirmation and no erase; it now opens this, so the two doors cannot drift
 * into meaning different things.
 *
 * The dialog is rendered ONCE, in `root.tsx`, and not by either door. Both
 * doors depend on the session, and the first step of a sign-out closes the
 * session: a dialog rendered by a door unmounted at the start of its own work,
 * so a failed erase wrote its error to a component that was gone and the person
 * saw a signed-out app, the diary still on the device, and no message. Here the
 * host outlives the session and the routes, and `sign-out-progress.ts` holds
 * the two facts the doors and the host share.
 *
 * It therefore never follows the live session. The account is read ONCE, when
 * the dialog opens, and kept: the session is null by the time an erase fails.
 */
import { Fragment, useEffect, useState } from 'react';
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
} from '#app/components/ui/alert-dialog';
import { Button } from '#app/components/ui/button';
import { Label } from '#app/components/ui/label';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { createComponentLogger } from '#app/lib/logger';
import {
  isEraseNoticeSettled,
  readUnsentOnDevice,
  resolveEraseNotice,
  type EraseNoticeLine,
  type UnsentRead,
} from '#app/lib/sync/erase-notice';
import { defaultSignOutSteps, runSignOut, signOutDestination } from '#app/lib/sync/sign-out-flow';
import {
  closeSignOutDialog,
  isSignOutRunning,
  setSignOutPhase,
  useSignOutProgress,
} from '#app/lib/sync/sign-out-progress';
import { cn } from '#app/lib/utils';
import { useSyncSession } from './sync-status';

const log = createComponentLogger('sign-out');

const ERASE_FIELD_ID = 'sign-out-erase';
const ERASE_REGION_ID = 'sign-out-erase-region';

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
 * The one sign-out dialog. Mount it once, above every route; the doors open it
 * through `openSignOutDialog()`.
 */
export function SignOutDialogHost() {
  const { t } = useTranslation();
  // `signOutClosesTheDiary` is the question, never the mode name: it is the one
  // that says whether the diary belongs to the account or to the device, and
  // therefore whether this sign-out has to close it.
  const { signOutClosesTheDiary } = useInstancePolicy();
  const session = useSyncSession();
  const { isOpen, phase } = useSignOutProgress();
  const isBusy = phase === 'running';
  // Once the sign-out has started, the session ending is its own doing. The
  // dialog stops asking the session anything: no new read (it would open the
  // database the erase is about to delete), no "syncing", no new key.
  const isFrozen = phase !== 'idle';
  // THE ACCOUNT, READ ONCE when the dialog opens. It is state and not
  // `session.account`, because the session is null by the time an erase fails.
  const [openedFor, setOpenedFor] = useState<{ accountId: number | null } | null>(null);
  if (isOpen && openedFor === null) setOpenedFor({ accountId: session.account?.id ?? null });
  const accountId = openedFor?.accountId ?? null;
  const isSyncing = !isFrozen && session.phase === 'syncing';
  // THE NOTICE THE PERSON SAW WHEN THEY TICKED, and the tick itself: a box is
  // ticked exactly when this holds lines. One state, so the box and the erase
  // it asks for cannot disagree. Cleared on untick and on close.
  const [frozenNotice, setFrozenNotice] = useState<EraseNoticeLine[] | null>(null);
  const eraseDevice = frozenNotice !== null;
  const [keyedRead, setKeyedRead] = useState<KeyedRead | null>(null);
  // Whether the erase failed. The sentence is fixed, so a flag is all it takes.
  const [hasEraseFailed, setHasEraseFailed] = useState(false);

  // WHICH MOMENT A READ DESCRIBES: this account, as of its last completed
  // cycle. A cycle that lands while the dialog is open moves the baseline, and
  // a read from before it is then a statement about a device that no longer
  // exists, so it is not shown; the line says "checking" until the next one.
  const readKey = `${accountId ?? 'none'}:${session.lastSyncedAt ?? 'never'}`;
  // Frozen, the last read stands whatever the key says: the session going null
  // moves the key, and a sign-out in flight must not flip the line to "checking".
  const isCurrentRead = isFrozen || keyedRead?.key === readKey;
  const unsentRead: UnsentRead = isCurrentRead && keyedRead !== null ? keyedRead.read : { status: 'pending' };
  const noticeLines = resolveEraseNotice({ read: unsentRead, isSyncing, hasSession: accountId !== null });
  // THE BOX WAITS FOR AN ANSWER, any answer: a finished read, a failed one, or
  // no session at all. Ticking it shows the lines, and the first paint of the
  // region must not be "checking". Once ticked it stays operable, or a sync
  // starting under an open dialog would lock the person into an erase.
  const isNoticeSettled = isEraseNoticeSettled(noticeLines);

  // Read only while the dialog is open. This is a genuine external read with a
  // lifetime, not derived state: it reads IndexedDB, and doing so when the menu
  // merely renders would open two databases on every page.
  //
  // NOT DURING A CYCLE. The cycle's commit is about to move the baseline, so
  // the effect waits for it to settle and reads then; `isSyncing` in the deps
  // is what brings it back.
  useEffect(() => {
    if (!isOpen || isFrozen || accountId === null || isSyncing) return;
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
  }, [isOpen, isFrozen, accountId, isSyncing, readKey]);

  async function handleSignOut(): Promise<void> {
    setHasEraseFailed(false);
    setSignOutPhase('running');
    try {
      // THE SAME TWO FACTS decide what happens and where the person lands, so
      // the request is built once and both read it.
      const request = { eraseDevice, locksDevice: signOutClosesTheDiary };
      await runSignOut(request, defaultSignOutSteps({ destination: signOutDestination(request) }));
    } catch (caught) {
      // Reached only when an opted-in erase failed, which in practice means a
      // second tab is holding the database. The session is already closed and
      // the device already locked by then, so this reports the erase and not
      // the sign-out. This component is still mounted to say so: it lives in
      // the root, not under the session.
      // ALWAYS THE ONE FIXED SENTENCE. The box for it is reserved from the tick,
      // and a free message would not be known to fit; the cause is logged.
      log.error('the erase on sign-out failed', {
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setHasEraseFailed(true);
      setSignOutPhase('failed');
    }
  }

  function handleEraseChange(isTicked: boolean): void {
    // The freeze starts here. The error belongs to the tick it came from, so an
    // untick takes it away with the region.
    setHasEraseFailed(false);
    setFrozenNotice(isTicked ? noticeLines : null);
  }

  function handleClose(): void {
    // A running sign-out cannot be closed: its error would have nowhere to go.
    // Escape and the overlay both end here.
    if (isSignOutRunning()) return;
    setSignOutPhase('idle');
    closeSignOutDialog();
    // Reopening starts from unchecked. A box that remembered a tick from a
    // dialog somebody cancelled is a wipe nobody asked for twice.
    setFrozenNotice(null);
    setHasEraseFailed(false);
    // And from no read. A read kept from the last opening would be shown
    // for a moment on the next one, about a device that may have changed
    // since. And from no account: the next opening reads it again.
    setKeyedRead(null);
    setOpenedFor(null);
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        // Opening is the doors' act (`openSignOutDialog`); this only ever closes.
        if (!next) handleClose();
      }}
    >
      {/* ANCHORED AT THE TOP: the erase region grows below the box a person
          ticked, and a centred dialog would move its own title when it did.
          Both `top` and `translate-y` replace the base component's centring;
          `sign-out-dialog-moves-nothing.spec.ts` reads the computed styles. */}
      <AlertDialogContent className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:top-[10vh]">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('signOut.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {signOutClosesTheDiary ? t('signOut.bodyManaged') : t('signOut.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-2.5 border border-border p-3">
          {/* Unticked on every open. Erasing is a second act inside this one,
              and it is the person's act. Drawn from the first paint and
              disabled until the read has an answer: a disabled box moves
              nothing. */}
          <input
            id={ERASE_FIELD_ID}
            type="checkbox"
            checked={eraseDevice}
            onChange={(event) => handleEraseChange(event.target.checked)}
            disabled={isBusy || (!eraseDevice && !isNoticeSettled)}
            aria-describedby={eraseDevice ? ERASE_REGION_ID : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 border-input accent-primary"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={ERASE_FIELD_ID} className="text-sm font-normal leading-relaxed">
              {t('signOut.erase.label')}
            </Label>
            {/* THE ERASE REGION, mounted by the tick and by nothing else. One
                grid cell, two layers: the notice and the error sentence. The
                layer that is not showing is `invisible`, `inert` and
                `aria-hidden`, and the cell keeps the taller one's height, so a
                failed erase moves nothing. */}
            {frozenNotice !== null && (
              <div id={ERASE_REGION_ID} data-slot="erase-region" className="grid">
                <p
                  data-slot="erase-notice"
                  className={cn(
                    '[grid-area:1/1] text-xs leading-relaxed text-muted-foreground',
                    hasEraseFailed && 'invisible',
                  )}
                  inert={hasEraseFailed}
                  aria-hidden={hasEraseFailed || undefined}
                >
                  {/* One paragraph of sentences, so the spaces are text, not margin. */}
                  {frozenNotice.map((line, index) => (
                    <Fragment key={line.kind}>
                      {index > 0 && ' '}
                      <EraseNoticeText line={line} />
                    </Fragment>
                  ))}
                </p>
                <p
                  data-slot="sign-out-error"
                  role="alert"
                  className={cn(
                    '[grid-area:1/1] text-sm leading-relaxed text-destructive',
                    !hasEraseFailed && 'invisible',
                  )}
                  inert={!hasEraseFailed}
                  aria-hidden={!hasEraseFailed || undefined}
                >
                  {t('signOut.eraseFailed')}
                </p>
              </div>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('confirm.cancel')}</AlertDialogCancel>
          {/* NOT `destructive`. Signing out gives the account back its diary;
              it does not take anything away, and the erase beside it is opt-in
              and labelled for what it does. */}
          <Button type="button" onClick={() => void handleSignOut()} disabled={isBusy}>
            {/* ALWAYS DRAWN, `invisible` when idle, so the button keeps its
                width when the sign-out starts. */}
            <Loader2 className={cn('animate-spin', isBusy ? 'visible' : 'invisible')} />
            {t('signOut.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
