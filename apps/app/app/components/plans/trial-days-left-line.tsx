/**
 * THE FREE TIER'S DAYS LEFT, the line beside the scans left (owner decision
 * 2026-09-30).
 *
 * ── ITS BOX IS RESERVED WITH THE SCANS LINE ──────────────────────────────
 *
 * A caller draws this wherever it draws a scan trial's scans line, and only
 * there. The box is then on screen from the first paint, whether or not the
 * day count is known yet: an account saved on this device before the core
 * sent `trialEndsAt` has no date until the next account read, and a line that
 * arrived then would push down everything under it. Until the count is known
 * the box holds one invisible line of the same height; an account with no
 * scan trial draws no box at all, because its caller draws no scans line.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '#app/lib/utils';

export function TrialDaysLeftLine({
  daysLeft,
  className,
}: {
  /** `trialDaysLeft` for the trial, or `null` while no count can be drawn. */
  daysLeft: number | null;
  /** The type size and colour of the scans line it sits beside. */
  className?: string;
}) {
  const { t } = useTranslation();
  if (daysLeft === null) {
    return (
      <span aria-hidden="true" className={cn('invisible block', className)} data-slot="trial-days-left-reserved">
        {' '}
      </span>
    );
  }
  return (
    <span className={cn('block', className)} data-slot="trial-days-left">
      {t('account.allowance.trialDaysLeft', { count: daysLeft })}
    </span>
  );
}
