/**
 * Where the admin page gets its client: the session that is already open.
 *
 * SEPARATE FROM `admin-client.ts` on purpose. That file is a pure wrapper over
 * a transport it is handed, which is what lets its tests drive every endpoint
 * without a browser. This one reaches into module state for the live vault,
 * and keeping the reach here means the client never grew a hidden dependency
 * on a signed-in session that a test would have to fake.
 */
import { AdminClient } from './admin-client';
import { getSyncVault } from '../sync/sync-session';

/**
 * The admin client for the signed-in account, or `null` when no session is
 * open.
 *
 * `null` IS NOT "you are not an administrator". It is "there is nobody here
 * yet", which on a fresh reload is temporary. The page decides what it is from
 * the session snapshot's role, never from this.
 */
export function currentAdminClient(): AdminClient | null {
  const vault = getSyncVault();
  if (vault === null) return null;
  return new AdminClient({ transport: vault.authClient });
}
