/**
 * One food caution as a small chip (M219/03 D5, D5a, D5b, D5c).
 *
 * Subtle by design: a chip, not a banner, with no thick left border, no modal
 * and no blocking. It is not a button and tapping it opens nothing in v1. The
 * tone follows the TIER and nothing else: warning (the amber pair every "over
 * goal" signal in the app already uses) for `avoid`, the muted pair for
 * `limit`, so a cup of coffee reads as a note and a raw egg as a warning. An
 * allergen chip carries a different icon from a pregnancy chip, so the two
 * kinds are told apart at a glance and not by reading.
 *
 * THE CHIP WRAPS. No width ceiling and no ellipsis class (a grep in the spec
 * holds this, so neither word is spelled out here): a hedged sentence in
 * German is longer than in English, and a clipped caution is a caution nobody
 * can read. That is also why this is its own `<span>` and not `ui/badge`,
 * whose recipe forbids wrapping and hides overflow.
 *
 * The words are `cautions.*` catalog keys, hedged where a photo cannot prove
 * the thing ("may be unpasteurised", "may contain milk" against "contains
 * milk"), and the caffeine text says it counts toward 200 mg a day. Tests
 * assert the structure of the chip (the slot, the kind, the tier, which key
 * it read), never a wordsmith-owned phrase. The prior art is
 * `EatingStyleCautionNote`.
 */
import { useTranslation } from 'react-i18next';
import { Baby, TriangleAlert } from 'lucide-react';
import { cn } from '#app/lib/utils';
import type { FoodCaution } from '#app/lib/food-cautions';

/** The `data-slot` every caution chip carries, so a test can count them without reading their words. */
export const FOOD_CAUTION_CHIP_SLOT = 'food-caution-chip';

/** The catalog key one caution reads its sentence from. Exported so a test can pin the KEY and not the phrase. */
export function cautionTextKey(caution: FoodCaution): string {
  if (caution.kind === 'pregnancy') return `cautions.pregnancy.${caution.category}`;
  return caution.certainty === 'contains' ?
      `cautions.contains.${caution.allergen}`
    : `cautions.mayContain.${caution.allergen}`;
}

const TONE_CLASS = {
  avoid: 'bg-accent-amber-surface text-accent-amber',
  limit: 'bg-muted text-muted-foreground',
} as const;

export function FoodCautionChip({ caution, className }: { caution: FoodCaution; className?: string }) {
  const { t } = useTranslation();
  // Two icons, one per kind (D5a): the pregnancy chip and the allergen chip
  // sit in the same row and must be told apart without reading.
  const Icon = caution.kind === 'allergen' ? TriangleAlert : Baby;
  return (
    <span
      data-slot={FOOD_CAUTION_CHIP_SLOT}
      data-caution-kind={caution.kind}
      data-caution-tier={caution.tier}
      className={cn(
        // `items-start` and a top margin on the icon rather than `items-center`:
        // once the sentence wraps to a second line the icon stays on the first.
        'inline-flex items-start gap-1 px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[caution.tier],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      <span>{t(cautionTextKey(caution))}</span>
    </span>
  );
}

/**
 * The chips one food earns, in a wrapping row, or nothing at all when it
 * earns none. Rendering nothing rather than an empty row keeps a badge row
 * from carrying an invisible gap.
 */
export function FoodCautionChips({ cautions, className }: { cautions: readonly FoodCaution[]; className?: string }) {
  if (cautions.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {cautions.map((caution) => (
        <FoodCautionChip key={cautionTextKey(caution)} caution={caution} />
      ))}
    </div>
  );
}

/** The `data-slot` of the not-checked line's box, so a test can find the box whether or not the line is in it. */
export const CAUTIONS_NOT_CHECKED_SLOT = 'cautions-not-checked';

/** The catalog key each answer of `notCheckedNote` reads its sentence from. */
const NOT_CHECKED_TEXT_KEY = {
  all: 'cautions.notChecked.all',
  partial: 'cautions.notChecked.partial',
} as const;

/**
 * The one line a scan owes a person who listed an allergy or a pregnancy when
 * some of its foods were not fully checked for them (`notCheckedNote`). It
 * says what the chips cannot: that the ABSENCE of a chip is not an all-clear.
 *
 * THE BOX IS ALWAYS THERE. Render this only on a screen whose person has
 * something listed (`profileWantsCautions`), and then render it whether or not
 * there is a line to show: the two-line `min-h-8` is the room the line takes,
 * so a line that arrives, or a locale that wraps it, never moves what sits
 * below. The line itself is a `role="note"`, a statement and not an alert.
 *
 * @param props.note - which sentence to show, or `null` for the empty box.
 */
export function CautionsNotCheckedNote({ note }: { note: 'all' | 'partial' | null }) {
  const { t } = useTranslation();
  return (
    <div data-slot={CAUTIONS_NOT_CHECKED_SLOT} className="min-h-8">
      {note !== null && (
        <p role="note" className="text-xs text-muted-foreground">
          {t(NOT_CHECKED_TEXT_KEY[note])}
        </p>
      )}
    </div>
  );
}
