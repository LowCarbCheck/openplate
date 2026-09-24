/**
 * `/add`, the hub the three intake siblings nest under (ADR-0019).
 *
 * THE SWITCHER LIVES HERE (M255/01). Search, Describe and Photo are drawn
 * once, above `<Outlet />`, so the row stays mounted while the screen under
 * it changes and sits in the same box on all three. What makes a switch safe
 * is not this file but `app/lib/add-drafts.ts`: each screen keeps its draft
 * there, so the person who leaves one to try another finds it where they left
 * it when they come back. There is still no hub SCREEN: bare `/add` redirects
 * to `/add/search` (`add._index.tsx`), and the launcher's raised button and
 * its long-press sheet stay the one-gesture way in from anywhere else.
 *
 * NOT FOR A CONSUMER. `/add/describe?to=/pantry` is the pantry asking for a
 * list of what is on the shelf (M233/01), not a way to log a meal, so a row
 * offering the diary's search and camera would be three doors out of the
 * pantry. The row is left out on any `?to=`, decided from the address and so
 * from the very first paint, never hidden after it.
 *
 * WHY A GRID. The describe composer pins itself to the bottom of the room it
 * is given (`min-h-full` on its page, see `add.describe.tsx`). The row takes
 * its own height, the screen under it takes the rest (`1fr`), and a grid
 * area is a definite height for a percentage to resolve against, so the
 * composer still ends where the page ends instead of one switcher lower.
 * `minmax(0, 1fr)` across keeps a long unbroken word inside a screen from
 * widening the column past the phone.
 */
import { useState } from 'react';
import { Outlet, useSearchParams } from 'react-router';
import { AddMethodBusyProvider, AddMethodSwitcher } from '#app/components/intake/add-method-switcher';

export default function AddLayout() {
  const [searchParams] = useSearchParams();
  // True while `/add/photo` has an analysis in flight; the photo screen sets
  // it through `useReportAddMethodBusy` and clears it when it unmounts.
  const [isBusy, setIsBusy] = useState(false);

  if (searchParams.has('to')) return <Outlet />;

  return (
    <AddMethodBusyProvider value={setIsBusy}>
      <div data-slot="add-layout" className="grid min-h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] gap-4">
        <AddMethodSwitcher isBusy={isBusy} />
        {/* ONE grid item for whatever the screen renders, fragments and
            all, so a screen with two top-level siblings never lands them in
            rows of their own. */}
        <div data-slot="add-method-screen" className="min-w-0">
          <Outlet />
        </div>
      </div>
    </AddMethodBusyProvider>
  );
}
