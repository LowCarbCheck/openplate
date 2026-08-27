/**
 * `/settings/sharing` — the patient's grant, verify and revoke surface, plus
 * the Tier 2 rotation that is what actually defends the future.
 *
 * ── This route does not exist when sync is off ────────────────────────────
 *
 * The loader 404s when `SYNC_SERVER_URL` is unset, exactly as
 * `settings.sync.tsx` does: a share is a third wrap of the sync DEK, so on an
 * instance with no sync there is nothing here to be a page about.
 *
 * ── And it degrades honestly when the SERVER has sharing off ─────────────
 *
 * `SYNC_SHARING` unset makes every share path answer the ordinary
 * unknown-route 404, to everybody (ADR-0002 prohibition 10). The client reads
 * that as `unavailable` — not as an error — and this page says so in one
 * sentence instead of rendering a broken form. Sharing ships dark, so that is
 * the state every existing deployment is in today.
 *
 * ── Everything below is client-side ──────────────────────────────────────
 *
 * The loader returns one string. The ceremony, the wrap, the rotation and
 * every request to the sync service happen in the browser and never touch this
 * server — the property the whole design rests on.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { KeyRound, Loader2, Share2 } from 'lucide-react';

import { CONFIG } from '#app/config';
import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ShareGrantsPanel } from '#app/components/share-grants-panel';
import { ShareVerifyStep, type ShareInviteDraft } from '#app/components/share-verify-step';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
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
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import {
  grantShare,
  loadShareGrants,
  planDekRotation,
  revokeShare,
  rotateSyncDek,
  type RotateDekOutcome,
} from '#app/lib/sync/share-actions';
import type { RotationDrop, ShareCeremonyResult, ShareGrantView } from '#app/lib/sync/sharing';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.sharing') }];

export const handle = {
  titleKey: 'sharing.title',
  title: 'Sharing',
  backTo: '/settings',
};

/** @throws a 404 Response on an instance with no sync server configured. */
export function loader() {
  if (CONFIG.sync.syncServerUrl === null) throw new Response('Not Found', { status: 404 });
  return { sharingRouteEnabled: true };
}

/** What the page knows about the server's share surface right now. */
type GrantsState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'ready'; grants: ShareGrantView[] };

export default function SettingsSharing() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const [state, setState] = useState<GrantsState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    if (session.account === null) {
      setState({ status: 'signed-out' });
      return;
    }
    const grants = await loadShareGrants();
    setState(grants.status === 'unavailable' ? { status: 'unavailable' } : { status: 'ready', grants: grants.value });
  }, [session.account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sharing.title')}
          </CardTitle>
          <CardDescription>{t('sharing.intro')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'signed-out' && <SignedOutNotice />}
          {state.status === 'unavailable' && <UnavailableNotice />}
          {state.status === 'ready' && <GrantsSection grants={state.grants} onChanged={() => void refresh()} />}
        </CardContent>
      </Card>

      {state.status === 'ready' && <RotationCard onRotated={() => void refresh()} />}
    </div>
  );
}

/** Sharing needs the DEK, and the DEK needs an unlocked session. Nothing here works signed out, and saying so beats a dead form. */
function SignedOutNotice() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('sharing.needsSession')}</p>
      <Button asChild variant="outline" className="h-11">
        <Link to="/settings/sync">{t('sharing.needsSessionCta')}</Link>
      </Button>
    </div>
  );
}

/** The honest answer for a deployment whose operator has not enabled sharing — which, while it ships dark, is all of them. */
function UnavailableNotice() {
  const { t } = useTranslation();
  return <p className="text-sm text-muted-foreground">{t('sharing.unavailable')}</p>;
}

function GrantsSection({ grants, onChanged }: { grants: readonly ShareGrantView[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [isGranting, setIsGranting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  async function handleGrant(draft: ShareInviteDraft): Promise<void> {
    setIsGranting(true);
    setMessage(null);
    try {
      const accountId = Number.parseInt(draft.granteeAccountId, 10);
      if (!Number.isSafeInteger(accountId) || accountId <= 0) {
        setMessage(t('sharing.grant.badAccount'));
        return;
      }
      const result = await grantShare({
        granteeAccountId: accountId,
        publicKeyBase64: draft.publicKeyBase64.trim(),
        label: draft.label.trim() === '' ? null : draft.label.trim(),
        typedFingerprint: draft.typedFingerprint,
      });
      setMessage(describeCeremony(result, t));
      onChanged();
    } catch (caught) {
      setMessage(describeErrorForUser(caught, t('sharing.grant.failed')));
    } finally {
      setIsGranting(false);
    }
  }

  async function handleRevoke(granteeAccountId: number): Promise<void> {
    setRevoking(granteeAccountId);
    try {
      await revokeShare(granteeAccountId);
      onChanged();
    } catch (caught) {
      setMessage(describeErrorForUser(caught, t('sharing.grants.revokeFailed')));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('sharing.grants.title')}</h2>
        <ShareGrantsPanel
          grants={grants}
          busyAccountId={revoking}
          onRevoke={(accountId) => void handleRevoke(accountId)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('sharing.grant.title')}</h2>
        <ShareVerifyStep onSubmit={handleGrant} isSubmitting={isGranting} message={message} />
      </section>
    </div>
  );
}

/** Turns a ceremony outcome into one sentence. A refusal says WHAT was refused; none of them offers a way to proceed anyway. */
function describeCeremony(result: ShareCeremonyResult, t: (key: string, params?: Record<string, string>) => string) {
  if (result.status === 'granted') return t('sharing.grant.done', { fingerprint: result.fingerprintDisplay });
  if (result.status === 'fingerprint-mismatch') return t('sharing.grant.mismatch');
  if (result.status === 'key-changed') {
    return t('sharing.grant.keyChanged', {
      pinned: result.pinnedFingerprintDisplay,
      offered: result.offeredFingerprintDisplay,
    });
  }
  if (result.status === 'unknown-grantee') return t('sharing.grant.unknownGrantee');
  if (result.status === 'conflict') return t('sharing.grant.conflict');
  return t('sharing.unavailable');
}

/**
 * TIER 2 — rotate the data key.
 *
 * The copy here is as load-bearing as the revoke dialog's. Rotation seals
 * FUTURE entries with a key a revoked person never had; it does not and cannot
 * reach what was already downloaded, and this card must not suggest it does.
 *
 * It also shows the plan before it runs: any grant this device cannot re-wrap
 * — an unpinned peer, or a key that has changed — is revoked by the rotation,
 * and the person should learn that from this screen rather than from their
 * dietician.
 */
function RotationCard({ onRotated }: { onRotated: () => void }) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RotateDekOutcome | null>(null);
  const [drops, setDrops] = useState<RotationDrop[]>([]);

  useEffect(() => {
    void (async () => {
      const plan = await planDekRotation();
      if (plan.status === 'available') setDrops(plan.value.drop);
    })();
  }, []);

  async function handleRotate(): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      setOutcome(await rotateSyncDek({ passphrase }));
      onRotated();
    } catch (caught) {
      setError(describeErrorForUser(caught, t('sharing.rotate.failed')));
    } finally {
      setIsBusy(false);
      setPassphrase('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sharing.rotate.title')}
        </CardTitle>
        <CardDescription>{t('sharing.rotate.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('sharing.rotate.future')}</p>
        <p className="text-sm text-muted-foreground">{t('sharing.rotate.notThePast')}</p>
        {drops.length > 0 && (
          <p className="text-sm text-accent-amber">{t('sharing.rotate.willDrop', { shares: drops.length })}</p>
        )}

        {outcome === null ?
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="h-11">
                {t('sharing.rotate.open')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('sharing.rotate.confirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('sharing.rotate.confirmBody')}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="sharing-rotate-passphrase">{t('sharing.rotate.passphraseLabel')}</Label>
                <Input
                  id="sharing-rotate-passphrase"
                  type="password"
                  autoComplete="current-password"
                  className="h-11"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('sharing.rotate.passphraseHint')}</p>
                {error !== null && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isBusy}>{t('sharing.cancel')}</AlertDialogCancel>
                <Button disabled={isBusy || passphrase === ''} onClick={() => void handleRotate()}>
                  {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('sharing.rotate.confirmCta')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        : <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium">{t('sharing.rotate.doneTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {t('sharing.rotate.doneBody', { kept: outcome.keptShares, revoked: outcome.revokedShares })}
            </p>
            <p className="text-sm text-muted-foreground">{t('sharing.rotate.recoveryTitle')}</p>
            <p className="font-mono text-base tracking-widest">{outcome.recoveryCode}</p>
            <p className="text-xs text-muted-foreground">{t('sharing.rotate.recoveryNote')}</p>
          </div>
        }
      </CardContent>
    </Card>
  );
}
