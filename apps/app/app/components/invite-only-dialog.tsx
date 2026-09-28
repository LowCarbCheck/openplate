import { useTranslation } from 'react-i18next';
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

/**
 * THE ANSWER FOR A VISITOR WITH NO INVITE, on a managed instance (M201/03).
 *
 * ── Why the label is not "sign up" ───────────────────────────────────────
 *
 * A managed instance is invite-only. "Sign up" promises a form that does not
 * exist and cannot be built here, so the click is a dead end however polite
 * the screen behind it is, and a control that always dead-ends costs trust.
 * The affordance is still wanted, because a visitor with no invite has a real
 * question and the front page answered it nowhere. So the affordance stays and
 * the LABEL tells the truth before the click rather than after it: this asks
 * the operator for access, it does not create anything.
 *
 * ── Why it collects no address ───────────────────────────────────────────
 *
 * A field here would start a data collection with no notice covering it: the
 * privacy copy this instance renders says nothing about addresses left by
 * people who are not accounts, and the sync server has nowhere to put one. So
 * the dialog states the rule and names who can act on it, and the person
 * carries the request over a channel they already have with that operator.
 * `tests/unit/public-header-doors.test.ts` reads this file and fails if a
 * field ever appears in it.
 *
 * ── Why `alert-dialog` ───────────────────────────────────────────────────
 *
 * It is the app's one modal primitive (DESIGN.md §7, and the house pattern is
 * `confirm-action.tsx`). A second modal library for a four-line message would
 * be two sets of focus-trap and escape-key behaviour to keep in step.
 *
 * Uncontrolled on purpose: there is nothing to submit and nothing to settle,
 * so the only transition is open and closed, and Radix already owns that.
 * `confirm-action.tsx` holds state because it has to close itself when a
 * fetcher lands; this has no fetcher.
 */
export function InviteOnlyDialog() {
  const { t } = useTranslation();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {/* Muted and unfilled, beside the sign-in button: teal carries CTAs
            (DESIGN.md §1) and this is the secondary of the two. `h-10`
            overrides the `sm` size's 32px box for the same reason the button
            next to it does, since both have to be tappable on a phone. */}
        <Button variant="ghost" size="sm" className="h-10 px-3 text-muted-foreground">
          {t('chrome.requestAccess')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('chrome.requestAccessTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('chrome.requestAccessBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* One button, and it is the Cancel rather than the Action: closing
              is the only thing this dialog can do, and Radix gives Cancel the
              escape key and the initial focus. */}
          <AlertDialogCancel>{t('chrome.requestAccessClose')}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
