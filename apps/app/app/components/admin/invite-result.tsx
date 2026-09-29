/**
 * What an administrator sees after an invitation is created, in the two cases
 * that are genuinely different.
 *
 * ── Mail sent: say who, and stop ─────────────────────────────────────────
 *
 * The link exists in exactly one place, their mailbox, and that is the whole
 * point of a configured instance. Showing it here as well would put a working
 * capability into a screenshot, a support chat, and a browser history for no
 * gain.
 *
 * ── No mail: show the link, and say what it is ───────────────────────────
 *
 * An instance without mail must still produce a usable invitation, or an
 * operator who has not set up mail cannot onboard anybody. The one sentence
 * that has to be there is what the link IS: whoever holds it opens that
 * account. An administrator who reads it as a convenience will paste it into a
 * group chat.
 *
 * ── A link that opens another address says so ────────────────────────────
 *
 * The core builds the link from its own settings, and the compose files fall
 * back to `http://localhost:3000` when `PUBLIC_APP_URL` is unset. A link like
 * that opens only on the server. The administrator is using the address the
 * family uses, so a link whose origin is not this page's gets one line under
 * it that names the address and the two settings to change.
 *
 * The same line covers the link's other half: a link on the right address whose
 * `server=` names this machine or plain http opens the right page and then
 * cannot reach the sync server, so the line names that server and
 * `PUBLIC_SYNC_URL` instead. See `lib/admin/link-delivery.ts`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, MailCheck } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { usePageOrigin } from '#app/hooks/use-page-origin';
import type { Delivery } from '#app/lib/admin/admin-wire';
import { linkWarning } from '#app/lib/admin/link-delivery';

/**
 * The one button under the result: the next invitation, on the invite page, or
 * the way back to the list a resend came from, on the invitations tab.
 */
export type InviteResultNext =
  { kind: 'invite-another'; onClick: () => void } | { kind: 'back-to-list'; onClick: () => void };

export interface InviteResultProps {
  email: string;
  delivery: Delivery;
  next: InviteResultNext;
}

export function InviteResult({ email, delivery, next }: InviteResultProps) {
  const { t } = useTranslation();
  const emailed = delivery.emailed && delivery.link === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          {emailed ? t('admin.invite.sentTitle', { email }) : t('admin.invite.linkTitle', { email })}
        </CardTitle>
        <CardDescription>{emailed ? t('admin.invite.sentBody') : t('admin.invite.linkBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {delivery.link !== null && <CopyableLink link={delivery.link} />}
        <Button type="button" variant="outline" className="h-11" onClick={next.onClick}>
          {next.kind === 'invite-another' ? t('admin.invite.again') : t('admin.invite.back')}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The link, readable and copyable. Exported because a reset link needs the
 * same treatment on the console.
 *
 * Shown in full rather than behind a button alone: a clipboard write can fail
 * silently in a browser that refuses it, and an administrator who cannot see
 * what they are about to send has no way to tell.
 *
 * Reads the page's origin here, so both screens that hand out a link get the
 * warning in {@link CopyableLinkView} without asking for it.
 */
export function CopyableLink({ link }: { link: string }) {
  return <CopyableLinkView link={link} pageOrigin={usePageOrigin()} />;
}

export interface CopyableLinkViewProps {
  link: string;
  /** `location.origin`, or `null` before hydration, when no warning is drawn. */
  pageOrigin: string | null;
}

/**
 * The link, the warning line when it opens another address than this page,
 * and the copy button.
 *
 * ── The warning is drawn with the link, never after it ───────────────────
 *
 * Both callers mount this in the commit that puts the link on screen, after
 * hydration, so `pageOrigin` is already the browser's answer in that first
 * render (see `usePageOrigin`). The line therefore arrives with the link and
 * the copy button is drawn below it from the start: nothing moves once it is
 * on screen. A `useEffect` that set the origin a frame later would push the
 * button down under a finger aiming at it.
 *
 * Presentational, so the unit tier can render it with either origin.
 */
export function CopyableLinkView({ link, pageOrigin }: CopyableLinkViewProps) {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);
  const warning = linkWarning({ link, pageOrigin });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setIsCopied(true);
    } catch {
      // The link is on screen and selectable, so a refused clipboard costs a
      // manual selection rather than the invitation.
      setIsCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="break-all border bg-muted/30 p-3 font-mono text-xs">{link}</p>
      {warning !== null && (
        <p data-slot="link-origin-warning" className="flex items-start gap-2 text-sm text-accent-amber">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {warning.kind === 'other-origin' ?
              t('admin.link.otherAddress', { origin: warning.origin })
            : t('admin.link.syncAddress', { server: warning.server })}
          </span>
        </p>
      )}
      <Button type="button" variant="outline" className="h-11" onClick={() => void copy()}>
        {isCopied ?
          <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />}
        {isCopied ? t('admin.invite.linkCopied') : t('admin.invite.linkCopy')}
      </Button>
    </div>
  );
}
