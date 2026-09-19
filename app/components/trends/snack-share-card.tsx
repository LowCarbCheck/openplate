/**
 * "Snack share" (M239/04): the weekly share of kcal coming from snacks, one
 * bar per week, always kcal and always weekly (unlike the metric-following
 * `SlotShareCard` beside it) — the point of this card is the TREND over
 * several weeks, and a single day's snack share is noise a person cannot act
 * on. Below two weeks of range there is nothing to show a trend with, so the
 * card renders a one-line note instead of a chart nobody could read.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { dateLabelLocale } from '#app/i18n/date-locale';
import type { SlotShareRow } from '#app/lib/slot-stats';

/**
 * @param rows - `computeSlotShares`'s weekly, kcal-metric rows, oldest first.
 * @param hasEnoughWeeks - false below two weeks of range, when a note replaces the chart.
 */
export function SnackShareCard({ rows, hasEnoughWeeks }: { rows: readonly SlotShareRow[]; hasEnoughWeeks: boolean }) {
  const { t, i18n } = useTranslation();

  if (!hasEnoughWeeks) {
    return (
      <Card data-slot="snack-share-card" data-state="sparse">
        <CardHeader>
          <CardTitle className="text-lg">{t('trends.meals.snack.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('trends.meals.snack.sparse')}</p>
        </CardContent>
      </Card>
    );
  }

  const formatDate = new Intl.DateTimeFormat(dateLabelLocale(i18n.language), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const labelOf = (date: string): string => formatDate.format(new Date(`${date}T00:00:00Z`));

  return (
    <Card data-slot="snack-share-card" data-state="chart">
      <CardHeader className="space-y-1">
        <CardTitle className="text-lg">{t('trends.meals.snack.title')}</CardTitle>
        <CardDescription>{t('trends.meals.snack.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const share = row.shares?.snack ?? null;
            const dateLabel = t('trends.chart.bar.week', { date: labelOf(row.date) });
            return (
              <li key={row.date} data-slot="snack-share-row" data-date={row.date} className="flex items-center gap-3">
                <span aria-hidden="true" className="w-24 shrink-0 truncate text-xs tabular-nums text-muted-foreground">
                  {dateLabel}
                </span>
                <span className="sr-only">
                  {share === null ? t('trends.chart.bar.empty', { date: dateLabel }) : t('trends.meals.snack.row', { date: dateLabel, percent: Math.round(share) })}
                </span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  {share !== null && <div data-slot="snack-share-fill" style={{ width: `${share}%` }} className="h-full rounded-full bg-primary/25" />}
                </div>
                <span
                  aria-hidden="true"
                  data-slot="snack-share-value"
                  data-date={row.date}
                  data-value={share ?? ''}
                  className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                >
                  {share === null ? '—' : `${Math.round(share)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
