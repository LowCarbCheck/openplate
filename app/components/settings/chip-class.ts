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
 * @param isSelected - whether this chip is the current answer.
 * @returns the class list for the chip.
 */
import { cn } from '#app/lib/utils';

export function settingsChipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
  );
}
