import * as React from 'react';
import {
  Camera,
  CreditCard,
  LayoutGrid,
  Plus,
  Refrigerator,
  Settings,
  ShieldCheck,
  Sprout,
  Target,
  Timer,
  TrendingUp,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '#app/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroupLabel,
  SidebarSeparator,
  useSidebar,
} from '#app/components/ui/sidebar';
import { useLocation } from 'react-router';
import { Link } from '#app/components/link';
import { Wordmark } from '#app/components/wordmark';
import { useSyncSession } from '#app/components/sync-status';
import { AppBuildStamp } from '#app/components/build-stamp';
import { PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import { useTranslation } from 'react-i18next';

/**
 * Where a destination sits in the sidebar: with the day-to-day destinations,
 * or in the visually separated footer group that carries configuration
 * (Settings).
 */
export type NavigationGroup = 'primary' | 'footer';

export type NavigationItem = {
  /** Catalog key, not a literal label — see the catalog comment for why. */
  labelKey: string;
  to: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>> | LucideIcon;
  group: NavigationGroup;
  /**
   * Where a `primary` destination lives on a phone (M258). The desktop sidebar
   * ignores it and draws every entry.
   *
   * - `'tab'`: a flat tab of its own in the bottom bar. Diary is the only one.
   * - `'plus'`: behind the bar's raised plus, whose add sheet reaches it. Add
   *   and Scan, the two ways food comes in.
   * - absent: a tile in the More sheet, which is every other page.
   *
   * One field on the entry, not a second list in `bottom-nav.tsx`, so the bar,
   * the More sheet and the sidebar cannot drift into two labels or two
   * addresses for one destination, and a page cannot be in the bar and in the
   * sheet at once.
   */
  phone?: 'tab' | 'plus';
};

/**
 * Personal food-tracker navigation. Shares labels/hrefs with the phone's bottom
 * bar and More sheet for every destination they have in common: a laptop user
 * used to see "Scan Plate"/"Add food"/"AI Settings" here while a phone user on
 * the same account saw "Scan"/"Add"/"Goals" for the same destinations, same
 * app, two different maps.
 *
 * Each nav surface has exactly one job, and all of them read this catalog:
 *
 * - **Bottom bar** (`BottomNav`, phone): three slots (M258). The one entry
 *   whose `phone` is `'tab'` (Diary), the raised plus that opens the add
 *   sheet (the two `'plus'` entries, Add and Scan, are what that sheet
 *   reaches), and More.
 * - **More sheet** (`more-sheet.tsx`, phone): every other `primary` entry, as
 *   tiles. Settings, Plan and Administration are not in it; on a phone they
 *   live in the avatar menu (`avatar-menu.tsx`).
 * - **Sidebar** (desktop): the complete map, every `primary` entry, then a
 *   separated `footer` group. Unchanged by M258.
 *
 * Since M129/05 every nav carries catalog KEYS rather than literal labels, so a
 * wording change lands in one catalog entry and all of them move together.
 * Label drift is now only possible by using different keys for the same
 * destination, which is exactly what the unit test pins.
 * Exported so a unit test can assert keys/hrefs never drift apart again
 * without rendering anything: a data-only assertion is the right shape for a
 * label/href check, and it costs no router harness.
 */
export const personalNavigationItems: NavigationItem[] = [
  // The app home (M134). A More tile, and the one nearest the thumb: the
  // sheet reverses this order, so the first entry here lands bottom right.
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutGrid, group: 'primary' },
  // The bar's one flat tab: the day is what a person opens the app for.
  { labelKey: 'nav.diary', to: '/diary', icon: UtensilsCrossed, group: 'primary', phone: 'tab' },
  // `/add/search` specifically (ADR-0019), not bare `/add`: `activeNavigationHref`
  // matches this exactly or one level under it, so the row lights up on the
  // database search and stays dark on `/add/photo`, a sibling rather than a
  // child of it. On a phone, the plus reaches it and `/add/photo` below.
  { labelKey: 'nav.add', to: '/add/search', icon: Plus, group: 'primary', phone: 'plus' },
  { labelKey: 'nav.scan', to: '/add/photo', icon: Camera, group: 'primary', phone: 'plus' },
  // The pantry (M233/02), placed directly after Scan because it is the second
  // thing the camera is for: the same composer, pointed at a shelf instead of
  // a plate.
  //
  // Then the fasting timer (M132): a fast is something you start once and then
  // watch, not a several-times-a-day tap. The catalog reads as the
  // doing-surfaces (Overview, Diary, Add, Scan, Pantry, Fasting) then the
  // reviewing and target-setting ones (Insights, Nutrients, Goals).
  { labelKey: 'nav.pantry', to: '/pantry', icon: Refrigerator, group: 'primary' },
  { labelKey: 'nav.fasting', to: '/fasting', icon: Timer, group: 'primary' },
  // Insights. It was the bar's second slot for one release (0.46.0); with three
  // slots it is a More tile, one tap further away, which is the cost the
  // operator accepted for a calmer bar.
  { labelKey: 'nav.trends', to: '/trends', icon: TrendingUp, group: 'primary' },
  // The nutrient screen (M135/06), a reviewing surface beside Insights, which
  // is what it is a sibling of.
  { labelKey: 'nav.nutrients', to: '/nutrients', icon: Sprout, group: 'primary' },
  { labelKey: 'nav.goals', to: '/settings/nutrition', icon: Target, group: 'primary' },
  // The settings HUB, not one setting: this row used to point straight at
  // Preferences, which made theme/language look like the only settings the
  // app has and left AI, sync and backups reachable only from the retired
  // profile page. The hub lists all of them with their current values.
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, group: 'footer' },
];

/**
 * The administrator entry, deliberately OUTSIDE `personalNavigationItems`.
 * The catalog is static: it is filtered into the phone's bar and More sheet and
 * pinned by a unit test, while this row appears only for an account whose role
 * is `admin`. It still lives here, as one shared object, because the avatar
 * menu and the sidebar have to render the same label and the same href, two
 * literals in two files is the drift the catalog comment above exists to
 * prevent.
 */
export const adminNavigationItem: NavigationItem = {
  labelKey: 'nav.admin',
  to: '/admin',
  icon: ShieldCheck,
  group: 'footer',
};

/**
 * The plan page's entry (M250), OUTSIDE `personalNavigationItems` for the
 * admin row's reason: the catalog is static, and this entry exists only for a
 * signed-in person on an instance whose FRESH handshake says a biller stands
 * behind it (`hasPlanNavigationEntry`). One shared object, so the avatar menu
 * and the sidebar draw one label and one address. It sits directly above
 * Settings in both.
 */
export const planNavigationItem: NavigationItem = {
  labelKey: 'nav.plan',
  to: PLAN_PAGE_HREF,
  icon: CreditCard,
  group: 'footer',
};

/**
 * The catalog the active row is chosen from: with the plan entry while it is
 * drawn, so on `/settings/plan` the plan row lights up and the settings row,
 * the shorter match, does not.
 */
export function activeCatalog(showsPlanEntry: boolean): readonly NavigationItem[] {
  return showsPlanEntry ? [...personalNavigationItems, planNavigationItem] : personalNavigationItems;
}

/** The day-to-day destinations, in catalog order: the top block of the sidebar. */
export const primaryNavigationItems: NavigationItem[] = personalNavigationItems.filter(
  (item) => item.group === 'primary',
);

/** The separated configuration group at the bottom of the sidebar. */
export const footerNavigationItems: NavigationItem[] = personalNavigationItems.filter(
  (item) => item.group === 'footer',
);

/**
 * The bottom bar's flat tabs, in catalog order (see `NavigationItem.phone`).
 * Derived rather than re-listed, so the bar cannot label a destination
 * differently from the sidebar.
 */
export const barTabNavigationItems: NavigationItem[] = personalNavigationItems.filter((item) => item.phone === 'tab');

/**
 * The More sheet's tiles: every `primary` destination the bar does not carry,
 * neither as a tab nor behind the plus.
 *
 * REVERSED, so the most used page is nearest the thumb (the operator's
 * choice, "most used near thumb"). The sheet fills its grid from the top left,
 * so the catalog's first page, Overview, is the last tile and sits bottom
 * right, and Goals, the last, sits top left.
 */
export const moreSheetNavigationItems: NavigationItem[] = primaryNavigationItems
  .filter((item) => item.phone === undefined)
  .toReversed();

/**
 * Which nav item (if any) the current URL belongs to — the LONGEST matching
 * href wins.
 *
 * A plain `startsWith` per item breaks now that the catalog carries both
 * `/settings` (the hub) and `/settings/nutrition`: on the targets page both rows
 * would match and both would highlight, which tells the user nothing. Pure
 * and exported so the sidebar, the phone's bar and its More sheet share one
 * rule, and so it is testable without a router.
 *
 * @param pathname - the current `location.pathname`.
 * @returns the winning item's `to`, or `null` when the URL is outside the catalog.
 */
export function activeNavigationHref(
  pathname: string,
  items: readonly NavigationItem[] = personalNavigationItems,
): string | null {
  return items.reduce<string | null>((best, item) => {
    const isMatch = pathname === item.to || pathname.startsWith(item.to + '/');
    if (!isMatch) return best;
    return best === null || item.to.length > best.length ? item.to : best;
  }, null);
}

function Logo() {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <Link
      // The in-app brand mark points at the app home, not at the diary.
      to="/dashboard"
      className={cn(
        'flex items-center gap-3 transition-all duration-200 ease-in-out hover:opacity-80 px-4',
        // Collapsed rail is `--sidebar-width-icon` (3rem) minus the header's own
        // `p-2` padding (see `SidebarHeader`), leaving exactly 2rem (the mark's
        // own `w-8`) of room — the same math `SidebarMenuButton` relies on when
        // it drops to `size-8! p-2!` under `group-data-[collapsible=icon]`. Any
        // leftover horizontal padding/gap here eats into that budget and
        // squeezes the mark, so both collapse to zero and the mark centers.
        isCollapsed && 'gap-0 px-0 justify-center',
      )}
    >
      <img src="/icons/icon-192.png?v=2" alt="" className="h-8 w-8 shrink-0" />
      {!isCollapsed && <Wordmark besideMark className="text-lg text-sidebar-foreground" />}
    </Link>
  );
}

/** One sidebar row — shared by the primary group and the footer group. */
function NavigationRow({ item, isActive }: { item: NavigationItem; isActive: boolean }) {
  const { t } = useTranslation();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link to={item.to}>
          <item.icon />
          <span>{t(item.labelKey)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  /** Whether the plan entry is drawn, decided once in the shell (`usePlanNavigationEntry`). */
  showsPlanEntry: boolean;
}

export function AppSidebar({ showsPlanEntry, ...props }: AppSidebarProps) {
  // The superadmin groups that used to sit above and below the tracker nav
  // went with `/super/*` and the account system itself (M128 spec 03), so the
  // catalog below is one flat list of the app's own destinations. The one
  // session read left is the sync session, and only to decide whether to show
  // the administrator row: `/admin` shows everybody else a card saying they
  // are not an administrator, so this is discoverability, not access control.
  const location = useLocation();
  const { t } = useTranslation();
  const session = useSyncSession();
  const activeHref = activeNavigationHref(location.pathname, activeCatalog(showsPlanEntry));
  // Matched against the admin entry alone, so the catalog's own winner is
  // untouched: `/admin` is outside the catalog and would otherwise never win.
  const adminActiveHref = activeNavigationHref(location.pathname, [adminNavigationItem]);

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Same brand-tinted hairline the app header closes with (see
          `app-wrapper.tsx`): at `md`+ these two rules sit at the same `y` and
          meet in the middle of the screen, so an untinted one here would show
          up as a colour break halfway across the chrome. */}
      <SidebarHeader className="h-16 border-b border-primary/20 px-0">
        <div className="flex h-full items-center">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.groupYourDay')}</SidebarGroupLabel>
          <SidebarMenu>
            {primaryNavigationItems.map((item) => (
              <NavigationRow key={item.to} item={item} isActive={activeHref === item.to} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {/* THE PLAN ENTRY, AT THE FOOT OF THE LIST, directly above the rule
            over Settings (M250). It is known only after the session and a
            fresh handshake, so it arrives after the first paint, and it must
            not move anything when it does. This group is the LAST child of a
            box whose height the rail fixes, pushed down by `mt-auto` into
            space that was empty: the list above keeps its place, and the
            footer below is a different box that never learns of it. Put in
            the footer instead, it grew the footer upward, and the footer's
            own top edge moving is a layout shift the browser reports. */}
        {showsPlanEntry && (
          <SidebarGroup data-nav-entry="plan" className="mt-auto">
            <SidebarMenu>
              <NavigationRow item={planNavigationItem} isActive={activeHref === planNavigationItem.to} />
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      {/* Settings is configuration, not a destination you visit daily, so it
          sits below a rule at the bottom of the rail rather than as a sixth
          equal row. On a phone it is in the avatar menu instead. */}
      <SidebarFooter>
        {session.account?.role === 'admin' && (
          <>
            <SidebarSeparator className="mx-0" />
            <SidebarMenu>
              <NavigationRow item={adminNavigationItem} isActive={adminActiveHref === adminNavigationItem.to} />
            </SidebarMenu>
          </>
        )}
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          {footerNavigationItems.map((item) => (
            <NavigationRow key={item.to} item={item} isActive={activeHref === item.to} />
          ))}
        </SidebarMenu>
        {/* Which build this is, readable without navigating. Hidden on the
            collapsed icon rail, where there is no room for a version string and
            the whole row would render as unreadable clipped text. */}
        <div className="px-2 pb-1 group-data-[collapsible=icon]:hidden">
          <AppBuildStamp />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
