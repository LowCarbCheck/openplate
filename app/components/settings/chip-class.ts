/**
 * chip-class.ts: the one chip recipe the settings pages paint with.
 *
 * `/settings/profile` (the biological sex answer) and `/settings/nutrition`
 * (the protein and calorie suggestions) both render the same small pill: a
 * rounded, bordered, 44px-tall target that fills with the primary colour when
 * it is the selected one. The two screens used to be one file and shared this
 * function; the split (M215 spec 03) moved them apart, so the recipe moved
 * here rather than being copied into both. Two literals in two files is how a
 * chip on one page slowly stops looking like a chip on the other.
 *
 * Tokens only, no raw colour (DESIGN.md section 2 and section 11).
 *
 * THE UNCHOSEN CHIP IS NEUTRAL (M243 spec 05b, decision 3). It was a bordered
 * ghost that tinted itself in the brand colour on hover, so a fieldset of five
 * answers offered five brand-coloured invitations and the one already chosen
 * had to shout over them. `CHIP_NEUTRAL` is the shared fill; only the chosen
 * one is teal.
 *
 * @param isSelected - whether this chip is the current answer.
 * @returns the class list for the chip.
 */
import { CHIP_NEUTRAL } from '#app/components/list-row';
import { cn } from '#app/lib/utils';

export function settingsChipClass(isSelected: boolean): string {
  return cn(
    CHIP_NEUTRAL,
    'inline-flex min-h-11 items-center justify-center border border-transparent px-4 py-2 text-xs font-medium transition-colors hover:bg-muted/70',
    isSelected && 'border-primary bg-primary text-primary-foreground',
  );
}
