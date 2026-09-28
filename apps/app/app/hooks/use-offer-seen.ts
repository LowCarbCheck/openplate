/**
 * Reports an offer as seen, once, when it is actually on screen (M250/06).
 *
 * "Seen" means VISIBLE, not mounted: an offer rendered below the fold of a
 * long page and never scrolled to was not seen, and counting it would make
 * every placement look like it reaches everybody. So the event waits for an
 * `IntersectionObserver` to report the element in the viewport, fires once,
 * and stops observing. A second render of the same mount fires nothing; a new
 * page view is a new mount and fires again.
 *
 * The event itself respects the instance's analytics level
 * (`matomo-events.ts`), so this hook never has to ask whether tracking is on.
 */
import { useEffect, useRef, type RefObject } from 'react';

import { trackOfferSeen, type OfferPlacement } from '#app/lib/matomo-events';

/**
 * @param input.ref - the element whose visibility counts as the offer being seen.
 * @param input.placement - where the offer is drawn.
 * @param input.isEnabled - `false` observes nothing, for a placement that is
 *   rendered but not yet showing an offer.
 */
export function useOfferSeen({
  ref,
  placement,
  isEnabled = true,
}: {
  ref: RefObject<Element | null>;
  placement: OfferPlacement | null;
  isEnabled?: boolean;
}): void {
  const hasReported = useRef(false);

  useEffect(() => {
    if (!isEnabled || placement === null || hasReported.current) return;
    const element = ref.current;
    if (element === null || globalThis.IntersectionObserver === undefined) return;
    const observer = new IntersectionObserver((entries) => {
      if (hasReported.current) return;
      if (!entries.some((entry) => entry.isIntersecting)) return;
      hasReported.current = true;
      observer.disconnect();
      trackOfferSeen(placement);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, placement, isEnabled]);
}
