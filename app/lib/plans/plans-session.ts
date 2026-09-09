/**
 * Where the plan page gets its client: the session that is already open.
 *
 * SEPARATE FROM `plans-client.ts` on purpose, exactly as `admin-session.ts` is
 * separate from `admin-client.ts`. That file is a pure wrapper over a
 * transport it is handed, which is what lets its contract test drive all three
 * routes without a browser. This one reaches into module state for the live
 * vault, and keeping the reach here means the client never grows a hidden
 * dependency on a signed-in session that a test would have to fake.
 */
import { PlansClient } from '#app/lib/sync/engine/client/plans-client';
import { getSyncVault } from '#app/lib/sync/sync-session';

/**
 * The plan client for the signed-in account, or `null` when no session is
 * open.
 *
 * `null` IS NOT "this instance sells no plans". That question is answered by
 * the handshake (`plans-door.ts`), before anybody asks this. `null` here is
 * "there is nobody signed in yet", which on a fresh reload is temporary.
 */
export function currentPlansClient(): PlansClient | null {
  const vault = getSyncVault();
  if (vault === null) return null;
  return new PlansClient({ transport: vault.authClient });
}
