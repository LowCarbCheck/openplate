/**
 * Erasing this device's diary, in ONE step (M201 spec 02).
 *
 * ── The trap this module exists for ──────────────────────────────────────
 *
 * The diary is IndexedDB rows. The sync BASELINE is a localStorage key, keyed
 * per account (`sync/sync-state.ts`), and it records how far that account
 * already got. They are two storage systems with nothing in common except a
 * meaning: together they say "this device holds this account's diary, up to
 * here".
 *
 * Delete the diary and keep the baseline and the next sign-in believes it is
 * up to date, asks the server for nothing, and renders an EMPTY diary. No
 * error, no warning, no missing screen: a person's whole record is simply not
 * there and everything looks correct. That is worse than either half alone,
 * which is why the two are erased by one function that nobody can call half
 * of, rather than by two calls at a call site somebody will later reorder.
 *
 * ── The order inside is deliberate ───────────────────────────────────────
 *
 * The baseline goes FIRST. If anything after it fails, what is left behind is
 * a diary with no baseline: the next sign-in re-downloads the account and
 * merges, which costs bandwidth and nothing else. The opposite order leaves
 * exactly the silent-empty-diary state above whenever the second half fails.
 * So the failure mode is chosen rather than inherited.
 *
 * ── Databases are DELETED, not emptied ───────────────────────────────────
 *
 * `indexedDB.deleteDatabase` rather than clearing the TinyBase stores through
 * their persisters. Emptying a store means writing empty content over full
 * content, which is the exact shape of the data-loss incident `persist.ts`'s
 * `loadAndVerifyOrThrow` exists to refuse, and it would leave every open
 * persister autosaving on top of the erase. Deleting the database removes the
 * schema with the rows and leaves the next boot to recreate an honest empty
 * one.
 *
 * ── A second tab is the failure this reports rather than hides ───────────
 *
 * `deleteDatabase` does not fail when another connection is open: it fires
 * `blocked` and waits, possibly forever. An erase that resolved there would
 * tell somebody their diary was gone from a device that still has it. So the
 * wait is BOUNDED and a still-blocked delete THROWS, and the dialog tells the
 * person to close the other tab. The bound is generous because the app's own
 * persisters open and close a connection per operation (see `persist.ts`), so
 * a `blocked` here is a passing overlap and not a held handle in the ordinary
 * case.
 */
import { createComponentLogger } from '#app/lib/logger';
import { syncBaselineStorageKey, type KeyValueStorage } from '#app/lib/sync/sync-state';
import { OUTBOX_DB_NAME, PHOTOS_DB_NAME, PRIMARY_DB_NAME } from './store';

const log = createComponentLogger('device-erase');

/**
 * Every database an erase removes, in the order it removes them.
 *
 * The diary first, because it is the one the person means. The AI settings
 * database (`openplate-ai`) is deliberately NOT here: it holds a provider key
 * the person brought and a local usage count, neither of which is the
 * account's diary, and destroying somebody's own API key because they signed
 * out of sync would be a second surprise inside one button.
 */
export const ERASED_DATABASES = [PRIMARY_DB_NAME, PHOTOS_DB_NAME, OUTBOX_DB_NAME] as const;

/** How long a `blocked` delete is given before the erase reports failure. */
const BLOCKED_TIMEOUT_MS = 3_000;

/** The two storage systems an erase touches, injected so the whole step is testable without a browser. */
export interface DeviceEraseDeps {
  /** Deletes one IndexedDB database. Rejects when it cannot. */
  deleteDatabase: (name: string) => Promise<void>;
  /** Where the sync baseline lives, `localStorage` in a browser. */
  storage: KeyValueStorage;
}

/**
 * Removes this account's diary, photos, outbox and sync baseline from this
 * device.
 *
 * @param accountId - the account whose baseline key must go with the rows, or
 *   `null` for a device that holds no account: there is then no per-account key
 *   to leave behind, and the trap above needs one to spring.
 * @param deps - storage seams; defaults to this browser's.
 * @throws when a database could not be deleted, so no caller can report a
 *   partial erase as a success.
 */
export async function eraseDeviceData(
  { accountId }: { accountId: number | null },
  deps: DeviceEraseDeps = browserEraseDeps(),
): Promise<void> {
  // FIRST, and see the header for why the order is the whole point.
  if (accountId !== null) deps.storage.removeItem(syncBaselineStorageKey(accountId));
  for (const name of ERASED_DATABASES) {
    await deps.deleteDatabase(name);
  }
}

/** The real seams: `indexedDB` and `localStorage`. */
function browserEraseDeps(): DeviceEraseDeps {
  return { deleteDatabase: deleteIndexedDbDatabase, storage: browserKeyValueStorage() };
}

/**
 * `localStorage`, or an inert stand-in where there is none.
 *
 * The stand-in is not a fallback that keeps data: it is what makes this
 * function callable during SSR and in a locked-down browser without a
 * `ReferenceError`. There is no baseline to erase in either case, because
 * there was nowhere to write one.
 */
function browserKeyValueStorage(): KeyValueStorage {
  if (globalThis.localStorage === undefined) {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
  return localStorage;
}

/**
 * Deletes one IndexedDB database, waiting out a `blocked` for a bounded time.
 *
 * @throws when the delete errors, or is still blocked by another connection
 *   after {@link BLOCKED_TIMEOUT_MS}.
 */
export async function deleteIndexedDbDatabase(name: string): Promise<void> {
  if (globalThis.indexedDB === undefined) return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    // Armed only once `blocked` fires. A delete that is merely slow is not a
    // delete that is blocked, and timing out on the former would report a
    // failure that did not happen.
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (): void => {
      if (blockedTimer !== null) clearTimeout(blockedTimer);
    };
    request.addEventListener('success', () => {
      settle();
      resolve();
    });
    request.addEventListener('error', () => {
      settle();
      reject(request.error ?? new Error(`could not delete ${name}`));
    });
    request.addEventListener('blocked', () => {
      log.warn(`erase blocked by another connection, waiting: ${name}`);
      blockedTimer = setTimeout(() => {
        reject(new Error(`${name} is open in another tab`));
      }, BLOCKED_TIMEOUT_MS);
    });
  });
}
