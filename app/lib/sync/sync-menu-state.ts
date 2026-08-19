/**
 * sync-menu-state.ts — what the header's device menu should say about sync.
 *
 * Pure, so the branch order (which of "unreachable", "syncing", "waiting",
 * "synced" wins when several are true at once) is a tested decision rather
 * than a chain of `&&`s buried in JSX.
 *
 * The `hidden` case is the AGENTS.md rule, not a UI preference: on an instance
 * with no `SYNC_SERVER_URL` there is no sync feature, so nothing may mention
 * one — no row, no "set it up", no explanation of what's missing.
 */
import type { SyncErrorReason, SyncSessionSnapshot } from './sync-session';

export type SyncMenuState =
  /** No sync server configured on this instance — render nothing at all. */
  | { status: 'hidden' }
  /** Sync exists but this device has no account yet. */
  | { status: 'not-set-up' }
  /** Last cycle stopped for a reason worth naming. Outranks everything else. */
  | { status: 'error'; reason: SyncErrorReason }
  /** A cycle is running right now. */
  | { status: 'syncing' }
  /** Local changes the server has not seen — "synced 5 min ago" would be true but misleading. */
  | { status: 'pending' }
  | { status: 'synced'; lastSyncedAt: number }
  /** Connected, but no cycle has ever completed on this device. */
  | { status: 'never-synced' };

/**
 * @param hasSyncServer - whether the instance is configured for sync at all (`useSyncServerUrl() !== null`).
 * @param session - the live session snapshot.
 */
export function deriveSyncMenuState({
  hasSyncServer,
  session,
}: {
  hasSyncServer: boolean;
  session: SyncSessionSnapshot;
}): SyncMenuState {
  if (!hasSyncServer) return { status: 'hidden' };
  if (session.account === null) return { status: 'not-set-up' };
  if (session.error !== null) return { status: 'error', reason: session.error.reason };
  if (session.phase === 'syncing') return { status: 'syncing' };
  if (session.hasPendingChanges) return { status: 'pending' };
  if (session.lastSyncedAt === null) return { status: 'never-synced' };
  return { status: 'synced', lastSyncedAt: session.lastSyncedAt };
}
