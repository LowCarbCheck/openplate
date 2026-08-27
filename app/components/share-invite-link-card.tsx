/**
 * The clinician's connect link, built here and only here.
 *
 * Everything on this card is made from values this device already holds: her
 * own share public key, her own account id, and the app's own origin read from
 * `window.location`. There is no loader, no action and no request — `openplate-sync`
 * ADR-0002 prohibition 1 says the server never stores, serves or endorses a
 * share public key, and a "give me my invite link" endpoint would be exactly
 * that endorsement with a different name.
 *
 * ── The key is in the fragment, so this card cannot leak it ───────────────
 *
 * `buildClinicianLink` puts the payload after `#`. Nothing after `#` is ever
 * sent to a server — not this one, not the patient's, and not whatever mail or
 * chat service carries the link. See `app/lib/clinician-link.ts` for why that
 * is a requirement rather than a nicety.
 *
 * ── The QR is a second input to the same check, never a replacement ───────
 *
 * When both people are in one room the QR is simply better than reading out a
 * base64 key. It carries the same link, so it carries the same UNVERIFIED
 * bytes: the patient still types the fingerprint this clinician reads aloud,
 * and the ceremony still refuses everything else. A scanned code is not a
 * verified code.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, QrCode as QrCodeIcon } from 'lucide-react';

import { QrCode } from '#app/components/qr-code';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { CLINICIAN_LABEL_MAX_LENGTH, buildClinicianLink } from '#app/lib/clinician-link';
import type { ShareIdentityView } from '#app/lib/sync/share-actions';

/** How long "Copied" stays on the button before it goes back to "Copy". */
const COPIED_LABEL_MS = 2000;

/** The copy button's three states, spelled out rather than interpolated — a derived key that misses renders a raw slug. */
const COPY_LABEL_KEYS = {
  copy: 'clinicianLink.copy',
  copied: 'clinicianLink.copied',
  failed: 'clinicianLink.copyFailed',
} as const;

export function ShareInviteLinkCard({ identity, accountId }: { identity: ShareIdentityView; accountId: number }) {
  const { t } = useTranslation();
  const [claimedName, setClaimedName] = useState('');
  const origin = useAppOrigin();

  if (origin === null) return null;

  const link = buildClinicianLink({
    origin,
    accountId,
    publicKeyBase64: identity.publicKeyBase64,
    label: claimedName,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCodeIcon className="h-5 w-5 text-primary" aria-hidden="true" /> {t('clinicianLink.title')}
        </CardTitle>
        <CardDescription>{t('clinicianLink.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="clinician-link-name">{t('clinicianLink.nameLabel')}</Label>
          <Input
            id="clinician-link-name"
            maxLength={CLINICIAN_LABEL_MAX_LENGTH}
            value={claimedName}
            onChange={(event) => setClaimedName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('clinicianLink.nameHint')}</p>
        </div>

        <div className="flex justify-center">
          <QrCode value={link} title={t('clinicianLink.qrTitle')} className="h-48 w-48 rounded-lg border bg-white" />
        </div>

        <div className="space-y-2">
          <p className="break-all rounded-lg border bg-muted/30 p-3 font-mono text-xs">{link}</p>
          <CopyLinkButton link={link} />
        </div>

        {/* The point of the whole card, said last so it is the last thing read:
            the link moves bytes, the spoken fingerprint is what makes them
            trustworthy. Never soften this into "share your secure link". */}
        <p className="text-sm text-muted-foreground">
          {t('clinicianLink.stillReadAloud', { fingerprint: identity.fingerprintDisplay })}
        </p>
        <p className="text-xs text-muted-foreground">{t('clinicianLink.notSecret')}</p>
      </CardContent>
    </Card>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState<keyof typeof COPY_LABEL_KEYS>('copy');

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setLabel('copied');
      setTimeout(() => setLabel('copy'), COPIED_LABEL_MS);
    } catch {
      setLabel('failed');
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void handleCopy()}>
      <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t(COPY_LABEL_KEYS[label])}
    </Button>
  );
}

/**
 * This app's own origin, once the browser has one.
 *
 * `null` during SSR and the first render, which is why this card renders
 * nothing until then: a link built from a guessed origin is a link that opens
 * the wrong app, and there is no server value to fall back to — the origin has
 * to be the one the clinician is actually looking at.
 */
function useAppOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}
