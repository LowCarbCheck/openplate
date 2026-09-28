/**
 * An alternate STRUCTURE for the "Wie gestern" affordance, for review only.
 *
 * The shipped door is `#app/components/repeat-yesterday-door`: a button above
 * the add-entry row, which puts a fourth thing to press next to three things to
 * press. The concept here is not a fourth button; it is a line of the page's
 * own text with the verb at the end of it.
 *
 * Concept C, the ghost card, WAS REVIEWED AND SHIPPED: `RepeatYesterdayGhost`
 * lives beside the door in `#app/components/repeat-yesterday-door` and
 * `/dashboard` renders it. The playground imports it from there rather than
 * keeping a second copy.
 *
 * The mechanism is the shipped one: `useCopyDoor` and `CopyFields` come from
 * the same module as the door, so this variant posts the same `copy-yesterday`
 * intent to `/diary` with the same fields and shares the same toast.
 */
import type { ReactElement } from 'react';

import type { RepeatYesterdayOffer } from '#app/lib/copy-day';
import { CopyFields, useCopyDoor } from '#app/components/repeat-yesterday-door';
import { cn } from '#app/lib/utils';
import { CopyPlus } from 'lucide-react';

type VariantProps = {
  offer: RepeatYesterdayOffer | null;
  className?: string;
};

function RepeatYesterdayEyebrowBody({
  offer,
  className,
}: {
  offer: RepeatYesterdayOffer;
  className?: string;
}): ReactElement {
  const { label, hint, hintId, isCopying, Form } = useCopyDoor(offer);

  return (
    <Form method="post" action="/diary" className={className}>
      <CopyFields targetDate={offer.targetDate} />
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <p id={hintId} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {hint}
        </p>
        <button
          type="submit"
          disabled={isCopying}
          aria-describedby={hintId}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 px-1.5 py-1 text-sm font-semibold text-primary underline decoration-primary/40 decoration-dashed underline-offset-4 transition-colors hover:decoration-primary hover:decoration-solid disabled:opacity-60',
            isCopying && 'pulse-soft',
          )}
        >
          <CopyPlus className="size-4" aria-hidden="true" />
          {label}
        </button>
      </div>
    </Form>
  );
}

/**
 * Concept D: the eyebrow. It stops being a block and becomes the line of type
 * that introduces the section, with the verb at the end of the sentence and a
 * hairline tying it to what follows. One text line instead of a card keeps the
 * no-scroll phone page intact, and an offer in the page's own voice does not
 * read as a fourth button.
 */
export function RepeatYesterdayEyebrow({ offer, className }: VariantProps): ReactElement | null {
  if (offer === null) return null;
  return <RepeatYesterdayEyebrowBody offer={offer} className={className} />;
}
