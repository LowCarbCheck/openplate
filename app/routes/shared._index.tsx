/**
 * `/shared` — the clinician's list of the patients who have shared with her,
 * and her own share identity.
 *
 * ── NO LOADER, and that is the point ─────────────────────────────────────
 *
 * `app/routes/settings.data.tsx` states the house rule: the diary lives on the
 * device. This is the first screen in the app that renders SOMEBODY ELSE's
 * diary, and the rule does not bend for that. The share list, the wrap and the
 * blob are all fetched by the browser directly from the sync service, and
 * decrypted here — no loader on this route fetches or holds a patient blob,
 * and none may be added.
 *
 * There is no server-side gate either, because there is nothing to gate: with
 * no unlocked session this page can read nothing at all, and on a deployment
 * with sharing off every share path answers the ordinary 404, which this
 * screen reports as one sentence rather than an error.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Loader2, Stethoscope } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ShareIdentityCard } from '#app/components/share-identity-card';
import { ShareInviteLinkCard } from '#app/components/share-invite-link-card';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import {
  dropSharedWithMe,
  ensureShareIdentity,
  loadSharedWithMe,
  readShareIdentity,
  type ShareIdentityView,
  type SharedWithMeView,
} from '#app/lib/sync/share-actions';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.shared') }];

export const handle = {
  titleKey: 'sharing.clinician.title',
  title: 'Shared with you',
  backTo: '/settings',
};

type SharedState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'unavailable' }
  | { status: 'ready'; shares: SharedWithMeView[] };

export default function SharedIndex() {
  const { t } = useTranslation();
  const session = useSyncSession();
  const [state, setState] = useState<SharedState>({ status: 'loading' });
  const [identity, setIdentity] = useState<ShareIdentityView | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIdentity(await readShareIdentity());
    if (session.account === null) {
      setState({ status: 'signed-out' });
      return;
    }
    const shares = await loadSharedWithMe();
    setState(shares.status === 'unavailable' ? { status: 'unavailable' } : { status: 'ready', shares: shares.value });
  }, [session.account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerate(): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      setIdentity(await ensureShareIdentity());
    } catch (caught) {
      setError(describeErrorForUser(caught, t('sharing.identity.failed')));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDrop(grantorAccountId: number): Promise<void> {
    setIsBusy(true);
    try {
      await dropSharedWithMe(grantorAccountId);
      await refresh();
    } catch (caught) {
      setError(describeErrorForUser(caught, t('sharing.clinician.dropFailed')));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <ShareIdentityCard identity={identity} onGenerate={() => void handleGenerate()} isBusy={isBusy} />

      {/* The connect link (M160/08), shown only once there is a key to put in
          it and an account id to address it to. Built entirely on this device:
          no loader fetches it and no server ever holds it. */}
      {identity !== null && session.account !== null && (
        <ShareInviteLinkCard identity={identity} accountId={session.account.id} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sharing.clinician.title')}
          </CardTitle>
          <CardDescription>{t('sharing.clinician.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error !== null && <p className="text-sm text-destructive">{error}</p>}
          {state.status === 'loading' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'signed-out' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('sharing.needsSession')}</p>
              <Button asChild variant="outline" className="h-11">
                <Link to="/settings/sync">{t('sharing.needsSessionCta')}</Link>
              </Button>
            </div>
          )}
          {state.status === 'unavailable' && (
            <p className="text-sm text-muted-foreground">{t('sharing.unavailable')}</p>
          )}
          {state.status === 'ready' && state.shares.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('sharing.clinician.empty')}</p>
          )}
          {state.status === 'ready' && state.shares.length > 0 && (
            <ul className="space-y-3">
              {state.shares.map((share) => (
                <li
                  key={share.grantorAccountId}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t('sharing.clinician.patientTitle', { accountId: share.grantorAccountId })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('sharing.clinician.sharedSince', { at: new Date(share.createdAt).toLocaleDateString() })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button asChild size="sm">
                      <Link to={`/shared/${share.grantorAccountId}`}>{t('sharing.clinician.open')}</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void handleDrop(share.grantorAccountId)}
                    >
                      {t('sharing.clinician.drop')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
