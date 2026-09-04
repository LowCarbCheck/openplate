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
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, MailCheck } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { Delivery } from '#app/lib/admin/admin-wire';

export interface InviteResultProps {
  email: string;
  delivery: Delivery;
  onInviteAnother: () => void;
}

export function InviteResult({ email, delivery, onInviteAnother }: InviteResultProps) {
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
        <Button type="button" variant="outline" className="h-11" onClick={onInviteAnother}>
          {t('admin.invite.again')}
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
 */
export function CopyableLink({ link }: { link: string }) {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

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
      <p className="break-all rounded-lg border bg-muted/30 p-3 font-mono text-xs">{link}</p>
      <Button type="button" variant="outline" className="h-11" onClick={() => void copy()}>
        {isCopied ?
          <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />}
        {isCopied ? t('admin.invite.linkCopied') : t('admin.invite.linkCopy')}
      </Button>
    </div>
  );
}
