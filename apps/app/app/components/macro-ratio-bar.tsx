/**
 * The macro ratio bar (M129/01), a single stacked-flex bar whose segment
 * widths are each macro's share of the day, BY CALORIES (three segments:
 * carbs, protein, fat; fibre is not an energy source here) or BY GRAMS (four
 * segments, fibre as its own). The caller passes the basis; the person's choice
 * lives in `#app/lib/macro-share-basis`. Pure percentage math lives in
 * `#app/lib/macro-ratio` so the zero-guard is unit-testable without rendering
 * this component.
 *
 * Color is never the SOLE way a segment reads: `aria-label` states the full
 * ratio in words for assistive tech, and a thin card-colored gap sits between
 * segments so boundaries survive even when two macro hues are hard to tell
 * apart (color-vision deficiency) — width still carries the ratio either way.
 */
import { useTranslation } from 'react-i18next';
import { computeMacroShares } from '#app/lib/macro-ratio';
import type { MacroRatioGrams, MacroShareKey, MacroShares } from '#app/lib/macro-ratio';
import type { MacroShareBasis } from '#app/lib/macro-share-basis';
import { cn } from '#app/lib/utils';

/** Segment fill per macro, each its own token (see `app.css`'s `:root`/`.dark` doc comments for why `--macro-fat` isn't just an alias of `--accent-amber`). */
export const MACRO_SWATCH_CLASS = {
  carbs: 'bg-macro-carbs',
  fiber: 'bg-macro-fiber',
  protein: 'bg-macro-protein',
  fat: 'bg-macro-fat',
} satisfies Record<MacroShareKey, string>;

/** Catalog key per macro — the lower-case, mid-sentence noun the accessible name reads. */
const MACRO_LABEL_KEY = {
  carbs: 'diary.nutrients.carbs',
  fiber: 'diary.nutrients.fiber',
  protein: 'diary.nutrients.protein',
  fat: 'diary.nutrients.fat',
} satisfies Record<MacroShareKey, string>;

/** The i18next `t` shape this module needs, matching the rest of the diary surface. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** The sentence key per basis, so the accessible name says which share it reads. */
const LABEL_KEY = {
  kcal: 'diary.macroRatio.labelKcal',
  grams: 'diary.macroRatio.labelGrams',
} satisfies Record<MacroShareBasis, string>;

/** "39% carbs, 12% fiber, 28% protein, 21% fat" — the bar's accessible name. */
function summarizeRatioForLabel({ shares, t }: { shares: MacroShares; t: Translate }): string {
  return shares.segments
    .map(({ key, percent }) =>
      t('diary.macroRatio.segment', { percent: Math.round(percent), macro: t(MACRO_LABEL_KEY[key]) }),
    )
    .join(', ');
}

export function MacroRatioBar({
  grams,
  basis,
  className,
}: {
  grams: MacroRatioGrams;
  /** Which share to draw: calories (three segments) or grams (four). */
  basis: MacroShareBasis;
  className?: string;
}) {
  const { t } = useTranslation();
  const shares = computeMacroShares(grams, basis);

  if (!shares) {
    return (
      <div data-slot="macro-ratio-bar" className={cn('h-2 w-full bg-muted', className)}>
        <span className="sr-only">{t('diary.macroRatio.empty')}</span>
      </div>
    );
  }

  return (
    <div
      data-slot="macro-ratio-bar"
      data-basis={basis}
      className={cn('flex h-2 w-full overflow-hidden bg-muted', className)}
    >
      {/* The ratio in words: the segments themselves are pure geometry, so the
          accessible reading lives in this visually-hidden sentence rather than
          an `aria-label` (which would need a `role="img"` to be honoured). */}
      <span className="sr-only">
        {t(LABEL_KEY[basis], { ratio: summarizeRatioForLabel({ shares, t }) })}
      </span>
      {shares.segments.map(({ key, percent }, index) => (
        <div
          key={key}
          data-slot="macro-ratio-segment"
          data-macro={key}
          className={cn(MACRO_SWATCH_CLASS[key], index > 0 && 'border-l-2 border-card')}
          style={{ width: `${percent}%` }}
        />
      ))}
    </div>
  );
}
