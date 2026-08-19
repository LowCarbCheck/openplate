/**
 * The on-device plate-photo cache — a TinyBase store wholly separate from the
 * mirror and outbox (its own IndexedDB database, see `store.ts`/`persist.ts`).
 * Photos are stored as the already-downscaled JPEG's base64 data-URL and are
 * DEVICE-LOCAL by definition: they are never uploaded, never mirrored, and
 * never enter any sync path.
 *
 * OWNER SCOPING: every row key is `${userId}::${logBatchId}` (see
 * `photo-policy.ts`'s `buildPhotoKey`/`parsePhotoKey`), and every
 * read/write/usage/clear/GC path below takes an owner id and operates only on
 * that owner's rows. That keying exists because the IndexedDB database is
 * origin-scoped, and back when this app had accounts a shared device's
 * `openplate-photos` database was shared by every account that had ever signed
 * in on it.
 *
 * There are no accounts any more (M128 spec 03), so there is exactly ONE owner:
 * the `ANONYMOUS_USER_ID` sentinel. The keying is kept rather than flattened —
 * `photo-rekey.ts` moves any surviving account-keyed row onto the sentinel at
 * boot, which is a far smaller and more reviewable change than rewriting every
 * row id, and it leaves the legacy/unattributable-row handling below intact.
 * Callers should pass `ANONYMOUS_USER_ID`, not invent an owner id.
 *
 * The one exception is the save-photos on/off preference
 * (`readPhotoEnabled`/`writePhotoEnabled`): it has always been a single
 * store-level VALUE, not per-owner, because it's a device policy ("does this
 * device cache plate photos at all"), not private data.
 *
 * The imperative shell lives here (store I/O + the browser-only `FileReader`
 * transcode); the retention/cap/size policy is the pure `photo-policy` module.
 * The low-level `write/read/delete/evict` helpers take a `Store` so tests can
 * drive them against a real in-memory store with no IndexedDB and no `FileReader`.
 *
 * Every public entry point swallows its own errors: a photo-cache failure must
 * never affect logging or break a page render.
 */
import type { Store } from 'tinybase';
import { z } from 'zod';
import { getPhotosStore } from './persist';
import {
  PHOTO_BYTE_SIZE_CELL,
  PHOTO_CREATED_AT_CELL,
  PHOTO_DATA_URL_CELL,
  PHOTOS_ENABLED_VALUE,
  PHOTOS_TABLE,
} from './store';
import {
  buildPhotoKey,
  estimateDataUrlBytes,
  keyBelongsToUser,
  selectExpiredPhotoKeys,
  selectOverflowPhotoKeys,
  summarizePhotoUsage,
  type PhotoCacheEntry,
  type PhotoKeyParts,
  type PhotoUsage,
} from './photo-policy';

export type { PhotoUsage } from './photo-policy';

/** A cached photo's persisted shape (before base64 encoding into the data-URL cell). */
export interface WritePhotoRowInput extends PhotoKeyParts {
  /** base64 data-URL of the already-downscaled JPEG. */
  dataUrl: string;
  /** Original JPEG byte size (the meaningful "photo size" for usage accounting). */
  byteSize: number;
  /** Epoch ms the photo was cached. */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Low-level store <-> row helpers (synchronous, store-injected — unit-testable)
// ---------------------------------------------------------------------------

export function writePhotoRow(store: Store, input: WritePhotoRowInput): void {
  store.setRow(PHOTOS_TABLE, buildPhotoKey(input), {
    [PHOTO_DATA_URL_CELL]: input.dataUrl,
    [PHOTO_BYTE_SIZE_CELL]: input.byteSize,
    [PHOTO_CREATED_AT_CELL]: input.createdAt,
  });
}

/** The data-URL cell as it comes back off the store — a TinyBase cell, not yet a data-URL. */
const dataUrlCellSchema = z.string();

/** The byte-size / cached-at cells as they come back off the store. */
const finiteNumberCellSchema = z.number().finite();

/** The device-level save-photos preference as it comes back off the store. */
const photoEnabledValueSchema = z.boolean();

export function readPhotoDataUrl(store: Store, keyParts: PhotoKeyParts): string | null {
  const raw = dataUrlCellSchema.safeParse(store.getCell(PHOTOS_TABLE, buildPhotoKey(keyParts), PHOTO_DATA_URL_CELL));
  return raw.success ? raw.data : null;
}

export function deletePhotoRow(store: Store, keyParts: PhotoKeyParts): void {
  store.delRow(PHOTOS_TABLE, buildPhotoKey(keyParts));
}

/** Removes every row belonging to `userId` — other accounts' rows are untouched. */
export function clearPhotoRows(store: Store, userId: number): void {
  for (const rowId of store.getRowIds(PHOTOS_TABLE)) {
    if (keyBelongsToUser(rowId, userId)) store.delRow(PHOTOS_TABLE, rowId);
  }
}

/** A row's recorded byte size, falling back to estimating it from the data-URL. */
function photoRowByteSize(store: Store, rowId: string): number {
  const size = finiteNumberCellSchema.safeParse(store.getCell(PHOTOS_TABLE, rowId, PHOTO_BYTE_SIZE_CELL));
  if (size.success) return size.data;
  const dataUrl = dataUrlCellSchema.safeParse(store.getCell(PHOTOS_TABLE, rowId, PHOTO_DATA_URL_CELL));
  return dataUrl.success ? estimateDataUrlBytes(dataUrl.data) : 0;
}

/** A row's recorded cache timestamp, or null when missing/invalid. */
function photoRowCreatedAt(store: Store, rowId: string): number | null {
  const createdAt = finiteNumberCellSchema.safeParse(store.getCell(PHOTOS_TABLE, rowId, PHOTO_CREATED_AT_CELL));
  return createdAt.success ? createdAt.data : null;
}

/** Every row id belonging to `userId`. */
function rowIdsForUser(store: Store, userId: number): string[] {
  return store.getRowIds(PHOTOS_TABLE).filter((rowId) => keyBelongsToUser(rowId, userId));
}

/** Count + total bytes of `userId`'s cached photos. */
export function readPhotoUsage(store: Store, userId: number): PhotoUsage {
  const entries = rowIdsForUser(store, userId).map((rowId) => ({ byteSize: photoRowByteSize(store, rowId) }));
  return summarizePhotoUsage(entries);
}

/**
 * Drops photos past the retention window (see `photo-policy`), scoped to
 * `userId` — plus, unconditionally, every LEGACY row (written before user
 * scoping existed, so its key has no `userId::` prefix and can't be safely
 * attributed to anyone). Rows belonging to a DIFFERENT, known user are left
 * alone; each account's own session is what cleans up after it.
 *
 * @returns the number of photos evicted.
 */
export function evictExpiredPhotos(store: Store, userId: number, nowMs: number = Date.now()): number {
  const ownEntries: PhotoCacheEntry[] = [];
  const legacyKeys: string[] = [];
  for (const rowId of store.getRowIds(PHOTOS_TABLE)) {
    if (keyBelongsToUser(rowId, userId)) {
      const createdAt = photoRowCreatedAt(store, rowId);
      if (createdAt !== null) ownEntries.push({ key: rowId, createdAt });
      continue;
    }
    // A legacy (pre-scoping) row has no attributable owner — always drop it.
    // A row scoped to a DIFFERENT, known user is left for that account's own
    // GC pass (only a legacy key, i.e. one with no `::` separator, qualifies).
    if (!rowId.includes('::')) legacyKeys.push(rowId);
  }
  const expiredOwn = selectExpiredPhotoKeys(ownEntries, nowMs);
  const toDelete = [...expiredOwn, ...legacyKeys];
  for (const key of toDelete) store.delRow(PHOTOS_TABLE, key);
  return toDelete.length;
}

/**
 * Drops `userId`'s oldest photos past `MAX_CACHED_PHOTOS` (see `photo-policy`'s
 * `selectOverflowPhotoKeys`) — the count-cap counterpart to
 * `evictExpiredPhotos`'s age-based retention, enforced right after a save.
 * Exported for store-level tests; `savePlatePhoto` is the real caller.
 */
export function enforcePhotoCap(store: Store, userId: number): void {
  const entries = rowIdsForUser(store, userId)
    .map((rowId) => ({ key: rowId, createdAt: photoRowCreatedAt(store, rowId) }))
    .filter((entry): entry is PhotoCacheEntry => entry.createdAt !== null);
  for (const key of selectOverflowPhotoKeys(entries)) store.delRow(PHOTOS_TABLE, key);
}

/**
 * The save-photos preference; defaults to ON when the value was never set.
 * Device-global by design — see the module-level doc comment for why this one
 * value is NOT scoped per user.
 */
export function readPhotoEnabled(store: Store): boolean {
  const value = photoEnabledValueSchema.safeParse(store.getValue(PHOTOS_ENABLED_VALUE));
  return value.success ? value.data : true;
}

export function writePhotoEnabled(store: Store, enabled: boolean): void {
  store.setValue(PHOTOS_ENABLED_VALUE, enabled);
}

// ---------------------------------------------------------------------------
// Browser-only transcode
// ---------------------------------------------------------------------------

/** Reads a File into a base64 data-URL. Browser-only (`FileReader`). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      // SAFETY: `result` is typed `string | ArrayBuffer | null` for the reader as a
      // whole; `readAsDataURL` (below) always produces the base64 data-URL string,
      // and this handler only runs on that read's success.
      resolve(reader.result as string);
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read photo.')));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Public async API (default store) — every path swallows its own errors
// ---------------------------------------------------------------------------

/** Input for {@link savePlatePhoto} — the owner, the batch id, and the in-memory downscaled JPEG. */
export interface SavePlatePhotoInput extends PhotoKeyParts {
  file: File;
}

/**
 * Caches the just-confirmed plate's downscaled JPEG under its owner + batch id.
 * A no-op when the user has turned photo saving off. Enforces the per-user
 * count cap right after writing. Fire-and-forget: any failure (disabled store,
 * quota, unreadable file) is swallowed so logging is never affected.
 */
export async function savePlatePhoto(input: SavePlatePhotoInput): Promise<void> {
  try {
    const store = await getPhotosStore();
    if (!readPhotoEnabled(store)) return;
    const dataUrl = await fileToDataUrl(input.file);
    writePhotoRow(store, {
      userId: input.userId,
      logBatchId: input.logBatchId,
      dataUrl,
      byteSize: input.file.size,
      createdAt: Date.now(),
    });
    enforcePhotoCap(store, input.userId);
  } catch {
    // Best-effort device cache — a save failure must never affect logging.
  }
}

/** The cached data-URL for a user's batch, or null when none is stored (or on error). */
export async function getPhotoDataUrl(keyParts: PhotoKeyParts): Promise<string | null> {
  try {
    const store = await getPhotosStore();
    return readPhotoDataUrl(store, keyParts);
  } catch {
    return null;
  }
}

/** Deletes a user's cached photo for a batch. Best-effort; a miss is not an error. */
export async function deletePlatePhoto(keyParts: PhotoKeyParts): Promise<void> {
  try {
    const store = await getPhotosStore();
    deletePhotoRow(store, keyParts);
  } catch {
    // Best-effort — the retention GC is the backstop for anything left behind.
  }
}

/** Cached-photo count + approximate total size for `userId`, for the settings card. */
export async function getPhotoUsage(userId: number): Promise<PhotoUsage> {
  try {
    const store = await getPhotosStore();
    return readPhotoUsage(store, userId);
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}

/** Removes every photo cached for `userId`. Other accounts' rows on this device are untouched. */
export async function clearAllPhotos(userId: number): Promise<void> {
  try {
    const store = await getPhotosStore();
    clearPhotoRows(store, userId);
  } catch {
    // Best-effort.
  }
}

/**
 * App-boot housekeeping for `userId`: evicts their photos past the retention
 * window plus any unattributable legacy row (see `evictExpiredPhotos`).
 * Fire-and-forget.
 */
export async function runPhotoGc(input: { userId: number; nowMs?: number }): Promise<void> {
  try {
    const store = await getPhotosStore();
    evictExpiredPhotos(store, input.userId, input.nowMs ?? Date.now());
  } catch {
    // Best-effort.
  }
}

/** Whether plate photos are currently saved on this device (default ON, device-global). */
export async function isPhotoCaptureEnabled(): Promise<boolean> {
  try {
    const store = await getPhotosStore();
    return readPhotoEnabled(store);
  } catch {
    return true;
  }
}

/**
 * Sets the device-global save-photos preference. Turning it OFF also clears
 * every photo cached for `userId` (the account making the change) — it does
 * NOT touch photos belonging to a different account that has used this device,
 * since a clear is an owner-scoped operation even though the preference itself
 * is shared.
 */
export async function setPhotoCaptureEnabled(enabled: boolean, userId: number): Promise<void> {
  try {
    const store = await getPhotosStore();
    writePhotoEnabled(store, enabled);
    if (!enabled) clearPhotoRows(store, userId);
  } catch {
    // Best-effort.
  }
}

/**
 * Subscribes to any change in the photo table (add/update/delete), re-firing
 * `listener` so a reactive reader (e.g. the entry-detail hook) can re-read.
 * Returns an unsubscribe. SSR-safe: store access is lazy, so this is inert
 * until IndexedDB actually exists. Table-wide (not user-scoped) — callers
 * always re-read their own scoped key, so a notification about another
 * account's row is harmless, just a no-op re-read.
 */
export function subscribeToPhotos(listener: () => void): () => void {
  let cancelled = false;
  let remove: (() => void) | null = null;
  void (async () => {
    try {
      const store = await getPhotosStore();
      if (cancelled) return;
      const listenerId = store.addTableListener(PHOTOS_TABLE, () => listener());
      remove = () => store.delListener(listenerId);
    } catch {
      // No store (SSR / no IndexedDB) — nothing to subscribe to.
    }
  })();
  return () => {
    cancelled = true;
    if (remove) remove();
  };
}
