/**
 * The update subject, as a component sees it.
 *
 * A thin read over `#app/lib/update-store` (which holds the state, the poll and
 * the dismissal) plus the one action that lives in the service worker. Split that
 * way because the store has to work outside React, and because
 * `useSyncExternalStore` needs a `getServerSnapshot` for the SSR pass.
 *
 * `updateNow` is the ONLY action here that changes what the person is looking at.
 * `checkNow` asks the server to look at GitHub again; it can come back with
 * nothing new, and on a self-hosted box a newer release still needs someone to
 * pull an image. See `adoptNewestBundle` for why that boundary is where it is.
 */
import { useSyncExternalStore } from 'react';

import { adoptNewestBundle } from '#app/lib/service-worker';
import {
  checkForUpdateNow,
  dismissRelease,
  getServerUpdateSnapshot,
  getUpdateSnapshot,
  ribbonState,
  subscribeUpdateStatus,
  type RibbonState,
  type UpdateSnapshot,
} from '#app/lib/update-store';

/** The snapshot, the ribbon's verdict, and the three things a person can do. */
export interface UpdateStatusView {
  status: UpdateSnapshot;
  ribbon: RibbonState;
  /** Ask the server to look at GitHub now. */
  checkNow: () => void;
  /** Adopt the newest bundle this server serves, then reload onto it. */
  updateNow: () => void;
  /** Stop the ribbon mentioning the release it is currently mentioning. */
  dismiss: () => void;
}

export function useUpdateStatus(): UpdateStatusView {
  const status = useSyncExternalStore(subscribeUpdateStatus, getUpdateSnapshot, getServerUpdateSnapshot);

  return {
    status,
    ribbon: ribbonState(status),
    checkNow: () => {
      void checkForUpdateNow();
    },
    updateNow: () => {
      void adoptNewestBundle();
    },
    dismiss: () => {
      const latest = status.status?.latest;
      if (latest === undefined || latest === null) return;
      dismissRelease(latest);
    },
  };
}
