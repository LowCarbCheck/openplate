import type { ReactNode } from 'react';

import { HeaderStatusRow } from '#app/components/header-status';
import { useStatus, useStatusHostCount } from '#app/lib/status';

/**
 * THE LAST TIER OF THE NOTIFICATION CHANNEL, so that no message is ever lost.
 *
 * The owner's decision on 2026-09-10 is that a published status is always read
 * somewhere. There are three places it can be read, and this is the third:
 *
 *   1. THE PERSONAL HEADER. `components/app-wrapper.tsx` puts `HeaderStatus`
 *      in its sticky header's title slot, so on every route under
 *      `routes/_personal.tsx` the message takes the place of the page title.
 *   2. THE PUBLIC HEADER. `components/public-wrapper.tsx` does the same in its
 *      fixed header, in the wordmark's box, which covers `routes/_public.tsx`
 *      and `_personal`'s gate-exempt branch, both of which wear `PublicShell`.
 *   3. THIS BAR. The bare top-level routes wear NEITHER shell: `/welcome`,
 *      `/sign-in`, `/forgot`, `/reset`, `/recover`, `/join`, `/study`,
 *      `/join-study`, `/connect-clinician` and the OpenRouter callback all
 *      render their own full-page layout with no chrome at all. Mounted once
 *      in `root.tsx`, beside the `Outlet`, this draws a bar of its own at the
 *      top of the screen when, and only when, nothing else is hosting.
 *
 * A MESSAGE CANNOT FALL THROUGH ALL THREE, because the third is not a list of
 * routes that has to be kept in step with `routes.ts`. It asks the channel how
 * many hosts are mounted (`useStatusHostCount`) and draws whenever the answer
 * is zero. A new route, a new shell or a deleted layout changes the count, not
 * this file.
 *
 * FIXED, NOT STICKY, and it holds no space. A route that reaches this tier has
 * no chrome, so there is nothing above the fold for a bar to push down, and
 * covering the first 64px of a centred sign-in card for four seconds is the
 * intended trade. `position: fixed` is measured against the viewport only while
 * no ancestor is transformed: `root.tsx` renders this straight under `<body>`
 * with no `transform`, `filter`, `perspective` or `backdrop-filter` above it.
 * Adding any of those to `body`, to `Layout` or to a wrapper around the
 * `Outlet` would silently re-anchor this bar to that element. It is not
 * portalled precisely because it does not need to be; if that ever changes, a
 * portal to `document.body` is the fix, not a `z-index`.
 *
 * ONE FRAME OF FLASH IS ACCEPTED. Navigating between two shells unmounts the
 * old host before the new one's effect runs, so with a message live the count
 * can read zero for a single render and this bar can appear for one frame over
 * a page that is about to host the message itself. Accepted deliberately: the
 * alternative is a timer, and a timer would trade a one-frame flash for a real
 * window in which a message is lost.
 */
export function StatusFallbackHost(): ReactNode {
  const hostCount = useStatusHostCount();
  const status = useStatus();

  // A shell is already saying it; saying it twice is worse than either.
  if (hostCount > 0) return null;
  if (status === null) return null;

  return (
    <div
      data-slot="status-fallback"
      className="fixed inset-x-0 top-0 z-50 flex min-h-16 items-center border-b border-primary/20 bg-card px-4 pt-[env(safe-area-inset-top)]"
    >
      {/* Same row the two headers draw, so the message reads identically
          wherever it lands, and the dismiss control on a persisting error comes
          along with it. Keyed by `status.id` for the same reason it is there. */}
      <HeaderStatusRow key={status.id} status={status} />
    </div>
  );
}
