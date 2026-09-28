import { useTranslation } from 'react-i18next';

import { InviteOnlyDialog } from '#app/components/invite-only-dialog';
import { Link } from '#app/components/link';
import { Button, buttonVariants } from '#app/components/ui/button';
import { useServerInstanceRead } from '#app/hooks/use-server-instance';
import { hasOpenSignup } from '#app/lib/plans/signup-door';
import { cn } from '#app/lib/utils';

/** Where the sign-up form lives. One constant, because the header and the welcome screen both link it. */
export const SIGN_UP_PATH = '/sign-up';

/** The muted, unfilled look both doors share. Teal carries CTAs (DESIGN.md §1), and this is the secondary one. */
const DOOR_CLASS = 'h-10 px-3 text-muted-foreground';

/** Which door the handshake leaves open. `unknown` until it has answered. */
type Door = 'unknown' | 'invite-only' | 'sign-up';

/**
 * THE WAY IN FOR A VISITOR WITH NO ACCOUNT, beside "Sign in" on a managed
 * instance (M253/02, absorbing M250/11).
 *
 * Two instances, two true answers. An instance with open sign-up takes an
 * address and mails a letter, so the control says "Sign up" and goes to the
 * form. An invite-only instance creates nothing for a stranger, so the control
 * keeps M201/03's label and dialog, which say so before the click.
 *
 * ── Nothing until the handshake has answered ────────────────────────────
 *
 * The server renders no handshake, so the first paint cannot know which of
 * the two is true. Drawing the invite dialog meanwhile would put "invite-only"
 * on an instance whose sign-up is open, which is the owner's report. So no
 * door is drawn until the read settles.
 *
 * ── Its box is there from the first paint ────────────────────────────────
 *
 * The invite label is drawn INVISIBLE in one grid cell, so the slot has its
 * width before anything is known, and the real control is drawn into the same
 * cell, hugging sign in. Neither the header row nor sign in moves when the
 * door arrives (`tests/e2e/open-signup.spec.ts` reads a layout-shift total of
 * 0). It is the LONGER of the two labels ("Request access" against "Sign up",
 * and so in every language this app ships), and the one
 * `tests/e2e/landing-fits-a-phone.spec.ts` already proves fits a 360 px phone
 * in all six. Only that label is reserved: a hidden "Sign up" in the markup of
 * an invite-only instance would still be a claim in the served page
 * (`tests/unit/landing-doors.test.ts`).
 */
export function AccountDoor() {
  const { t } = useTranslation();
  const door = useDoor();
  const reserved = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), DOOR_CLASS, 'invisible');

  return (
    <span data-slot="account-door" className="grid justify-items-end [&>*]:col-start-1 [&>*]:row-start-1">
      <span aria-hidden="true" className={reserved}>
        {t('chrome.requestAccess')}
      </span>
      {door === 'invite-only' && <InviteOnlyDialog />}
      {door === 'sign-up' && (
        <Button asChild variant="ghost" size="sm" className={DOOR_CLASS}>
          <Link to={SIGN_UP_PATH}>{t('chrome.signUp')}</Link>
        </Button>
      )}
    </span>
  );
}

/** The door the handshake leaves open, and nothing while it is unread. */
function useDoor(): Door {
  const { isSettled, instance } = useServerInstanceRead();
  if (!isSettled) return 'unknown';
  return hasOpenSignup(instance) ? 'sign-up' : 'invite-only';
}
