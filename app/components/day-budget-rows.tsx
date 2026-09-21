/**
 * The budget rows themselves: a stack of "label, headline, meter" rows that
 * replaced the diary hero's ring gauges.
 *
 * Presentational only: every string and every number arrives already
 * formatted from `#app/lib/day-budget-rows`, which is where the wording is
 * pinned by a unit test. This file owns three things and nothing else: the
 * colour of the status dot per metric, the meter, and the accessible reading
 * of a row. The row's SHAPE is the shared data-row recipe in
 * `#app/components/list-row`, so a budget row and a macro figure are visibly
 * the same kind of object.
 *
 * Two rules are load-bearing:
 *
 * 1. **Colour never carries meaning alone.** Every row states its metric in
 *    words; the status dot and the meter fill are the only coloured elements, and
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
import {
  DATA_ROW_CLASS,
  DATA_ROW_DOT_CLASS,
  DATA_ROW_LABEL_CLASS,
  DATA_ROW_VALUE_CLASS,
} from '#app/components/list-row';
import { cn } from '#app/lib/utils';

/**
 * The status dot and meter fill per metric. Net carbs and calories are the two
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
 * others. It has its own cell on the sub-line row now, named rather than left
 * to auto-placement, so a row is the same height whether it carries a tag or
 * not.
 */
const REFERENCE_TAG_CLASS =
  'col-start-1 row-start-2 min-w-0 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground';

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
 * One row, on the shared data-row recipe (`#app/components/list-row`): a label,
 * a figure and a status dot on a quiet filled row, which is the signature shape
 * of lowcarbcheck.org's own data pages (M243 spec 05a).
 *
 * THREE COLUMNS AND TWO GRID ROWS, not the recipe's plain flex line. The recipe
 * describes a row that states one figure; a budget row states a figure AND how
 * far through its budget the day is, so the caption and the optional reference
 * tag get a second line under it. Column 1 is the label and the tag, column 2
 * the figure and its caption, column 3 the dot, which spans both lines and
 * closes the row exactly as it does in `CarbCheck.tsx`.
 *
 * THE METER IS THE ROW'S FOOT, not a line of its own. It used to be a third
 * grid row, 8 px of track plus two gaps, on all five rows of a card that
 * already filled four fifths of the phone. Drawn as a fill along the bottom
 * edge of the row it costs no height at all, and `inset-x-0` keeps it the same
 * length in every row whatever the number beside it says: sizing it to a column
 * gave the rows tracks of 143, 164, 154, 143 and 154 px in one card, which the
 * mobile audit caught and `mobile-diary.spec.ts` now pins.
 *
 * A row with no target draws NO track: an empty one would read as a goal
 * sitting at zero percent, which is a different and wrong statement. Its
 * caption says "no target set" in words instead.
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
    <li
      className={cn(
        DATA_ROW_CLASS,
        'relative grid grid-cols-[minmax(0,1fr)_auto_auto] gap-y-0.5 overflow-hidden p-2',
      )}
    >
      {/*
        A German label beside the reference tag overflowed at a large font: it
        lost its tail to an ellipsis, or collapsed to nothing. The tag has its
        own cell on the second line, so the label owns the width of column 1
        and the word itself wraps rather than being clipped.
      */}
      <span className={cn(DATA_ROW_LABEL_CLASS, 'col-start-1 row-start-1 min-w-0 break-words')}>{row.label}</span>
      <span
        className={cn(
          DATA_ROW_VALUE_CLASS,
          'col-start-2 row-start-1 flex shrink-0 items-center gap-1.5 text-right leading-tight',
          // Over-goal is amber and only amber: the day describes the food,
          // never the person (DESIGN.md §2b).
          isOver ? 'text-accent-amber'
          : isMet ? 'text-primary'
          : 'text-foreground',
        )}
      >
        {headlineFor(row, animated)}
        {isMet && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      </span>
      {/*
        The dot closes the row and spans both lines, so it stays centred
        against the pair. It carries the metric's own colour, and amber once
        the day is over, which is never the only cue: the label names the
        metric and the caption states the figures.
      */}
      <span
        className={cn(DATA_ROW_DOT_CLASS, 'col-start-3 row-span-2 row-start-1 self-center', fillClass)}
        aria-hidden="true"
      />

      {row.fraction !== null && (
        <div
          data-slot="budget-track"
          className={cn('absolute inset-x-0 bottom-0 h-1.5 overflow-hidden', ROW_TRACK_CLASS[row.key])}
        >
          <div
            className={cn('h-full motion-safe:transition-[width] motion-safe:duration-500', fillClass)}
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
        className="col-start-2 row-start-2 justify-self-end text-right text-xs text-muted-foreground tabular-nums"
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
 * A STACK OF FILLED ROWS, not a divided list. The rows were hairline-separated
 * while they sat on the hero's own fill; each one carries the data-row recipe's
 * quiet fill now, and a divider between two filled blocks draws nothing anyone
 * can see. The separation is the gap.
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
    <ul className="space-y-1">
      {rows.map((row) => (
        <BudgetRow key={row.key} row={row} animated={animatedHeadlines} />
      ))}
    </ul>
  );
}
