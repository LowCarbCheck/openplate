/**
 * "Where your calories come from" (M239/03): the share of each day's energy
 * from carbs, protein and fat, as one 100 percent stacked bar per day (per
 * week at 30 and 90 days), under a pooled range average. The arithmetic lives
 * in `#app/lib/macro-energy-split`; this file only lays it out.
 *
 * The note under the title is load-bearing: the split is 4/4/9 times the
 * grams, which is not the calorie total a label reports, so the card says so
 * rather than letting the two figures disagree silently.
 *
 * A day with nothing logged or with missing macros has NO split, and is drawn
 * as an empty track with its reason in words, never as a guessed proportion.
 * Colour is never the only cue: each row carries its split as a sentence for
 * assistive tech, and the average names every share in text beside its swatch.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '#app/components/ui/tooltip';
import { MACRO_SWATCH_CLASS } from '#app/components/macro-ratio-bar';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { computeMacroEnergySplit, computeRangeEnergySplit } from '#app/lib/macro-energy-split';
import type { MacroEnergyShares } from '#app/lib/macro-energy-split';
import { bucketByWeek } from '#app/lib/trend-buckets';
import type { TrendDay } from '#app/lib/trend-chart';
import { cn } from '#app/lib/utils';

/** Segment order, left to right: the diary ratio bar's order with fiber left out (fiber is not an energy source here). */
const SPLIT_ORDER = ['carbs', 'protein', 'fat'] as const;

type SplitMacro = (typeof SPLIT_ORDER)[number];

/** The capitalised macro name shown beside each average swatch. */
const MACRO_NAME_KEY = {
  carbs: 'trends.recap.macro.carbs',
  protein: 'trends.recap.macro.protein',
  fat: 'trends.recap.macro.fat',
} satisfies Record<SplitMacro, string>;

/** The lower-case, mid-sentence macro noun a row's accessible sentence reads. */
const MACRO_NOUN_KEY = {
  carbs: 'diary.nutrients.carbs',
  protein: 'diary.nutrients.protein',
  fat: 'diary.nutrients.fat',
} satisfies Record<SplitMacro, string>;

/** How long the pointer rests on a row before its tooltip opens; the bar chart and the adherence grid use the same figure. */
const TOOLTIP_DELAY_MS = 80;

/** The i18next `t` shape this module needs. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** One row of the card: a day or a week, and its split when it has one. */
interface SplitRow {
  date: string;
  hasLogs: boolean;
  shares: MacroEnergyShares | null;
}

/** "30% carbs, 25% protein, 45% fat", the split in words. */
function describeShares({ shares, t }: { shares: MacroEnergyShares; t: Translate }): string {
  return SPLIT_ORDER.map((macro) =>
    t('diary.macroRatio.segment', { percent: Math.round(shares[macro]), macro: t(MACRO_NOUN_KEY[macro]) }),
  ).join(', ');
}

/** The accessible sentence for one row, including why a row has no split. */
function describeRow({ row, dateLabel, t }: { row: SplitRow; dateLabel: string; t: Translate }): string {
  if (row.shares !== null)
    return t('trends.split.row', { date: dateLabel, ratio: describeShares({ shares: row.shares, t }) });
  if (!row.hasLogs) return t('trends.chart.bar.empty', { date: dateLabel });
  return t('trends.split.partial', { date: dateLabel });
}

/**
 * One 100 percent stacked bar, or an empty track when there is no split. The
 * segment widths are the shares themselves, so they fill the track exactly.
 */
function SplitBar({ shares, date }: { shares: MacroEnergyShares | null; date: string }) {
  if (shares === null) {
    return (
      <div
        data-slot="macro-split-bar"
        data-date={date}
        data-state="none"
        className="h-2.5 w-full bg-muted"
      />
    );
  }
  return (
    <div
      data-slot="macro-split-bar"
      data-date={date}
      data-state="split"
      className="flex h-2.5 w-full overflow-hidden bg-muted"
    >
      {SPLIT_ORDER.map((macro, index) => (
        <div
          key={macro}
          data-slot="macro-split-segment"
          data-macro={macro}
          className={cn(MACRO_SWATCH_CLASS[macro], index > 0 && 'border-l-2 border-card')}
          style={{ width: `${shares[macro]}%` }}
        />
      ))}
    </div>
  );
}

/** The range average: its bar, and each share named in text beside its swatch. */
function AverageSplit({ shares, t }: { shares: MacroEnergyShares; t: Translate }) {
  return (
    <div data-slot="macro-split-average" className="space-y-2">
      <p className="text-xs font-medium text-foreground">{t('trends.split.average')}</p>
      <SplitBar shares={shares} date="average" />
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {SPLIT_ORDER.map((macro) => (
          <span key={macro} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('h-2.5 w-2.5', MACRO_SWATCH_CLASS[macro])} />
            {t('trends.split.share', { macro: t(MACRO_NAME_KEY[macro]), percent: Math.round(shares[macro]) })}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * @param days - the chart's per-day rows for the active range and slot, oldest first.
 * @param isWeekly - true at 30 and 90 days, where each row is a week averaged over its logged days.
 */
export function MacroEnergySplitCard({ days, isWeekly }: { days: readonly TrendDay[]; isWeekly: boolean }) {
  const { t, i18n } = useTranslation();
  const formatDate = new Intl.DateTimeFormat(dateLabelLocale(i18n.language), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const labelOf = (date: string): string => formatDate.format(new Date(`${date}T00:00:00Z`));
  // The average is pooled over the DAYS, whatever the rows are: averaging the
  // weekly rows would weigh a week with one logged day like a full one.
  const average = computeRangeEnergySplit(days.map((day) => day.summary));
  const rows: SplitRow[] = (isWeekly ? bucketByWeek(days) : days).map((day) => ({
    date: day.date,
    hasLogs: day.hasLogs,
    shares: computeMacroEnergySplit(day.summary),
  }));

  return (
    <Card data-slot="macro-split-card">
      <CardHeader className="space-y-1">
        <CardTitle>{t('trends.split.title')}</CardTitle>
        <CardDescription>{t('trends.split.note')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {average !== null && <AverageSplit shares={average} t={t} />}
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const dateLabel = isWeekly ? t('trends.chart.bar.week', { date: labelOf(row.date) }) : labelOf(row.date);
            return (
              <Tooltip key={row.date} delayDuration={TOOLTIP_DELAY_MS}>
                {/* The whole row is the target and not the 10 px bar: the label
                    and the bar are one thing to a pointer, and the sentence is
                    the row's own screen-reader sentence (2026-09-21, the
                    operator asked for hovers on the charts). */}
                <TooltipTrigger asChild>
                  <li data-slot="macro-split-row" data-date={row.date} className="flex items-center gap-3">
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
                      <SplitBar shares={row.shares} date={row.date} />
                    </div>
                  </li>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-72">
                  {describeRow({ row, dateLabel, t })}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
