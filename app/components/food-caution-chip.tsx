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
        'inline-flex items-start gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
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
