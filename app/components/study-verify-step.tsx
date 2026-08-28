/**
 * THE ENROLMENT CEREMONY, on screen (M163/02, `openplate-sync` ADR-0003).
 *
 * The study's key arrived in a LINK. The twelve characters below are read off
 * the study's PRINTED CONSENT DOCUMENT and typed here. Two channels, and the
 * whole ceremony is the fact that they are two: if this screen displayed the
 * fingerprint it computed from the link and asked the person to confirm it,
 * both halves would come from the same source and a substituted key would pass
 * cleanly — for a whole cohort at once, which is why ADR-0003 ranks this above
 * the clinician case.
 *
 * So nothing here renders a fingerprint. The only thing this component learns
 * about the key is a BOOLEAN, from `use-typed-fingerprint-match.ts`, and that
 * type is the guarantee rather than a convention.
 *
 * There is deliberately no confirm-what-you-see control, and no "join anyway"
 * beside the button. The disabled button is a courtesy:
 * `runEnrolmentCeremony` re-checks the typed value before it writes anything.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useTypedFingerprintMatch } from '#app/components/use-typed-fingerprint-match';
import { STUDY_LABEL_MAX_LENGTH, type StudyInvite } from '#app/lib/study-link';

/** What the contributor supplies: her own name for the study, and the printed fingerprint. */
export interface StudyEnrolmentDraft {
  label: string;
  typedFingerprint: string;
}

export function StudyVerifyStep({
  invite,
  onSubmit,
  isSubmitting,
  message,
}: {
  invite: StudyInvite;
  onSubmit: (draft: StudyEnrolmentDraft) => void;
  isSubmitting: boolean;
  /** The last refusal, already translated by the page that owns the action. */
  message: string | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<StudyEnrolmentDraft>({ label: invite.claimedLabel ?? '', typedFingerprint: '' });
  const isMatch = useTypedFingerprintMatch({
    publicKeyBase64: invite.publicKeyBase64,
    typedFingerprint: draft.typedFingerprint,
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {/* The name the LINK claims, marked as claimed. Anybody who can write
          the link can write it, and a study name reads like credentials. */}
      <div className="space-y-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">
          {invite.claimedLabel === null ?
            t('research.join.claimed.unnamed')
          : t('research.join.claimed.named', { name: invite.claimedLabel })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('research.join.claimed.account', { studyAccountId: invite.studyAccountId })}
        </p>
        <p className="text-xs text-muted-foreground">{t('research.join.claimed.unverified')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="study-label">{t('research.join.labelLabel')}</Label>
        <Input
          id="study-label"
          maxLength={STUDY_LABEL_MAX_LENGTH}
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('research.join.labelHint')}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Label htmlFor="study-typed-fingerprint" className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('research.join.fingerprintLabel')}
        </Label>
        {/* Names the SECOND CHANNEL explicitly. A person who takes these
            characters off the screen they arrived on has performed no check. */}
        <p className="text-sm text-muted-foreground">{t('research.join.fingerprintHint')}</p>
        <Input
          id="study-typed-fingerprint"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('research.join.fingerprintPlaceholder')}
          value={draft.typedFingerprint}
          onChange={(event) => setDraft({ ...draft, typedFingerprint: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('research.join.fingerprintWhy')}</p>
      </div>

      {message !== null && <p className="text-sm text-destructive">{message}</p>}

      <Button type="submit" className="h-11 w-full" disabled={!isMatch || isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('research.join.submit')}
      </Button>
    </form>
  );
}
