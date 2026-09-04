/**
 * The invitations that are still waiting.
 *
 * ── Only `pending` is listed, and that is the whole filter ───────────────
 *
 * The service returns every invitation it has ever minted, in four states. A
 * redeemed one is now a person and appears in the list above; a revoked or
 * expired one is a thing that did not happen. Showing all four would make the
 * useful list, "who have I invited who has not arrived yet", the hardest one
 * to read.
 *
 * ── Sending again mints a NEW link ───────────────────────────────────────
 *
 * The button says "send again" because that is what the administrator wants,
 * but the old link stops working. That is the right behaviour rather than an
 * unfortunate one: a resend happens when the first link went somewhere it
 * should not have, or to a mailbox that never got it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { ConfirmButton } from './people-table';
import type { InviteView } from '#app/lib/admin/admin-wire';

export interface InviteTableProps {
  invites: InviteView[];
  onResend: (input: { id: number }) => Promise<void>;
  onRevoke: (input: { id: number }) => Promise<void>;
}

export function InviteTable({ invites, onResend, onRevoke }: InviteTableProps) {
  const { t } = useTranslation();
  const pending = invites.filter((invite) => invite.status === 'pending');

  if (pending.length === 0) return <p className="text-sm text-muted-foreground">{t('admin.invites.empty')}</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {pending.map((invite) => (
        <InviteRow key={invite.id} invite={invite} onResend={onResend} onRevoke={onRevoke} />
      ))}
    </ul>
  );
}

function InviteRow({
  invite,
  onResend,
  onRevoke,
}: {
  invite: InviteView;
  onResend: (input: { id: number }) => Promise<void>;
  onRevoke: (input: { id: number }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t('admin.invites.failed'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{invite.email}</p>
          <p className="truncate text-sm text-muted-foreground">
            {invite.displayName ?? t('admin.noName')}
            {' · '}
            {t('admin.invites.expires', { date: new Date(invite.expiresAt).toLocaleDateString() })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
            {invite.role === 'admin' ? t('admin.role.admin') : t('admin.role.standard')}
          </Badge>
          <Badge variant="outline">
            {invite.dailyAiLimit === 0 ?
              t('admin.usageNone')
            : t('admin.usage', { used: 0, limit: invite.dailyAiLimit })}
          </Badge>
        </div>
      </div>

      {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => void run(() => onResend({ id: invite.id }))}
        >
          {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('admin.invites.resend')}
        </Button>
        <ConfirmButton
          label={t('admin.invites.revoke')}
          title={t('admin.invites.revokeConfirmTitle', { email: invite.email })}
          body={t('admin.invites.revokeConfirmBody')}
          confirmLabel={t('admin.invites.revokeConfirmCta')}
          isBusy={isBusy}
          onConfirm={() => void run(() => onRevoke({ id: invite.id }))}
        />
      </div>
    </li>
  );
}
