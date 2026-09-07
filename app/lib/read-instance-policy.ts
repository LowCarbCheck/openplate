/**
 * The instance's policy, read from a route's SERVER LOADER, failing OPEN.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * `useInstancePolicy()` is the answer everywhere a hook can run. A
 * `clientLoader` is the one layer where none can: it runs before render, has
 * no access to the root loader's data, and therefore has to get the mode from
 * its own route's server loader. Three routes needed that
 * (`onboarding.tsx`, `settings.ai.tsx` and now `index.tsx`), and the first two
 * each grew a private `readManagedInstance` with the same body and the same
 * paragraph of reasoning above it. Two copies is a coincidence; three is a
 * module, and a fourth copy is how one of them ends up failing CLOSED by
 * accident.
 *
 * ── Failing open is the decision, not the fallback ───────────────────────
 *
 * On a hard load this costs nothing: `clientLoader.hydrate` means the server
 * loader already ran and `serverLoader()` hands back the data that came with
 * the document. Only an in-app navigation fetches, and offline that fetch
 * rejects. Answering with the OPEN policy there is the same choice
 * `getInstancePolicy` makes for an unreadable config: a screen that cannot
 * read its configuration must not lock somebody out of the app on a guess, and
 * a managed instance is unreachable offline anyway.
 *
 * Any other rejection is rethrown. `shouldFallbackOffline` is the one seam
 * that says "this was the network", and swallowing everything here would turn
 * a genuine loader fault into a silently open instance.
 */
import { instancePolicyForMode, type InstancePolicy } from '#app/config/instance-policy';
import { shouldFallbackOffline } from '#app/lib/local-store';

/**
 * The smallest thing a server loader has to return for this to work: the
 * `managed` flag the root config already carries.
 */
export interface InstanceModeLoaderData {
  managed: boolean;
}

/**
 * @param serverLoader - the route's own `serverLoader` from `ClientLoaderArgs`.
 * @returns the policy for this instance, or the open policy when the fetch failed offline.
 */
export async function readInstancePolicy(serverLoader: () => Promise<InstanceModeLoaderData>): Promise<InstancePolicy> {
  try {
    const { managed } = await serverLoader();
    return instancePolicyForMode(managed ? 'managed' : 'open');
  } catch (cause) {
    if (shouldFallbackOffline(cause)) return instancePolicyForMode('open');
    throw cause;
  }
}
