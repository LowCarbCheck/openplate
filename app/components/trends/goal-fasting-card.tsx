/**
 * The fasting card on the Goals tab (M239/05): how many of the fasts that
 * ended in the grid's 13 weeks reached their own target. Each fast is measured
 * against the target it was started with (`selectFastTargetShare`).
 *
 * Renders nothing when no fast finished in the window: an empty tile is a
 * question the person never asked.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import type { FastTargetShare } from '#app/models/fasting-stats';

/** Whole percent for the bar width. */
const PERCENT = 100;

/**
 * @param share - the finished and the reached counts for the window.
 * @returns the card, or null when nothing finished.
 */
export function GoalFastingCard({ share }: { share: FastTargetShare }): ReactElement | null {
  const { t } = useTranslation();
  if (share.finishedCount === 0) return null;
  const percent = Math.round((share.reachedCount / share.finishedCount) * PERCENT);

  return (
    <Card data-slot="goal-fasting-card">
      <CardHeader>
        <CardTitle>{t('trends.goals.fasting.title')}</CardTitle>
        <CardDescription>{t('trends.goals.fasting.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-foreground tabular-nums">
          {t('trends.goals.fasting.reached', { reached: share.reachedCount, finished: share.finishedCount })}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}
