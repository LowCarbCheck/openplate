/**
 * "Wie gestern", one tap that repeats yesterday, from wherever the person is.
 *
 * ── Why it exists (M217) ─────────────────────────────────────────────────
 *
 * A user who eats the same thing most days asked for a "wie gestern" button.
 * Three doors for that already shipped, and they found none of them: the diary
 * has a copy section, an entry has "log this again", and `/meals` holds saved
 * meals. All three are on a screen they were not on when they thought of it.
 * So this is a DOOR, not a mechanism: it writes nothing itself.
 *
 * ── One flow, one Undo ───────────────────────────────────────────────────
 *
 * It posts the diary's EXISTING `copy-yesterday` intent to `/diary`, with the
 * target day and no meal, which is the whole-day copy the diary's "All" chip
 * already sends. Same handler, same batch id, same Undo, same Matomo event.
 * The toast and its Undo come from `useCopyYesterdayToast`, shared with the
 * diary's chips, so one copy is announced once.
 *
 * ── Conditional, always ──────────────────────────────────────────────────
 *
 * `offer` is `selectRepeatYesterday`'s answer. Null renders nothing at all,
 * so a day with nothing to repeat leaves the dashboard's no-scroll phone page
 * exactly as it was.
 */
import type { ReactElement } from 'react';
import { useId } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CopyPlus } from 'lucide-react';

import type { RepeatYesterdayOffer } from '#app/lib/copy-day';
import { useCopyYesterdayToast, type CopyYesterdayResult } from '#app/hooks/use-copy-yesterday-toast';
import { cn } from '#app/lib/utils';

/**
 * The door itself, rendered only when there is something to repeat. Split from
 * the wrapper below so the hooks are never behind a condition.
 */
function RepeatYesterdayButton({
  offer,
  className,
}: {
  offer: RepeatYesterdayOffer;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const copyFetcher = useFetcher<CopyYesterdayResult>();
  const hintId = useId();
  const isCopying = copyFetcher.state !== 'idle';

  useCopyYesterdayToast({ data: copyFetcher.data });

  return (
    <copyFetcher.Form method="post" action="/diary" className={cn('space-y-1', className)}>
      <input type="hidden" name="_intent" value="copy-yesterday" />
      <input type="hidden" name="date" value={offer.targetDate} />
      {/* No `mealType` field: its absence is what tells `handleCopyYesterday`
          to take the whole day, which is the only thing this door offers. */}
      <button
        type="submit"
        disabled={isCopying}
        aria-describedby={hintId}
        className={cn(
          'inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-primary/50 bg-card/60 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-60',
          isCopying && 'pulse-soft',
        )}
      >
        <CopyPlus className="h-4 w-4" aria-hidden="true" />
        {isCopying ? t('diary.copy.copying') : t('diary.copy.door')}
      </button>
      {/* The count is the whole answer to "what will this do to my day", so it
          is on the screen and not only in the accessible name. */}
      <p id={hintId} className="text-center text-xs text-muted-foreground">
        {t('diary.copy.doorHint', { count: offer.sourceCount })}
      </p>
    </copyFetcher.Form>
  );
}

/**
 * Renders the "Wie gestern" door, or nothing.
 *
 * @param offer - `selectRepeatYesterday`'s answer; null means no door.
 * @param className - passed to the form wrapper.
 */
export function RepeatYesterdayDoor({
  offer,
  className,
}: {
  offer: RepeatYesterdayOffer | null;
  className?: string;
}): ReactElement | null {
  if (offer === null) return null;
  return <RepeatYesterdayButton offer={offer} className={className} />;
}
