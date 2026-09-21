/**
 * "Your usual {{meal}}" (M239/04): the five most-logged foods at one slot,
 * over the chart's current range. Reuses `usual.title.*` verbatim — the exact
 * sentence `#app/components/usual-at-slot.tsx` already shows above the intake
 * input on `/add` and `/scan` — rather than a new "Your usual {{meal}}" key,
 * so the two surfaces never drift into two different English (and, since
 * that catalog is already translated into all six shipped languages, two
 * different) sentences for the same claim.
 *
 * Deliberately NOT actionable: unlike that section, this list is read-only
 * history for the range being reviewed, not a one-tap "log this again" offer,
 * so a tap here does nothing and nothing here posts a form.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import type { SlotFood } from '#app/lib/slot-stats';
import type { MealType } from '#types/enums';

/**
 * The title key per slot, mirroring `usual-at-slot.tsx`'s own `USUAL_TITLE_KEYS`
 * (same catalog keys, same reasoning: a whole sentence per slot rather than
 * one sentence with the slot interpolated, because a lower-cased meal noun and
 * its article are not the same move in every language).
 */
const USUAL_TITLE_KEYS = {
  breakfast: 'usual.title.breakfast',
  lunch: 'usual.title.lunch',
  dinner: 'usual.title.dinner',
  snack: 'usual.title.snack',
} satisfies Record<MealType, string>;

/**
 * @param slot - the meal slot this list is for.
 * @param foods - `topFoodsForSlot`'s answer for this slot and range, most-logged first.
 */
export function UsualSlotFoodsCard({ slot, foods }: { slot: MealType; foods: readonly SlotFood[] }) {
  const { t } = useTranslation();

  return (
    <Card data-slot="usual-slot-foods-card" data-slot-name={slot}>
      <CardHeader>
        <CardTitle>{t(USUAL_TITLE_KEYS[slot])}</CardTitle>
      </CardHeader>
      <CardContent>
        {foods.length === 0 ?
          <p className="text-sm text-muted-foreground">{t('trends.meals.usual.empty')}</p>
        : <ol className="space-y-2">
            {foods.map((food) => (
              <li key={food.key} data-slot="usual-slot-food" className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{food.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t('trends.meals.usual.timesLogged', { count: food.logCount })}
                </span>
              </li>
            ))}
          </ol>
        }
      </CardContent>
    </Card>
  );
}
