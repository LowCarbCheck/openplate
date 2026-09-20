/**
 * "Average by meal" (M239/04): one row per slot, showing the mean kcal, net
 * carbs, protein and fat over the days that slot was actually logged, and how
 * many of the range's days that was. Presentational only, all arithmetic
 * lives in `#app/lib/slot-stats`'s `computeSlotAverages`.
 *
 * A gap day for a slot (the person logged that day, just not that meal) is
 * never averaged in as a zero, the same honesty rule `computeSlotTotalsInRange`
 * already applies to the chart, which is why "logged on N of M days" sits
 * beside every figure here: a mean over two days reads very differently from
 * one over none.
 *
 * NO GOAL LINE AND NO MET/MISSED WORDING: every stored goal is a whole-day
 * figure, and a slot is a part of a day (see `#app/lib/slot-stats`'s header).
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '#app/components/ui/card';
import { formatMeasureIn } from '#app/lib/format-macro-number';
import { MEAL_LABEL_KEYS } from '#app/lib/meal-choice';
import type { SlotAverages, SlotAveragesBySlot } from '#app/lib/slot-stats';
import type { MealType } from '#types/enums';

/** One metric shown per slot row, and the unit it is formatted with. */
const METRIC_ROWS: readonly { key: keyof SlotAverages; labelKey: string; unit: string }[] = [
  { key: 'averageKcal', labelKey: 'trends.metric.calories', unit: 'kcal' },
  { key: 'averageNetCarbs', labelKey: 'trends.metric.netCarbs', unit: 'g' },
  { key: 'averageProtein', labelKey: 'trends.metric.protein', unit: 'g' },
  { key: 'averageFat', labelKey: 'trends.metric.fat', unit: 'g' },
];

/** One slot's row: its label, its "logged on N of M" caption, and its four figures. */
function SlotAverageRow({ slot, averages, language }: { slot: MealType; averages: SlotAverages; language: string }) {
  const { t } = useTranslation();

  return (
    <li data-slot="slot-average-row" data-slot-name={slot} className="space-y-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
      <p className="text-sm font-medium text-foreground">{t(MEAL_LABEL_KEYS[slot])}</p>
      <p className="text-xs text-muted-foreground">
        {t('trends.meals.averages.loggedDays', { days: averages.loggedDays, total: averages.totalDays })}
      </p>
      {/* One column below 400px: two columns left 13px between a label and its
          own value, so "Calories 333.4 kcal" read as one phrase, and a Turkish
          label that wrapped in three of the four blocks made the rows of the
          same card different heights. */}
      {averages.loggedDays > 0 && (
        <dl className="grid grid-cols-1 gap-y-1.5 text-sm tabular-nums min-[400px]:grid-cols-2 min-[400px]:gap-x-4">
          {METRIC_ROWS.map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-muted-foreground">{t(row.labelKey)}</dt>
              <dd data-slot="slot-average-value" data-metric={row.key} data-value={averages[row.key] ?? ''}>
                {averages[row.key] === null ? '—' : formatMeasureIn(language, averages[row.key] ?? 0, row.unit)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * @param slots - which slots to render a row for, in order (all four for the
 *   overview, or a single slot for the "one slot in detail" view).
 * @param averages - `computeSlotAverages`'s answer, keyed by slot.
 */
export function SlotAveragesCard({ slots, averages }: { slots: readonly MealType[]; averages: SlotAveragesBySlot }) {
  const { t, i18n } = useTranslation();

  return (
    <Card data-slot="slot-averages-card">
      <CardHeader>
        <CardTitle className="text-lg">{t('trends.meals.averages.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {slots.map((slot) => (
            <SlotAverageRow key={slot} slot={slot} averages={averages[slot]} language={i18n.language} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
