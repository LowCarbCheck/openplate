/**
 * "Your usual breakfast", under the intake input on `/add` and `/scan`
 * (M227/01).
 *
 * ── What it is for ───────────────────────────────────────────────────────
 *
 * Somebody who eats the same porridge every morning should not have to search
 * for it every morning. The section offers what this person normally eats AT
 * THIS TIME OF DAY, and one tap logs it into today's slot.
 *
 * ── It does not choose the slot ──────────────────────────────────────────
 *
 * The slot is a PROP, resolved by the screen that renders this: `/add` from
 * `mealTypeForTime`, `/scan` from `mealTypeForCapture`. The section is
 * deliberately NOT independently slot-selectable, it mirrors the default the
 * route already computed for a fresh log, so the offer and the entry it
 * produces can never disagree. A picker here would be a second answer to a
 * question the route has already answered.
 *
 * ── Empty renders nothing ────────────────────────────────────────────────
 *
 * No placeholder, no "nothing usual yet" panel. A person with no habit yet has
 * nothing to gain from a box telling them so, and the screen's real input sits
 * directly above.
 *
 * ── Presentational ───────────────────────────────────────────────────────
 *
 * Props only, no store read, no clock. The offers come from the route's
 * loader and the tap posts back to the route's own action, which is where the
 * write lives (`#app/lib/usual-at-slot`).
 */
import type { ReactElement } from 'react';
import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Utensils, Repeat } from 'lucide-react';

import type { MealType } from '#types/enums';
import type { UsualAtSlotOffer } from '#app/lib/local-store';
import { LOG_USUAL_INTENT } from '#app/lib/usual-at-slot';
import { SectionEyebrow } from '#app/components/typography';
import { cn } from '#app/lib/utils';
import { CHIP_NEUTRAL } from '#app/components/list-row';

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

/** One tapped offer: a submit button carrying its id and the slot it was offered under. */
function UsualOfferButton({ offer, slot }: { offer: UsualAtSlotOffer; slot: MealType }): ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const isLogging = fetcher.state !== 'idle';
  const isBundle = offer.kind === 'saved-meal';

  return (
    <fetcher.Form method="post" data-slot="usual-offer" data-usual-kind={offer.kind}>
      <input type="hidden" name="_intent" value={LOG_USUAL_INTENT} />
      <input type="hidden" name="suggestionId" value={offer.id} />
      {/* The slot the screen OFFERED under travels with the tap, so the entry
          is filed where the person was told it would go, even if the clock
          crosses a window boundary while the page is open. */}
      <input type="hidden" name="slot" value={slot} />
      {/* 44 px, the app's tap floor (M243 spec 05b). It was 40, and it only
          ever showed up as a failure when the clock happened to land in the
          same meal window as a habit, which is a flake the floor removes. */}
      <button
        type="submit"
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
    </fetcher.Form>
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
