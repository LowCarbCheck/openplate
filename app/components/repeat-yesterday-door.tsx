/**
 * "Wie gestern", one tap that repeats yesterday, from wherever the person is.
 *
 * Two surfaces live here, and they submit the SAME thing. `RepeatYesterdayDoor`
 * is the pill button, on `/describe`. `RepeatYesterdayGhost` is the dashed card
 * that draws the day it would bring over, on `/dashboard`, where a fourth thing
 * to press beside the three add-entry controls was the complaint. Both take
 * their fields, their label, their hint and their toast from `useCopyDoor`
 * below, so only the surface differs.
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

/** Everything a repeat surface needs, so a surface only decides where to draw it. */
type CopyDoor = {
  /** The button's own words, which become "copying" while the submit is in flight. */
  label: string;
  /** How many entries the copy would bring over, as a sentence. */
  hint: string;
  /** The id the hint element carries and the button points at with `aria-describedby`. */
  hintId: string;
  isCopying: boolean;
  Form: ReturnType<typeof useFetcher<CopyYesterdayResult>>['Form'];
};

/**
 * The one repeat-yesterday mechanism, shared by every surface below.
 *
 * The toast and its Undo come from `useCopyYesterdayToast`, so one copy is
 * announced once no matter which surface sent it.
 *
 * @param offer - `selectRepeatYesterday`'s answer for an eligible day.
 */
export function useCopyDoor(offer: RepeatYesterdayOffer): CopyDoor {
  const { t } = useTranslation();
  const copyFetcher = useFetcher<CopyYesterdayResult>();
  const hintId = useId();
  useCopyYesterdayToast({ data: copyFetcher.data });

  const isCopying = copyFetcher.state !== 'idle';
  return {
    label: isCopying ? t('diary.copy.copying') : t('diary.copy.door'),
    hint: t('diary.copy.doorHint', { count: offer.sourceCount }),
    hintId,
    isCopying,
    Form: copyFetcher.Form,
  };
}

/**
 * The submitted fields, which are the diary's own whole-day copy.
 *
 * No `mealType` field: its absence is what tells `handleCopyYesterday` to take
 * the whole day, which is the only thing these surfaces offer.
 *
 * @param targetDate - the day the entries are copied ONTO.
 */
export function CopyFields({ targetDate }: { targetDate: string }): ReactElement {
  return (
    <>
      <input type="hidden" name="_intent" value="copy-yesterday" />
      <input type="hidden" name="date" value={targetDate} />
    </>
  );
}

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
  const { label, hint, hintId, isCopying, Form } = useCopyDoor(offer);

  return (
    <Form method="post" action="/diary" className={cn('space-y-1', className)}>
      <CopyFields targetDate={offer.targetDate} />
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
        {label}
      </button>
      {/* The count is the whole answer to "what will this do to my day", so it
          is on the screen and not only in the accessible name. */}
      <p id={hintId} className="text-center text-xs text-muted-foreground">
        {hint}
      </p>
    </Form>
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

/**
 * The ghost rows the card draws. Ragged widths so the stack reads as entries
 * rather than as a loading skeleton, and at most three, because the sentence
 * under them already carries the real number.
 */
const GHOST_ROW_WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3'] as const;

/**
 * The dashed card, rendered only when there is something to repeat. Split from
 * the wrapper below so the hooks are never behind a condition.
 */
function RepeatYesterdayGhostBody({
  offer,
  className,
}: {
  offer: RepeatYesterdayOffer;
  className?: string;
}): ReactElement {
  const { label, hint, hintId, isCopying, Form } = useCopyDoor(offer);
  const ghostRows = GHOST_ROW_WIDTHS.slice(0, Math.max(1, Math.min(offer.sourceCount, GHOST_ROW_WIDTHS.length)));

  return (
    <Form method="post" action="/diary" className={className}>
      <CopyFields targetDate={offer.targetDate} />
      <button
        type="submit"
        disabled={isCopying}
        aria-describedby={hintId}
        className={cn(
          'block w-full rounded-2xl border border-dashed border-primary/35 bg-card/50 p-3 text-left transition-all hover:border-primary/70 hover:bg-primary/5 hover:shadow-md hover:shadow-black/20 disabled:opacity-60 motion-safe:active:scale-[0.99]',
          isCopying && 'pulse-soft',
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{label}</span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CopyPlus className="size-4" aria-hidden="true" />
          </span>
        </span>
        <span className="mt-2.5 flex flex-col gap-1.5" aria-hidden="true">
          {ghostRows.map((width) => (
            <span
              key={width}
              className={cn('h-2 rounded-full border border-dashed border-primary/30 bg-primary/5', width)}
            />
          ))}
        </span>
        {/* The hint is drawn INSIDE the card, because the card is the button,
            but it is hidden from the name computation: a button whose
            accessible name repeated its own description read as one long
            sentence to a screen reader, and `aria-describedby` still reaches a
            hidden element, which is what makes the count reach the user once
            rather than twice. */}
        <span id={hintId} aria-hidden="true" className="mt-2.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </button>
    </Form>
  );
}

/**
 * Renders the "Wie gestern" ghost card, or nothing.
 *
 * A card that shows the day rather than a button that names a command: the
 * dashed stack is yesterday drawn faintly onto today, so the outcome is the
 * picture and the count is a caption under it. It is a different KIND of thing
 * from the three add-entry controls beside it on `/dashboard`, so it stops
 * competing with them.
 *
 * @param offer - `selectRepeatYesterday`'s answer; null means no card.
 * @param className - passed to the form wrapper.
 */
export function RepeatYesterdayGhost({
  offer,
  className,
}: {
  offer: RepeatYesterdayOffer | null;
  className?: string;
}): ReactElement | null {
  if (offer === null) return null;
  return <RepeatYesterdayGhostBody offer={offer} className={className} />;
}
