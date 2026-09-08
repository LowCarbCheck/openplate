/**
 * Whether this device has an AI provider connected, read once after hydration.
 *
 * IT IS A HOOK BECAUSE THE ANSWER IS AN INDEXEDDB ROUND TRIP, and every
 * add-food surface needs it before it can promise anything: the camera gesture
 * must not ask for a permission the feature cannot use
 * (`use-camera-capture.ts`), and the search screen must not offer "Log with AI"
 * to somebody who has no AI. One read, one rule, two surfaces.
 *
 * `unknown` is its own member and is NEVER treated as connected. The read only
 * starts after hydration, and in that window the honest answer is that nobody
 * knows yet — so both callers behave exactly as they do for a device with no
 * provider, and correct themselves a moment later rather than promising first.
 */
import { useEffect, useState } from 'react';
import { getLocalAiSettings } from '#app/lib/local-store';

export type AiConnection = 'unknown' | 'connected' | 'absent';

export function useAiConnection(): AiConnection {
  const [connection, setConnection] = useState<AiConnection>('unknown');

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      const settings = await getLocalAiSettings();
      if (isMounted) setConnection(settings === null ? 'absent' : 'connected');
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  return connection;
}
