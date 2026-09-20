/**
 * "Meals across the day" (M239/04): one stacked, full-width bar per day (per
 * week at 30 and 90 days), the share of that day's kcal or net carbs coming
 * from each meal slot, with a fifth segment for every log with no meal chosen
 * at all ("No meal set") so nothing is hidden. The arithmetic lives in
 * `#app/lib/slot-stats`'s `computeSlotShares`; this file only lays it out,
 * the same split `MacroEnergySplitCard` (M239/03) already follows.
 *
 * COLOUR: four opacity steps of `--primary` (100/75/50/25, the same ramp
 * `admin/activity-strip.tsx`'s `LEVEL_CLASS` already uses for a 4-step
 * intensity scale) stand in for four distinct slot colours, since no
 * per-meal-slot token exists. "No meal set" is `bg-muted-foreground/30`,
 * deliberately different from the plain `bg-muted` empty-day track so the
 * two "nothing to see here" states cannot be mistaken for one another.
 *
 * Colour is never the only cue: a visually-hidden sentence per row spells the
 * shares out in words, and the legend repeats every label beside its swatch.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { MEAL_LABEL_KEYS } from '#app/lib/meal-choice';
import { SLOT_SHARE_KEYS } from '#app/lib/slot-stats';
import type { SlotShareBucket, SlotShareMetric, SlotShareRow } from '#app/lib/slot-stats';
import { cn } from '#app/lib/utils';

/** The fill class per bucket. See the module header for why these are opacity steps, not new tokens. */
const SLOT_SEGMENT_CLASS = {
  breakfast: 'bg-primary',
  lunch: 'bg-primary/75',
  dinner: 'bg-primary/50',
  snack: 'bg-primary/25',
  noSlot: 'bg-muted-foreground/30',
} satisfies Record<keyof SlotShareBucket, string>;

/** The label catalog key per bucket; `noSlot` has no meal-choice key of its own. */
const SLOT_LABEL_KEY = {
  ...MEAL_LABEL_KEYS,
  noSlot: 'trends.meals.noMealSet',
} satisfies Record<keyof SlotShareBucket, string>;

/** The i18next `t` shape this module needs. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** "Breakfast 40%, Lunch 20%, Dinner 30%, Snack 5%, No meal set 5%", the split in words. */
function describeShares({ shares, t }: { shares: SlotShareBucket; t: Translate }): string {
  return SLOT_SHARE_KEYS.map((key) => t('trends.meals.share.segment', { meal: t(SLOT_LABEL_KEY[key]), percent: Math.round(shares[key]) })).join(
    ', ',
  );
}

/** The accessible sentence for one row, including why a row has no split. */
function describeRow({ row, dateLabel, t }: { row: SlotShareRow; dateLabel: string; t: Translate }): string {
  if (row.shares !== null) return t('trends.meals.share.row', { date: dateLabel, ratio: describeShares({ shares: row.shares, t }) });
  return t('trends.chart.bar.empty', { date: dateLabel });
}

/** One 100 percent stacked bar, or an empty track when the day/week has no split. */
function ShareBar({ shares, date }: { shares: SlotShareBucket | null; date: string }) {
  if (shares === null) {
    return <div data-slot="slot-share-bar" data-date={date} data-state="none" className="h-2.5 w-full rounded-full bg-muted" />;
  }
  return (
    <div data-slot="slot-share-bar" data-date={date} data-state="split" className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      {SLOT_SHARE_KEYS.map((key, index) => (
        <div
          key={key}
          data-slot="slot-share-segment"
          data-meal={key}
          className={cn(SLOT_SEGMENT_CLASS[key], index > 0 && 'border-l-2 border-card')}
          style={{ width: `${shares[key]}%` }}
        />
      ))}
    </div>
  );
}

/** The legend: one swatch and label per bucket, in the same order the bar draws its segments. */
function ShareLegend({ t }: { t: Translate }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {SLOT_SHARE_KEYS.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-sm', SLOT_SEGMENT_CLASS[key])} />
          {t(SLOT_LABEL_KEY[key])}
        </span>
      ))}
    </p>
  );
}

/**
 * @param rows - `computeSlotShares`'s answer, oldest first.
 * @param isWeekly - true at 30 and 90 days, where each row is a week.
 * @param metric - which total the shares are of, only used to phrase the description.
 */
export function SlotShareCard({
  rows,
  isWeekly,
  metric,
}: {
  rows: readonly SlotShareRow[];
  isWeekly: boolean;
  metric: SlotShareMetric;
}) {
  const { t, i18n } = useTranslation();
  const formatDate = new Intl.DateTimeFormat(dateLabelLocale(i18n.language), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const labelOf = (date: string): string => formatDate.format(new Date(`${date}T00:00:00Z`));

  return (
    <Card data-slot="slot-share-card">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg">{t('trends.meals.share.title')}</CardTitle>
        <CardDescription>{t(metric === 'kcal' ? 'trends.meals.share.descriptionCalories' : 'trends.meals.share.descriptionNetCarbs')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ShareLegend t={t} />
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const dateLabel = isWeekly ? t('trends.chart.bar.week', { date: labelOf(row.date) }) : labelOf(row.date);
            return (
              <li key={row.date} data-slot="slot-share-row" data-date={row.date} className="flex items-center gap-3">
                {/* `w-32` and no `truncate`: "Woche vom 14. Sept." needs 121px,
                    and every German row used to read "Woche vom 22..." with the
                    one thing that tells the rows apart cut off. */}
                <span
                  aria-hidden="true"
                  className="w-32 shrink-0 break-words text-xs tabular-nums text-muted-foreground"
                >
                  {dateLabel}
                </span>
                <span className="sr-only">{describeRow({ row, dateLabel, t })}</span>
                <div className="min-w-0 flex-1">
                  <ShareBar shares={row.shares} date={row.date} />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
