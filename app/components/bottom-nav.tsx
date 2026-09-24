import { NavLink } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { cn } from '#app/lib/utils';
import { tabNavigationItems, type NavigationItem } from './app-sidebar';
import { AddLauncher } from '#app/components/add-launcher';
import { LayoutGrid } from 'lucide-react';

/**
 * The bar has five slots: Diary, Insights, the raised Scan, Add, and Menu.
 * The first four are destinations from the shared catalog, pre-ordered by each
 * item's `tab.order`, so this file never re-lists a label or an href and the
 * bar and the drawer cannot disagree about a destination. The fifth is not a
 * destination: it opens the navigation drawer (`app-wrapper.tsx`'s
 * `NavDrawer`), the complete map the desktop sidebar also draws.
 *
 * THE MENU TAB IS THE ANSWER TO A REPORT (2026-09-24). A person did not know
 * that the brand mark at the top left of the header opens that drawer: the
 * mark is a picture, and nothing on it says "menu". The operator compared
 * seven mockups and chose a labelled tab here over a hamburger icon and over
 * an onboarding lesson people skip. The header mark stays a door too, so
 * nobody who learned it loses it. `tests/e2e/menu-is-found.spec.ts` holds both.
 *
 * FIVE SLOTS KEEP SCAN A TRUE CENTRE, as three did: the raised button is slot
 * three of five, and every slot is `flex-1`. Insights left the bar once, when
 * it was the logging loop alone, and came back with the Menu tab.
 */
const BOTTOM_NAV_TABS: readonly NavigationItem[] = tabNavigationItems;

/**
 * A flat slot's box: an equal share of the bar, icon over label.
 *
 * `min-w-0` HOLDS THE SHARE. A flex item's automatic minimum is its content's,
 * so without it a label wider than its slot would widen the slot instead, and
 * push the raised Scan button off the centre. With it the slot keeps its fifth
 * and a label too long for it overflows its own box, where a check can see it.
 */
const FLAT_TAB_CLASS =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 font-medium transition-colors';

/**
 * A flat slot's label, 11 px, the size the Scan label under the circle already
 * has. At 12 px the longest label, the German "Hinzufügen", is ten characters
 * of a face that is a flat 0.6 em wide, 72 px, which is the WHOLE slot at 360
 * px with five slots, touching both edges. At 11 px it is 66 px. `max-w-full`
 * keeps the label's box inside its slot, so a word that ever outgrows it
 * overflows a box a check can measure (`menu-is-found.spec.ts` reads every
 * label in six languages at 360 and 390 px, and fails on `scrollWidth` past
 * `clientWidth`).
 */
const FLAT_TAB_LABEL_CLASS = 'max-w-full text-[11px]';

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
          FLAT_TAB_CLASS,
          isActive ?
            'bg-primary/5 text-primary after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:bg-primary after:content-[""]'
          : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      <tab.icon className="h-5 w-5" aria-hidden="true" />
      <span className={FLAT_TAB_LABEL_CLASS}>{t(tab.labelKey)}</span>
    </NavLink>
  );
}

/** What the Menu tab needs from the shell, which owns the drawer it opens. */
export interface MenuTabProps {
  /** Whether the drawer is open, from either of its two doors. */
  isOpen: boolean;
  /**
   * Opens the drawer from the right, the side this tab sits on. The tab
   * passes itself, so the shell can give focus back to it on close.
   */
  onOpen: (trigger: HTMLElement) => void;
}

/**
 * The bar's fifth slot: a door to the navigation drawer, drawn like a flat
 * tab (icon over label, muted) so it reads as one of the five.
 *
 * A BUTTON, NOT A LINK: it goes nowhere, it opens a panel, and
 * `aria-haspopup` says so. It never takes the active treatment. While the
 * drawer is open the bar sits under its overlay, and a second lit tab beside
 * the page's own would say that two places are "here".
 *
 * `LayoutGrid`, a two by two grid, on purpose: the operator ruled out a
 * hamburger, and three dots read as "more options on this item", not as a map
 * of the app. The drawer's Overview row wears the same glyph.
 */
function MenuTab({ isOpen, onOpen }: MenuTabProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-slot="bottom-nav-menu"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(FLAT_TAB_CLASS, 'text-muted-foreground hover:text-foreground')}
    >
      <LayoutGrid className="h-5 w-5" aria-hidden="true" />
      <span className={FLAT_TAB_LABEL_CLASS}>{t('nav.menu')}</span>
    </button>
  );
}

/**
 * Mobile-only fixed bottom tab bar (hidden at `md`+, where the sidebar takes
 * over). Active tab uses the teal brand accent (DESIGN.md §6); inactive tabs
 * are muted. The `h-14` content height plus the `env(safe-area-inset-bottom)`
 * padding is a contract: the scan route positions its sticky action bar above
 * this bar, and `AppWrapper` reserves matching bottom padding so page content
 * is never occluded. The raised launcher adds a second clearance on top of
 * that; see `AddLauncher`, which owns the circle and its long-press sheet.
 *
 * That slot stopped being a `NavLink` in the one-tap pass: the tap now opens
 * the camera inside its own gesture rather than travelling to `/scan` first.
 * The geometry is unchanged, and so are the two clearances that depend on it
 * (`app-wrapper.tsx`'s `6rem` of bottom page padding, and `/scan`'s sticky
 * action bar's extra bottom padding). M243 spec 03 took the teal halo off that
 * circle and moved nothing: `tests/e2e/lcc-lineage-shell.spec.ts` freezes all
 * four values of its rect beside this bar's own height, so the next change to
 * either fails instead of quietly eating a clearance.
 */
export function BottomNav({ menu }: { menu: MenuTabProps }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="flex h-14 items-stretch">
        {BOTTOM_NAV_TABS.map((tab) =>
          tab.tab?.raised === true ? <AddLauncher key={tab.to} tab={tab} /> : <FlatTab key={tab.to} tab={tab} />,
        )}
        <MenuTab isOpen={menu.isOpen} onOpen={menu.onOpen} />
      </div>
    </nav>
  );
}
