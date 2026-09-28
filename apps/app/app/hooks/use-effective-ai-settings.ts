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
 * that can scan would otherwise ask for it on mount. That read and its cache
 * live in `#app/hooks/use-server-instance` now, because the model is no longer
 * the only thing the document answers: the consent step reads the retention
 * window off the same body, and two caches would mean two requests for one
 * document.
 *
 * FAILS OPEN, like the read underneath it: an unreachable service yields `null`
 * for the model, which the resolver turns into managed settings this build will
 * not scan with rather than into an error screen.
 */
import { useEffect, useState } from 'react';

import { useInstancePolicy, usePublicConfig } from '#app/hooks/use-public-config';
import { useSyncSession } from '#app/components/sync-status';
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { resolveEffectiveAiSettings, type EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import type { LocalAiSettings } from '#app/lib/local-store';

/**
 * The AI this device may use right now, or `null` when it may use none.
 *
 * @param storedSettings - the device's BYOK row, as the caller's loader read it.
 */
export function useEffectiveAiSettings(storedSettings: LocalAiSettings | null): EffectiveAiSettings | null {
  const config = usePublicConfig();
  const session = useSyncSession();
  // THE POLICY, not `config.managed` (M201/07). This was the one reader that
  // opened the config object and compared the flag itself, which is exactly
  // how a second definition of "managed" gets born. The question it wants is
  // whether the AI comes from the instance; `ManagedInstanceFacts.managed`
  // keeps its name because that resolver is about the AI and nothing else.
  const { aiComesFromTheInstance: managed } = useInstancePolicy();
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
      const instance = await readCachedServerInstance(syncServerUrl);
      if (isMounted) setModel(instance?.ai?.model ?? null);
    };
    void ask();
    return () => {
      isMounted = false;
    };
  }, [managed, syncServerUrl]);

  return resolveEffectiveAiSettings({ instance: { managed, syncServerUrl, model }, session, storedSettings });
}
