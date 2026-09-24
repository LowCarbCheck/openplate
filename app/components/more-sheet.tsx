import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { cn } from '#app/lib/utils';
import { moreSheetNavigationItems, type NavigationItem } from './app-sidebar';

/**
 * The More sheet's body: one square tile per page the phone's bar does not
 * carry (M258). The sheet itself, its tab and its open state live in
 * `bottom-nav.tsx`; this file is the grid.
 *
 * WHAT IS IN IT. Overview, Pantry, Fasting, Insights, Nutrients and Goals:
 * `moreSheetNavigationItems`, derived from the catalog, so a page cannot be a
 * tile and a bar slot at once. No Settings, no Plan, no Administration. The
 * operator found Settings "closest to the thumb" in the old drawer odd, and on
 * a phone all three are in the avatar menu now.
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

/** The current page's tile carries the brand, as a lit bar tab does. */
const TILE_ACTIVE_CLASS = 'border-primary bg-primary/10 text-primary';

const TILE_IDLE_CLASS = 'border-border bg-background text-foreground hover:bg-muted';

/** One tile. */
function MoreTile({ item, isActive, onNavigate }: { item: NavigationItem; isActive: boolean; onNavigate: () => void }) {
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

export interface MoreSheetTilesProps {
  /** The catalog's winner for the current URL (`activeNavigationHref`), or `null`. */
  activeHref: string | null;
  /** Closes the sheet. Called on a tile's tap, so the sheet leaves with the page it opened. */
  onNavigate: () => void;
}

/**
 * The grid of tiles.
 *
 * @param props - which page is on screen, and how to close the sheet.
 */
export function MoreSheetTiles({ activeHref, onNavigate }: MoreSheetTilesProps) {
  const blanks = (COLUMNS - (moreSheetNavigationItems.length % COLUMNS)) % COLUMNS;

  return (
    <nav className="grid grid-cols-3 gap-1.5 px-2 pb-4">
      {Array.from({ length: blanks }, (_, index) => (
        <span key={`blank-${index}`} aria-hidden="true" />
      ))}
      {moreSheetNavigationItems.map((item) => (
        <MoreTile key={item.to} item={item} isActive={activeHref === item.to} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}
