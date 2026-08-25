/**
 * The three-state "which panel convention" control (spec 13, M123) — shared
 * between the label-scan confirm form (`scan.tsx`) and the typed custom-food
 * form (`add.tsx`) so the two entry points ask the same question the same
 * way. Plain radios, no client JS required to submit — the same chip
 * affordance `onboarding.tsx`'s `ChipRadioGroup` uses for its one-of-N
 * answers, duplicated rather than imported because that component is local
 * to the onboarding route and this control's three fixed options (with a
 * "not sure" third state, not just the two `CarbBasis` values) don't share
 * its generic `options` shape.
 *
 * "Not sure" is a real, first-class answer, not a missing one: it submits as
 * the empty string, which `parseCarbBasis` (`#app/lib/net-carbs`) resolves to
 * `null`, which persists as an ABSENT `carbBasis` — the same UNKNOWN state
 * every pre-spec-13 row already carries (see `LocalFoodLog.carbBasis`'s doc
 * comment in `#app/lib/local-store/schema`).
 */
import type { CarbBasis } from '#app/lib/net-carbs';
import { cn } from '#app/lib/utils';

/** "Not sure" submits as this value; `parseCarbBasis` treats it (and any other unrecognised text) as unknown. */
export const CARB_BASIS_NOT_SURE_VALUE = '';

/** Border/fill for a chip by selection state — the same convention `onboarding.tsx`'s `chipClass` uses. */
function chipClass(isSelected: boolean): string {
  if (isSelected) return 'border-primary bg-primary text-primary-foreground';
  return 'border-border hover:border-teal-300 dark:hover:border-teal-600';
}

/**
 * @param options.name - the form field name the radios submit under.
 * @param options.legend - the fieldset's accessible label.
 * @param options.hint - one line explaining what the answer changes.
 * @param options.selected - the current value: a `CarbBasis`, or `''` for "not sure".
 * @param options.onSelect - called with the radio's value on change.
 * @param options.totalLabel - copy for the US/total option.
 * @param options.availableLabel - copy for the EU/available option.
 * @param options.notSureLabel - copy for the not-sure option.
 */
export function CarbBasisField({
  name,
  legend,
  hint,
  selected,
  onSelect,
  totalLabel,
  availableLabel,
  notSureLabel,
}: {
  name: string;
  legend: string;
  hint: string;
  selected: CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE;
  onSelect: (value: CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE) => void;
  totalLabel: string;
  availableLabel: string;
  notSureLabel: string;
}) {
  const options: { value: CarbBasis | typeof CARB_BASIS_NOT_SURE_VALUE; label: string }[] = [
    { value: 'total', label: totalLabel },
    { value: 'available', label: availableLabel },
    { value: CARB_BASIS_NOT_SURE_VALUE, label: notSureLabel },
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
              'flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm transition-colors',
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
