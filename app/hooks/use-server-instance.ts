/**
 * WHAT THE SYNC SERVER SAYS ABOUT ITSELF, as a hook.
 *
 * `/health` is one small, unauthenticated document that answers several
 * questions a screen has: which model this instance proxies, and how long it
 * keeps a photograph somebody reports. Both used to be two separate concerns
 * with one read between them; this is that read, in one place, so a second
 * consumer does not mean a second request.
 *
 * FETCHED ONCE PER SERVER AND CACHED AT MODULE SCOPE. Every screen that can
 * scan, and every entry that can be reported, would otherwise ask on mount. The
 * document does not change while a tab is open, this app talks to exactly one
 * server, and an operator moving it means a new document anyway. The cache dies
 * with the tab.
 *
 * FAILS OPEN, like the read underneath it: an unreachable service, a malformed
 * body or a service older than the fields all yield `null`. Every caller must
 * treat `null` as "not known", never as a licence to substitute a default of
 * its own, see {@link useFeedbackRetentionDays}.
 */
import { useEffect, useState } from 'react';

import { usePublicConfig } from '#app/hooks/use-public-config';
import { readServerInstance } from '#app/lib/sync/sync-actions';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';

/** One in-flight or settled `/health` read per server URL. Shared by every mount in the tab. */
const instanceCache = new Map<string, Promise<InstanceDescriptor | null>>();

/** The instance descriptor for a server, read at most once per tab. Never rejects. */
export function readCachedServerInstance(serverUrl: string): Promise<InstanceDescriptor | null> {
  const cached = instanceCache.get(serverUrl);
  if (cached !== undefined) return cached;
  const pending = readServerInstance(serverUrl);
  instanceCache.set(serverUrl, pending);
  return pending;
}

/**
 * What this app's sync server says about itself, or `null` while the answer is
 * unknown: no sync server configured, the read still in flight, or a service
 * that could not be reached.
 */
export function useServerInstance(): InstanceDescriptor | null {
  const config = usePublicConfig();
  const syncServerUrl = config?.syncServerUrl ?? null;
  const [instance, setInstance] = useState<InstanceDescriptor | null>(null);

  useEffect(() => {
    // No sync server on this instance means nothing to ask and nothing that
    // could act on the answer.
    if (syncServerUrl === null) return;
    let isMounted = true;
    const ask = async (): Promise<void> => {
      // `readServerInstance` fails open and never rejects, so there is nothing
      // here for a catch to do: an unreachable service IS the `null` result.
      const next = await readCachedServerInstance(syncServerUrl);
      if (isMounted) setInstance(next);
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [syncServerUrl]);

  return instance;
}

/**
 * How long THIS server keeps a reported photograph, in days, or `null` when it
 * has not said.
 *
 * `null` IS NOT A NUMBER WAITING TO BE FILLED IN. It means one of: no sync
 * server, a server with reports switched off, a server older than the field, or
 * an answer that has not arrived. In every one of those cases this app knows of
 * no promise, so it must state none. The number it used to print came from a
 * constant in this repository, which is exactly the defect: an operator who
 * changed the window on their server left the app promising the old one to
 * somebody about to hand over a photograph of their food.
 */
export function useFeedbackRetentionDays(): number | null {
  return useServerInstance()?.feedback?.retentionDays ?? null;
}
