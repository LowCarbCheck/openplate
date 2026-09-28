/**
 * Reactive read of the on-device plate-photo cache for an entry's owner +
 * `logBatchId`. SSR-safe: returns `null` on the server and on first client
 * paint (so the receipt renders exactly its image-free form), then fills in
 * from IndexedDB in an effect. Re-reads whenever the photo store changes, so a
 * delete/clear while the page is open removes the image live.
 *
 * `userId` scopes the lookup to the entry's own owner — the photo store's
 * IndexedDB database is shared by every account that's used this device, so an
 * unscoped lookup could show one account's photo to another (see `photos.ts`).
 */
import { useEffect, useState } from 'react';
import { getPhotoDataUrl, subscribeToPhotos } from '#app/lib/local-store/photos';

export function usePlatePhoto({ userId, logBatchId }: { userId: number; logBatchId: string | null }): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (logBatchId === null) {
      setDataUrl(null);
      return;
    }
    let active = true;
    const load = (): void => {
      void (async () => {
        const url = await getPhotoDataUrl({ userId, logBatchId });
        if (active) setDataUrl(url);
      })();
    };
    load();
    const unsubscribe = subscribeToPhotos(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId, logBatchId]);

  return dataUrl;
}
