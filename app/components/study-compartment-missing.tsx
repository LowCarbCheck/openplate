/**
 * THE REFUSAL WITH NO WAY PAST IT (M163/02, `openplate-sync` ADR-0003
 * prohibition 4).
 *
 * This account has no owner-private compartment, which is where the pseudonym
 * root lives. Without one the root would be per-device: the person's pseudonym
 * would change when they restored a backup or picked up a second device, and a
 * researcher reads that as a new participant whose series starts from nothing.
 * The ceremony refuses instead of degrading, and this screen is that refusal.
 *
 * So there is NO enrol control here, and adding one would be the prohibition.
 * What is offered is the thing that actually fixes it — setting up a recovery
 * code, which is what establishes a compartment — and the person can come back
 * through the same link afterwards.
 *
 * It is a component rather than a branch inside the route so the absence above
 * is assertable: a route-local card cannot be rendered by a test.
 */
import { useTranslation } from 'react-i18next';
import { ShieldQuestion } from 'lucide-react';

import { Link } from '#app/components/link';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Button } from '#app/components/ui/button';

export function StudyCompartmentMissing() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{t('research.join.compartmentMissing.title')}</AlertTitle>
        <AlertDescription>{t('research.join.compartmentMissing.body')}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">{t('research.join.compartmentMissing.why')}</p>
      {/* A link, not a button that enrols. The route out is a password reset:
          the compartment is established at signup, and the reset ceremony is
          the one routine operation that can create one for an account whose
          data predates it (see `rewrapCompartmentAfterRecovery`). It used to
          point at a "set up a recovery code" screen, which no longer exists —
          the code is escrowed and never shown (M192). */}
      <Button asChild variant="outline" className="h-11 w-full">
        <Link to="/forgot">{t('research.join.compartmentMissing.cta')}</Link>
      </Button>
    </div>
  );
}
