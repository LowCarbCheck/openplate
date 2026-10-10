/**
 * A row of quick filters, each one with the number of rows it would leave.
 *
 * ── Toggle buttons, not links and not a menu ─────────────────────────────
 *
 * A chip is a button with `aria-pressed`, so a screen reader says "pressed" for
 * the one that is on. The people list and the invitation list both use it; the
 * state lives in the address (see `people-filter.ts`), and this component only
 * reports the click.
 *
 * ── The number is the answer before you ask ──────────────────────────────
 *
 * Each chip carries its count, so "how many have never signed in" is read, not
 * clicked. A chip with nothing behind it is dimmed and still works: a disabled
 * chip would hide the fact that the question was asked and the answer is none.
 *
 * ── Wrap wide, scroll narrow ─────────────────────────────────────────────
 *
 * On a wide screen the chips wrap onto a second line. On a phone one row
 * scrolls sideways with no scrollbar drawn, because a row of seven wrapped
 * onto four lines pushed the list a hand's width down the screen. The row's
 * height is the same in both: the chips are a fixed height, and nothing in a
 * chip changes size when it is pressed (the border is always one pixel, only
 * its colour changes).
 */

export interface FilterChip<Id extends string> {
  id: Id;
  label: string;
  count: number;
}

export interface FilterChipsProps<Id extends string> {
  /** Names the group for a screen reader: "View", "Status". */
  groupLabel: string;
  chips: readonly FilterChip<Id>[];
  value: Id;
  onChange: (next: Id) => void;
}

export function FilterChips<Id extends string>({ groupLabel, chips, value, onChange }: FilterChipsProps<Id>) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">{groupLabel}</legend>
      <div className="flex flex-wrap gap-1.5 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
        {chips.map((chip) => {
          const isPressed = chip.id === value;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={isPressed}
              data-chip={chip.id}
              onClick={() => onChange(chip.id)}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                isPressed ?
                  'border-primary bg-primary/10 text-primary'
                : `border-input text-muted-foreground hover:text-foreground ${chip.count === 0 ? 'opacity-50' : ''}`
              }`}
            >
              {chip.label}
              <span className={`tabular-nums ${isPressed ? 'text-primary' : 'text-foreground'}`}>{chip.count}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
