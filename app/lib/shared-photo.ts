/**
 * Web Share Target v2 glue for the scan flow.
 *
 * When the service worker receives a photo shared from the OS share sheet it
 * stashes the file under a synthetic cache key and redirects the browser to
 * `/scan?shared=1`. The scan page reads the file back on mount via
 * `readSharedPhoto`, strips the flag from the URL, and feeds the file through
 * the normal library-pick pipeline.
 *
 * The string helpers are pure and unit-tested. `readSharedPhoto` takes an
 * injected cache handle (structurally satisfied by `window.caches`) so its
 * contract is testable without a live browser.
 */

/** The query flag the service worker adds when redirecting a shared photo to /scan. */
export const SHARED_PHOTO_FLAG = 'shared';

/** Cache name the service worker writes the shared photo to (keep in sync with public/sw.js). */
export const SHARE_TARGET_CACHE = 'share-target';

/** Synthetic GET key the shared photo is stored under (keep in sync with public/sw.js). */
export const SHARED_PHOTO_KEY = '/share-target/photo';

/** True when the current query string carries the `?shared=1` flag. */
export function hasSharedPhotoFlag(search: string): boolean {
  return new URLSearchParams(search).get(SHARED_PHOTO_FLAG) === '1';
}

/**
 * Rebuilds `pathname` with the `shared` flag removed from its query string,
 * preserving any other params. Returns just the pathname when nothing else
 * remains — used to clean the URL after the shared photo is consumed so a reload
 * can't reprocess it.
 */
export function buildUrlWithoutSharedParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHARED_PHOTO_FLAG);
  const rest = params.toString();
  return rest === '' ? pathname : `${pathname}?${rest}`;
}

/** The subset of `CacheStorage` `readSharedPhoto` needs — lets tests inject a fake. */
export interface SharedPhotoCacheStorage {
  open(cacheName: string): Promise<{
    match(request: string): Promise<Response | undefined>;
    delete(request: string): Promise<boolean>;
  }>;
}

/**
 * Reads the shared photo the service worker stashed, deletes the cache entry so
 * it's consumed exactly once, and reconstructs a `File`. Returns null when
 * nothing is stashed (e.g. a stale `?shared=1` after a manual reload).
 *
 * @param cacheStorage - a `CacheStorage`-like handle (pass `window.caches`).
 * @returns the shared photo as a `File`, or null when there's nothing to read.
 */
export async function readSharedPhoto(cacheStorage: SharedPhotoCacheStorage): Promise<File | null> {
  const cache = await cacheStorage.open(SHARE_TARGET_CACHE);
  const response = await cache.match(SHARED_PHOTO_KEY);
  if (!response) return null;
  await cache.delete(SHARED_PHOTO_KEY);
  const blob = await response.blob();
  const filenameHeader = response.headers.get('X-Shared-Filename');
  const filename = filenameHeader ? decodeURIComponent(filenameHeader) : 'shared-photo.jpg';
  const type = response.headers.get('Content-Type') || blob.type || 'image/jpeg';
  return new File([blob], filename, { type });
}
