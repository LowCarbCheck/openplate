/**
 * The operator's note on an account, such as "Beta supporter", drawn as a
 * small chip on a person's row and on their page.
 *
 * ── The text is the operator's, so it is not translated ──────────────────
 *
 * An administrator typed it, in whatever language they work in, and the chip
 * shows exactly that. It carries no copy key of its own.
 *
 * ── It never pushes the page sideways ────────────────────────────────────
 *
 * A label can be 40 characters, wider than a phone has room for beside
 * anything else. So the chip is capped (`max-w-full` here, narrower where the
 * caller says so) and cuts its text with an ellipsis instead of wrapping or
 * overflowing. The ellipsis sits on the inner span, because `text-overflow`
 * does not reach the text of an inline-flex box. The full text is in `title`,
 * for the cut one.
 *
 * Where the chip sits, and why that costs no layout shift, is the caller's
 * business: `people-table.tsx` says it for the row.
 */
import { Badge } from '#app/components/ui/badge';
import { cn } from '#app/lib/utils';

export interface AccountLabelChipProps {
  /** The label as the core stored it: trimmed, one line, at most 40 characters. */
  label: string;
  /** Placement classes from the caller, merged over the chip's own. */
  className?: string;
}

export function AccountLabelChip({ label, className }: AccountLabelChipProps) {
  return (
    <Badge variant="secondary" data-slot="account-label" title={label} className={cn('min-w-0 max-w-full', className)}>
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
}
