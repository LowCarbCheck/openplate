/**
 * The budget rows themselves: a stack of "label, headline, meter" rows that
 * replaced the diary hero's ring gauges.
 *
 * Presentational only: every string and every number arrives already
 * formatted from `#app/lib/day-budget-rows`, which is where the wording is
 * pinned by a unit test. This file owns three things and nothing else: the
 * colour swatch per metric, the meter, and the accessible reading of a row.
 *
 * Two rules are load-bearing:
 *
 * 1. **Colour never carries meaning alone.** Every row states its metric in
 *    words; the swatch and the meter fill are the only coloured elements, and
 *    the headline text stays `text-foreground` unless the day is over a
 *    ceiling (amber, never destructive) or a floor is reached (brand, with a
 *    check mark beside it, so the state survives greyscale).
 * 2. **The meter is decoration; the `progress` element is the fact.** Assistive
 *    tech reads the real, unclamped figures, so a day at 62 of 50 g reports as
 *    "62 of 50" rather than silently capping at the ceiling, exactly as
 *    `RingProgress` does for the gauge this replaced.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import type { AnimatedHeadlines, DayBudgetRow, DayBudgetRowKey } from '#app/lib/day-budget-rows';
import { cn } from '#app/lib/utils';

/**
 * The swatch and meter fill per metric. Net carbs and calories are the two
 * BUDGETS and share the brand colour, as their rings did; protein, fat and
 * fiber take the same macro tokens the ratio bar and the macro grid use, so a
 * row and its slice of that bar are visibly the same thing.
 */
const ROW_FILL_CLASS = {
  netCarbs: 'bg-primary',
  calories: 'bg-primary',
  protein: 'bg-macro-protein',
  fat: 'bg-macro-fat',
  fiber: 'bg-macro-fiber',
} satisfies Record<DayBudgetRowKey, string>;

/**
 * The meter track: a lighter step of the row's own fill rather than a neutral
 * grey, so an empty meter still says which metric it belongs to. Protein, fat
 * and fiber sit a little heavier than the brand pair because their tokens are
 * less saturated at low opacity.
 */
const ROW_TRACK_CLASS = {
  netCarbs: 'bg-primary/15',
  calories: 'bg-primary/15',
  protein: 'bg-macro-protein/20',
  fat: 'bg-macro-fat/20',
  fiber: 'bg-macro-fiber/20',
} satisfies Record<DayBudgetRowKey, string>;

/** The shared look of the small uppercase tag beside a row's label. */
const REFERENCE_TAG_CLASS = 'shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground';

/**
 * The tag beside a reference row's label.
 *
 * An ordinary default says one word, "reference", and is not actionable: there
 * is no fiber goal field to send anyone to. A default that fell back for a
 * missing due or birth date IS actionable, so it names the date it wants and
 * links to the goals page where that date is entered. Same size, same weight:
 * the tag is a footnote either way, never an alarm.
 */
function ReferenceTag({ row }: { row: DayBudgetRow }) {
  const { t } = useTranslation();
  if (!row.referenceDateMissing)
    return <span className={REFERENCE_TAG_CLASS}>{t('diary.drilldown.referenceTag')}</span>;

  const key =
    row.missingReferenceDate === 'birth-date' ?
      'diary.drilldown.referenceTagBirthDateMissing'
    : 'diary.drilldown.referenceTagDateMissing';
  return (
    <Link
      to="/settings/goals"
      className={cn(REFERENCE_TAG_CLASS, 'underline underline-offset-2 hover:text-foreground')}
    >
      {t(key)}
    </Link>
  );
}

/**
 * The headline to paint for a row: the tweened string when the caller is
 * animating that metric, and the settled one otherwise. Only the two budget
 * rows can animate, because a floor row has no single figure to count toward.
 */
function headlineFor(row: DayBudgetRow, animated: AnimatedHeadlines | null): string {
  if (animated === null) return row.headline;
  if (row.key === 'netCarbs') return animated.netCarbs ?? row.headline;
  if (row.key === 'calories') return animated.calories ?? row.headline;
  return row.headline;
}

/** One row. Kept to about 40 px on a phone: that budget is the whole reason four rows cost less than two rings. */
function BudgetRow({ row, animated }: { row: DayBudgetRow; animated: AnimatedHeadlines | null }) {
  const { t } = useTranslation();
  const isOver = row.tone === 'over';
  const isMet = row.tone === 'met';
  const fillClass = isOver ? 'bg-accent-amber' : ROW_FILL_CLASS[row.key];

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', fillClass)} aria-hidden="true" />
          <span className="truncate">{row.label}</span>
          {row.targetSource === 'default' && <ReferenceTag row={row} />}
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-xl font-semibold leading-tight tracking-tight tabular-nums sm:text-2xl',
            // Over-goal is amber and only amber: the day describes the food,
            // never the person (DESIGN.md §2b).
            isOver ? 'text-accent-amber'
            : isMet ? 'text-primary'
            : 'text-foreground',
          )}
        >
          {headlineFor(row, animated)}
          {isMet && <Check className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" aria-hidden="true" />}
        </span>
      </div>

      {row.fraction === null && <p className="text-xs text-muted-foreground">{t('diary.drilldown.noTarget')}</p>}

      {row.fraction !== null && (
        <div className="flex items-center gap-2.5">
          <div className={cn('h-2 flex-1 overflow-hidden rounded-full', ROW_TRACK_CLASS[row.key])}>
            <div
              className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', fillClass)}
              style={{ width: `${row.fraction * 100}%` }}
            />
          </div>
          {row.progressText !== null && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.progressText}</span>
          )}
        </div>
      )}

      {/*
        The semantics live on a real element, not on the meter above: the same
        split `RingProgress` makes, and for the same reason. A row with no
        target has nothing to report progress against, so it states its
        sentence instead of inventing a maximum for it.
      */}
      {row.target === null ?
        <span className="sr-only">{row.srLabel}</span>
      : <progress
          className="sr-only"
          value={Math.round(row.consumed)}
          max={Math.round(row.target)}
          aria-label={row.srLabel}
        />
      }
    </li>
  );
}

/**
 * The day's budget rows.
 *
 * @param rows - the rows to draw, already in display order.
 * @param animatedHeadlines - tweened headlines for the two budget rows, or null where the caller does not animate (the dashboard does not).
 */
export function DayBudgetRows({
  rows,
  animatedHeadlines = null,
}: {
  rows: DayBudgetRow[];
  animatedHeadlines?: AnimatedHeadlines | null;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <BudgetRow key={row.key} row={row} animated={animatedHeadlines} />
      ))}
    </ul>
  );
}
