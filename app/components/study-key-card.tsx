/**
 * THE STUDY'S KEY, as the console shows it (M163/03).
 *
 * ── The fingerprint is computed here and goes into a printed document ────
 *
 * `openplate-sync` ADR-0003 moves the trust anchor to the study's
 * ethics-approved consent materials: the fingerprint is PRINTED there and the
 * contributor TYPES it at enrolment. That is what makes a substituted study
 * key fail for a whole cohort rather than pass for it. So this card states
 * where the twelve characters belong, and offers nothing that would move them
 * anywhere else.
 *
 * ── No link, no QR, no "send to participants" ────────────────────────────
 *
 * There is no registry to publish a study key to (prohibition 10: the server
 * never stores, serves or endorses one), and a console control that mailed,
 * copied or encoded the key would be the beginning of every path that ends
 * with a substituted one. The public key itself is never rendered either —
 * only its fingerprint, which is a hash and is meant to be read aloud and
 * typed. The PRIVATE key never leaves `study-session.ts`'s vault.
 *
 * ── A generation is added, never replaced ────────────────────────────────
 *
 * The count is on screen because it is load-bearing: a study that has rotated
 * still opens its back catalogue with the older generations, and only the
 * newest belongs in the document being printed today.
 *
 * ── "No key yet" and "I cannot read your keys" are not one screen ────────
 *
 * `loadStudyIdentity` reports a count and a fingerprint, and a compartment
 * this console could not open leaves both at `0` and `null` — which is
 * exactly what a study on its first visit shows. The first is ordinary and
 * the second is the state in which minting a generation is a mistake, so the
 * identity carries `hasUnopenedCompartment` (M164/07) and this card shows the
 * two apart.
 *
 * AMBER, NOT DESTRUCTIVE, and the mint stays enabled. Nothing is lost here —
 * the keyring is intact on the service and this console simply cannot read it
 * — and `generateStudyKey` refuses the mint on its own (M164/01) with the
 * reason. A disabled button would say "this is broken" where the truth is
 * "you are signed in with the wrong passphrase". DESIGN §10 keeps
 * `--destructive` for the line that is a defect.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { StudyConsoleIdentity } from '#app/lib/sync/research/study-session';

export function StudyKeyCard({
  identity,
  onGenerate,
  isBusy,
}: {
  identity: StudyConsoleIdentity;
  onGenerate: () => void;
  isBusy: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" /> {t('research.console.identity.title')}
        </CardTitle>
        <CardDescription>{t('research.console.identity.account', { accountId: identity.accountId })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {identity.hasUnopenedCompartment && (
          <output className="flex items-start gap-2 rounded-lg border border-accent-amber-border bg-accent-amber-surface px-3 py-2 text-sm text-accent-amber">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t('research.console.identity.unopened')}</span>
          </output>
        )}

        {/* The empty state, and ONLY when it is really empty: a console that
            could not open the compartment has no fingerprint either, and
            telling that researcher to mint one is how she ends up minting onto
            a keyring she cannot read. */}
        {identity.fingerprint === null && !identity.hasUnopenedCompartment && (
          <p className="text-sm text-muted-foreground">{t('research.console.identity.noKey')}</p>
        )}

        {identity.fingerprint !== null && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('research.console.identity.fingerprintLabel')}</p>
            <p className="font-mono text-lg tracking-widest" data-study-fingerprint="">
              {identity.fingerprint}
            </p>
            <p className="text-xs text-muted-foreground">{t('research.console.identity.fingerprintHint')}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t('research.console.identity.generations', { generations: identity.generationCount })}
        </p>

        <div className="space-y-2">
          <Button type="button" className="h-11 w-full" disabled={isBusy} onClick={onGenerate}>
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isBusy ? t('research.console.identity.generating') : t('research.console.identity.generate')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('research.console.identity.generateHint')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
