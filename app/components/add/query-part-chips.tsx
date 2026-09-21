/**
 * The tap-to-search chips offered when a typed query only makes sense in
 * pieces (M208/04), so "Kaffee mit Hafermilch" becomes "Kaffee" and
 * "Hafermilch", each one a tap away from its own search.
 *
 * Presentational only: it takes the parts, the lead-in line and a callback,
 * and knows nothing about how the parts were derived (`app/lib/query-parts`)
 * or what searching means (`add.tsx`). That keeps it renderable in a test with
 * no i18next instance, no router and no store.
 *
 * `SEARCH_CHIP_CLASS` is the shipped starter-suggestion chip on the same
 * screen, lifted here so both rows are literally the same pill instead of two
 * that drift apart. Real `<button>` elements, so tab and Enter reach them
 * without any key handling of our own.
 */
import { CHIP_NEUTRAL } from '#app/components/list-row';
import { cn } from '#app/lib/utils';

/**
 * The one chip style on the /add search screen, shared with the starter suggestions.
 *
 * NEUTRAL, from the shared recipe (M243 spec 05b, decision 3). It was a card
 * fill with a hairline that turned brand-coloured on hover, which spent the
 * accent on a row of search shortcuts. The brand colour on this screen belongs
 * to the one primary action; a chip is a quiet key. Only the size, the weight
 * and the hit floor are this file's business.
 *
 * THE FLOOR IS 44 PX, the app's own (M242). These chips drew 36, which no check
 * had caught because they only appear on a search that found nothing.
 */
export const SEARCH_CHIP_CLASS = cn(
  CHIP_NEUTRAL,
  'inline-flex min-h-11 items-center justify-center border border-transparent px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/70',
);

export function QueryPartChips({
  parts,
  label,
  onSelect,
}: {
  parts: readonly string[];
  label: string;
  onSelect: (part: string) => void;
}) {
  if (parts.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {parts.map((part) => (
          <button key={part} type="button" onClick={() => onSelect(part)} className={SEARCH_CHIP_CLASS}>
            {part}
          </button>
        ))}
      </div>
    </div>
  );
}
