import * as React from 'react';
import {
  Camera,
  LayoutGrid,
  Plus,
  Settings,
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
import { useTranslation } from 'react-i18next';

/**
 * Where a destination sits in the drawer/sidebar: with the day-to-day
 * destinations, or in the visually separated footer group that carries
 * configuration (Settings, and — drawer only — Install app).
 */
export type NavigationGroup = 'primary' | 'footer';

export type NavigationItem = {
  /** Catalog key, not a literal label — see the catalog comment for why. */
  labelKey: string;
  to: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>> | LucideIcon;
  group: NavigationGroup;
  /**
   * Present only for the destinations the mobile tab bar ALSO carries. Its
   * `order` is the tab-bar slot, which is deliberately not the catalog's own
   * order: the drawer/sidebar reads as a list (Diary, Add, Scan, …) while the
   * bar is a shape, and the raised Scan button has to sit in its middle slot.
   * Keeping the two orders as one field on one entry is what stops the bar and
   * the drawer drifting into two different labels for one destination.
   */
  tab?: { order: number; raised?: boolean };
};

/**
 * Personal food-tracker navigation. Shares labels/hrefs with `BottomNav`'s
 * mobile tabs for every destination the two navs have in common (see that
 * file's own doc comment for why "AI settings" isn't a top-level item here
 * either) — a laptop user used to see "Scan Plate"/"Add food"/"AI Settings"
 * here while a phone user on the same account saw "Scan"/"Add"/"Goals" for
 * the same destinations, same app, two different maps.
 *
 * Each nav surface now has exactly one job, and all three read this catalog:
 *
 * - **Tab bar** (`BottomNav`, mobile) — the daily logging loop ONLY: the three
 *   entries carrying a `tab` field. Trends left the bar because reviewing is
 *   not logging; it is still one tap away in the drawer.
 * - **Drawer** (`app-wrapper.tsx`'s `NavDrawer`, mobile) and **sidebar**
 *   (desktop) — the complete map, identical to each other: every `primary`
 *   entry, then a separated `footer` group.
 *
 * Since M129/05 every nav carries catalog KEYS rather than literal labels, so a
 * wording change lands in one catalog entry and all of them move together —
 * label drift is now only possible by using different keys for the same
 * destination, which is exactly what the unit test pins.
 * Exported so a unit test can assert keys/hrefs never drift apart again
 * without rendering anything — a data-only assertion is the right shape for a
 * label/href check, and it costs no router harness.
 */
export const personalNavigationItems: NavigationItem[] = [
  // The app home (M134). No `tab` field on purpose: `BottomNav` carries the
  // daily logging loop only, and its raised centre button needs exactly three
  // slots — Overview is a review surface, like Trends, which left the bar for
  // the same reason. It is one tap away in the drawer and a first-class row
  // in the sidebar.
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutGrid, group: 'primary' },
  { labelKey: 'nav.diary', to: '/diary', icon: UtensilsCrossed, group: 'primary', tab: { order: 1 } },
  { labelKey: 'nav.add', to: '/add', icon: Plus, group: 'primary', tab: { order: 3 } },
  { labelKey: 'nav.scan', to: '/scan', icon: Camera, group: 'primary', tab: { order: 2, raised: true } },
  // The fasting timer (M132). No `tab` field, for the same reason `/dashboard`
  // and `/trends` have none: `BottomNav` carries the daily LOGGING loop and its
  // raised centre button needs exactly three slots. A fast is something you
  // start once and then watch — it is not a several-times-a-day tap.
  //
  // Placed after Scan and before Trends so the catalog reads as the
  // doing-surfaces (Overview, Diary, Add, Scan, Fasting) then the reviewing and
  // target-setting ones (Trends, Goals).
  { labelKey: 'nav.fasting', to: '/fasting', icon: Timer, group: 'primary' },
  { labelKey: 'nav.trends', to: '/trends', icon: TrendingUp, group: 'primary' },
  // The nutrient screen (M135/06). No `tab` field, same reason as Overview,
  // Trends and Fasting: `BottomNav` carries the daily LOGGING loop and its
  // raised centre button needs exactly three slots. This is a reviewing
  // surface — it sits next to Trends, which is what it is a sibling of.
  { labelKey: 'nav.nutrients', to: '/nutrients', icon: Sprout, group: 'primary' },
  { labelKey: 'nav.goals', to: '/settings/goals', icon: Target, group: 'primary' },
  // The settings HUB, not one setting: this row used to point straight at
  // Preferences, which made theme/language look like the only settings the
  // app has and left AI, sync and backups reachable only from the retired
  // profile page. The hub lists all of them with their current values.
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, group: 'footer' },
];

/** The day-to-day destinations, in catalog order — the top block of the drawer and the sidebar. */
export const primaryNavigationItems: NavigationItem[] = personalNavigationItems.filter(
  (item) => item.group === 'primary',
);

/** The separated configuration group at the bottom of the drawer and the sidebar. */
export const footerNavigationItems: NavigationItem[] = personalNavigationItems.filter(
  (item) => item.group === 'footer',
);

/**
 * The mobile tab bar's destinations, in bar order (see `NavigationItem.tab`).
 * Derived rather than re-listed, so the bar cannot label a destination
 * differently from the drawer.
 */
export const tabNavigationItems: NavigationItem[] = personalNavigationItems
  .filter((item) => item.tab !== undefined)
  .toSorted((a, b) => (a.tab?.order ?? 0) - (b.tab?.order ?? 0));

/**
 * Which nav item (if any) the current URL belongs to — the LONGEST matching
 * href wins.
 *
 * A plain `startsWith` per item breaks now that the catalog carries both
 * `/settings` (the hub) and `/settings/goals`: on the goals page both rows
 * would match and both would highlight, which tells the user nothing. Pure
 * and exported so the sidebar and the mobile drawer share one rule, and so it
 * is testable without a router.
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
      <img src="/icons/icon-192.png?v=2" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      {!isCollapsed && <span className="font-display text-lg font-semibold text-sidebar-foreground">openplate</span>}
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

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  // No session read at all (M128 spec 03). The superadmin groups that used to
  // sit above and below the tracker nav went with `/super/*` and the account
  // system itself — this is now one flat list of the app's own destinations.
  const location = useLocation();
  const { t } = useTranslation();
  const activeHref = activeNavigationHref(location.pathname);

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
      </SidebarContent>
      {/* Settings is configuration, not a destination you visit daily, so it
          sits below a rule at the bottom of the rail rather than as a sixth
          equal row — the same separation the mobile drawer draws. */}
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          {footerNavigationItems.map((item) => (
            <NavigationRow key={item.to} item={item} isActive={activeHref === item.to} />
          ))}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
