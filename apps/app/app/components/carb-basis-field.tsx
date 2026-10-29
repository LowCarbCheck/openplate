/**
 * The three-state "which panel convention" control (spec 13, M123) — shared
 * between the label-scan confirm form (`scan.tsx`) and the typed custom-food
 * form (`add.tsx`) so the two entry points ask the same question the same
 * way. Plain radios, no client JS required to submit — the same chip
 * affordance `onboarding.tsx`'s `ChipRadioGroup` uses for its one-of-N
 * answers, duplicated rather than imported because that component is local
 * to the onboarding route and this control's three fixed options (with an
 * "Automatic" third state, not just the two `CarbBasis` values) don't share
 * its generic `options` shape.
 *
 * "Automatic" is the default and a real, first-class answer: it submits as
 * the empty string, which `parseCarbBasis` (`#app/lib/net-carbs`) resolves to
 * `null`, which persists as an ABSENT `carbBasis`. Nothing is guessed at
 * write time; every reader resolves the absent basis from the food's numbers
 * through `resolveCarbBasis`, so a better rule there reaches old rows too.
 * It was called "Not sure" until 2026-10-29, when an unstated basis still
 * meant a US label and took the fibre out of an EU pack's carbs a second time.
 */
import type { CarbBasis } from '#app/lib/net-carbs';
import { cn } from '#app/lib/utils';

/** "Automatic" submits as this value; `parseCarbBasis` treats it (and any other unrecognised text) as unstated. */
export const CARB_BASIS_AUTOMATIC_VALUE = '';

/** Border/fill for a chip by selection state — the same convention `onboarding.tsx`'s `chipClass` uses. */
function chipClass(isSelected: boolean): string {
  if (isSelected) return 'border-primary bg-primary text-primary-foreground';
  return 'border-border hover:border-teal-300 dark:hover:border-teal-600';
}

/**
 * @param options.name - the form field name the radios submit under.
 * @param options.legend - the fieldset's accessible label.
 * @param options.hint - one line explaining what the answer changes.
 * @param options.selected - the current value: a `CarbBasis`, or `''` for "Automatic".
 * @param options.onSelect - called with the radio's value on change.
 * @param options.totalLabel - copy for the US/total option.
 * @param options.availableLabel - copy for the EU/available option.
 * @param options.automaticLabel - copy for the Automatic option, the default.
 */
export function CarbBasisField({
  name,
  legend,
  hint,
  selected,
  onSelect,
  totalLabel,
  availableLabel,
  automaticLabel,
}: {
  name: string;
  legend: string;
  hint: string;
  selected: CarbBasis | typeof CARB_BASIS_AUTOMATIC_VALUE;
  onSelect: (value: CarbBasis | typeof CARB_BASIS_AUTOMATIC_VALUE) => void;
  totalLabel: string;
  availableLabel: string;
  automaticLabel: string;
}) {
  const options: { value: CarbBasis | typeof CARB_BASIS_AUTOMATIC_VALUE; label: string }[] = [
    { value: 'total', label: totalLabel },
    { value: 'available', label: availableLabel },
    { value: CARB_BASIS_AUTOMATIC_VALUE, label: automaticLabel },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              // `focus-within:ring-*` on the label, not the (visually hidden)
              // input, is this codebase's convention for a "chip wraps an
              // sr-only radio" control — see `theme-selector.tsx`'s identical
              // pattern. Without it, a keyboard user tabbing through these
              // three options gets no visible indicator of which one is
              // focused (M123/13 second-review finding 3).
              'flex min-h-11 cursor-pointer items-center border px-4 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary',
              chipClass(selected === option.value),
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected === option.value}
              onChange={() => onSelect(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
