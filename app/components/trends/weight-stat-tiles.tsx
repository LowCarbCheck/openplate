/**
 * The three-tile stat row above the weight chart: the latest weigh-in, the
 * window's smoothed change, and the distance still to travel.
 *
 * Two rules worth keeping:
 *
 * - **A direction is not a verdict.** The change tile is never green or red;
 *   losing and gaining are both just numbers here, and colouring them would
 *   make the app grade the person.
 * - **No sparkline.** The chart directly below IS the series; a sparkline in a
 *   tile would be the same data twice.
 *
 * Every figure is `font-sans tabular-nums` — never `font-display`, which is
 * reserved for the wordmark and hero numbers (DESIGN.md §4).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Link } from '#app/components/link';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { formatDayLabel } from '#app/lib/format-day-label';
import { fromKg, roundWeightForDisplay, type WeightUnit } from '#app/lib/weight-units';
import type { WeightProgress } from '#app/lib/weight-progress';

/** One tile: a value slot above a small label. */
function StatTile({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="min-h-7">{children}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The stat row.
 *
 * @param progress - the pre-computed weight stats, all in kilograms.
 * @param unit - the reader's display unit.
 * @param hasTarget - whether a target weight is set (the third tile becomes a nudge when it isn't).
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
    <div className="grid grid-cols-3 gap-2">
      <StatTile label={t('trends.weight.stat.latest')}>
        {progress.latestKg === null ?
          <p className="text-sm text-muted-foreground">{t('trends.weight.empty')}</p>
        : <>
            <p className="text-xl font-semibold tabular-nums">
              {display(progress.latestKg)} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
            </p>
            {progress.latestDate !== null && (
              <p className="text-[11px] text-muted-foreground">
                {t('trends.weight.stat.latestOn', { date: formatDayLabel(progress.latestDate, language) })}
              </p>
            )}
          </>
        }
      </StatTile>

      <StatTile label={t('trends.weight.stat.change')}>
        {progress.changeKg === null ?
          <p className="text-sm text-muted-foreground">{t('trends.weight.singleEntry')}</p>
        : <p className="text-xl font-semibold tabular-nums">
            {formatSignedDelta({ kg: progress.changeKg, unit, language, t })}
          </p>
        }
      </StatTile>

      <StatTile label={t('trends.weight.stat.toTarget')}>
        {!hasTarget ?
          <p className="text-sm text-muted-foreground">
            {t('trends.weight.stat.noTarget')}{' '}
            <Link to="/settings/goals" className="underline underline-offset-2">
              {t('trends.weight.stat.setTarget')}
            </Link>
          </p>
        : progress.hasReachedTarget ?
          <p className="flex items-center gap-1.5 text-base font-semibold">
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('trends.weight.stat.atTarget')}
          </p>
        : <p className="text-xl font-semibold tabular-nums">
            {progress.toTargetKg === null ? '—' : display(Math.abs(progress.toTargetKg))}{' '}
            <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </p>
        }
      </StatTile>
    </div>
  );
}

/**
 * A signed delta in the reader's unit — `−1.8` / `+0.4` / "no change". Uses the
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
