/**
 * `/shared/:grantorAccountId` — one patient's diary, read-only.
 *
 * ── NO LOADER. The decryption happens on this device ─────────────────────
 *
 * The share wrap is opened with this clinician's private key and the blob with
 * the DEK that comes out of it, both in this browser. A server loader that
 * fetched a patient blob would put ciphertext this app's server has no
 * business holding into a request it has no business making — and it still
 * could not decrypt it, so it would buy nothing and cost the house rule.
 *
 * ── Every absence is the same absence ────────────────────────────────────
 *
 * A revoked share, a patient who never pushed, an account that does not exist
 * and a deployment with sharing off all answer one 404 (ADR-0002: absence of a
 * share must not confirm that an account exists). This screen therefore says
 * one thing for all of them, and does not invent a distinction it cannot make.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { Loader2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SharedDiaryView } from '#app/components/shared-diary-view';
import { useSyncSession } from '#app/components/sync-status';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { openSharedPatientDiary } from '#app/lib/sync/share-actions';
import type { OpenSharedDiaryResult } from '#app/lib/sync/sharing';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.shared') }];

export const handle = {
  titleKey: 'sharing.clinician.title',
  title: 'Shared with you',
  backTo: '/shared',
};

export default function SharedPatientDiary() {
  const { t } = useTranslation();
  const params = useParams();
  const session = useSyncSession();
  const [result, setResult] = useState<OpenSharedDiaryResult | null>(null);

  const grantorAccountId = Number.parseInt(params.grantorAccountId ?? '', 10);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      if (session.account === null || !Number.isSafeInteger(grantorAccountId)) return;
      const opened = await openSharedPatientDiary(grantorAccountId);
      if (!isCancelled) setResult(opened);
    })();
    return () => {
      isCancelled = true;
    };
  }, [grantorAccountId, session.account]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Button asChild variant="outline" size="sm">
        <Link to="/shared">{t('sharing.clinician.back')}</Link>
      </Button>

      {session.account === null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('sharing.clinician.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('sharing.needsSession')}</p>
          </CardContent>
        </Card>
      )}

      {session.account !== null && result === null && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}

      {result !== null && result.status === 'unavailable' && (
        <p className="text-sm text-muted-foreground">{t('sharing.clinician.gone')}</p>
      )}
      {result !== null && result.status === 'undecryptable' && (
        <p className="text-sm text-destructive">{result.message}</p>
      )}
      {result !== null && result.status === 'opened' && <SharedDiaryView diary={result.diary} />}
    </div>
  );
}
