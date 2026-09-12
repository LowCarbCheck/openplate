/**
 * The one chip recipe the fasting surfaces share (DESIGN.md section 2,
 * "Interactive row/chip hover"). Tokens only, never a `hover:border-teal-*`
 * literal: the brand teal is defined in `openplate-brand` and reaches this
 * file as `primary` (DESIGN.md section 11).
 *
 * It lives in its own module rather than in `routes/fasting.tsx` because the
 * end sheet's mood chips are a sibling of the plan card's protocol chips and
 * have to look identical. A second copy is how two rows of chips on the same
 * screen drift apart.
 */
import { cn } from '#app/lib/utils';

/**
 * @param isSelected - whether this chip is the current choice.
 * @returns the full class list for a chip button.
 */
export function fastingChipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
  );
}
