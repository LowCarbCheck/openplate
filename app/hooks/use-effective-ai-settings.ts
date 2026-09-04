/**
 * WHICH AI THIS SCREEN MAY USE, as a hook — the React-visible half of
 * `app/lib/ai/managed-ai-settings.ts` (M192).
 *
 * The rule itself is pure and lives there. This adds the three inputs it needs
 * and nothing else: what kind of instance this is (`PublicConfig`), whether
 * somebody is signed in (`SyncSessionSnapshot`), and which model the instance
 * advertises (its `/health` handshake).
 *
 * ── The handshake is fetched ONCE per server, and cached at module scope ──
 *
 * `/health` is a small, unauthenticated, unchanging document, and every screen
 * that can scan would otherwise ask for it on mount. A module-level cache
 * keyed on the server URL is enough: this app talks to exactly one server, an
 * operator moving it means a new document anyway, and the cache dies with the
 * tab.
 *
 * FAILS OPEN, like the read underneath it: an unreachable service yields `null`
 * for the model, which the resolver turns into managed settings this build will
 * not scan with rather than into an error screen.
 */
import { useEffect, useState } from 'react';

import { usePublicConfig } from '#app/hooks/use-public-config';
import { useSyncSession } from '#app/components/sync-status';
import { resolveEffectiveAiSettings, type EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import type { LocalAiSettings } from '#app/lib/local-store';
import { readServerInstance } from '#app/lib/sync/sync-actions';

/** One in-flight or settled `/health` read per server URL. Shared by every mount in the tab. */
const instanceModelCache = new Map<string, Promise<string | null>>();

function readInstanceModel(serverUrl: string): Promise<string | null> {
  const cached = instanceModelCache.get(serverUrl);
  if (cached !== undefined) return cached;
  const pending = readServerInstance(serverUrl).then((instance) => instance?.ai?.model ?? null);
  instanceModelCache.set(serverUrl, pending);
  return pending;
}

/**
 * The AI this device may use right now, or `null` when it may use none.
 *
 * @param storedSettings - the device's BYOK row, as the caller's loader read it.
 */
export function useEffectiveAiSettings(storedSettings: LocalAiSettings | null): EffectiveAiSettings | null {
  const config = usePublicConfig();
  const session = useSyncSession();
  const managed = config?.managed === true;
  const syncServerUrl = config?.syncServerUrl ?? null;
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    // Only a managed instance has a model to ask about. On an open one the
    // model comes from the person's own BYOK row, and asking `/health` would
    // be a request for a value nothing reads.
    if (!managed || syncServerUrl === null) return;
    let isMounted = true;
    const ask = async (): Promise<void> => {
      // `readServerInstance` fails open and never rejects, so there is nothing
      // here for a catch to do — an unreachable service IS the `null` result.
      const next = await readInstanceModel(syncServerUrl);
      if (isMounted) setModel(next);
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [managed, syncServerUrl]);

  return resolveEffectiveAiSettings({ instance: { managed, syncServerUrl, model }, session, storedSettings });
}
