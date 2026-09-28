/**
 * What `/join` does about the session this device already holds, decided in
 * one pure function.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * The invitation and this app's own configuration decide. A value the device
 * saved earlier never blocks a new invitation unless it is a LIVE session for
 * another account on this app's server, and then the page says so and offers a
 * way on.
 *
 * - No session: the invitation goes ahead.
 * - A session saved for ANOTHER server: stale. The operator has since moved
 *   this app to a different server, so those tokens mean nothing here, and a
 *   reload would discard them unread (`performResume` in `session-cache.ts`
 *   compares the same two strings). `/join` forgets it and goes ahead.
 * - A session for the invited address: goes ahead. The service answers the
 *   signup with `409`, and the page already turns that into "go to sign in".
 * - A session for SOMEBODY ELSE on this server: the person is told who is
 *   signed in and who was invited. Two people share a laptop, and redeeming
 *   one person's invitation over the other's open session would move a diary
 *   out from under somebody still using it. Signing out is offered, never done
 *   for them.
 *
 * ── Why the server is compared as an exact string ────────────────────────
 *
 * Both sides come from the same place: the cached `serverUrl` was written from
 * this app's configured sync address when the session opened, and the resume
 * compares them exactly. Comparing by origin here would call a session live
 * that the resume is about to throw away.
 */
import type { DeviceSessionIdentity } from '#app/lib/sync/session-cache';

/** What `/join` does about the session it found. */
export type DeviceSessionVerdict =
  | { kind: 'none' }
  | { kind: 'stale' }
  | { kind: 'same-account' }
  | { kind: 'other-account'; signedInAs: string };

/**
 * @param session - the open or cached session, or `null` when the device holds none.
 * @param configuredSyncUrl - this app's sync address, from its own configuration.
 * @param invitedEmail - the address the invitation was written to, as the service reported it.
 */
export function judgeDeviceSession({
  session,
  configuredSyncUrl,
  invitedEmail,
}: {
  session: DeviceSessionIdentity | null;
  configuredSyncUrl: string;
  invitedEmail: string;
}): DeviceSessionVerdict {
  if (session === null) return { kind: 'none' };
  if (session.serverUrl !== configuredSyncUrl) return { kind: 'stale' };
  if (isSameAddress({ left: session.email, right: invitedEmail })) return { kind: 'same-account' };
  return { kind: 'other-account', signedInAs: session.email };
}

/** Email addresses compared the way a person reads them: case and surrounding space do not count. */
function isSameAddress({ left, right }: { left: string; right: string }): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
