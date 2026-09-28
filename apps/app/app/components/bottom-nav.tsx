import { useTranslation } from 'react-i18next';
import { Ellipsis } from 'lucide-react';
import { NavLink } from '#app/components/link';
import { cn } from '#app/lib/utils';
import { barTabNavigationItems, type NavigationItem } from './app-sidebar';
import { AddLauncher } from '#app/components/add-launcher';
import { useMoreSheetDoor } from '#app/components/more-sheet';

/**
 * The phone's bottom bar: three slots, Diary, the raised plus, and More (M258).
 *
 * THE OPERATOR'S DECISION (2026-09-24). The 0.46.0 bar had five slots (Diary,
 * Insights, Scan, Add, Menu), and its drawer opened from two places, the Menu
 * tab and the brand mark, sliding in from a different side for each. After a
 * day on a phone the operator wrote: "too many items in the bottom and the way
 * it opens from 2 spots is weird + settings being closest to the thumb is also
 * weird". In a playground they chose three slots:
 *
 * - Diary, the one flat destination (`barTabNavigationItems`, the catalog
 *   entry whose `phone` is `'tab'`).
 * - The raised plus in the centre. A TAP opens the add sheet (`AddLauncher`).
 * - More, which opens a bottom sheet of tiles for every page the bar does not
 *   carry, with a Settings row above them (`MoreTab`, and `more-sheet.tsx`,
 *   which owns the sheet). Since M259 the brand mark in the header opens the
 *   same sheet: two doors, one sheet, always rising from the bottom.
 *
 * THREE SLOTS KEEP THE PLUS A TRUE CENTRE, as five did: every slot is `flex-1`
 * and `min-w-0`, and the plus is slot two of three. The flat tab is drawn from
 * the catalog, so this file never re-lists a label or an href.
 */

/**
 * A flat slot's box: an equal share of the bar, icon over label. The More tab
 * is drawn as a flat slot too.
 *
 * `min-w-0` HOLDS THE SHARE. A flex item's automatic minimum is its content's,
 * so without it a label wider than its slot would widen the slot instead, and
 * push the raised plus off the centre. With it the slot keeps its third and a
 * label too long for it overflows its own box, where a check can see it.
 */
const FLAT_TAB_CLASS =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 font-medium transition-colors';

/**
 * A flat slot's label, 11 px, the size the label under the plus has.
 * `max-w-full` keeps the label's box inside its slot, so a word that ever
 * outgrows it overflows a box a check can measure (`menu-is-found.spec.ts`
 * reads every label in six languages at 360 and 390 px, and fails on
 * `scrollWidth` past `clientWidth`). With three slots the widest label, the
 * Turkish "Daha fazla" or the German "Hinzufügen", is 66 px in a 120 px slot.
 */
const FLAT_TAB_LABEL_CLASS = 'max-w-full text-[11px]';

/**
 * A lit flat slot: the brand in three places (a top rule, a faint wash, and
 * the text color) so it never depends on hue alone. The More tab lights the
 * same way on the pages it holds.
 */
const FLAT_TAB_ACTIVE_CLASS =
  'bg-primary/5 text-primary after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:bg-primary after:content-[""]';

/** An unlit flat slot. */
const FLAT_TAB_IDLE_CLASS = 'text-muted-foreground hover:text-foreground';

/** An ordinary tab: icon over label, lit while its page is on screen. */
function FlatTab({ tab }: { tab: NavigationItem }) {
  const { t } = useTranslation();

  return (
    <NavLink
      to={tab.to}
      className={({ isActive }) => cn(FLAT_TAB_CLASS, isActive ? FLAT_TAB_ACTIVE_CLASS : FLAT_TAB_IDLE_CLASS)}
    >
      <tab.icon className="h-5 w-5" aria-hidden="true" />
      <span className={FLAT_TAB_LABEL_CLASS}>{t(tab.labelKey)}</span>
    </NavLink>
  );
}

/**
 * The bar's third slot: a door to the More sheet, drawn like a flat tab (icon
 * over label) so it reads as one of the three.
 *
 * A BUTTON, NOT A LINK: it goes nowhere, it opens a panel. The sheet is not
 * this slot's any more (M259): `MoreSheetProvider` renders it once for both
 * of its doors, this tab and the brand mark in the header, and this button
 * spreads the door props `useMoreSheetDoor` hands out. They announce the
 * dialog (`aria-haspopup`, `aria-expanded`, `aria-controls` while open), and
 * the sheet gives the focus back to this tab when this tab opened it, by
 * Escape, the close key, the overlay, a row or a tile.
 *
 * IT LIGHTS ON THE PAGES THE SHEET HOLDS, the way the playground the operator
 * chose from lit it: on Insights, say, nothing else in the bar says where the
 * person is. Since M259 that includes the settings hub and the settings pages
 * no tile claims, because the Settings row is in the sheet. The lit state is
 * `data-active` and the treatment, never `aria-current`: a button is not a
 * page, and the tile or row inside the sheet is the element that carries
 * `aria-current` for its page.
 *
 * `Ellipsis`, three dots in a row, and not the two by two grid the Menu tab
 * wore: that grid is Overview's own glyph, and Overview is a tile inside the
 * sheet, so the tab and one of its tiles would have shared a picture.
 *
 * THE SHEET RESTS AT THE BOTTOM AND TAKES ITS CONTENT'S HEIGHT, a handle, a
 * title, the Settings row and two rows of tiles. It covers the bar while open,
 * and the bar does not move: the sheet is portalled and `fixed`, so opening
 * and closing it changes no box on the page (`menu-is-found.spec.ts` reads a
 * `layout-shift` total of 0 across both doors).
 */
function MoreTab() {
  const { t } = useTranslation();
  const { doorProps, holdsCurrentPage } = useMoreSheetDoor();

  return (
    <button
      type="button"
      data-slot="bottom-nav-more"
      data-active={holdsCurrentPage ? 'true' : undefined}
      {...doorProps}
      className={cn(FLAT_TAB_CLASS, holdsCurrentPage ? FLAT_TAB_ACTIVE_CLASS : FLAT_TAB_IDLE_CLASS)}
    >
      <Ellipsis className="h-5 w-5" aria-hidden="true" />
      <span className={FLAT_TAB_LABEL_CLASS}>{t('nav.more')}</span>
    </button>
  );
}

/**
 * Mobile-only fixed bottom tab bar (hidden at `md`+, where the sidebar takes
 * over). The `h-14` content height plus the `env(safe-area-inset-bottom)`
 * padding is a contract: the scan route positions its sticky action bar above
 * this bar, and `AppWrapper` reserves matching bottom padding so page content
 * is never occluded. The raised plus adds a second clearance on top of that;
 * see `AddLauncher`, which owns the circle and its sheet.
 *
 * THE BAR'S HEIGHT AND THE CIRCLE'S BOX DID NOT CHANGE WITH M258. The circle
 * is the same `h-12 w-12` raised by `-mt-5`, centred in the middle slot, and
 * `tests/e2e/lcc-lineage-shell.spec.ts` freezes all four values of its rect
 * beside this bar's own height, so the next change to either fails instead of
 * quietly eating a clearance (`app-wrapper.tsx`'s `6rem` of bottom page
 * padding, and `/add/photo`'s sticky action bar).
 */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="flex h-14 items-stretch">
        {barTabNavigationItems.map((tab) => (
          <FlatTab key={tab.to} tab={tab} />
        ))}
        <AddLauncher />
        <MoreTab />
      </div>
    </nav>
  );
}
