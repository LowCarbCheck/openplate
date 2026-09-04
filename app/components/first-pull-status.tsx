/**
 * What the first pull looks like on screen, for every route that runs one.
 *
 * ONE COPY, deliberately. `/sign-in` and `/reset` wait for the same snapshot
 * over the same connection and fail for the same reasons, so two spinners
 * would be two chances for one of them to say something different about the
 * same moment. The strings stay under `signIn.*` because that is where they
 * were written and where they are still true; renaming them would move ten
 * translations to say the same thing.
 *
 * The retry repeats the PULL alone. It never asks for a password again: the
 * session is open, and only the download failed.
 */
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import type { FirstPullPhase } from '#app/hooks/use-first-pull';

/** The two phases that have something to show. `idle` is not one of them, and the type says so. */
export type FirstPullVisiblePhase = Exclude<FirstPullPhase, { status: 'idle' }>;

export function FirstPullStatus({ phase, onRetry }: { phase: FirstPullVisiblePhase; onRetry: () => void }) {
  const { t } = useTranslation();

  if (phase.status === 'pulling') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('signIn.pulling')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t('signIn.pullFailedTitle')}</p>
      <p className="text-sm text-muted-foreground">{phase.message}</p>
      <Button type="button" className="h-11 w-full" onClick={onRetry}>
        {t('errors.tryAgain')}
      </Button>
    </div>
  );
}
