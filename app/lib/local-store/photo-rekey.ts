/**
 * One-shot device-local re-key of the plate-photo cache onto the anonymous
 * owner (M128 spec 03, the accountless cutover).
 *
 * WHY ONLY THE PHOTO CACHE: the primary store (personal foods, food logs,
 * weigh-ins, profile/goals) is DEVICE-scoped and has never carried a userId
 * namespace — see `index.ts`'s header for that accepted M117 limitation — so
 * dropping accounts changes nothing about how it is keyed. The photo cache is
 * the one local surface that WAS account-keyed: every row id is
 * `${userId}::${logBatchId}` (`photo-policy.ts`'s `buildPhotoKey`) because a
 * single origin-scoped IndexedDB database used to be shared by every account
 * that had ever signed in on this device. With accounts gone there is exactly
 * one owner left — the `ANONYMOUS_USER_ID` sentinel — and rows still keyed to a
 * real (now non-existent) account id would be invisible to every read, usage,
 * clear and GC path, i.e. a silent orphan store of the visitor's own photos.
 *
 * The plan is PURE (`planPhotoKeyRekey`) so the collision and idempotency rules
 * are unit-testable without IndexedDB; `runPhotoCacheRekey` is the thin
 * store-applying shell, and `rekeyPhotoCacheToAnonymousOwner` is the
 * fire-and-forget app-boot entry point (see `outbox-sync-controller.tsx`).
 *
 * IDEMPOTENT BY CONSTRUCTION — no "already ran" stamp is needed or kept: after
 * one pass every row is already `0::…`, which the plan classifies as
 * untouched, so a second pass is an empty plan. That also makes it safe to run
 * on every app boot rather than needing a migration ledger on the device.
 */
import type { Store } from 'tinybase';
import { getPhotosStore } from './persist';
import { ANONYMOUS_USER_ID, PHOTOS_TABLE } from './store';
import { buildPhotoKey, parsePhotoKey } from './photo-policy';

/** A single key move: the row at `from` is rewritten under `to`, then removed. */
export interface PhotoKeyRename {
  from: string;
  to: string;
}

/** What a re-key pass should do to the photo table. Both lists may be empty. */
export interface PhotoKeyRekeyPlan {
  /** Rows to move onto the anonymous owner's key. */
  renames: PhotoKeyRename[];
  /**
   * Rows to delete outright: an account-keyed row whose anonymous-owner target
   * key is already taken. The target row is the one every read path resolves,
   * and both rows hold the same `logBatchId`'s photo, so keeping the loser
   * would just re-orphan it under a dead account id.
   */
  drops: string[];
}

/**
 * Plans the move of every account-keyed photo row onto the `ANONYMOUS_USER_ID`
 * sentinel. Pure — the caller applies it.
 *
 * Classification, per row id:
 *  - parses AND already owned by `ANONYMOUS_USER_ID` → untouched (this is what
 *    makes a second pass a no-op).
 *  - parses with any other owner id → renamed to `0::<logBatchId>`, unless that
 *    target is already claimed (by a pre-existing anonymous row, or by an
 *    earlier row in this same plan), in which case it is dropped instead. Input
 *    order decides the winner, which keeps the plan deterministic even in the
 *    practically-impossible case of two accounts sharing a `logBatchId` (they
 *    are `randomUuid()`s).
 *  - does NOT parse (a legacy bare-`logBatchId` key written before scoping
 *    existed) → untouched. Those are unattributable and `photos.ts`'s
 *    `evictExpiredPhotos` already drops them unconditionally on its own GC
 *    pass; adopting them here would silently hand one account's photos to
 *    whoever holds the device now.
 *
 * @param rowIds - every row id currently in the photo table.
 * @returns the renames and drops that move the table onto the single owner.
 */
export function planPhotoKeyRekey(rowIds: readonly string[]): PhotoKeyRekeyPlan {
  const claimedTargets = new Set<string>();
  for (const rowId of rowIds) {
    const parsed = parsePhotoKey(rowId);
    if (parsed !== null && parsed.userId === ANONYMOUS_USER_ID) claimedTargets.add(rowId);
  }

  const renames: PhotoKeyRename[] = [];
  const drops: string[] = [];

  for (const rowId of rowIds) {
    const parsed = parsePhotoKey(rowId);
    if (parsed === null) continue;
    if (parsed.userId === ANONYMOUS_USER_ID) continue;

    const target = buildPhotoKey({ userId: ANONYMOUS_USER_ID, logBatchId: parsed.logBatchId });
    if (claimedTargets.has(target)) {
      drops.push(rowId);
      continue;
    }
    claimedTargets.add(target);
    renames.push({ from: rowId, to: target });
  }

  return { renames, drops };
}

/** How many photo-cache rows a re-key moved onto the new owner key, and how many it discarded. */
export interface PhotoRekeyOutcome {
  renamed: number;
  dropped: number;
}

/**
 * Applies {@link planPhotoKeyRekey} to a store. Synchronous and store-injected
 * so it can be driven against a real in-memory TinyBase store in tests, with no
 * IndexedDB.
 *
 * @param store - the photo-cache store to re-key in place.
 * @returns how many rows were moved and how many were dropped.
 */
export function runPhotoCacheRekey(store: Store): PhotoRekeyOutcome {
  const plan = planPhotoKeyRekey(store.getRowIds(PHOTOS_TABLE));

  for (const { from, to } of plan.renames) {
    // Copy the row whole — the cache's cells (data URL, byte size, cached-at)
    // are carried across verbatim; only the key changes.
    store.setRow(PHOTOS_TABLE, to, store.getRow(PHOTOS_TABLE, from));
    store.delRow(PHOTOS_TABLE, from);
  }
  for (const rowId of plan.drops) {
    store.delRow(PHOTOS_TABLE, rowId);
  }

  return { renamed: plan.renames.length, dropped: plan.drops.length };
}

/**
 * App-boot entry point: re-keys this device's photo cache onto the anonymous
 * owner. Fire-and-forget and error-swallowing, like every other public path in
 * `photos.ts` — a photo-cache failure must never affect logging or break a
 * render.
 */
export async function rekeyPhotoCacheToAnonymousOwner(): Promise<void> {
  try {
    const store = await getPhotosStore();
    runPhotoCacheRekey(store);
  } catch {
    // Best-effort device cache — nothing here is worth surfacing to the user.
  }
}
