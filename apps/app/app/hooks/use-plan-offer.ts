/**
 * `GET /plans/offer`, read for a placement (M250/02).
 *
 * The offer is what an instance sells, in one language, and it is DATA: the
 * prices and every sentence about the order come from the biller. A placement
 * draws it or draws nothing, so this hook answers the offer or `null`, and
 * `null` covers an instance with no biller, a biller older than the route, a
 * body that does not decode and a request that failed. Unknown must not sell.
 *
 * `settled` is separate from the offer itself so a page can hold its own
 * layout until the answer is in, rather than drawing the rest and pushing it
 * down when the cards arrive (DESIGN.md section 7).
 */
import { useEffect, useState } from 'react';

import { currentPlansClient } from '#app/lib/plans/plans-session';
import type { PlanOffer } from '#app/lib/sync/engine/client/plans-wire';

/** Where the offer read is. */
export type OfferReadState = { settled: false } | { settled: true; offer: PlanOffer | null };

/**
 * Reads the offer once per mount, and again when the language changes.
 *
 * @param input.isEnabled - `false` sends nothing and stays unsettled. A caller
 *   passes whether it would draw the offer at all, so a paying person's plan
 *   page never asks.
 * @param input.locale - the language the texts are wanted in.
 * @param input.refresh - a counter; a new value reads the offer again. The
 *   answer on screen stays until the new one is in, so a re-read never
 *   blanks the page. The order page bumps it when the biller says the page
 *   the person read is stale (M245/04).
 */
export function usePlanOffer({
  isEnabled,
  locale,
  refresh = 0,
}: {
  isEnabled: boolean;
  locale: string;
  refresh?: number;
}): OfferReadState {
  const [state, setState] = useState<OfferReadState>({ settled: false });

  useEffect(() => {
    if (!isEnabled) return;
    let isMounted = true;
    const read = async (): Promise<void> => {
      const client = currentPlansClient();
      if (client === null) {
        if (isMounted) setState({ settled: true, offer: null });
        return;
      }
      try {
        const outcome = await client.readOffer({ locale });
        if (isMounted) setState({ settled: true, offer: outcome.status === 'ok' ? outcome.value : null });
      } catch {
        if (isMounted) setState({ settled: true, offer: null });
      }
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [isEnabled, locale, refresh]);

  return state;
}
