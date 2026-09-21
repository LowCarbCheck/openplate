/**
 * "Your usual breakfast", under the intake input on `/add` and `/scan`
 * (M227/01).
 *
 * ── What it is for ───────────────────────────────────────────────────────
 *
 * Somebody who eats the same porridge every morning should not have to search
 * for it every morning. The section offers what this person normally eats AT
 * THIS TIME OF DAY. A tap opens a small dialog naming the offer and letting
 * the person adjust the portion (default 100%, exactly what was recorded);
 * confirming there is what logs it into today's slot. This replaced a bare
 * one-tap log after a product review: a habit is still one tap away, it is
 * just a tap on "confirm" instead of on the chip itself.
 *
 * ── It does not choose the slot ──────────────────────────────────────────
 *
 * The slot is a PROP, resolved by the screen that renders this: `/add` from
 * `mealTypeForTime`, `/scan` from `mealTypeForCapture`. The section is
 * deliberately NOT independently slot-selectable, it mirrors the default the
 * route already computed for a fresh log, so the offer and the entry it
 * produces can never disagree. A picker here would be a second answer to a
 * question the route has already answered. The confirm dialog inherits this:
 * it adjusts the PORTION and nothing else, on purpose, there is no slot
 * control inside it either.
 *
 * ── Empty renders nothing ────────────────────────────────────────────────
 *
 * No placeholder, no "nothing usual yet" panel. A person with no habit yet has
 * nothing to gain from a box telling them so, and the screen's real input sits
 * directly above.
 *
 * ── Presentational ───────────────────────────────────────────────────────
 *
 * Props only, no store read, no clock (the dialog's open/scale state is
 * local UI state, not a store read). The offers come from the route's loader
 * and the confirm tap posts back to the route's own action, which is where
 * the write lives (`#app/lib/usual-at-slot`).
 */
import { useId, useState, type ReactElement } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Repeat, Utensils } from 'lucide-react';

import type { MealType } from '#types/enums';
import type { UsualAtSlotOffer } from '#app/lib/local-store';
import { LOG_USUAL_INTENT } from '#app/lib/usual-at-slot';
import { SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';
import { CHIP_NEUTRAL } from '#app/components/list-row';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Button } from '#app/components/ui/button';
import { Label } from '#app/components/ui/label';

/**
 * The percentages the confirm dialog's portion stepper offers, in display
 * order. 100 is always present: it is the default, and it is today's exact
 * recorded amount, unscaled.
 */
const SCALE_PERCENT_STEPS: readonly number[] = [50, 75, 100, 125, 150, 200];

/**
 * Moves one step along `SCALE_PERCENT_STEPS`, clamped at either end (same
 * shape as `pantry.recipes.tsx`'s `stepServings`, this dialog's nearest
 * sibling stepper).
 */
function stepScalePercent(current: number, direction: 1 | -1): number {
  const index = SCALE_PERCENT_STEPS.indexOf(current);
  const next = index === -1 ? SCALE_PERCENT_STEPS.indexOf(100) : index + direction;
  return SCALE_PERCENT_STEPS[Math.min(Math.max(next, 0), SCALE_PERCENT_STEPS.length - 1)] ?? current;
}

/**
 * One title per slot, rather than one title with the slot interpolated.
 *
 * Four whole sentences cost three extra keys and buy a translator the freedom
 * every language needs: a lowercased meal noun is correct in English and wrong
 * in German, and the article before it changes with the word in half of Europe.
 */
const USUAL_TITLE_KEYS = {
  breakfast: 'usual.title.breakfast',
  lunch: 'usual.title.lunch',
  dinner: 'usual.title.dinner',
  snack: 'usual.title.snack',
} satisfies Record<MealType, string>;

/**
 * One tapped offer: a chip that OPENS a confirm dialog (name, portion
 * stepper, cancel/add) rather than submitting straight away. The write
 * itself still travels as one `fetcher.submit` carrying the suggestion id,
 * the slot it was offered under and the dialog's chosen scale, the same
 * fields the old direct-submit form posted, plus `scalePercent`.
 */
function UsualOfferButton({ offer, slot }: { offer: UsualAtSlotOffer; slot: MealType }): ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const isLogging = fetcher.state !== 'idle';
  const isBundle = offer.kind === 'saved-meal';
  const [open, setOpen] = useState(false);
  const [scalePercent, setScalePercent] = useState<number>(100);
  const scaleOutputId = useId();

  /** Every close (Cancel, outside tap, Escape, or a confirmed tap) resets the stepper, so the next open always starts at 100%. */
  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setScalePercent(100);
  }

  function handleConfirm(): void {
    const form = new FormData();
    form.set('_intent', LOG_USUAL_INTENT);
    form.set('suggestionId', offer.id);
    // The slot the screen OFFERED under travels with the tap, so the entry
    // is filed where the person was told it would go, even if the clock
    // crosses a window boundary while the dialog is open.
    form.set('slot', slot);
    form.set('scalePercent', String(scalePercent));
    fetcher.submit(form, { method: 'post' });
  }

  return (
    <div data-slot="usual-offer" data-usual-kind={offer.kind}>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          {/* 44 px, the app's tap floor (M243 spec 05b). It was 40, and it only
              ever showed up as a failure when the clock happened to land in the
              same meal window as a habit, which is a flake the floor removes. */}
          <button
            type="button"
            disabled={isLogging}
            className={cn(
              'inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60',
              isLogging && 'pulse-soft',
            )}
          >
            {isBundle ?
              <Utensils className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            : <Repeat className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            {/* THE NAME WRAPS, it is not cut (M243 spec 05b). It was held to 12 rem
                and ellipsed, which in the wider face hid 56 px of a 35 character
                food name: the offer is "log THIS again", so a person who cannot
                read which food it is has nothing to act on. The row already wraps,
                so a second line costs the layout nothing. */}
            <span className="min-w-0 break-words">{offer.name}</span>
            {/* Only a bundle says how many rows it writes. For a single food the
                count is always one, and printing it would be noise. */}
            {isBundle && (
              <span className={cn(CHIP_NEUTRAL, 'text-xs tabular-nums')}>
                {t('usual.itemCount', { count: offer.itemCount })}
              </span>
            )}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent data-slot="usual-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{offer.name}</AlertDialogTitle>
            {/* The bundle's item count, same copy the chip itself prints, so a
                person who opens the dialog straight from a screenshot still
                sees the same figure. A single food gets a plain instruction
                instead: there is nothing to count. */}
            <AlertDialogDescription>
              {isBundle ? t('usual.itemCount', { count: offer.itemCount }) : t('usual.confirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1">
            <Label htmlFor={scaleOutputId}>{t('usual.confirm.portionLabel')}</Label>
            {/* Fixed steps, not free typing, the same shape
                `pantry.recipes.tsx`'s servings-eaten control uses: two 44 px
                icon buttons around a read-only figure, each with its own
                label, because a bare "+" is unreachable by anyone who is not
                looking at it. */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label={t('usual.confirm.decrease')}
                onClick={() => setScalePercent((current) => stepScalePercent(current, -1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <output id={scaleOutputId} className="w-16 text-center text-sm tabular-nums">
                {t('usual.confirm.percent', { percent: scalePercent })}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label={t('usual.confirm.increase')}
                onClick={() => setScalePercent((current) => stepScalePercent(current, 1))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('usual.confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>{t('usual.confirm.add')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Renders the "Your usual <slot>" section, or nothing at all.
 *
 * @param slot - the meal slot the calling route resolved for now.
 * @param offers - `readUsualAtSlot`'s answer; an empty list renders nothing.
 * @param className - passed to the section wrapper.
 */
export function UsualAtSlot({
  slot,
  offers,
  className,
}: {
  slot: MealType;
  offers: readonly UsualAtSlotOffer[];
  className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (offers.length === 0) return null;

  return (
    <section className={cn('space-y-2', className)} data-slot="usual-at-slot" data-meal={slot}>
      <SectionEyebrow as="h2" trailingRule>
        {t(USUAL_TITLE_KEYS[slot])}
      </SectionEyebrow>
      <div className="flex flex-wrap gap-2">
        {offers.map((offer) => (
          <UsualOfferButton key={offer.id} offer={offer} slot={slot} />
        ))}
      </div>
    </section>
  );
}
