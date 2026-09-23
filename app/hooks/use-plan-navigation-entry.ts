/**
 * WHETHER THE NAVIGATION DRAWS THE PLAN ENTRY (M250), asked once, in the app
 * shell, and handed to the sidebar and the drawer.
 *
 * Two facts, and both must hold. The person is signed in: a plan belongs to
 * an account, and the plan page says only "sign in" to anybody else. And the
 * instance sells plans, read the way the plan page's own gate reads it
 * (M245/05, `plans-door.ts`): from a descriptor fetched for this server when
 * the shell mounted, and replaced by every later read, so an operator who
 * switches the biller off takes the entry away instead of leaving a door to a
 * 404. `null`, an unreachable server or a read still in flight, is no entry:
 * unknown must not offer to sell somebody something.
 */
import { useSyncSession } from '#app/components/sync-status';
import { useFreshServerInstance } from '#app/hooks/use-server-instance';
import { hasPlanNavigationEntry } from '#app/lib/plans/plans-door';

/** `true` while the sidebar and the drawer draw the plan entry. */
export function usePlanNavigationEntry(): boolean {
  const instance = useFreshServerInstance();
  const session = useSyncSession();
  return hasPlanNavigationEntry({ instance, isSignedIn: session.account !== null });
}
