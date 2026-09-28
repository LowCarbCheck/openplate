/**
 * The meal picker, in one place. `/add` (both its portion step and its manual
 * form) and the scan confirm step (both plate and label) render THIS. See
 * `#app/lib/meal-choice` for why four copies of the same four slots was the
 * wrong answer.
 *
 * It is uncontrolled from the form's point of view: the Radix select drives a
 * hidden input, because a Radix `<Select>` is not a `<select>` and posts
 * nothing on its own. `''` in that input is "no meal", which every consuming
 * schema decodes to `undefined` and stores as `null`.
 */
import { useTranslation } from 'react-i18next';

import { FieldError } from '#app/components/field-error';
import { Label } from '#app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select';
import { MEAL_LABEL_KEYS, MEAL_TYPES, NO_MEAL_VALUE } from '#app/lib/meal-choice';

export function MealSelectField({
  id,
  name,
  label,
  value,
  onChange,
  errorId,
  errors,
  className,
}: {
  /** The field id, so the label points at the trigger. */
  id: string;
  /** The posted field name. */
  name: string;
  /** The already-translated field label. The two callers word it differently ("Meal", "Meal (optional)"). */
  label: string;
  /** The selected slot, or `''` for "no meal". */
  value: string;
  onChange: (value: string) => void;
  errorId?: string;
  errors?: string[];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className ?? 'grid gap-2'}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || NO_MEAL_VALUE} onValueChange={(next) => onChange(next === NO_MEAL_VALUE ? '' : next)}>
        <SelectTrigger id={id} className="h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_MEAL_VALUE}>{t(MEAL_LABEL_KEYS.none)}</SelectItem>
          {MEAL_TYPES.map((meal) => (
            <SelectItem key={meal} value={meal}>
              {t(MEAL_LABEL_KEYS[meal])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name={name} value={value} />
      <FieldError id={errorId} errors={errors} />
    </div>
  );
}
