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
 * The ACCOUNT DOOR the header menu offers, if any (M201 spec 02 and 03).
 *
 * Four states, named, because the menu had one and let the others fall through
 * it. A managed instance signed out showed "Create account", which on an
 * invite-only instance is a promise nobody can keep; signed in it showed no
 * way out at all, which is what sent people into the Danger Zone of
 * `/settings/account` looking for one.
 *
 * The fourth was the same fault one level down. Signing in and creating an
 * account are not alternatives: on an OPEN instance with a sync server ANYBODY
 * may make an account, AND somebody who already has one and was signed out
 * needs the way back in. Offering only creation there left a returning person
 * with no route to sign in from this menu at all, while the screen behind it
 * (`/settings/account`) offered the link the menu was hiding. So that case is
 * its own state carrying BOTH rows, rather than a single door this menu has to
 * guess at.
 */
export type AvatarMenuDoor =
  /** No sync on this instance: no account, no door, nothing to say (AGENTS.md). */
  | 'none'
  /** A session is open: the way out. */
  | 'sign-out'
  /** No session, and this instance requires one: the way in, and only that. */
  | 'sign-in'
  /** No session on an instance where accounts are open to all: the way in, and the way to make one. */
  | 'sign-in-or-create';

/**
 * Which door the menu shows.
 *
 * ── The two questions this must not conflate ─────────────────────────────
 *
 * `hasSyncServer` is "may any sync UI render here" and `requiresAccount` is
 * "does a person need an account to use this instance at all". They are
 * genuinely different, and the difference is a real deployment: a self-hoster
 * who sets `SYNC_SERVER_URL` on an OPEN instance has sync, no accounts, and an
 * anonymous diary that works. On that instance "Create account" is honest, and
 * so is "Sign in", so this returns the state that carries both.
 * `app/config/instance-policy.ts` documents the trap.
 *
 * @param hasSyncServer - `useSyncServerUrl() !== null`.
 * @param hasSession - is somebody signed in on this device right now?
 * @param requiresAccount - `InstancePolicy.requiresAccount`.
 */
export function resolveAvatarMenuDoor({
  hasSyncServer,
  hasSession,
  requiresAccount,
}: {
  hasSyncServer: boolean;
  hasSession: boolean;
  requiresAccount: boolean;
}): AvatarMenuDoor {
  // FIRST, and unconditionally: an instance with no sync server mentions no
  // account anywhere. A managed instance always has one (`isManagedInstance`
  // refuses to boot without it), so this branch can never hide a needed door.
  if (!hasSyncServer) return 'none';
  if (hasSession) return 'sign-out';
  // Both are true on an open instance, so the answer is both rows and not a
  // choice between them; `requiresAccount` only removes the creation one.
  if (requiresAccount) return 'sign-in';
  return 'sign-in-or-create';
}

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
