/**
 * The "your account was created, now open the email" toast.
 *
 * ── Why a toast on top of a screen that already says it ──────────────────
 *
 * On an instance running with `REQUIRE_EMAIL_VERIFICATION`, a successful
 * signup returns no session and no recovery code (`SyncSetupOutcome`). The
 * wizard swaps its form for a calm instruction panel — and that swap is the
 * whole of the feedback: the button the user pressed simply becomes different
 * text in the same box, several hundred pixels down a settings page they may
 * well have scrolled past. Read as an event, nothing announced that the
 * account had been created at all, so the first report of this flow was "I
 * signed up and got no confirmation". The toast is the announcement; the panel
 * remains the place the instruction lives.
 *
 * The copy is pure and exported separately from the side effect, so the exact
 * strings are pinned by a test rather than by watching a toast go by — the
 * same split `food-added-toast.ts` uses.
 */
import { toast as showToast } from 'sonner';

/** The i18next `t` shape this module needs, taken as an argument so the copy stays testable without a provider. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * One sonner id for the whole family. A retry after a failed attempt replaces
 * the previous toast in place instead of stacking a second copy of an
 * announcement that is only true once.
 */
export const SYNC_SIGNUP_TOAST_ID = 'sync-signup';

/** What the toast says: a lead that reports the event, and a line that names the next move. */
export interface SyncSignupToastCopy {
  /** The headline — the account now exists. */
  title: string;
  /** The instruction, carrying the address the mail went to. */
  description: string;
}

/**
 * Builds the copy for a signup that succeeded and is waiting on the address.
 *
 * @param t - translation lookup.
 * @param email - the address the confirmation mail was sent to. Rendered, so it is the user's own typed value.
 * @returns the toast's two lines, already translated.
 */
export function syncSignupPendingToastCopy(t: Translate, email: string): SyncSignupToastCopy {
  return {
    title: t('sync.setup.awaitingVerification.toastTitle'),
    description: t('sync.setup.awaitingVerification.toastBody', { email }),
  };
}

/**
 * Fires the toast for a signup that succeeded and is waiting on the address.
 *
 * A SUCCESS toast deliberately: nothing failed and nothing was lost, and the
 * account really was created. Styling this as a warning because a step remains
 * would read as "something went wrong", which is the exact misreading the
 * `awaiting-email-verification` outcome exists to prevent.
 */
export function showSyncSignupPendingToast(t: Translate, email: string): void {
  const { title, description } = syncSignupPendingToastCopy(t, email);
  showToast.success(title, { id: SYNC_SIGNUP_TOAST_ID, description });
}
