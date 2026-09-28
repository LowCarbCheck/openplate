import { useEffect } from 'react';
import { runPhotoGc } from '#app/lib/local-store/photos';
import { rekeyPhotoCacheToAnonymousOwner } from '#app/lib/local-store/photo-rekey';
import { ANONYMOUS_USER_ID } from '#app/lib/local-store/store';

/**
 * App-boot device-local housekeeping, run once per mount. Renders nothing.
 *
 * THE NAME IS OLDER THAN THE JOB. Until M117/03 this flushed the log outbox,
 * the queue of offline diary writes bound for a server "/add" action. Health
 * writes commit straight to the on-device primary store since then, so there
 * was nothing left to flush, and the queue's own modules (`outbox.ts`,
 * `outbox-machine.ts`) were deleted once nothing read them: they were never
 * the encrypted-sync path, which keeps no queue at all (`sync/orchestrator.ts`).
 * The one queue left in the outbox database, reports of a bad estimate, is
 * drained by `SyncController`. A table the old queue left behind on an old
 * browser is deleted when the outbox store loads (`persist.ts`,
 * `dropRetiredLogOutbox`).
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
