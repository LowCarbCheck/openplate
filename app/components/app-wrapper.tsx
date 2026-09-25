import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { AppSidebar } from './app-sidebar';
import { AvatarMenu } from './avatar-menu';
import { BottomNav } from './bottom-nav';
import { MoreSheetProvider, useMoreSheetDoor } from './more-sheet';
import { FastChipSlot } from './fast-chip';
import { CatchUpWriter } from './catch-up-writer';
import { PulseHeartbeat } from './pulse-heartbeat';
import { TrialCountdown } from './plans/trial-countdown';
import { HeaderStatus } from './header-status';
import { ProgressBar } from './progress-bar';
import { UpdateRibbon } from './update-ribbon';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar';
import { Separator } from './ui/separator';
import { usePlanNavigationEntry } from '#app/hooks/use-plan-navigation-entry';
import { APP_NAME } from '#app/lib/brand';
import { cn } from '#app/lib/utils';
import { Wordmark } from './wordmark';
import * as React from 'react';

/**
 * The brand mark at the top left of the phone header, and the second door to
 * the More sheet (M259).
 *
 * TWO DOORS, ONE SHEET. The mark opened a side drawer until 0.46.0, and was a
 * picture that opened nothing in 0.47.0 (M258), when the bar's More tab became
 * the one door. After a day with that the operator wrote: "pressing on the top
 * left icon should open the same menu that the bottom right button opens." So
 * it opens exactly that sheet, the one instance `MoreSheetProvider` renders,
 * which rises from the bottom whichever door was tapped. What made 0.46.0's
 * two doors weird was a drawer that slid in from a different side for each;
 * here the two doors cannot disagree, because there is one thing to open.
 *
 * A BUTTON AROUND THE SAME PICTURE. The door props (`useMoreSheetDoor`)
 * announce the dialog and say whether it is open, and the sheet gives the
 * focus back here when this door opened it. Its name is the sheet's own title,
 * `nav.more`, since the picture says nothing a screen reader can read.
 *
 * A 44 px TARGET THAT MOVES NOTHING. The picture stays `size-9`, sized to the
 * two-line lockup beside it so the mark optically spans BOTH the wordmark and
 * the page title. The button pads it by 4 px on each side and takes the same
 * 4 px back with a negative margin, so the header's flex row still lays out a
 * 36 px box, and the title and the wordmark keep the rects they had in 0.47.0.
 * `mark-opens-more.spec.ts` freezes those rects and reads the 44 px box.
 *
 * `md:hidden`: at `md`+ the sidebar's own `Logo()` already occupies this
 * position, and a second mark next to it would be a duplicate. The sheet it
 * opens is phone-only too.
 */
function HeaderMark() {
  const { t } = useTranslation();
  const { doorProps } = useMoreSheetDoor();

  return (
    <button
      type="button"
      data-slot="header-mark"
      aria-label={t('nav.more')}
      {...doorProps}
      className="-m-1 flex shrink-0 p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
    >
      <img src="/icons/icon-192.png?v=2" alt="" className="size-9" />
    </button>
  );
}

/** The tags a person types into, and the only focus this layout reacts to. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * How short the viewport has to get before the bottom bar costs more than it
 * offers. On a 390x430 phone, which is what a 390x844 phone becomes with a
 * keyboard up, the header and the bar together took 121 of 430px, 28 percent
 * of the screen, and the bar covered the bottom of the field being typed into
 * (SET-04, measured on `/settings/profile`).
 */
const SHORT_VIEWPORT_HEIGHT = 500;

/**
 * Whether someone is typing on a viewport too short to carry the bottom bar as
 * well.
 *
 * `visualViewport` before `innerHeight`: an on-screen keyboard shrinks the
 * visual viewport on every phone, while the layout viewport only follows on
 * the browsers that resize it. Focus and resize are both read, so a keyboard
 * opening under a field that was already focused counts the same as a field
 * being tapped once the keyboard is up.
 *
 * @returns true while a text field has focus on a short viewport.
 */
function useTypingOnAShortViewport(): boolean {
  const [isTyping, setIsTyping] = React.useState(false);

  React.useEffect(() => {
    const read = (): void => {
      const focused = document.activeElement;
      const height = window.visualViewport?.height ?? window.innerHeight;
      setIsTyping(height < SHORT_VIEWPORT_HEIGHT && focused !== null && TEXT_ENTRY_TAGS.has(focused.tagName));
    };

    read();
    document.addEventListener('focusin', read);
    document.addEventListener('focusout', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      document.removeEventListener('focusin', read);
      document.removeEventListener('focusout', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);

  return isTyping;
}

export default function AppWrapper({
  title,
  backTo,
  children,
}: {
  title?: string;
  backTo?: string;
  children: React.ReactNode;
}) {
  // ONE READ FOR BOTH NAVIGATIONS, the sidebar and the phone's avatar menu,
  // in the shell, which mounts once per page load and survives every client
  // navigation.
  const showsPlanEntry = usePlanNavigationEntry();
  return (
    <SidebarProvider>
      <AppSidebar showsPlanEntry={showsPlanEntry} />
      <SidebarInset>
        {/* THE MORE SHEET'S ONE INSTANCE, around both of its doors: the mark
            in the header and the More tab in the bar (M259). It belongs to
            neither door, so it sits above both, and never inside the bar's
            wrapper, which is hidden while someone types on a short viewport
            while the header stays. The sheet itself is portalled, so where
            this sits moves no box. */}
        <MoreSheetProvider showsPlanEntry={showsPlanEntry}>
          <InnerContent title={title} backTo={backTo} showsPlanEntry={showsPlanEntry}>
            {children}
          </InnerContent>
        </MoreSheetProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}

// Inner content component that can use useSidebar hook
function InnerContent({
  title,
  backTo,
  showsPlanEntry,
  children,
}: {
  title?: string;
  backTo?: string;
  showsPlanEntry: boolean;
  children: React.ReactNode;
}) {
  // The top-right control is `AvatarMenu`. It was device-only because M128 spec
  // 03 says there are no accounts, and that premise is now conditional (M201):
  // an instance running `INSTANCE_MODE=managed` has accounts, and the menu
  // carries the door in or out for them. The menu asks the policy itself; this
  // layout stays out of it.
  const { t } = useTranslation();
  const isTypingOnAShortViewport = useTypingOnAShortViewport();

  return (
    <>
      <ProgressBar />
      {/* In flow and above the header, so it reserves space instead of covering
          the page title. Renders nothing unless there is something to say. */}
      <UpdateRibbon />
      {/* The chrome sits on `bg-card`, not `bg-background`, the header was
          previously the exact same fill as the page beneath it, so the only
          thing separating it from the date navigator was one hairline and the
          whole top of the screen read as one undifferentiated slab. Every other
          surface in the app is a card; the one piece of persistent chrome was
          the least treated thing on screen. `border-primary/20` tints the
          closing hairline the way the active bottom-nav tab is tinted
          (DESIGN.md §2, "where the brand shows up outside a hero");
          `AppSidebar`'s header carries the same value so the two rules read as
          one line across the chrome at `md`+. */}
      {/* `sticky top-0` pins the header to the top of the viewport while the
          page scrolls under it, so the page title and the device menu are
          always one tap away. The scroll container is the DOCUMENT: nothing
          between `<html>` and this element sets an `overflow` (checked in
          `root.tsx`, in `app.css`, and on `SidebarProvider`'s wrapper and
          `SidebarInset` in `ui/sidebar.tsx`), so `top-0` is measured against
          the viewport. Do not introduce a scrolling ancestor here; it would
          silently re-anchor this bar.

          `UpdateRibbon` above stays IN FLOW, so it scrolls away with the page
          and the header then pins at 0 rather than under a bar that is usually
          not there.

          `z-40` is deliberate and is a contract with three neighbours:
          `BottomNav` and the scan route's action bar are also `z-40`, and
          every Radix portal (Popover, Sheet, Dialog) is `z-50`. Raising this
          to `z-50` would put the header OVER the diary's calendar popover.
          `tests/unit/app-wrapper-sticky-header.test.ts` fails on that. The bar
          already sits on `bg-card`, an opaque fill, so it needs no backdrop
          blur to stay readable over scrolling content. */}
      <header className="sticky top-0 z-40 flex min-h-16 shrink-0 items-center gap-2 border-b border-primary/20 bg-card">
        <div className="flex min-w-0 items-center gap-2.5 px-4 w-full">
          {/* Desktop only: below `md` the mark beside it and the bottom bar's
              More tab are the doors to the pages the bar does not carry, and a
              hamburger here would be a third. Only the desktop sidebar (visible
              at `md`+, see `Sidebar`'s own `hidden md:block`) needs this
              toggle. */}
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
          <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
          <HeaderMark />
          {/* `min-w-0` so this flex child can shrink below its status text's
              intrinsic width; without it a long status (a blocked-notification
              error, especially the longer German string) pushes the header
              past the viewport instead of wrapping inside `HeaderStatusRow`.
              `tests/unit/app-wrapper-sticky-header.test.ts` pins this line's
              exact class list. */}
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            {/* The header's title slot is also the app's ONE notification
                surface. While `#app/lib/status` holds a message,
                `HeaderStatus` renders it here instead of the two lines below,
                in the same box and under the same fixed header height, so
                nothing on this bar moves. There are no toasts any more. */}
            <HeaderStatus>
              {/* `gap-1`, AND IT IS THE POINT OF THIS COLUMN. It was `gap-px`
                  until 2026-09-21, which put the brand word 1.67 px of ink above
                  the page title (measured, `tests/e2e/header-brand-kicker.spec.ts`).
                  At that distance the two lines are one grey block on a phone: a
                  reader cannot say which line is the product and which is the
                  page they are on, and the operator said so of a diary
                  screenshot. It was `gap-1.5` (6 px) for one day, beside a 14 px
                  title. On 2026-09-22 the operator compared the pair in a
                  playground and chose an 18 px title with 4 px above it: the
                  larger title already stands apart from the 12 px word by size,
                  so the white can be smaller, and the pair still reads as two
                  ordered things instead of drifting apart inside the bar.

                  IT COSTS THE BAR NOTHING. The column is 12 + 4 + 22.5 = 38.5 px
                  inside a `min-h-16` header, so the header's fixed 64 px, which
                  three other layout budgets are measured off, does not move.
                  `tests/e2e/lcc-lineage-shell.spec.ts` re-reads that height. */}
              <div className="flex min-w-0 flex-col justify-center gap-1">
                {/* The wordmark, mobile only. Below `md` the mark to its left is
                    the app's ONLY persistent brand statement, so the word belongs
                    next to it; at `md`+ the sidebar's own `Logo()` renders this
                    exact lockup a few pixels away, and a second "openplate" there
                    is a duplicate, not emphasis.

                    Deliberately NOT the `SectionEyebrow` recipe (small uppercase
                    grey caps): that treatment already means "label for the
                    content block below" everywhere else in the app, so wearing
                    it made the brand read as a category kicker for the page
                    title rather than as the product name. A wordmark is set like
                    a wordmark: lowercase, thin, "open" in brand teal and "plate" in
                    the ink of the header. The recipe lives in `Wordmark`, so this
                    call passes a size and nothing else.

                    `Wordmark` renders the literal, lowercase brand string
                    (`APP_NAME`, deliberately outside i18n) in the brand face.
                    Decorative: the `h1` below names the page for assistive tech.

                    THE SIZE STAYS 12 px, and that is a decision, not an
                    oversight. The pair read as one blur for two reasons,
                    proximity and likeness. Both are answered on the title's
                    side: the title is 18 px, half again the word's size, and
                    600 against this word's 100, the widest weight step this
                    face offers. Shrinking the word would widen the ratio too,
                    and is the opposite of what the operator asked for.

                    `data-slot` because the gap above is now a measured contract
                    and a measurement needs a handle it cannot lose. Reading "the
                    span in the header that says openplate" would silently start
                    reading some other openplate the day a sheet renders one inline. */}
                <Wordmark
                  aria-hidden="true"
                  data-slot="header-brand-kicker"
                  className="text-xs leading-none md:hidden"
                />
                {/* 18 px ON A PHONE, FIXED, AND THE STRINGS MUST FIT IT. The
                    operator chose this on 2026-09-22 after comparing sizes side
                    by side in a playground. It had been 14 px, the largest size
                    at which no title clipped harder in Victor Mono than it had
                    in Inter at 18 px, and at 14 px a page title is barely larger
                    than the body under it.

                    THE SIZE DOES NOT BEND. Victor Mono is a flat 0.6 em per
                    character, so a title here costs 10.8 px a character and the
                    slot holds a fixed count of them. A title that does not fit
                    is a defect in its STRING, in its locale file, and is fixed
                    by shortening the string. There is no shrink to fit, no
                    clamp and no fallback size, on purpose.
                    `lcc-lineage-header-title.spec.ts` writes every route title
                    of all six languages into this element at 360 and 390 px and
                    fails on any that does not fit;
                    `lcc-lineage-clip-sweep.spec.ts` checks the title each route
                    really draws. Both read the size from
                    `tests/design-contract.ts` (`HEADER_TITLE_PX`).

                    `truncate` stays only as the last safety net, so a title
                    that slips through ends in an ellipsis instead of wrapping
                    the header onto a second line. Desktop keeps `md:text-xl`. */}
                <h1 className="truncate text-lg font-semibold leading-tight tracking-tight md:text-xl">
                  {title || APP_NAME}
                </h1>
              </div>
            </HeaderStatus>
            <div className="flex shrink-0 items-center gap-3">
              {/* The one live fact in the app, and the only thing in this bar
                  that is not always there: it renders nothing unless a fast is
                  scheduled or running. `min-h-9` inside this header's
                  `min-h-16` is what keeps the bar's height fixed either way,
                  and it sits in the shrink-0 group so the `h1` beside it
                  truncates first. */}
              <FastChipSlot />
              {/* No markup at all: it beats a "still fasting" signal while a
                  fast is running and this tab is visible, and it is mounted
                  beside the chip for the chip's own reason, a fast runs
                  whatever page the person is on (M222). The toggle is asked
                  inside `#app/lib/pulse`, never here. */}
              <PulseHeartbeat />
              {/* Also no markup: it writes this morning's catch-up into the
                  notification database so a push that arrives later already
                  has its words. Mounted here for `PulseHeartbeat`'s own
                  reason, a log lands on whatever page the person is on
                  (M223). */}
              <CatchUpWriter />
              {/* No markup either: during a trial it publishes the countdown
                  to the status channel, which this header's title slot draws
                  (M250/03). Mounted in the personal shell only, once, so the
                  line is published once per page load. */}
              <TrialCountdown />
              {/* The device menu, at both breakpoints: identity, the theme
                  inline, and Settings, with Plan and Administration where
                  they apply. On a phone it is the only door to Plan and
                  Administration (M258); Settings is also a row in the More
                  sheet since M259. See `avatar-menu.tsx` for why the theme
                  lives in here rather than only on the Preferences page. */}
              <AvatarMenu showsPlanEntry={showsPlanEntry} />
            </div>
          </div>
        </div>
      </header>
      {backTo && (
        <div className="bg-muted/50 border-b px-4 py-2 sm:px-6 lg:px-8">
          {/* `min-h-11 py-2` makes the way back a 44px target; `-my-2` spends
              that height on the bar's own padding rather than on new chrome,
              so the bar grows 4px instead of 20 and the link's box covers it
              edge to edge. It was 20px tall on every settings sub-page. The
              `md:` line puts the pointer-sized bar back. */}
          <Link
            to={backTo}
            data-slot="back-link"
            className="-my-2 inline-flex min-h-11 items-center py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:my-0 md:min-h-0 md:py-0"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('chrome.back')}
          </Link>
        </div>
      )}
      {/* Bottom padding clears the mobile `BottomNav` so page content is never
          occluded; the sidebar owns navigation at md+. 6rem = the h-14 bar plus
          the safe area plus the raised plus button's overhang and ring
          (M129/04), content must clear the circle, not just the bar. */}
      <div className="flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:p-6 md:pb-6">{children}</div>
      {/* HIDDEN, NOT UNMOUNTED, and hidden from a WRAPPER rather than from the
          bar itself. The bar is `fixed`, so `display: none` on this div takes
          it off the screen without moving a single pixel of the page: the
          bottom padding above is unchanged, so nothing reflows and nothing
          scrolls when it comes back. Unmounting would also close the add
          sheet mid-use; it is portalled to the body, so it stays on screen
          while its door is away. The More sheet is not rendered in here at
          all: `MoreSheetProvider` holds it, above the header and this wrapper
          both. */}
      <div data-slot="bottom-nav-shell" className={cn(isTypingOnAShortViewport && 'hidden')}>
        <BottomNav />
      </div>
    </>
  );
}
