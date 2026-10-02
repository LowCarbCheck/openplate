/**
 * Handing a device that holds one account's diary to ANOTHER account
 * (ADR-0022).
 *
 * ── The defect this module closes ────────────────────────────────────────
 *
 * On a managed instance a plain sign-out hides the diary behind a device lock
 * and deletes nothing (`sync-state.ts`). The lock used to name nobody, and any
 * session that opened lifted it. So a second person who signed in, joined or
 * reset a password on a shared device opened the first person's plaintext
 * diary, and the first sync counted every row as unsent against the new
 * account's empty baseline and pushed the first person's diary into the
 * second account. The lock now names its owner, and a session for any other
 * account refuses to open (`assertDeviceMayOpen`).
 *
 * ── The one way on, and why never a merge ────────────────────────────────
 *
 * The diary on the device belongs to the account that signed out. Nothing on
 * the device can say which rows a second person would want, and anything the
 * second session kept would be pushed into the second account on its first
 * cycle. So the way on is to ERASE the held diary, and every baseline with it,
 * and only then let the next account in. The person whose diary it is keeps
 * the other way: sign in again with the account that signed out, which never
 * meets this module.
 *
 * ── The only code that clears the lock ───────────────────────────────────
 *
 * Besides the owner's own sign-in (`releaseDeviceLockForOwner`, from
 * `openSyncSession`), {@link eraseDiaryAndReleaseLock} is the one place the
 * lock is lifted, and only after the erase resolved. A unit source test keeps
 * `clearDeviceLockAfterErase` out of every other module. The sign-out dialog's
 * opt-in erase runs the same function (`sign-out-flow.ts`), so a device whose
 * diary was erased at sign-out is not left locked over nothing.
 */
import { createComponentLogger } from '#app/lib/logger';
import { defaultDeviceEraseDeps, eraseDeviceData, type DeviceEraseDeps } from '#app/lib/local-store/device-erase';
import { stopAllPersisters } from '#app/lib/local-store/persist';
import { withTimeout } from '#app/lib/with-timeout';
import { canonicalizeEmail } from './email';
import { readUnsentOnDevice, resolveEraseNotice, type EraseNoticeLine, type UnsentOnDevice } from './erase-notice';
import { writeAccountHint } from './sync-session';
import {
  clearDeviceLockAfterErase,
  createMemoryStorage,
  listSyncBaselineKeys,
  type DeviceLockOwner,
} from './sync-state';

const log = createComponentLogger('account-switch');

/**
 * The longest the step's read of the held diary may take before it says the
 * device could not be checked. The submit button spins for this long at most,
 * and the step then appears with its lines settled.
 */
export const HELD_DIARY_READ_DEADLINE_MS = 5_000;

/** What {@link eraseDiaryAndReleaseLock} touches: the erase's own seams, plus the stop of this page's stores. */
export interface DiaryEraseDeps extends DeviceEraseDeps {
  /** Stops every store persister this page started; `stopAllPersisters` in a browser. Never rejects. */
  stopStores: () => Promise<void>;
}

/** The real seams: this page's stores, `indexedDB` and `localStorage`. */
export function defaultDiaryEraseDeps(): DiaryEraseDeps {
  return { ...defaultDeviceEraseDeps(), stopStores: stopAllPersisters };
}

/**
 * Erases the held diary and every sync baseline on this device, and only then
 * lifts the device lock.
 *
 * THE ORDER IS THE GUARANTEE:
 *
 *  0. Every store persister this page started is stopped, and none may start
 *     again in this page (`stopAllPersisters`). A running store polls its
 *     database about once a second, and a poll after the delete creates an
 *     empty database again, so an erase with a store still running does not
 *     stay erased.
 *  1. Every `openplate.sync.state.v1:*` key goes first, for the reason
 *     `eraseDeviceData` gives about its own one key: a diary gone with a
 *     baseline left is a silent empty diary on the next sign-in. Every key and
 *     not only the owner's, because the next account must not inherit
 *     anybody's.
 *  2. `eraseDeviceData` deletes the databases, the pulse opt-in and the push
 *     preferences. It throws when another tab holds a database open.
 *  3. The lock is lifted LAST, and only when step 2 resolved. A failed erase
 *     leaves the lock exactly where it was, so a device that still holds the
 *     diary is never left open to the next account.
 *
 * On an open instance there is no lock, and step 3 removes nothing.
 *
 * @param accountId - the owner, whose baseline `eraseDeviceData` names, or `null` when it is unknown.
 * @param deps - the store stop, the storage and the database delete; this browser's by default.
 * @throws when a database could not be deleted. The lock is still set then.
 */
export async function eraseDiaryAndReleaseLock(
  { accountId }: { accountId: number | null },
  deps: DiaryEraseDeps = defaultDiaryEraseDeps(),
): Promise<void> {
  await deps.stopStores();
  for (const key of listSyncBaselineKeys(deps.storage)) deps.storage.removeItem(key);
  await eraseDeviceData({ accountId }, deps);
  clearDeviceLockAfterErase(deps.storage);
}

/**
 * What the step says about the held diary: the sign-out dialog's own lines,
 * read for the OWNER, with no session open.
 *
 * Settled before it returns, always. A read that throws, or that takes longer
 * than {@link HELD_DIARY_READ_DEADLINE_MS}, answers "this device could not be
 * checked", so the step never shows a "checking" line and never moves once it
 * is on screen.
 *
 * An unknown owner has no baseline to compare with, so every row counts: an
 * empty baseline over-warns, which a destructive confirm is allowed to do.
 *
 * @param owner - the account whose diary the device holds, or `null` when unknown.
 * @param read - the read itself; injected in tests.
 */
export async function readHeldDiaryNotice({
  owner,
  read = readUnsentOnDevice,
}: {
  owner: DeviceLockOwner | null;
  read?: typeof readUnsentOnDevice;
}): Promise<EraseNoticeLine[]> {
  const unsent = await withTimeout(readSafely({ owner, read }), HELD_DIARY_READ_DEADLINE_MS);
  return resolveEraseNotice({
    read: unsent === null ? { status: 'failed' } : { status: 'done', unsent },
    isSyncing: false,
    hasSession: true,
  });
}

/** The read, with a failure turned into "not known". */
async function readSafely({
  owner,
  read,
}: {
  owner: DeviceLockOwner | null;
  read: typeof readUnsentOnDevice;
}): Promise<UnsentOnDevice | null> {
  try {
    if (owner !== null) return await read({ accountId: owner.accountId });
    // NO OWNER, NO BASELINE: an empty storage gives the empty baseline for any id.
    return await read({ accountId: 0, storage: createMemoryStorage() });
  } catch (cause) {
    log.warn('could not read the held diary for the account-switch step', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/**
 * After the erase: remember the incoming address and load `destination` as a
 * new document.
 *
 * The address is remembered so the page that loads next is already filled in
 * for the person who is arriving. A DOCUMENT LOAD, never a router navigation,
 * for the reason `sign-out-flow.ts` gives: this tab may hold the erased diary
 * in memory with persisters still running, and only a new document ends them.
 * On `/join` the invitation is parked in the tab's pending slot, so it comes
 * back after the load.
 */
export function continueAsIncomingAccount({ email, destination }: { email: string; destination: string }): void {
  writeAccountHint(canonicalizeEmail(email));
  globalThis.window.location.assign(destination);
}
