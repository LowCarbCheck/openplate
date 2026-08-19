/**
 * Pure policy + accounting for the on-device photo cache — no browser APIs, no
 * TinyBase, no I/O. The impure store wiring lives in `photos.ts`; everything a
 * unit test needs to reason about (row keying, retention window, count cap,
 * size accounting, data-URL byte estimation) is here so it can be exercised
 * without IndexedDB or a `FileReader`.
 *
 * Photos are device-local, best-effort cache — never uploaded, never synced.
 */

/** Milliseconds in a day, for the retention-window math below. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Bytes in a KiB / MiB, for the human-readable size formatter. */
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

// ---------------------------------------------------------------------------
// Row keying — scopes every cached photo to its owning user
// ---------------------------------------------------------------------------

/**
 * Separator between the owning user's id and the batch id in a stored row key.
 * Safe because a `logBatchId` is a `randomUuid()` and never contains it.
 */
const PHOTO_KEY_SEPARATOR = '::';

export interface PhotoKeyParts {
  userId: number;
  logBatchId: string;
}

/**
 * Builds the row key that scopes a cached photo to its owning user. The photo
 * store is a single IndexedDB database shared by every account that has ever
 * used this device/browser profile (a shared family device, for instance), so
 * every row must be attributable to exactly one user — never a bare `logBatchId`.
 */
export function buildPhotoKey({ userId, logBatchId }: PhotoKeyParts): string {
  return `${userId}${PHOTO_KEY_SEPARATOR}${logBatchId}`;
}

/**
 * Parses a row key back into its owning user id and batch id. Returns null for
 * a key that doesn't match the scoped scheme — notably every row written
 * before user-scoping existed (a bare `logBatchId`, no separator). Those
 * legacy rows can't be safely attributed to any user; see `photos.ts`'s GC,
 * which drops them unconditionally rather than risk showing them to the wrong
 * account.
 */
export function parsePhotoKey(key: string): PhotoKeyParts | null {
  const separatorIndex = key.indexOf(PHOTO_KEY_SEPARATOR);
  if (separatorIndex === -1) return null;
  const userIdPart = key.slice(0, separatorIndex);
  const logBatchId = key.slice(separatorIndex + PHOTO_KEY_SEPARATOR.length);
  if (!/^\d+$/.test(userIdPart) || logBatchId === '') return null;
  return { userId: Number(userIdPart), logBatchId };
}

/** Whether a row key both matches the scoped scheme and belongs to `userId`. */
export function keyBelongsToUser(key: string, userId: number): boolean {
  const parsed = parsePhotoKey(key);
  return parsed !== null && parsed.userId === userId;
}

// ---------------------------------------------------------------------------
// Retention window (age-based eviction)
// ---------------------------------------------------------------------------

/**
 * How long a cached plate photo is kept before app-boot GC drops it. A device
 * cache is a convenience, not an archive — 90 days comfortably covers "show me
 * the plate I logged recently" without letting the store grow unbounded.
 */
export const PHOTO_RETENTION_DAYS = 90;

/** A stored photo's identity + age, the minimum the eviction policies reason about. */
export interface PhotoCacheEntry {
  /** The row key (see `buildPhotoKey`). */
  key: string;
  /** Epoch ms the photo was cached. */
  createdAt: number;
}

/** Count + total bytes of the cached photos, for the settings usage line. */
export interface PhotoUsage {
  count: number;
  totalBytes: number;
}

/**
 * The keys of every photo older than the retention window relative to `nowMs`.
 * A future-dated `createdAt` (clock skew) yields a negative age and is never
 * expired. Pure — the caller does the deletion.
 *
 * @param entries - the cached photos' keys and cache timestamps.
 * @param nowMs - the current epoch ms (injected so tests stay deterministic).
 * @param retentionDays - the window; defaults to {@link PHOTO_RETENTION_DAYS}.
 * @returns the keys safe to evict, in input order.
 */
export function selectExpiredPhotoKeys(
  entries: readonly PhotoCacheEntry[],
  nowMs: number,
  retentionDays: number = PHOTO_RETENTION_DAYS,
): string[] {
  const maxAgeMs = retentionDays * MS_PER_DAY;
  return entries.filter((entry) => nowMs - entry.createdAt > maxAgeMs).map((entry) => entry.key);
}

// ---------------------------------------------------------------------------
// Per-user count cap (enforced at save time)
// ---------------------------------------------------------------------------

/**
 * The most plate photos kept per user on this device. Enforced right after a
 * save, on top of (not instead of) the 90-day retention window — a very active
 * scanner could otherwise accumulate photos faster than they age out.
 */
export const MAX_CACHED_PHOTOS = 100;

/**
 * The oldest-first keys to drop so a single user's cache doesn't exceed
 * `maxPhotos`. Pure — takes only that user's entries (the caller has already
 * scoped them by owner) and does not mutate its input.
 *
 * @param entries - the affected user's cached photos, keys + cache timestamps.
 * @param maxPhotos - the cap; defaults to {@link MAX_CACHED_PHOTOS}.
 * @returns the oldest keys past the cap, oldest first (empty when under the cap).
 */
export function selectOverflowPhotoKeys(
  entries: readonly PhotoCacheEntry[],
  maxPhotos: number = MAX_CACHED_PHOTOS,
): string[] {
  if (entries.length <= maxPhotos) return [];
  const overflow = entries.length - maxPhotos;
  return entries
    .toSorted((a, b) => a.createdAt - b.createdAt)
    .slice(0, overflow)
    .map((entry) => entry.key);
}

// ---------------------------------------------------------------------------
// Size accounting
// ---------------------------------------------------------------------------

/**
 * The decoded byte size of a base64 data-URL (`data:<mime>;base64,<payload>`),
 * or of a bare base64 payload. Pure — used to account for a stored photo's size
 * when a row is missing its recorded byte-size cell. Every 4 base64 chars encode
 * 3 bytes; trailing `=` padding trims 1 or 2.
 *
 * @param dataUrl - the data-URL (or bare base64 payload) to measure.
 * @returns the decoded size in bytes (0 for an empty payload).
 */
export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  const payload = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
  if (payload.length === 0) return 0;
  const padding =
    payload.endsWith('==') ? 2
    : payload.endsWith('=') ? 1
    : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/**
 * A human-readable, approximate size for the settings card. Pure. Rounds to
 * whole KB below 1 MB (never showing "0 KB" for a non-empty cache) and one
 * decimal MB above.
 */
export function formatPhotoSize(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
}

/** Aggregates per-photo byte sizes into the settings usage summary. Pure. */
export function summarizePhotoUsage(entries: readonly { byteSize: number }[]): PhotoUsage {
  return {
    count: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + (Number.isFinite(entry.byteSize) ? entry.byteSize : 0), 0),
  };
}
