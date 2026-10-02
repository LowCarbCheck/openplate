/**
 * What pressing "Sign out" does, as an ordered decision with injected steps
 * (M201 spec 02).
 *
 * ── Why this is not four lines in an onClick ─────────────────────────────
 *
 * The order is the correctness. Revoke, then lock, then erase, then leave, and
 * every one of the three "then"s is load-bearing:
 *
 * - The revoke is BEST EFFORT and comes first so the network gets its chance,
 *   but a failure there must not stop anything after it. This app is
 *   offline-first and a device with no connection has to be able to sign out;
 *   the token family expires on its own, and `SyncAuthClient.logout` already
 *   drops the local tokens before it ever reaches the wire.
 * - The lock comes BEFORE the erase, so an erase that fails still leaves a
 *   device whose diary is closed. The reverse order turns one failure into
 *   two.
 * - The erase is the only step allowed to throw, because it is the only one
 *   whose failure the person has to act on (close the other tab and try
 *   again). It must never be reported as done when it is not.
 * - Leaving the app is a HARD navigation, not a router navigation. This tab
 *   holds the whole diary in memory in TinyBase stores whose persisters are
 *   still autosaving; a client-side redirect would leave those alive, and
 *   after an erase they would cheerfully write the rows back into a database
 *   that was just deleted. A document load is the one thing that ends them.
 *
 * ── Where the person lands ───────────────────────────────────────────────
 *
 * On the page that matches what the sign-out did (`signOutDestination`), so
 * that the navigation is one document load and not a load plus a redirect.
 * Always `/` used to be the answer, and on an open instance `/` showed the
 * marketing page for a frame before its client loader found the local diary
 * and sent the person straight back: a sign-out that looked like a flash and
 * then nothing. On a managed instance the same `/` was a second "you are
 * signed out" screen, next to the `/welcome` a session the SERVER ended lands
 * on.
 *
 * The steps are injected so all four orderings above are asserted in
 * `tests/unit/sign-out-flow.test.ts` without a browser, a session or a router.
 */
import { createComponentLogger } from '#app/lib/logger';
import { eraseDeviceData } from '#app/lib/local-store/device-erase';
import { signOutOfSync } from './sync-actions';
import { getSyncSessionSnapshot } from './sync-session';
import { lockDevice } from './sync-state';

const log = createComponentLogger('sign-out');

/** What the person asked for, and what this instance requires of a sign-out. */
export interface SignOutRequest {
  /** The dialog's opt-in checkbox. Unchecked by default, and nothing here defaults it. */
  eraseDevice: boolean;
  /**
   * `InstancePolicy.signOutClosesTheDiary`: must signing out close the diary on
   * this device?
   *
   * `true` on a managed instance, where the diary belongs to the account.
   * `false` on an open one, where signing out of sync is not meant to take
   * anything away and locking the device would be a wipe with extra steps.
   */
  locksDevice: boolean;
}

/** The two pages a sign-out can end on. Never `/`, whose marketing page a person with a diary only flashes through. */
export type SignOutDestination = '/welcome' | '/dashboard';

/**
 * Which page a sign-out ends on.
 *
 * `/welcome` when this device no longer shows a diary: it was locked
 * (`locksDevice`, a managed instance) or it was erased (`eraseDevice`). That is
 * the same screen the onboarding gate sends an emptied or locked device to, and
 * the same one a session the server ended reaches, so there is one "you are
 * signed out" screen. `/welcome` is a top-level, client-only question screen,
 * so it is also correct on an open instance after an erase, where the gate
 * would have sent the empty device there anyway.
 *
 * `/dashboard` when the diary stays readable (an open instance, nothing
 * erased): the person is still in the app, so they land in it. The gate has
 * already seen this device through, and nothing flashes in between.
 *
 * Pure, so every combination is a row in `sign-out-flow.test.ts`.
 */
export function signOutDestination({ locksDevice, eraseDevice }: SignOutRequest): SignOutDestination {
  return locksDevice || eraseDevice ? '/welcome' : '/dashboard';
}

/** The four things a sign-out does, each replaceable in a test. */
export interface SignOutSteps {
  /** Revokes the token family server-side and drops the local session. Best effort. */
  revokeAndCloseSession: () => Promise<void>;
  /** Marks this device as signed out of an account whose diary it must stop showing. */
  lockDevice: () => void;
  /** Deletes the diary, the photos, the outbox and the sync baseline, in one step. */
  eraseDevice: () => Promise<void>;
  /** Ends this document, so no in-memory copy of the diary and no persister outlives the sign-out. */
  leaveTheApp: () => void;
}

/**
 * Signs this device out.
 *
 * @param request - the person's choice plus this instance's policy.
 * @param steps - the four effects; defaults to the real ones.
 * @throws only when an opted-in erase could not complete. The session is
 *   already closed and the device already locked at that point, so the caller
 *   reports "signed out, diary still here" rather than a failed sign-out.
 */
export async function runSignOut(
  { eraseDevice, locksDevice }: SignOutRequest,
  steps: SignOutSteps = defaultSignOutSteps(),
): Promise<void> {
  try {
    await steps.revokeAndCloseSession();
  } catch {
    // DELIBERATELY SWALLOWED, and the one place in this feature where a
    // failure does not stop the work. See the header: a person on a train has
    // to be able to sign out of a shared device, and everything that actually
    // protects them from the next reader happens below this line.
    log.warn('sign-out could not reach the server, continuing locally');
  }

  if (locksDevice) steps.lockDevice();
  if (eraseDevice) await steps.eraseDevice();
  steps.leaveTheApp();
}

/**
 * The real steps.
 *
 * `destination` is where the last step leaves for (`signOutDestination`). It is
 * optional so a caller that overrides `leaveTheApp` anyway (`/join`) need not
 * name one, and its default is `/dashboard` because that is the one answer
 * that is never wrong: a gate that finds the device locked or empty sends it on
 * to `/welcome` by itself, and one that finds a diary leaves it where it is.
 *
 * The account id is read HERE, while the session is still open, and closed
 * over. Reading it inside `eraseDevice` would read it after
 * `revokeAndCloseSession` has published a signed-out snapshot, and the
 * baseline key would then be the one thing an erase quietly left behind.
 */
export function defaultSignOutSteps({
  destination = '/dashboard',
}: { destination?: SignOutDestination } = {}): SignOutSteps {
  const accountId = getSyncSessionSnapshot().account?.id ?? null;
  return {
    revokeAndCloseSession: signOutOfSync,
    lockDevice: () => lockDevice(),
    eraseDevice: () => eraseDeviceData({ accountId }),
    leaveTheApp: () => window.location.assign(destination),
  };
}
