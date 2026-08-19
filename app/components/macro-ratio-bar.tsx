/**
 * Diary hero's 4-segment macro ratio bar (M129/01) — a single stacked-flex bar
 * whose segment widths are each macro's share of the day's carbs/protein/fat/
 * fiber grams. Pure percentage math lives in `#app/lib/macro-ratio` so the
 * zero-guard is unit-testable without rendering this component.
 *
 * Color is never the SOLE way a segment reads: `aria-label` states the full
 * ratio in words for assistive tech, and a thin card-colored gap sits between
 * segments so boundaries survive even when two macro hues are hard to tell
 * apart (color-vision deficiency) — width still carries the ratio either way.
 */
import { useTranslation } from 'react-i18next';
import { computeMacroRatioPercentages } from '#app/lib/macro-ratio';
import type { MacroRatioGrams, MacroRatioPercentages } from '#app/lib/macro-ratio';
import { cn } from '#app/lib/utils';

/** Fixed render order — same order the diary's macro-breakdown line already uses (Carbs · Fiber · Protein · Fat). */
const MACRO_ORDER = ['carbs', 'fiber', 'protein', 'fat'] as const;

type MacroKey = (typeof MACRO_ORDER)[number];

/** Segment fill per macro, each its own token (see `app.css`'s `:root`/`.dark` doc comments for why `--macro-fat` isn't just an alias of `--accent-amber`). */
export const MACRO_SWATCH_CLASS = {
  carbs: 'bg-macro-carbs',
  fiber: 'bg-macro-fiber',
  protein: 'bg-macro-protein',
  fat: 'bg-macro-fat',
} satisfies Record<MacroKey, string>;

/** Catalog key per macro — the lower-case, mid-sentence noun the accessible name reads. */
const MACRO_LABEL_KEY = {
  carbs: 'diary.nutrients.carbs',
  fiber: 'diary.nutrients.fiber',
  protein: 'diary.nutrients.protein',
  fat: 'diary.nutrients.fat',
} satisfies Record<MacroKey, string>;

/** The i18next `t` shape this module needs, matching the rest of the diary surface. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** "39% carbs, 12% fiber, 28% protein, 21% fat" — the bar's accessible name. */
function summarizeRatioForLabel(percentages: MacroRatioPercentages, t: Translate): string {
  return MACRO_ORDER.map((key) =>
    t('diary.macroRatio.segment', { percent: Math.round(percentages[key]), macro: t(MACRO_LABEL_KEY[key]) }),
  ).join(', ');
}

export function MacroRatioBar({ grams, className }: { grams: MacroRatioGrams; className?: string }) {
  const { t } = useTranslation();
  const percentages = computeMacroRatioPercentages(grams);

  if (!percentages) {
    return (
      <div className={cn('h-2 w-full rounded-full bg-muted', className)}>
        <span className="sr-only">{t('diary.macroRatio.empty')}</span>
      </div>
    );
  }

  return (
    <div className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      {/* The ratio in words: the segments themselves are pure geometry, so the
          accessible reading lives in this visually-hidden sentence rather than
          an `aria-label` (which would need a `role="img"` to be honoured). */}
      <span className="sr-only">
        {t('diary.macroRatio.label', { ratio: summarizeRatioForLabel(percentages, t) })}
      </span>
      {MACRO_ORDER.map((key, index) => (
        <div
          key={key}
          className={cn(MACRO_SWATCH_CLASS[key], index > 0 && 'border-l-2 border-card')}
          style={{ width: `${percentages[key]}%` }}
        />
      ))}
    </div>
  );
}
