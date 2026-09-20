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
import { Link } from '#app/components/link';
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

/**
 * The shared look of the small uppercase tag under a row's label.
 *
 * `text-xs` is the app's smallest readable step. It was `text-[10px]`, which
 * the mobile audit measured at 10 CSS px and called unreadable; the tag also
 * used to sit INSIDE the label cell, where a German or Turkish label pushed it
 * on to a second line and made the row 22 px taller on some days than on
 * others. It has its own cell on the sub-line row now, so a row is the same
 * height whether it carries a tag or not.
 */
const REFERENCE_TAG_CLASS =
  'col-start-1 min-w-0 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground';

/**
 * The tag beside a reference row's label.
 *
 * An ordinary default says one word, "reference", and is not actionable: there
 * is no fiber goal field to send anyone to. A default that fell back for a
 * missing due or birth date IS actionable, so it names the date it wants and
 * links to the life-phase page where that date is entered (M215 spec 01 moved
 * both dates off the targets page). Same size, same weight:
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
      to="/settings/life-phase"
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

/**
 * One row, as a two column grid with three grid rows. Top row: the label side
 * (swatch, label) on the left, the headline value right-aligned on the right.
 * Middle row: the meter track, spanning BOTH columns. Bottom row: the optional
 * reference tag on the left, the sub-line under the value on the right, so the
 * number and its caption share one right edge in every row.
 *
 * THE TRACK SPANS BOTH COLUMNS because the right column is `auto`: it sizes to
 * the headline, so "1,240" and "34 g" gave their rows tracks of different
 * lengths (the mobile audit measured 143, 164, 154, 143 and 154 px in one
 * five-row card). A full-width track is the same length in every row whatever
 * the number beside it says.
 *
 * A row with no target draws NO track, only the empty first cell: an empty
 * meter would read as a goal sitting at zero percent, which is a different and
 * wrong statement. Its sub-line says "no target set" in words instead.
 */
function BudgetRow({ row, animated }: { row: DayBudgetRow; animated: AnimatedHeadlines | null }) {
  const { t } = useTranslation();
  const isOver = row.tone === 'over';
  const isMet = row.tone === 'met';
  const fillClass = isOver ? 'bg-accent-amber' : ROW_FILL_CLASS[row.key];
  // A target always brings a progress text with it today, so the third state
  // (a track with nothing to caption it) is unreachable from the formatter.
  // It is still rendered as a blank line of the same height, because this
  // component takes any `DayBudgetRow` and a shorter row would break the grid.
  const noTargetText = row.fraction === null ? t('diary.drilldown.noTarget') : null;
  const subline = row.progressText ?? noTargetText;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 py-2.5 first:pt-0 last:pb-0">
      {/*
        A German label beside the reference tag overflowed at a large font: it
        lost its tail to an ellipsis, or collapsed to nothing. The tag has moved
        to the sub-line row, so the cell holds the swatch and the word alone and
        the word itself wraps rather than being clipped.
      */}
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', fillClass)} aria-hidden="true" />
        <span className="min-w-0 break-words">{row.label}</span>
      </span>
      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5 justify-self-end text-right text-base font-semibold leading-tight tracking-tight tabular-nums min-[400px]:text-xl sm:text-2xl',
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

      {row.fraction !== null && (
        <div
          data-slot="budget-track"
          className={cn('col-span-2 col-start-1 h-2 self-center overflow-hidden rounded-full', ROW_TRACK_CLASS[row.key])}
        >
          <div
            className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', fillClass)}
            style={{ width: `${row.fraction * 100}%` }}
          />
        </div>
      )}

      {row.targetSource === 'default' && <ReferenceTag row={row} />}
      {/*
        A DERIVED target is neither a goal the person typed in nor a population
        reference, so it wears its own footnote saying where the figure came
        from. Same size and same weight as the reference tag, and never a link:
        the numbers it is built from are already three separate fields on the
        targets page, so there is no one place to send anyone.
      */}
      {row.targetSource === 'derived' && (
        <span className={REFERENCE_TAG_CLASS}>{t('diary.drilldown.derivedTag')}</span>
      )}

      <span
        data-slot="budget-subline"
        aria-hidden={subline === null ? true : undefined}
        className="col-start-2 justify-self-end text-right text-xs text-muted-foreground tabular-nums"
      >
        {subline ?? '\u00a0'}
      </span>

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
    <ul className="divide-y divide-border/50">
      {rows.map((row) => (
        <BudgetRow key={row.key} row={row} animated={animatedHeadlines} />
      ))}
    </ul>
  );
}
