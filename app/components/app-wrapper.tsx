import { useLocation } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Share } from 'lucide-react';
import {
  AppSidebar,
  activeNavigationHref,
  adminNavigationItem,
  footerNavigationItems,
  primaryNavigationItems,
  type NavigationItem,
} from './app-sidebar';
import { useSyncSession } from './sync-status';
import { AvatarMenu } from './avatar-menu';
import { BottomNav } from './bottom-nav';
import { FastChipSlot } from './fast-chip';
import { CatchUpWriter } from './catch-up-writer';
import { PulseHeartbeat } from './pulse-heartbeat';
import { HeaderStatus } from './header-status';
import { ProgressBar } from './progress-bar';
import { UpdateRibbon } from './update-ribbon';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar';
import { Separator } from './ui/separator';
import { useInstallAffordance } from '#app/hooks/use-install-affordance';
import { APP_NAME } from '#app/lib/brand';
import { cn } from '#app/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Button } from './ui/button';
import { Wordmark } from './wordmark';
import * as React from 'react';

/**
 * The install-app entry in the mobile nav drawer, rendered only when there's
 * an actual affordance to offer (see `useInstallAffordance`, mirrors
 * `InstallCard`'s logic so the drawer and the settings card can never
 * disagree about whether the app is installable). A native
 * `beforeinstallprompt` triggers directly; iOS has no install API, so that
 * case links to the settings hub's own step-by-step "Add to Home Screen"
 * instructions.
 */
function InstallDrawerItem({ onNavigate }: { onNavigate: () => void }) {
  const { affordance, promptInstall } = useInstallAffordance();
  const { t } = useTranslation();

  // Nothing to offer in a nav drawer for either silent state: an installed
  // app has nothing left to install, and a browser that cannot install has no
  // row that would do anything. The plain "it installs on a phone" sentence
  // for `'cannot-install'` is taught once, in the onboarding lesson, not
  // repeated as a dead drawer item.
  if (affordance === 'already-installed' || affordance === 'cannot-install') return null;

  if (affordance === 'ios-instructions') {
    return (
      <Link to="/settings#install" onClick={onNavigate} className={drawerItemClasses(false)}>
        <Share className="h-4 w-4" aria-hidden="true" />
        {t('chrome.installApp')}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        onNavigate();
        void promptInstall();
      }}
      className={cn(drawerItemClasses(false), 'w-full text-left')}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('chrome.installApp')}
    </button>
  );
}

/** One drawer row's classes, active rows carry the brand the same way the sidebar's do. */
function drawerItemClasses(isActive: boolean): string {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
    isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
  );
}

/** One drawer destination, the drawer's counterpart to the sidebar's `NavigationRow`. */
function DrawerRow({
  item,
  isActive,
  onNavigate,
}: {
  item: NavigationItem;
  isActive: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={drawerItemClasses(isActive)}
    >
      <item.icon className="h-4 w-4" aria-hidden="true" />
      <span>{t(item.labelKey)}</span>
    </Link>
  );
}

/**
 * Persistent top-left brand mark for the mobile header, always visible,
 * tappable to open the navigation drawer. `md:hidden`: at `md`+ the sidebar's
 * own `Logo()` already occupies this same top-left position, so this would
 * otherwise be a second, redundant brand mark next to it.
 *
 * It was a dropdown of four odd destinations; it's now a real left-slide
 * drawer rendering the SAME catalog the desktop sidebar does, in the same
 * order and with the same footer separation, a phone user and a laptop user
 * see one map of the app rather than two. `BottomNav` keeps only the daily
 * logging loop (Diary · Scan · Add); this drawer is the complete list.
 */
function NavDrawer() {
  const { t } = useTranslation();
  const location = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);
  const close = (): void => setIsOpen(false);
  const session = useSyncSession();
  const activeHref = activeNavigationHref(location.pathname);
  // Matched against the admin entry alone, so the catalog's own winner is
  // untouched: `/admin` is outside the catalog and would otherwise never win.
  const adminActiveHref = activeNavigationHref(location.pathname, [adminNavigationItem]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {/* Sized to the two-line lockup beside it (see `InnerContent`), not to
            an icon-button grid: at `size-9` the mark optically spans BOTH the
            wordmark and the page title, which is what binds them into one
            brand-then-page unit. `p-0` drops the ghost button's inset, so the
            mark sits tight against the wordmark, that inset is what left the
            first eyebrow attempt floating free of the mark.

            The `after:` square is the TAP AREA, and it is a pseudo-element
            because the drawing has to stay 36px for the reason above while a
            thumb needs 44. `-inset-1` grows it 4px on every side, which lands
            inside the header's own `px-4` gutter and inside the `gap-2.5` to
            its right, so nothing else on the bar loses a pixel of its own
            target. This trigger is `md:hidden`, so the box never exists on a
            pointer device. */}
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 shrink-0 p-0 after:absolute after:-inset-1 after:content-[''] hover:bg-transparent md:hidden"
          aria-label={t('chrome.logoMenuLabel')}
        >
          <img src="/icons/icon-192.png?v=2" alt="" className="size-9 rounded-lg" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0 md:hidden">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <img src="/icons/icon-192.png?v=2" alt="" className="h-7 w-7 rounded-lg" />
            {/* The product name is a proper noun, never translated. */}
            <Wordmark besideMark />
          </SheetTitle>
          <SheetDescription className="sr-only">{t('chrome.navDrawerDescription')}</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-2">
          {primaryNavigationItems.map((item) => (
            <DrawerRow key={item.to} item={item} isActive={activeHref === item.to} onNavigate={close} />
          ))}
          {/* The administrator row, on the same terms as the sidebar's: shown
              only to an account whose role is `admin`, and for discoverability
              rather than access control. */}
          {session.account?.role === 'admin' && (
            <>
              <Separator className="my-2" />
              <DrawerRow
                item={adminNavigationItem}
                isActive={adminActiveHref === adminNavigationItem.to}
                onNavigate={close}
              />
            </>
          )}
          {/* Same footer separation the desktop sidebar draws: configuration
              sits below a rule, not among the places you go every day. */}
          <Separator className="my-2" />
          {footerNavigationItems.map((item) => (
            <DrawerRow key={item.to} item={item} isActive={activeHref === item.to} onNavigate={close} />
          ))}
          <InstallDrawerItem onNavigate={close} />
        </nav>
      </SheetContent>
    </Sheet>
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
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <InnerContent title={title} backTo={backTo}>
          {children}
        </InnerContent>
      </SidebarInset>
    </SidebarProvider>
  );
}

// Inner content component that can use useSidebar hook
function InnerContent({ title, backTo, children }: { title?: string; backTo?: string; children: React.ReactNode }) {
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
          {/* Desktop only: below `md` the drawer's own brand-mark trigger (see
              `NavDrawer`) opens the same list, and a second hamburger beside it
              would just be two triggers for one sheet. Only the desktop sidebar
              (visible at `md`+, see `Sidebar`'s own `hidden md:block`) needs
              this toggle. */}
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
          <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
          <NavDrawer />
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
              {/* `gap-1.5`, AND IT IS THE POINT OF THIS COLUMN. It was `gap-px`
                  until 2026-09-21, which put the brand word 1.67 px of ink above
                  the page title (measured, `tests/e2e/header-brand-kicker.spec.ts`).
                  At that distance the two lines are one four-line-tall grey block
                  on a phone: a reader cannot say which line is the product and
                  which is the page they are on, and the operator said so of a
                  diary screenshot. 6 px is about half the kicker's own 12 px body,
                  which is the classic eyebrow step, and it reads as two ordered
                  things rather than as padding that was cranked up. 8 px was drawn
                  beside it and the pair started to drift apart inside the bar.

                  IT COSTS THE BAR NOTHING. The column is 12 + 6 + 17.5 = 35.5 px
                  inside a `min-h-16` header, so the header's fixed 64 px, which
                  three other layout budgets are measured off, does not move.
                  `tests/e2e/lcc-lineage-shell.spec.ts` re-reads that height. */}
              <div className="flex min-w-0 flex-col justify-center gap-1.5">
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
                    oversight. The pair reads as one blur for two reasons,
                    proximity and likeness, and only proximity was fixable here.
                    The title is ON its floor (`HEADER_TITLE_FLOOR_PX`), so it
                    cannot grow, and the only way left to widen the size ratio
                    would be to shrink the word, which is the opposite of what
                    the operator asked for. What separates the two instead is the
                    gap above and a weight difference of 500 (this word is 100,
                    the title 600), which is the widest this face offers.

                    `data-slot` because the gap above is now a measured contract
                    and a measurement needs a handle it cannot lose. Reading "the
                    span in the header that says openplate" would silently start
                    reading the drawer's word the day that sheet renders inline. */}
                <Wordmark
                  aria-hidden="true"
                  data-slot="header-brand-kicker"
                  className="text-xs leading-none md:hidden"
                />
                {/* `truncate` because the longest titles ("Sync across devices",
                    "Connecting to OpenRouter", and their longer German
                    translations) would otherwise wrap the header to three lines
                    on a narrow phone.

                    14px ON A PHONE, AND MEASURED. This was `text-lg` (18px) back
                    when the face was Inter. Victor Mono is a flat 0.6em per
                    character, wider than Inter for any mixed-case title, and the
                    title slot is only about 172px. 14px is the largest whole pixel
                    size at which no route title in any of the six languages is clipped
                    harder than Inter at 18px clipped it, at 390px and at 360px
                    (`lcc-lineage-clip-sweep.spec.ts` holds the line, and
                    `lcc-lineage-header-title.spec.ts` holds German and Turkish).
                    It was 15px until the sweep found Italian and French titles
                    ("Il tuo riepilogo giornaliero", "Contributions à la
                    recherche") clipped harder at 360px. 14px is also the floor
                    in `tests/design-contract.ts`: below it a title is not read. */}
                <h1 className="truncate text-sm font-semibold leading-tight tracking-tight md:text-xl">
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
              {/* The device menu, at both breakpoints, identity, the theme
                  inline, and the settings people revisit. See
                  `avatar-menu.tsx` for why the theme lives in here rather than
                  only on the Preferences page. */}
              <AvatarMenu />
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
          the safe area plus the raised Scan button's overhang and ring
          (M129/04), content must clear the circle, not just the bar. */}
      <div className="flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:p-6 md:pb-6">{children}</div>
      {/* HIDDEN, NOT UNMOUNTED, and hidden from a WRAPPER rather than from the
          bar itself. The bar is `fixed`, so `display: none` on this div takes
          it off the screen without moving a single pixel of the page: the
          bottom padding above is unchanged, so nothing reflows and nothing
          scrolls when it comes back. Unmounting would also close the launcher's
          sheet mid-use, and the sheet is portalled to the body, so it stays on
          screen while its trigger is away. */}
      <div data-slot="bottom-nav-shell" className={cn(isTypingOnAShortViewport && 'hidden')}>
        <BottomNav />
      </div>
    </>
  );
}
