/**
 * The anonymous price read (`public-plan-prices.ts`), as a hook for the two
 * logged-out screens that state a price: `/sign-up` and the landing.
 *
 * FOUR STATES, because each draws something different:
 *
 * - `idle`: the caller did not ask, because the instance sells no plans or
 *   the handshake has not answered. No price line exists at all.
 * - `loading`: asked, not answered. The line's box is already drawn, empty.
 * - `ready`: both prices, to be formatted in the reader's language.
 * - `unavailable`: asked and answered with nothing usable. The line says the
 *   sentence without a price.
 */
import { useEffect, useState } from 'react';

import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { readCachedPublicPlanPrices, type PublicPlanPrices } from '#app/lib/plans/public-plan-prices';

/** What a screen knows about the prices right now. */
export type PublicPricesRead =
  { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; prices: PublicPlanPrices } | { kind: 'unavailable' };

/**
 * @param input.isEnabled - `true` once the handshake says this instance sells
 *   plans and the screen will show a price line.
 */
export function usePublicPlanPrices({ isEnabled }: { isEnabled: boolean }): PublicPricesRead {
  const serverUrl = useSyncServerUrl();
  const [read, setRead] = useState<{ url: string; prices: PublicPlanPrices | null } | null>(null);
  const isAsking = isEnabled && serverUrl !== null;

  useEffect(() => {
    if (!isAsking || serverUrl === null) return;
    let isMounted = true;
    const ask = async (): Promise<void> => {
      // `readCachedPublicPlanPrices` never rejects: a failure IS the `null` answer.
      const prices = await readCachedPublicPlanPrices(serverUrl);
      if (isMounted) setRead({ url: serverUrl, prices });
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [isAsking, serverUrl]);

  if (!isAsking) return { kind: 'idle' };
  // An answer about another server is no answer about this one.
  if (read === null || read.url !== serverUrl) return { kind: 'loading' };
  return read.prices === null ? { kind: 'unavailable' } : { kind: 'ready', prices: read.prices };
}
