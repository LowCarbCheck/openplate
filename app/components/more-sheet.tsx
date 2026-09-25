import { createContext, useContext, useId, useMemo, useRef, useState, type MouseEvent, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Link } from '#app/components/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#app/components/ui/sheet';
import { cn } from '#app/lib/utils';
import {
  activeCatalog,
  activeNavigationHref,
  footerNavigationItems,
  moreSheetNavigationItems,
  type NavigationItem,
} from './app-sidebar';

/**
 * The More sheet (M258): one bottom sheet of every page the phone's bar does
 * not carry, and the one open state its two doors share (M259).
 *
 * TWO DOORS, ONE SHEET, ONE DIRECTION. The operator, after a day with 0.47.0:
 * "pressing on the top left icon should open the same menu that the bottom
 * right button opens." So the bar's More tab (`bottom-nav.tsx`) and the brand
 * mark in the header (`app-wrapper.tsx`) open this same sheet, and it always
 * rises from the bottom, whichever of the two was tapped. 0.46.0 had two doors
 * into a side drawer that slid in from the left for the mark and from the
 * right for its Menu tab; the operator called that "weird", and the fix then
 * was to take the mark's door away. What was weird was two panels behaving
 * two ways, not two doors: here there is one instance, one title and one set
 * of tiles, so the mark cannot open a variant of it.
 *
 * WHY A PROVIDER AND NOT A TRIGGER. Radix's `SheetTrigger` belongs to exactly
 * one `Sheet`, and a sheet rendered by each door would be two dialogs. So
 * `MoreSheetProvider` holds the state and renders the sheet once, and a door
 * spreads `useMoreSheetDoor()`'s props, which do by hand what the trigger did:
 * announce the dialog, say whether it is open, and name it. Closing hands the
 * focus back to the door that opened it, which a trigger did for its one door.
 *
 * WHERE IT IS MOUNTED. In `AppWrapper`, around the header and the bar's
 * wrapper, never inside the bar: that wrapper is hidden while someone types on
 * a short viewport, and the mark is still on screen then.
 *
 * WHAT IS IN IT. A full-width row per configuration page, which is Settings
 * (the catalog's `footer` group, the same row the avatar menu draws), then the
 * tile grid: Overview, Pantry, Fasting, Insights, Nutrients and Goals, from
 * `moreSheetNavigationItems`, so a page cannot be a tile and a bar slot at
 * once. Settings came in with M259 ("also it should show the settings page
 * that's reachable via the profile menu"). It is a row at the TOP, not a
 * seventh tile: seven tiles in three columns leave two blank cells, and the
 * operator found Settings "closest to the thumb" odd in the old drawer. Plan
 * and Administration stay in the avatar menu only.
 *
 * WHERE EACH TILE SITS. Three columns, filled from the top left, over the
 * catalog order reversed: the first page of that order, Overview, is the last
 * tile and lands bottom right, nearest a right thumb. A count that does not
 * fill the top row is padded with blank cells at the START, so the bottom
 * row, the one under the thumb, is always the full one.
 */

/** How many tiles a row holds. */
const COLUMNS = 3;

/**
 * A tile: icon above label, a square-cornered box at least 76 px tall and a
 * third of the sheet wide, so the target is far past 44 px either way.
 *
 * THE LABEL IS 11 px ON ONE LINE, and it must fit. The longest label in the
 * six catalogs, the French "Vue d'ensemble", measured 98 px in the browser
 * tier. With `px-3` round the grid, `gap-2` and `px-1` inside each tile it had
 * 97 px at 360 px, and the fit check failed on it. So the grid is `px-2` with
 * `gap-1.5` and a tile keeps only `px-0.5`: a tile is about 111 px wide and
 * its label has about 105. `max-w-full truncate` keeps an overlong word inside
 * the tile as an ellipsis, and `menu-is-found.spec.ts` reads every tile's
 * `scrollWidth` against its `clientWidth` in all six languages at 360 and
 * 390 px, so the ellipsis never ships unnoticed.
 */
const TILE_CLASS =
  'flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 border px-0.5 text-[11px] font-medium transition-colors';

/**
 * A configuration row above the grid: icon, label, and a chevron at the far
 * end, the shape of a settings row elsewhere in the app. Square cornered and
 * bordered like a tile, so the row and the grid read as one panel, and 44 px
 * tall. The label takes the room between the icon and the chevron and is
 * `truncate`, so a word too long for it is an ellipsis that
 * `menu-is-found.spec.ts` reads in six languages, never a second line.
 */
const ROW_CLASS = 'flex min-h-11 w-full min-w-0 items-center gap-3 border px-3 text-sm font-medium transition-colors';

/** The current page's tile or row carries the brand, as a lit bar tab does. */
const TILE_ACTIVE_CLASS = 'border-primary bg-primary/10 text-primary';

const TILE_IDLE_CLASS = 'border-border bg-background text-foreground hover:bg-muted';

/** Every page the sheet reaches: the rows above the grid and the tiles in it. */
const MORE_SHEET_HREFS = new Set([...footerNavigationItems, ...moreSheetNavigationItems].map((item) => item.to));

/** What one tile or row needs to draw itself. */
interface MoreSheetEntryProps {
  item: NavigationItem;
  isActive: boolean;
  /** Closes the sheet. Called on a tap, so the sheet leaves with the page it opened. */
  onNavigate: () => void;
}

/** One tile. */
function MoreTile({ item, isActive, onNavigate }: MoreSheetEntryProps) {
  const { t } = useTranslation();

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      data-slot="more-tile"
      className={cn(TILE_CLASS, isActive ? TILE_ACTIVE_CLASS : TILE_IDLE_CLASS)}
    >
      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="max-w-full truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

/** One configuration row, above the grid. */
function MoreRow({ item, isActive, onNavigate }: MoreSheetEntryProps) {
  const { t } = useTranslation();

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      data-slot="more-row"
      className={cn(ROW_CLASS, isActive ? TILE_ACTIVE_CLASS : TILE_IDLE_CLASS)}
    >
      <item.icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{t(item.labelKey)}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/**
 * The sheet's body: the configuration rows, then the grid of tiles.
 *
 * The grid keeps the `px-2` and `gap-1.5` the tile budget above is measured
 * against, and the rows share its padding, so a row is exactly as wide as the
 * grid under it.
 */
function MoreSheetBody({ activeHref, onNavigate }: { activeHref: string | null; onNavigate: () => void }) {
  const blanks = (COLUMNS - (moreSheetNavigationItems.length % COLUMNS)) % COLUMNS;

  return (
    <nav className="flex flex-col gap-1.5 px-2 pb-4">
      {footerNavigationItems.map((item) => (
        <MoreRow key={item.to} item={item} isActive={activeHref === item.to} onNavigate={onNavigate} />
      ))}
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {moreSheetNavigationItems.map((item) => (
          <MoreTile key={item.to} item={item} isActive={activeHref === item.to} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

/** What a door needs from the shared sheet. */
interface MoreSheetContextValue {
  isOpen: boolean;
  /** The sheet's element id, for a door's `aria-controls`. */
  contentId: string;
  /** Whether the page on screen is one the sheet reaches, which lights the More tab. */
  holdsCurrentPage: boolean;
  /** Opens the sheet, remembering which door did it so the focus can go back there. */
  open: (opener: HTMLElement) => void;
}

const MoreSheetContext = createContext<MoreSheetContextValue | null>(null);

/** The attributes and the handler every door to the sheet carries. */
export interface MoreSheetDoorProps {
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  /** Only while the sheet is open, as Radix's own trigger does: a closed sheet has no element to name. */
  'aria-controls': string | undefined;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** What a door gets: the props its `button` spreads, and whether the sheet holds the page on screen. */
export interface MoreSheetDoor {
  doorProps: MoreSheetDoorProps;
  /** True on a page the sheet reaches, which lights the More tab. */
  holdsCurrentPage: boolean;
}

/**
 * A door to the More sheet.
 *
 * @returns the door's props and the lit state.
 * @throws when no `MoreSheetProvider` is above the caller, which would be a
 *   door to nothing.
 */
export function useMoreSheetDoor(): MoreSheetDoor {
  const context = useContext(MoreSheetContext);
  if (context === null) throw new Error('useMoreSheetDoor needs a MoreSheetProvider above it');

  return {
    doorProps: {
      'aria-haspopup': 'dialog',
      'aria-expanded': context.isOpen,
      'aria-controls': context.isOpen ? context.contentId : undefined,
      onClick: (event) => context.open(event.currentTarget),
    },
    holdsCurrentPage: context.holdsCurrentPage,
  };
}

export type MoreSheetProviderProps = PropsWithChildren<{
  /**
   * Whether the plan entry is drawn, decided once in the shell. It changes
   * which catalog entry wins on `/settings/plan`: with it, Plan wins, and Plan
   * is not in this sheet, so the Settings row and the More tab stay dark.
   */
  showsPlanEntry: boolean;
}>;

/**
 * Holds the sheet's open state and renders the sheet, once, for every door
 * below it.
 *
 * @param props - the plan entry's state, and the chrome that carries the doors.
 */
export function MoreSheetProvider({ showsPlanEntry, children }: MoreSheetProviderProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const contentId = useId();
  /**
   * The location the sheet was opened on, or `null` while it is shut. The
   * sheet is open only while that location is still the current one, so ANY
   * navigation shuts it, a tile's, the phone's own Back, or a link elsewhere,
   * with no effect to keep in step.
   */
  const [openedOnKey, setOpenedOnKey] = useState<string | null>(null);
  /** The door that opened the sheet last, where the focus goes back on close. */
  const openerRef = useRef<HTMLElement | null>(null);
  const isOpen = openedOnKey === location.key;
  // The winner across the WHOLE catalog, so `/settings/ai` lights the Settings
  // row (it is under the hub) while `/settings/nutrition` lights Goals.
  const activeHref = activeNavigationHref(location.pathname, activeCatalog(showsPlanEntry));
  const holdsCurrentPage = activeHref !== null && MORE_SHEET_HREFS.has(activeHref);
  const close = (): void => setOpenedOnKey(null);

  // Held across renders, so the two doors re-render when the sheet opens or
  // the page changes, and not on every render of the shell above them.
  const value = useMemo<MoreSheetContextValue>(
    () => ({
      isOpen,
      contentId,
      holdsCurrentPage,
      open: (opener) => {
        openerRef.current = opener;
        setOpenedOnKey(location.key);
      },
    }),
    [isOpen, contentId, holdsCurrentPage, location.key],
  );

  return (
    <MoreSheetContext.Provider value={value}>
      {children}
      {/* No door here asks Radix to open it, so the only change Radix reports
          is a close: Escape, the close key or the overlay. */}
      <Sheet
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <SheetContent
          id={contentId}
          side="bottom"
          // The title names the sheet, and there is no sentence to describe it
          // with that the rows and tiles do not already say.
          aria-describedby={undefined}
          // BACK TO THE DOOR THAT OPENED IT, the mark or the More tab. There
          // is no `SheetTrigger` to do it, and the element that had the focus
          // before the sheet opened is not always that door: a tap on a phone
          // does not focus a button everywhere.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus({ preventScroll: true });
          }}
          // Reduced motion keeps the sheet and drops the slide, as the add
          // sheet does: the position is the information, the travel is not.
          // `top-6` on the last child moves the primitive's own close key (it
          // is always the content's last element) down past the 24 px handle,
          // onto the title's row, so the two share one line.
          className="gap-0 p-0 pb-[env(safe-area-inset-bottom)] motion-reduce:animate-none motion-reduce:transition-none md:hidden [&>button:last-child]:top-6"
        >
          {/* A HANDLE'S LOOK, NOT A HANDLE. The sheet has no drag gesture: it
              closes by Escape, the close key, the overlay, a row and a tile.
              The bar says "this came up from the bottom and goes back there",
              which is true whichever door opened it. */}
          <div aria-hidden="true" className="flex h-6 shrink-0 items-center justify-center">
            <span className="h-1 w-10 bg-border" />
          </div>
          <SheetHeader className="px-4 pt-0 pb-2">
            <SheetTitle className="flex min-h-11 items-center">{t('nav.more')}</SheetTitle>
          </SheetHeader>
          <MoreSheetBody activeHref={activeHref} onNavigate={close} />
        </SheetContent>
      </Sheet>
    </MoreSheetContext.Provider>
  );
}
