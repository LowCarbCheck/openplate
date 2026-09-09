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

/** The one chip style on the /add search screen, shared with the starter suggestions. */
export const SEARCH_CHIP_CLASS =
  'inline-flex min-h-9 items-center justify-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground';

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
