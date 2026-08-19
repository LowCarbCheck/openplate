import { useEffect } from 'react';
import { runPhotoGc } from '#app/lib/local-store/photos';
import { rekeyPhotoCacheToAnonymousOwner } from '#app/lib/local-store/photo-rekey';
import { ANONYMOUS_USER_ID } from '#app/lib/local-store/store';

/**
 * App-boot device-local housekeeping, run once per mount (M117/03: no longer
 * drives an outbox flush — health writes commit directly to the on-device
 * primary store now, so there is nothing queued to sync to a server "/add"
 * action anymore; the outbox/oplog machinery itself (`outbox.ts`,
 * `outbox-machine.ts`) is preserved untouched for the encrypted-sync path,
 * just no longer wired to run here). Renders nothing.
 *
 * The diary MIRROR cache's boot-time prune that used to run here alongside
 * the photo GC was retired in M117/03 deploy-2's post-deploy review: the
 * mirror it pruned (`local-store/mirror.ts`) was itself deleted in the same
 * deploy — the local primary store is always available now, so there is no
 * server-read fallback left to cache — leaving `pruneMirrorCache` a call with
 * nothing left to prune. The whole eviction module (`eviction.ts`) was
 * removed with it, not just this call site.
 */
export function OutboxSyncController() {
  useEffect(() => {
    // Order matters: the re-key (M128 spec 03) moves any surviving
    // account-keyed photo row onto the anonymous owner FIRST, so the GC pass
    // that follows can actually see — and age out — the photos this device
    // cached back when it was signed in. Running GC first would leave those
    // rows unattributable for one more boot. Both are fire-and-forget and
    // swallow their own errors; a photo-cache failure must never affect
    // logging or break a render.
    void rekeyPhotoCacheToAnonymousOwner().then(() => runPhotoGc({ userId: ANONYMOUS_USER_ID }));
  }, []);

  return null;
}
