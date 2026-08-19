/**
 * The adherence grid's key: the four-step ramp (fewer → more goals met) plus
 * the two neutrals that sit off it. Presentational only.
 *
 * Every swatch names a TOKEN (`bg-adherence-*`), never a palette literal — the
 * ramp's values live in `app/app.css` and nowhere else (DESIGN.md §11), which
 * is what lets the light and dark ramps be independently chosen rather than
 * mechanically flipped.
 *
 * In `activity` mode the ramp is replaced by a single "You logged" swatch:
 * with no goal configured there is no magnitude to encode, so a fewer→more
 * scale would be inventing one.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdherenceMode } from '#app/models/adherence-grid';

/** The ramp steps, palest first — the same order the legend reads. */
const RAMP_CLASSES = ['bg-adherence-1', 'bg-adherence-2', 'bg-adherence-3', 'bg-adherence-4'];

/** One legend swatch. Always `aria-hidden` — the entry's text is the accessible content. */
function Swatch({ className }: { className: string }) {
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${className}`} aria-hidden="true" />;
}

/** One legend entry: a swatch and its label. */
function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}

/**
 * The grid legend.
 *
 * @param mode - `adherence` shows the ramp; `activity` shows a single logged swatch.
 * @param hasUnratedDays - whether any day in the window was logged but ungradeable (gates the third key).
 */
export function AdherenceLegend({ mode, hasUnratedDays }: { mode: AdherenceMode; hasUnratedDays: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {mode === 'adherence' ?
        <span className="inline-flex items-center gap-1.5" aria-label={t('trends.grid.legendRamp')}>
          {t('trends.grid.legendLess')}
          <span className="inline-flex gap-[2px]">
            {RAMP_CLASSES.map((className) => (
              <Swatch key={className} className={className} />
            ))}
          </span>
          {t('trends.grid.legendMore')}
        </span>
      : <LegendItem swatch={<Swatch className="bg-adherence-4" />} label={t('trends.grid.legendLogged')} />}

      <LegendItem swatch={<Swatch className="bg-adherence-empty" />} label={t('trends.legend.noEntry')} />

      {hasUnratedDays && (
        <LegendItem swatch={<Swatch className="bg-adherence-unrated" />} label={t('trends.grid.legendUnrated')} />
      )}
    </div>
  );
}
