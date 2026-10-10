/**
 * The invitations, behind chips that carry their counts.
 *
 * ── Every state is reachable, and pending is where you land ──────────────
 *
 * The service returns every invitation it has ever minted, in four states.
 * This list used to show only the pending ones, on the argument that a
 * redeemed invitation is a person and a revoked or expired one is a thing that
 * did not happen, so showing all four made the useful list ("who have I invited
 * who has not arrived yet") the hardest one to read. The operator reversed that
 * on 2026-10-11: the question "what happened to the invitation I sent last
 * week" is as real as the first one, and it had no answer on screen. So there
 * is a chip each for Pending (the default), Expired, Revoked and Accepted, and
 * All, with the count each would show. Newest first in every one.
 * `invite-filter.ts` holds the rules and `admin.invitations.tsx` keeps the
 * choice in the address (`?status=`).
 *
 * ── What a row says ──────────────────────────────────────────────────────
 *
 * When it was sent, the daily photo limit it grants, and for a pending one how
 * long it has left, in amber once that is under three days. An expired one
 * says when it ended. Withdrawn and accepted ones say nothing about expiry,
 * because there is nothing left to expire.
 *
 * ── Only a pending one can be withdrawn; an expired one can be sent again ─
 *
 * The service re-issues any invitation that is not accepted and not withdrawn,
 * and an expired one is exactly the case "they never got round to it". It keeps
 * its address unless the retention sweep already scrubbed it, in which case
 * there is nobody to send to and the button is not offered.
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

import { SentWhen } from '#app/components/admin/day-age';
import { FilterChips, type FilterChip } from '#app/components/admin/filter-chips';
import { Badge } from '#app/components/ui/badge';
import { Button } from '#app/components/ui/button';
import { ConfirmButton } from './person-actions';
import type { InviteStatus, InviteView } from '#app/lib/admin/admin-wire';
import { formatShortDate } from '#app/lib/admin/people-age';
import {
  countInvites,
  inviteExpiry,
  INVITE_STATUS_FILTERS,
  selectInvites,
  type InviteStatusFilter,
} from '#app/lib/admin/invite-filter';

export interface InviteTableProps {
  invites: InviteView[];
  /** Which chip is pressed. The route keeps it in the address. */
  status: InviteStatusFilter;
  onStatusChange: (next: InviteStatusFilter) => void;
  /** The clock every age and every "expires in" is measured against. A parameter, so a render is reproducible. */
  now: Date;
  onResend: (input: { id: number }) => Promise<void>;
  onRevoke: (input: { id: number }) => Promise<void>;
}

/** The copy key for each chip. */
const STATUS_LABEL_KEY = {
  pending: 'admin.invites.status.pending',
  expired: 'admin.invites.status.expired',
  revoked: 'admin.invites.status.revoked',
  redeemed: 'admin.invites.status.redeemed',
  all: 'admin.invites.status.all',
} satisfies Record<InviteStatusFilter, string>;

/** What an empty chip says. Pending keeps the sentence this list always had. */
const EMPTY_KEY = {
  pending: 'admin.invites.empty',
  expired: 'admin.invites.emptyFor.expired',
  revoked: 'admin.invites.emptyFor.revoked',
  redeemed: 'admin.invites.emptyFor.redeemed',
  all: 'admin.invites.emptyFor.all',
} satisfies Record<InviteStatusFilter, string>;

export function InviteTable({ invites, status, onStatusChange, now, onResend, onRevoke }: InviteTableProps) {
  const { t } = useTranslation();
  const counts = countInvites(invites);
  const shown = selectInvites({ invites, status });
  const chips: FilterChip<InviteStatusFilter>[] = INVITE_STATUS_FILTERS.map((id) => ({
    id,
    label: t(STATUS_LABEL_KEY[id]),
    count: counts[id],
  }));

  return (
    <div className="space-y-3">
      <FilterChips groupLabel={t('admin.invites.statusLabel')} chips={chips} value={status} onChange={onStatusChange} />
      {/* ONE LINE, ALWAYS, like the people list's result line. */}
      <div className="flex min-h-9 items-center text-xs text-muted-foreground">
        <output className="tabular-nums">{t('admin.invites.result', { count: shown.length })}</output>
      </div>
      {shown.length === 0 ?
        <p className="text-sm text-muted-foreground">{t(EMPTY_KEY[status])}</p>
      : <ul className="divide-y border">
          {shown.map((invite) => (
            <InviteRow key={invite.id} invite={invite} now={now} onResend={onResend} onRevoke={onRevoke} />
          ))}
        </ul>
      }
    </div>
  );
}

/** The copy key for a row's status badge. */
const BADGE_KEY = {
  pending: 'admin.invites.status.pending',
  expired: 'admin.invites.status.expired',
  revoked: 'admin.invites.status.revoked',
  redeemed: 'admin.invites.status.redeemed',
} satisfies Record<InviteStatus, string>;

function InviteRow({
  invite,
  now,
  onResend,
  onRevoke,
}: {
  invite: InviteView;
  now: Date;
  onResend: (input: { id: number }) => Promise<void>;
  onRevoke: (input: { id: number }) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiry = inviteExpiry({ invite, now });
  // A resend needs somebody to send to. An address the retention sweep erased
  // is an empty string, and the service would answer 404.
  const hasAddress = invite.email !== '';
  const canResend = (invite.status === 'pending' || invite.status === 'expired') && hasAddress;
  const canRevoke = invite.status === 'pending';

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
    <li className="space-y-3 p-4" data-invite-status={invite.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <span className="truncate">{hasAddress ? invite.email : t('admin.invites.addressErased')}</span>
            <Badge variant="outline" className={invite.status === 'pending' ? 'border-primary/60 text-primary' : ''}>
              {t(BADGE_KEY[invite.status])}
            </Badge>
          </p>
          <p className="truncate text-sm text-muted-foreground">{invite.displayName ?? t('admin.noName')}</p>
          <p className="text-sm text-muted-foreground">
            <SentWhen iso={invite.createdAt} now={now} />
            {' · '}
            {invite.dailyAiLimit === 0 ?
              t('admin.usageNone')
            : t('admin.invites.perDay', { count: invite.dailyAiLimit })}
            {expiry.kind === 'in-days' && (
              <>
                {' · '}
                <span className={expiry.isSoon ? 'text-accent-amber' : undefined} data-expires-soon={expiry.isSoon}>
                  {expiry.days === 0 ?
                    t('admin.invites.expiresToday')
                  : t('admin.invites.expiresIn', { count: expiry.days })}
                </span>
              </>
            )}
            {expiry.kind === 'ended' && (
              <>
                {' · '}
                {t('admin.invites.expiredOn', {
                  date: formatShortDate({ iso: expiry.iso, now, language: i18n.language }),
                })}
              </>
            )}
          </p>
        </div>
        <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
          {invite.role === 'admin' ? t('admin.role.admin') : t('admin.role.standard')}
        </Badge>
      </div>

      {error !== null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {(canResend || canRevoke) && (
        <div className="flex flex-wrap gap-2">
          {canResend && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="relative"
              disabled={isBusy}
              onClick={() => void run(() => onResend({ id: invite.id }))}
            >
              {/* THE LABEL KEEPS THE BUTTON'S WIDTH WHILE BUSY, and the spinner is
                  drawn over it. A spinner beside the label widened the button and
                  pushed "Withdraw" 22 px sideways. `opacity-0`, not `invisible`, so
                  the button keeps its name for a screen reader. */}
              <span className={isBusy ? 'opacity-0' : undefined}>{t('admin.invites.resend')}</span>
              {isBusy && <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin" aria-hidden="true" />}
            </Button>
          )}
          {canRevoke && (
            <ConfirmButton
              label={t('admin.invites.revoke')}
              title={t('admin.invites.revokeConfirmTitle', { email: invite.email })}
              body={t('admin.invites.revokeConfirmBody')}
              confirmLabel={t('admin.invites.revokeConfirmCta')}
              isBusy={isBusy}
              onConfirm={() => void run(() => onRevoke({ id: invite.id }))}
            />
          )}
        </div>
      )}
    </li>
  );
}
