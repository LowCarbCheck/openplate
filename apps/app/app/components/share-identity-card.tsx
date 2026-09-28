/**
 * The clinician's own share identity: her public key, and the fingerprint she
 * reads aloud.
 *
 * ── The fingerprint here is computed on THIS device ──────────────────────
 *
 * From her own key's bytes, by `shareKeyFingerprint`, in her own browser. It
 * is never fetched, never server-rendered, and never taken from a share row.
 * ADR-0002 is explicit about why: a server-rendered fingerprint is the
 * attacker reading you its own key, and the whole ceremony would then confirm
 * a substitution instead of catching one.
 *
 * The value displayed is the 60-bit prefix — twelve Crockford base32
 * characters in three groups of four — because that is what a person can read
 * out over a table without losing their place, and it is still far out of
 * reach of a targeted collision.
 *
 * The private half is never rendered, never copied to a clipboard and never
 * leaves the device except inside the account's own encrypted compartment.
 */
import { useTranslation } from 'react-i18next';
import { Fingerprint, Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { ShareIdentityView } from '#app/lib/sync/share-actions';

export function ShareIdentityCard({
  identity,
  onGenerate,
  isBusy,
}: {
  /** `null` on a device that has never generated a key pair — the normal state, since sharing is opt-in. */
  identity: ShareIdentityView | null;
  onGenerate: () => void;
  isBusy: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5 text-primary" aria-hidden="true" /> {t('sharing.identity.title')}
        </CardTitle>
        <CardDescription>{t('sharing.identity.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {identity === null ?
          <>
            <p className="text-sm text-muted-foreground">{t('sharing.identity.none')}</p>
            <Button type="button" className="h-11" disabled={isBusy} onClick={onGenerate}>
              {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('sharing.identity.generate')}
            </Button>
          </>
        : <>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('sharing.identity.fingerprintLabel')}
              </p>
              <p className="font-mono text-lg tracking-widest">{identity.fingerprintDisplay}</p>
              <p className="text-xs text-muted-foreground">{t('sharing.identity.readAloud')}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('sharing.identity.publicKeyLabel')}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">{identity.publicKeyBase64}</p>
              <p className="text-xs text-muted-foreground">{t('sharing.identity.publicKeyHint')}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t('sharing.identity.recoveryNote')}</p>
          </>
        }
      </CardContent>
    </Card>
  );
}
