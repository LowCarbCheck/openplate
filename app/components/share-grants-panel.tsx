/**
 * The patient's list of live grants, and the revoke control.
 *
 * ── Two rules this component exists to keep ──────────────────────────────
 *
 * 1. **An unpinned peer is never rendered as though it were verified.** The
 *    owner-private compartment merges whole at one Lamport stamp, so two
 *    devices pinning different peers at once means one compartment wins and
 *    the other's pin is lost. When that happens the row says so, shows NO
 *    fingerprint (there is no key here to compute one from), and offers the
 *    ceremony again. A silently absent pin is how somebody shares to an
 *    unverified key believing they verified it.
 *
 * 2. **The revoke copy promises the server-side cutoff and states the
 *    device-side residue.** ADR-0002 prohibition 7: no phrasing may claim
 *    retroactive effect. Revocation controls the future; it cannot repossess
 *    the past, and pretending otherwise would be the only actual lie in this
 *    protocol. The wording lives in the catalog and is asserted by tests, so
 *    "tightening the copy" cannot quietly turn it into a claim.
 */
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';

import { Button } from '#app/components/ui/button';
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
import type { ShareGrantStatus, ShareGrantView } from '#app/lib/sync/sharing';

/** Icon and copy keys per status. Frozen as one map so a new status cannot be added without deciding how it reads. */
const STATUS_PRESENTATION = {
  verified: { key: 'sharing.grants.verified', helpKey: 'sharing.grants.verifiedHelp' },
  unpinned: { key: 'sharing.grants.unpinned', helpKey: 'sharing.grants.unpinnedHelp' },
  'key-changed': { key: 'sharing.grants.keyChanged', helpKey: 'sharing.grants.keyChangedHelp' },
} as const satisfies Record<ShareGrantStatus, { key: string; helpKey: string }>;

function StatusIcon({ status }: { status: ShareGrantStatus }) {
  if (status === 'verified') return <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />;
  if (status === 'unpinned') return <ShieldAlert className="h-4 w-4 text-accent-amber" aria-hidden="true" />;
  return <ShieldX className="h-4 w-4 text-destructive" aria-hidden="true" />;
}

export function ShareGrantsPanel({
  grants,
  onRevoke,
  busyAccountId,
}: {
  grants: readonly ShareGrantView[];
  onRevoke: (granteeAccountId: number) => void;
  /** The row whose revoke is in flight, so only that one's control is disabled. */
  busyAccountId: number | null;
}) {
  const { t } = useTranslation();

  if (grants.length === 0) return <p className="text-sm text-muted-foreground">{t('sharing.grants.empty')}</p>;

  return (
    <ul className="space-y-3">
      {grants.map((grant) => {
        const presentation = STATUS_PRESENTATION[grant.status];
        const name = grant.label ?? t('sharing.grants.unnamed', { accountId: grant.granteeAccountId });
        return (
          <li key={grant.granteeAccountId} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{name}</p>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusIcon status={grant.status} />
                  {/* The fingerprint shown is computed on this device from the
                      pinned key's own bytes — never the server's copy of the
                      string, which is exactly what a substitution would edit. */}
                  {grant.pinnedFingerprintDisplay === null ?
                    t(presentation.key)
                  : t(presentation.key, { fingerprint: grant.pinnedFingerprintDisplay })}
                </p>
                <p className="text-xs text-muted-foreground">{t(presentation.helpKey)}</p>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={busyAccountId === grant.granteeAccountId}>
                    {t('sharing.grants.revoke')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('sharing.grants.revokeConfirmTitle', { name })}</AlertDialogTitle>
                    {/* Both halves, always: the cutoff AND the residue. */}
                    <AlertDialogDescription>
                      {t('sharing.grants.revokeConfirmCutoff', { name })} {t('sharing.grants.revokeConfirmResidue')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('sharing.cancel')}</AlertDialogCancel>
                    <Button variant="destructive" onClick={() => onRevoke(grant.granteeAccountId)}>
                      {t('sharing.grants.revokeConfirmCta')}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
