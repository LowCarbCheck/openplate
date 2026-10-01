/**
 * The small two-option control that sits on the title row of every macro share
 * visual: "kcal" (the default) and "g". It copies `WeightUnitToggle`'s recipe
 * (a fieldset of two `aria-pressed` buttons) with one difference that matters
 * for the no-layout-shift rule: both buttons have the SAME fixed width, so
 * switching the choice never changes the control's size or what sits beside it.
 *
 * THE ACTIVE OPTION IS NEUTRAL, NOT TEAL: foreground text in a 2 px foreground
 * border. `WeightUnitToggle` fills its active option with `bg-primary`, and one
 * more teal element took `/trends` from its frozen ceiling of 6 to 7
 * (`tests/e2e/lcc-lineage-teal-budget.spec.ts`; DESIGN.md section 6, "The teal
 * budget"). The inactive option wears a transparent border of the same width,
 * so the active mark never changes a button's size, and the state never rests
 * on hue alone either.
 *
 * The choice itself lives in `#app/lib/macro-share-basis`. This component only
 * draws it and reports a tap, so the caller owns the state.
 */
import { useTranslation } from 'react-i18next';
import { MACRO_SHARE_BASES } from '#app/lib/macro-share-basis';
import type { MacroShareBasis } from '#app/lib/macro-share-basis';
import { cn } from '#app/lib/utils';

/** Catalog key per option. The words are units, so they read the same in most languages. */
const OPTION_LABEL_KEY = {
  kcal: 'diary.macroBasis.kcal',
  grams: 'diary.macroBasis.grams',
} satisfies Record<MacroShareBasis, string>;

export function MacroBasisToggle({
  basis,
  onChange,
  idPrefix,
}: {
  basis: MacroShareBasis;
  onChange: (basis: MacroShareBasis) => void;
  /** Distinguishes two toggles on one page; each button's id is `${idPrefix}-${option}`. */
  idPrefix: string;
}) {
  const { t } = useTranslation();

  return (
    <fieldset
      data-slot="macro-basis-toggle"
      className="inline-flex shrink-0 border p-0.5 text-xs font-medium"
      aria-label={t('diary.macroBasis.group')}
    >
      {MACRO_SHARE_BASES.map((option) => (
        <button
          key={option}
          id={`${idPrefix}-${option}`}
          type="button"
          aria-pressed={basis === option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-11 min-w-11 w-12 border-2 py-1 transition-colors',
            basis === option ?
              'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(OPTION_LABEL_KEY[option])}
        </button>
      ))}
    </fieldset>
  );
}
