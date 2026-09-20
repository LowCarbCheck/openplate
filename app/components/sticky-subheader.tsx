import type * as React from 'react';

/**
 * A second bar that pins directly under the app header, for the one control a
 * page cannot afford to scroll away. Only the diary uses it today: its date
 * navigator decides WHICH day every row below belongs to, so scrolling a long
 * day used to leave the person reading entries with no visible answer to "what
 * day is this" and no way back to yesterday without scrolling to the top. The
 * dashboard and every other page get the sticky header alone, because they have
 * no equivalent control; a bar that says nothing is just lost height.
 */
export function StickySubheader({ children }: { children: React.ReactNode }) {
  // `top-16` is one contract with the header in `app/components/app-wrapper.tsx`,
  // whose `<header>` is `min-h-16`. The two numbers must stay equal or this bar
  // either overlaps the header or floats below it with a gap of page showing
  // through. `tests/unit/sticky-subheader.test.ts` parses both files and fails
  // when they drift.
  //
  // `z-30` sits below the header's `z-40` on purpose, so this bar slides UNDER
  // the header rather than over it, and below every Radix portal at `z-50`.
  //
  // The negative margins cancel the page padding `p-4 md:p-6` that `InnerContent`
  // gives every page, so this bar runs edge to edge like the header instead of
  // stopping short of both screen edges. The matching `px` puts the padding back
  // on the content inside.
  //
  // `first:-mt-4` cancels that page padding at the TOP as well. Without it the
  // page's own 16px of `bg-background` showed between the header's hairline and
  // this bar's, a band of nothing that read as a rendering fault rather than as
  // spacing (FRONT-15, measured at 360: header bottom 64, bar top 80). It is
  // scoped to `:first-child` because a page may put a banner above this bar,
  // and there the 24px the page asked for is the right gap; pulling the bar up
  // would leave the banner 8px from the header instead.
  //
  // The margin goes HERE and not on a wrapper in the page: a `position: sticky`
  // element only travels inside its own parent's box, so wrapping this bar to
  // move it would pin it to the top of a 61px box and it would scroll away.
  return (
    <div
      className="sticky top-16 z-30 -mx-4 border-b border-primary/20 bg-card px-4 py-2 first:-mt-4 md:-mx-6 md:px-6 md:first:-mt-6"
      data-slot="sticky-subheader"
    >
      {children}
    </div>
  );
}
