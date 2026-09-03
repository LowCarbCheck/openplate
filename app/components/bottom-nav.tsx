import { NavLink } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { cn } from '#app/lib/utils';
import { tabNavigationItems, type NavigationItem } from './app-sidebar';
import { AddLauncher } from '#app/components/add-launcher';

/**
 * The bar carries the **daily logging loop and nothing else**: Diary · Scan ·
 * Add. Every other destination — Trends, Goals, Settings — lives in the
 * top-left navigation drawer (`app-wrapper.tsx`'s `NavDrawer`), which shows the
 * same complete map the desktop sidebar does. One surface, one job: this one is
 * "what I do several times a day", not "everywhere I can go".
 *
 * Trends left the bar in this pass. Reviewing a week is not logging a meal, and
 * with it gone the bar has three slots, which finally makes the raised Scan
 * button a genuine center rather than a fake one (M129/04 had to bracket four
 * slots to get near it). Trends is one tap away in the drawer and still a
 * first-class row in the sidebar at `md`+.
 *
 * The entries themselves come from the shared catalog
 * (`personalNavigationItems`), pre-ordered by each item's `tab.order` — this
 * file no longer re-lists labels or hrefs, so the bar and the drawer can't
 * disagree about a destination.
 */
const BOTTOM_NAV_TABS: readonly NavigationItem[] = tabNavigationItems;

/**
 * An ordinary tab: icon over label, with the active state carrying the brand in
 * three places (a top rule, a faint wash, and the text color) so it never
 * depends on hue alone.
 */
function FlatTab({ tab }: { tab: NavigationItem }) {
  const { t } = useTranslation();

  return (
    <NavLink
      to={tab.to}
      className={({ isActive }) =>
        cn(
          'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
          isActive ?
            'bg-primary/5 text-primary after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:rounded-full after:bg-primary after:content-[""]'
          : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      <tab.icon className="h-5 w-5" aria-hidden="true" />
      <span>{t(tab.labelKey)}</span>
    </NavLink>
  );
}

/**
 * Mobile-only fixed bottom tab bar (hidden at `md`+, where the sidebar takes
 * over). Active tab uses the teal brand accent (DESIGN.md §6); inactive tabs
 * are muted. The `h-14` content height plus the `env(safe-area-inset-bottom)`
 * padding is a contract: the scan route positions its sticky action bar above
 * this bar, and `AppWrapper` reserves matching bottom padding so page content
 * is never occluded. The raised launcher adds a second clearance on top of
 * that — see `AddLauncher`, which owns the circle, its chevron and the sheet.
 *
 * That slot stopped being a `NavLink` in the one-tap pass: the tap now opens
 * the camera inside its own gesture rather than travelling to `/scan` first.
 * The geometry is unchanged, and so are the two clearances that depend on it
 * (`app-wrapper.tsx`'s `6rem` of bottom page padding, and `/scan`'s sticky
 * action bar's extra bottom padding).
 */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="flex h-14 items-stretch">
        {BOTTOM_NAV_TABS.map((tab) =>
          tab.tab?.raised === true ? <AddLauncher key={tab.to} tab={tab} /> : <FlatTab key={tab.to} tab={tab} />,
        )}
      </div>
    </nav>
  );
}
