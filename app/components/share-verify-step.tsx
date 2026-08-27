/**
 * THE FINGERPRINT CEREMONY — the one screen the whole sharing design rests on
 * (`openplate-sync` ADR-0002, "Trust: the invite carries the key, the room
 * verifies it").
 *
 * The clinician's own app computes her fingerprint from her own key and she
 * reads it aloud. HERE, the patient TYPES it. The grant is refused unless the
 * typed value is the fingerprint of the key this device actually received.
 *
 * ── Typed, not compared, and that is not a preference ─────────────────────
 *
 * There is deliberately no confirm-what-you-see control on this step. People
 * tap through those, and a design that relies on them not tapping through has
 * no security at all. ADR-0002 ranks grant-time key substitution with a
 * theatrical ceremony as THE attack that breaks the design, and prohibition 6
 * says replacing typing with tapping is a security regression to be reviewed
 * as one — not a simplification.
 *
 * The disabled submit button is a courtesy, not the gate: `runShareCeremony`
 * re-checks the typed value against the received key before it pins, wraps or
 * sends anything. A UI can be bypassed; that function cannot.
 *
 * ── The 12 characters are a security parameter ───────────────────────────
 *
 * 60 bits — three groups of four — puts a targeted collision (a server
 * grinding key pairs until the VISIBLE prefix matches the real clinician's) at
 * about 2^60 hashes. Forty bits would not be, so this length is not a layout
 * choice. A PREFIX of the right value does not pass: the comparison lives in
 * `shareFingerprintMatchesTyped`, which requires all twelve.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { base64ToBytes } from '#app/lib/sync/engine/crypto/base64';
import type { ClinicianInvite } from '#app/lib/clinician-link';
import { shareFingerprintMatchesTyped, shareKeyFingerprint } from '#app/lib/sync/engine/crypto/share-wrap';

/** What the patient has to hand: the clinician's account id and public key, however they travelled. */
export interface ShareInviteDraft {
  granteeAccountId: string;
  publicKeyBase64: string;
  label: string;
  typedFingerprint: string;
}

const EMPTY_DRAFT: ShareInviteDraft = { granteeAccountId: '', publicKeyBase64: '', label: '', typedFingerprint: '' };

/**
 * The account number and key, seeded from a connect link when there is one.
 *
 * A link (M160/08) carries the same two values the person would otherwise read
 * out and paste, so the fields it fills are shown rather than typed. What it
 * CANNOT fill is the fingerprint — that one is heard, not transported, and the
 * form below is identical either way from there down.
 */
function draftFor(invite: ClinicianInvite | null): ShareInviteDraft {
  if (invite === null) return EMPTY_DRAFT;
  return {
    granteeAccountId: String(invite.accountId),
    publicKeyBase64: invite.publicKeyBase64,
    label: invite.claimedLabel ?? '',
    typedFingerprint: '',
  };
}

export function ShareVerifyStep({
  onSubmit,
  isSubmitting,
  message,
  invite = null,
}: {
  onSubmit: (draft: ShareInviteDraft) => Promise<void>;
  isSubmitting: boolean;
  /** The last outcome, already translated by the page that owns the action. */
  message: string | null;
  /**
   * A connect link's payload, when the person arrived from one. `null` is the
   * hand-entered path, where they paste the key themselves.
   *
   * Read ONCE, as the initial draft: re-keying this component is how a caller
   * starts a new ceremony (see `connect-clinician.tsx`), so a changed key never
   * mutates a form somebody is halfway through typing into.
   */
  invite?: ClinicianInvite | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ShareInviteDraft>(() => draftFor(invite));
  const isMatch = useTypedFingerprintMatch(draft);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(draft);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {invite === null && <p className="text-sm text-muted-foreground">{t('sharing.grant.description')}</p>}

      {invite === null && (
        <>
          <div className="space-y-2">
            <Label htmlFor="share-grantee-account">{t('sharing.grant.accountLabel')}</Label>
            <Input
              id="share-grantee-account"
              inputMode="numeric"
              value={draft.granteeAccountId}
              onChange={(event) => setDraft({ ...draft, granteeAccountId: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('sharing.grant.accountHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-public-key">{t('sharing.grant.keyLabel')}</Label>
            <Input
              id="share-public-key"
              value={draft.publicKeyBase64}
              onChange={(event) => setDraft({ ...draft, publicKeyBase64: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('sharing.grant.keyHint')}</p>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="share-label">{t('sharing.grant.labelLabel')}</Label>
        <Input
          id="share-label"
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('sharing.grant.labelHint')}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Label htmlFor="share-typed-fingerprint" className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('sharing.grant.fingerprintLabel')}
        </Label>
        <p className="text-sm text-muted-foreground">{t('sharing.grant.fingerprintHint')}</p>
        <Input
          id="share-typed-fingerprint"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('sharing.grant.fingerprintPlaceholder')}
          value={draft.typedFingerprint}
          onChange={(event) => setDraft({ ...draft, typedFingerprint: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('sharing.grant.fingerprintWhy')}</p>
      </div>

      {message !== null && <p className="text-sm text-destructive">{message}</p>}

      {/* The typed value must match the key that actually arrived. There is no
          "share anyway" beside this button, and adding one would be the
          regression prohibition 6 names. */}
      <Button type="submit" className="h-11 w-full" disabled={!isMatch || isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('sharing.grant.submit')}
      </Button>
    </form>
  );
}

/**
 * Whether what is typed is the fingerprint of the key that was pasted.
 *
 * Computed in an effect because the fingerprint is a SHA-256 of the key bytes,
 * which WebCrypto only offers asynchronously. A malformed key is simply "no
 * match" — this control never has to explain base64.
 */
function useTypedFingerprintMatch(draft: ShareInviteDraft): boolean {
  const [isMatch, setIsMatch] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const matched = await matchesReceivedKey(draft);
      if (!isCancelled) setIsMatch(matched);
    })();
    return () => {
      isCancelled = true;
    };
  }, [draft]);

  return isMatch;
}

async function matchesReceivedKey(draft: ShareInviteDraft): Promise<boolean> {
  try {
    const fingerprint = await shareKeyFingerprint(base64ToBytes(draft.publicKeyBase64));
    return shareFingerprintMatchesTyped({ typed: draft.typedFingerprint, fingerprint });
  } catch {
    return false;
  }
}
