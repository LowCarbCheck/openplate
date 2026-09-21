/**
 * The stat row above the weight chart: the latest weigh-in, the window's
 * smoothed change, and the distance still to travel.
 *
 * Rules worth keeping:
 *
 * - **A direction is not a verdict.** The change tile is never green or red;
 *   losing and gaining are both just numbers here, and colouring them would
 *   make the app grade the person.
 * - **No sparkline.** The chart directly below IS the series; a sparkline in a
 *   tile would be the same data twice.
 * - **A tile holds a figure.** A stat with no figure yet (one weigh-in is not a
 *   change, no target is not a distance) has no tile. One quiet line under the
 *   row says why. It used to be a tile whose figure slot held that sentence,
 *   five lines of it in a third of the card, stretching its neighbours.
 *
 * Every figure is `tabular-nums` in the page's own body face, and never the
 * brand role. The comment here used to name `font-sans` and to allow the serif
 * on a hero number; both went in M243. The body role is one face now
 * (`--font-body`), and the `Wordmark` component is the only thing in the app
 * that may ask for the brand role. The tile itself, and the ladder inside it, is
 * `StatTile`.
 */
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Link } from '#app/components/link';
import {
  STAT_FIGURE_CLASS,
  STAT_GRID_CLASS,
  STAT_NOTE_CLASS,
  STAT_UNIT_CLASS,
  StatTile,
} from '#app/components/trends/stat-tile';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { formatDayLabel } from '#app/lib/format-day-label';
import { fromKg, roundWeightForDisplay, type WeightUnit } from '#app/lib/weight-units';
import type { WeightProgress } from '#app/lib/weight-progress';

/**
 * The stat row.
 *
 * @param progress - the pre-computed weight stats, all in kilograms.
 * @param unit - the reader's display unit.
 * @param hasTarget - whether a target weight is set (without one, a line under the row offers to set it).
 */
export function WeightStatTiles({
  progress,
  unit,
  hasTarget,
}: {
  progress: WeightProgress;
  unit: WeightUnit;
  hasTarget: boolean;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  /** A kilogram figure in the reader's unit, rounded the way every weight in the app is. */
  const display = (kg: number): string => formatMacroNumberIn(language, roundWeightForDisplay(fromKg(kg, unit)));

  return (
    <div className="space-y-2">
      <div className={STAT_GRID_CLASS}>
        {progress.latestKg !== null && (
          <StatTile label={t('trends.weight.stat.latest')}>
            <p className={STAT_FIGURE_CLASS}>
              {display(progress.latestKg)} <span className={STAT_UNIT_CLASS}>{unit}</span>
            </p>
            {progress.latestDate !== null && (
              <p className={STAT_NOTE_CLASS}>
                {t('trends.weight.stat.latestOn', { date: formatDayLabel(progress.latestDate, language) })}
              </p>
            )}
          </StatTile>
        )}

        {progress.changeKg !== null && (
          <StatTile label={t('trends.weight.stat.change')}>
            <p className={STAT_FIGURE_CLASS}>{formatSignedDelta({ kg: progress.changeKg, unit, language, t })}</p>
          </StatTile>
        )}

        {hasTarget && (progress.hasReachedTarget || progress.toTargetKg !== null) && (
          <StatTile label={t('trends.weight.stat.toTarget')}>
            {progress.hasReachedTarget || progress.toTargetKg === null ?
              <p className="flex items-center gap-1.5 text-base font-semibold">
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('trends.weight.stat.atTarget')}
              </p>
            : <p className={STAT_FIGURE_CLASS}>
                {display(Math.abs(progress.toTargetKg))} <span className={STAT_UNIT_CLASS}>{unit}</span>
              </p>
            }
          </StatTile>
        )}
      </div>

      {progress.changeKg === null && <p className={STAT_NOTE_CLASS}>{t('trends.weight.singleEntry')}</p>}
      {!hasTarget && (
        <p className={STAT_NOTE_CLASS}>
          {t('trends.weight.stat.noTarget')}{' '}
          <Link to="/settings/nutrition" className="underline underline-offset-2">
            {t('trends.weight.stat.setTarget')}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * A signed delta in the reader's unit, `−1.8` / `+0.4` / "no change". Uses the
 * app's existing U+2212 minus convention (see `weekly-recap-card.tsx`) rather
 * than a hyphen, so the sign lines up with the digits.
 */
function formatSignedDelta({
  kg,
  unit,
  language,
  t,
}: {
  kg: number;
  unit: WeightUnit;
  language: string;
  t: (key: string) => string;
}): string {
  const value = roundWeightForDisplay(fromKg(kg, unit));
  if (value === 0) return t('trends.recap.noChange');
  return `${value > 0 ? '+' : '−'}${formatMacroNumberIn(language, Math.abs(value))} ${unit}`;
}
