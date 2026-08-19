import { useLocation } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Share } from 'lucide-react';
import {
  AppSidebar,
  activeNavigationHref,
  footerNavigationItems,
  primaryNavigationItems,
  type NavigationItem,
} from './app-sidebar';
import { AvatarMenu } from './avatar-menu';
import { BottomNav } from './bottom-nav';
import { ProgressBar } from './progress-bar';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar';
import { Separator } from './ui/separator';
import { useInstallAffordance } from '#app/hooks/use-install-affordance';
import { APP_NAME } from '#app/lib/brand';
import { cn } from '#app/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Button } from './ui/button';
import * as React from 'react';

/**
 * The install-app entry in the mobile nav drawer, rendered only when there's
 * an actual affordance to offer (see `useInstallAffordance` — mirrors
 * `InstallCard`'s logic so the drawer and the settings card can never
 * disagree about whether the app is installable). A native
 * `beforeinstallprompt` triggers directly; iOS has no install API, so that
 * case links to the settings hub's own step-by-step "Add to Home Screen"
 * instructions.
 */
function InstallDrawerItem({ onNavigate }: { onNavigate: () => void }) {
  const { affordance, promptInstall } = useInstallAffordance();
  const { t } = useTranslation();

  if (affordance === 'none') return null;

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

/** One drawer row's classes — active rows carry the brand the same way the sidebar's do. */
function drawerItemClasses(isActive: boolean): string {
  return cn(
    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
    isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
  );
}

/** One drawer destination — the drawer's counterpart to the sidebar's `NavigationRow`. */
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
 * Persistent top-left brand mark for the mobile header — always visible,
 * tappable to open the navigation drawer. `md:hidden`: at `md`+ the sidebar's
 * own `Logo()` already occupies this same top-left position, so this would
 * otherwise be a second, redundant brand mark next to it.
 *
 * It was a dropdown of four odd destinations; it's now a real left-slide
 * drawer rendering the SAME catalog the desktop sidebar does, in the same
 * order and with the same footer separation — a phone user and a laptop user
 * see one map of the app rather than two. `BottomNav` keeps only the daily
 * logging loop (Diary · Scan · Add); this drawer is the complete list.
 */
function NavDrawer() {
  const { t } = useTranslation();
  const location = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);
  const close = (): void => setIsOpen(false);
  const activeHref = activeNavigationHref(location.pathname);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {/* Sized to the two-line lockup beside it (see `InnerContent`), not to
            an icon-button grid: at `size-9` the mark optically spans BOTH the
            wordmark and the page title, which is what binds them into one
            brand-then-page unit. `p-0` drops the ghost button's inset, so the
            mark sits tight against the wordmark — that inset is what left the
            first eyebrow attempt floating free of the mark. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 p-0 hover:bg-transparent md:hidden"
          aria-label={t('chrome.logoMenuLabel')}
        >
          <img src="/icons/icon-192.png?v=2" alt="" className="size-9 rounded-lg" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0 md:hidden">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 font-display text-lg">
            <img src="/icons/icon-192.png?v=2" alt="" className="h-7 w-7 rounded-lg" />
            {/* The product name is a proper noun — never translated. */}
            {APP_NAME}
          </SheetTitle>
          <SheetDescription className="sr-only">{t('chrome.navDrawerDescription')}</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-2">
          {primaryNavigationItems.map((item) => (
            <DrawerRow key={item.to} item={item} isActive={activeHref === item.to} onNavigate={close} />
          ))}
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
  // M128 spec 03: there are no accounts, so the top-right control is about the
  // DEVICE, not a person — see `AvatarMenu`. Nothing to sign in or out of.
  const { t } = useTranslation();

  return (
    <>
      <ProgressBar />
      {/* The chrome sits on `bg-card`, not `bg-background` — the header was
          previously the exact same fill as the page beneath it, so the only
          thing separating it from the date navigator was one hairline and the
          whole top of the screen read as one undifferentiated slab. Every other
          surface in the app is a card; the one piece of persistent chrome was
          the least treated thing on screen. `border-primary/20` tints the
          closing hairline the way the active bottom-nav tab is tinted
          (DESIGN.md §2, "where the brand shows up outside a hero");
          `AppSidebar`'s header carries the same value so the two rules read as
          one line across the chrome at `md`+. */}
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-primary/20 bg-card">
        <div className="flex items-center gap-2.5 px-4 w-full">
          {/* Desktop only: below `md` the drawer's own brand-mark trigger (see
              `NavDrawer`) opens the same list, and a second hamburger beside it
              would just be two triggers for one sheet. Only the desktop sidebar
              (visible at `md`+, see `Sidebar`'s own `hidden md:block`) needs
              this toggle. */}
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
          <Separator orientation="vertical" className="mr-2 h-4 hidden md:block" />
          <NavDrawer />
          <div className="flex flex-1 items-center justify-between">
            <div className="flex min-w-0 flex-col justify-center gap-px">
              {/* The wordmark, mobile only. Below `md` the mark to its left is
                  the app's ONLY persistent brand statement, so the word belongs
                  next to it; at `md`+ the sidebar's own `Logo()` renders this
                  exact lockup a few pixels away, and a second "openplate" there
                  is a duplicate, not emphasis.

                  Deliberately NOT the `SectionEyebrow` recipe (DESIGN.md §2:
                  11px, uppercase-ish, `tracking-[0.11em]`) — that treatment
                  already means "label for the content block below" everywhere
                  else in the app, so wearing it made the brand read as a
                  category kicker for the page title rather than as the product
                  name. A wordmark is set like a wordmark: normal tracking,
                  lowercase, brand-teal.

                  "openplate" is a literal, lowercase brand string, deliberately
                  outside i18n — same convention as `APP_NAME` elsewhere here.
                  Decorative: the `h1` below names the page for assistive tech. */}
              <span aria-hidden="true" className="font-display text-xs font-semibold leading-none text-primary md:hidden">
                {APP_NAME}
              </span>
              {/* `truncate` because the longest titles ("Sync across devices",
                  "Connecting to OpenRouter", and their longer German
                  translations) would otherwise wrap the header to three lines
                  on a narrow phone. */}
              <h1 className="truncate font-display text-lg font-semibold leading-tight tracking-tight md:text-xl">
                {title || APP_NAME}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {/* The device menu, at both breakpoints — identity, the theme
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
          <Link
            to={backTo}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('chrome.back')}
          </Link>
        </div>
      )}
      {/* Bottom padding clears the mobile `BottomNav` so page content is never
          occluded; the sidebar owns navigation at md+. 6rem = the h-14 bar plus
          the safe area plus the raised Scan button's overhang and ring
          (M129/04) — content must clear the circle, not just the bar. */}
      <div className="flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:p-6 md:pb-6">{children}</div>
      <BottomNav />
    </>
  );
}
