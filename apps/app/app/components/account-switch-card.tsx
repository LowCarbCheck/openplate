/**
 * The step a second account meets on a device that holds another account's
 * diary (ADR-0023).
 *
 * ── What it says, and what it offers ─────────────────────────────────────
 *
 * Whose diary this is (by address when the lock knows it), what an erase would
 * lose (the sign-out dialog's own lines, read for the owner before this card
 * is drawn), and the owner's other way: sign in with the account that signed
 * out. One action erases the held diary and continues as the incoming
 * account; the other leaves everything as it was. There is no third, and in
 * particular no "keep it": a diary the next session kept would be pushed into
 * the next account on its first cycle.
 *
 * ── Nothing moves (DESIGN.md section 7) ──────────────────────────────────
 *
 * The caller hands over SETTLED lines (`readHeldDiaryNotice`), so the card is
 * drawn once with every sentence it will hold and no "checking" state. The
 * notice and the erase failure share one grid cell with two layers, the
 * inactive one `invisible`, `inert` and `aria-hidden`, so a failed erase moves
 * nothing. The spinner is always in the erase button, `invisible` when idle,
 * so the button keeps its width.
 *
 * ── Why the erase lives here ─────────────────────────────────────────────
 *
 * Every door (`/sign-in`, `/join`, `/reset`) ends the same way: erase, remember
 * the incoming address, load the next page as a new document. Only the next
 * page differs, so it is a prop, and the erase cannot be wired half at one door.
 */
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { EraseNoticeText } from '#app/components/erase-notice-text';
import { Button } from '#app/components/ui/button';
import { createComponentLogger } from '#app/lib/logger';
import { continueAsIncomingAccount, eraseDiaryAndReleaseLock } from '#app/lib/sync/account-switch';
import type { EraseNoticeLine } from '#app/lib/sync/erase-notice';
import type { DeviceLockOwner } from '#app/lib/sync/sync-state';
import { cn } from '#app/lib/utils';

const log = createComponentLogger('account-switch-card');

/** What the card needs to say and do. */
export interface AccountSwitchCardProps {
  /** Whose diary the device holds, or `null` when the lock cannot say. */
  owner: DeviceLockOwner | null;
  /** What an erase would lose, already settled. */
  lines: readonly EraseNoticeLine[];
  /** The address that is arriving; remembered for the page that loads next. */
  incomingEmail: string;
  /** The page loaded, as a new document, once the erase is done. */
  destination: string;
  /** `/reset` only: the link is spent and the old password still works. */
  isResetSpent?: boolean;
  /** Leaves everything as it was. */
  onCancel: () => void;
}

/** The account-switch step. Mount it in place of the form it answers, with its lines settled. */
export function AccountSwitchCard({
  owner,
  lines,
  incomingEmail,
  destination,
  isResetSpent = false,
  onCancel,
}: AccountSwitchCardProps) {
  const { t } = useTranslation();
  const [isErasing, setIsErasing] = useState(false);
  const [hasEraseFailed, setHasEraseFailed] = useState(false);
  const ownerEmail = owner?.email ?? null;

  async function handleErase(): Promise<void> {
    setIsErasing(true);
    setHasEraseFailed(false);
    try {
      await eraseDiaryAndReleaseLock({ accountId: owner?.accountId ?? null });
    } catch (cause) {
      // THE ONE FIXED SENTENCE, because the box reserved for it fits only
      // that. The real cause is logged; the lock is still set.
      log.warn('the held diary could not be erased', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      setHasEraseFailed(true);
      setIsErasing(false);
      return;
    }
    // The page is replaced by a document load from here, so nothing after
    // this line is ever drawn.
    continueAsIncomingAccount({ email: incomingEmail, destination });
  }

  return (
    <section data-slot="account-switch" data-owner-known={owner !== null} className="space-y-4">
      <h2 className="text-base font-semibold leading-snug">{t('accountSwitch.title')}</h2>
      <p className="text-sm leading-relaxed">
        {ownerEmail === null ? t('accountSwitch.bodyUnknown') : t('accountSwitch.body', { email: ownerEmail })}
      </p>
      <div data-slot="account-switch-region" className="grid">
        <p
          data-slot="account-switch-notice"
          className={cn('[grid-area:1/1] text-sm leading-relaxed text-muted-foreground', hasEraseFailed && 'invisible')}
          inert={hasEraseFailed}
          aria-hidden={hasEraseFailed || undefined}
        >
          {/* One paragraph of sentences, so the spaces are text, not margin. */}
          {lines.map((line, index) => (
            <Fragment key={line.kind}>
              {index > 0 && ' '}
              <EraseNoticeText line={line} />
            </Fragment>
          ))}
        </p>
        <p
          data-slot="account-switch-error"
          role="alert"
          className={cn('[grid-area:1/1] text-sm leading-relaxed text-destructive', !hasEraseFailed && 'invisible')}
          inert={!hasEraseFailed}
          aria-hidden={!hasEraseFailed || undefined}
        >
          {t('accountSwitch.eraseFailed')}
        </p>
      </div>
      {isResetSpent && (
        <p data-line="reset-spent" className="text-sm leading-relaxed">
          {t('accountSwitch.resetSpent')}
        </p>
      )}
      <p className="text-sm leading-relaxed text-muted-foreground">{t('accountSwitch.yours')}</p>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          data-slot="account-switch-erase"
          variant="destructive"
          className="h-11 w-full"
          disabled={isErasing}
          onClick={() => void handleErase()}
        >
          {/* ALWAYS DRAWN, `invisible` when idle, so the button keeps its width. */}
          <Loader2 className={cn('animate-spin', isErasing ? 'visible' : 'invisible')} aria-hidden="true" />
          {t('accountSwitch.erase')}
        </Button>
        <Button
          type="button"
          data-slot="account-switch-cancel"
          variant="ghost"
          className="h-11 w-full"
          disabled={isErasing}
          onClick={onCancel}
        >
          {t('confirm.cancel')}
        </Button>
      </div>
    </section>
  );
}
