/**
 * The 13-week goal-adherence grid: 91 squares, one per day, Monday at the top
 * of each column. Presentational — the whole model arrives pre-computed from
 * `#app/models/adherence-grid`.
 *
 * Three things here are deliberate rather than incidental:
 *
 * - **The 2px gap does all the separating.** No cell ever gets a border or a
 *   stroke; the only outline in the grid is the today marker, which is
 *   ENCODING, not separation.
 * - **Two readouts, one builder.** Radix tooltips don't open on touch and this
 *   is a mobile-first PWA, so the always-visible caption row below the grid is
 *   the touch surface, and the per-cell `aria-label` is the screen-reader
 *   surface. All three render from `describeAdherenceDay`, so they can't drift.
 * - **A future day is a spacer, not a cell.** The trailing slots of the current
 *   week render as invisible gaps — a square saying "no entry" for a day that
 *   hasn't happened would be an accusation about the future.
 *
 * Colours come from the `--adherence-*` token family only (DESIGN.md §11).
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';
import { cn } from '#app/lib/utils';
import { dateLabelLocale } from '#app/i18n/date-locale';
import { describeAdherenceDay, type AdherenceDayDescription } from '#app/lib/adherence-message';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#app/components/ui/tooltip';
import type {
  AdherenceDay,
  AdherenceGoals,
  AdherenceGrid as AdherenceGridModel,
  AdherenceLevel,
  AdherenceMode,
  AdherenceStatus,
} from '#app/models/adherence-grid';

/** Days in a Monday→Sunday week — one grid row each. */
const DAYS_PER_WEEK = 7;
/** Row indices that carry a weekday label (Mon / Wed / Fri); the rest stay blank so the gutter reads as a scale, not a list. */
const LABELLED_WEEKDAY_ROWS = new Set([0, 2, 4]);
/** A Monday, used only to name the seven weekday rows through `Intl`. */
const REFERENCE_MONDAY_UTC = Date.UTC(2024, 0, 1);
/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Hover delay before a cell's tooltip opens — short enough to feel like a readout, long enough not to strobe on a sweep. */
const TOOLTIP_DELAY_MS = 80;

/**
 * The one place a cell state becomes a class. Tokens only — no literals.
 *
 * `activity` mode paints every logged day at step 4 deliberately: with no goal
 * configured there is no magnitude to encode, so it is a nominal one-series
 * fill (the same two-state teal the habit strip uses), not a ramp.
 */
const CELL_FILL = {
  'no-data': 'bg-adherence-empty',
  unrated: 'bg-adherence-unrated',
  logged: 'bg-adherence-4',
  rated: 'bg-adherence-empty', // unreachable — `rated` always resolves via level
  'rated-1': 'bg-adherence-1',
  'rated-2': 'bg-adherence-2',
  'rated-3': 'bg-adherence-3',
  'rated-4': 'bg-adherence-4',
} satisfies Record<AdherenceStatus | `rated-${AdherenceLevel}`, string>;

/** The paint class for one resolved cell. */
function fillClass(day: AdherenceDay): string {
  if (day.status === 'rated' && day.level !== null) return CELL_FILL[`rated-${day.level}`];
  return CELL_FILL[day.status];
}

/** Where the readout is being drawn — the tooltip surface is inverted, so the emphasis classes differ. */
type ReadoutTone = 'surface' | 'inverted';

/** Emphasis (the value) and recession (label, goal) classes per surface. */
const TONE_CLASSES = {
  surface: { emphasis: 'text-foreground', recessive: 'text-muted-foreground' },
  inverted: { emphasis: 'text-background', recessive: 'text-background/70' },
} satisfies Record<ReadoutTone, { emphasis: string; recessive: string }>;

/**
 * One day's readout — the shared body of the tooltip and the caption row.
 *
 * The `✓`/`–` glyph and the small coloured mark are both `aria-hidden`
 * redundancies: the verdict is already in the text (and in the `aria-label`),
 * so nothing here depends on colour alone.
 */
function AdherenceDayReadout({
  day,
  description,
  tone,
}: {
  day: AdherenceDay;
  description: AdherenceDayDescription;
  tone: ReadoutTone;
}) {
  const { emphasis, recessive } = TONE_CLASSES[tone];

  return (
    <div className={cn('space-y-0.5 text-xs', recessive)}>
      {/* A no-data headline already carries the date — see `describeAdherenceDay`. */}
      {day.status !== 'no-data' && <p className={cn('font-medium', emphasis)}>{description.dateLabel}</p>}
      <p>{description.headline}</p>
      {description.rows.length > 0 && (
        <ul className="space-y-0.5">
          {description.rows.map((row) => (
            <li key={row.key} className="flex items-center gap-1.5 tabular-nums">
              {row.verdict === 'met' ?
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              : <Minus className="h-3 w-3 shrink-0" aria-hidden="true" />}
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-[2px]',
                  row.verdict === 'met' ? 'bg-adherence-4' : 'bg-adherence-unrated',
                )}
                aria-hidden="true"
              />
              <span className={emphasis}>{row.value}</span>
              <span>{row.label}</span>
              <span>{row.against}</span>
            </li>
          ))}
        </ul>
      )}
      {description.note !== null && <p>{description.note}</p>}
    </div>
  );
}

interface AdherenceCellProps {
  day: AdherenceDay;
  goals: AdherenceGoals;
  mode: AdherenceMode;
  /** True for the single cell that owns the grid's tab stop (roving tabindex). */
  isAnchor: boolean;
  onActivate: (date: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: string) => void;
  registerRef: (date: string, node: HTMLButtonElement | null) => void;
}

/**
 * One square. Memoised because a pointer sweep re-renders the grid once per
 * cell entered, and only the two cells whose active/anchor state changed
 * actually need to re-render.
 */
const AdherenceCell = memo(function AdherenceCell({
  day,
  goals,
  mode,
  isAnchor,
  onActivate,
  onKeyDown,
  registerRef,
}: AdherenceCellProps) {
  const { t, i18n } = useTranslation();

  if (day.isFuture) {
    return (
      <li aria-hidden="true">
        <span className="block aspect-square w-full" />
      </li>
    );
  }

  const description = describeAdherenceDay({ day, goals, mode, t, language: i18n.language });

  return (
    <li>
      {/*
        `delayDuration` is set on the Root, not only on the provider wrapping
        the grid: `#app/components/ui/tooltip`'s `Tooltip` self-nests its own
        provider (delay 0), which would otherwise win over the outer one.
      */}
      <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <button
            type="button"
            ref={(node) => registerRef(day.date, node)}
            tabIndex={isAnchor ? 0 : -1}
            aria-label={description.ariaLabel}
            onPointerEnter={() => onActivate(day.date)}
            onFocus={() => onActivate(day.date)}
            onClick={() => onActivate(day.date)}
            onKeyDown={(event) => onKeyDown(event, day.date)}
            className={cn(
              // The `after` pseudo-element expands the touch target by 1px on
              // every side into the 2px gap — bigger than the painted square,
              // with zero overlap between neighbours.
              "relative block aspect-square w-full rounded-sm after:absolute after:-inset-[1px] after:content-['']",
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              fillClass(day),
              day.isToday && 'outline outline-[1.5px] outline-offset-[1px] outline-foreground/55',
            )}
          />
        </TooltipTrigger>
        <TooltipContent>
          <AdherenceDayReadout day={day} description={description} tone="inverted" />
        </TooltipContent>
      </Tooltip>
    </li>
  );
});

/** The seven weekday names, Monday first, in the reader's language. */
function useWeekdayNames(): string[] {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(dateLabelLocale(i18n.language), { timeZone: 'UTC', weekday: 'short' });
    return Array.from({ length: DAYS_PER_WEEK }, (_unused, index) =>
      formatter.format(new Date(REFERENCE_MONDAY_UTC + index * MS_PER_DAY)),
    );
  }, [i18n.language]);
}

/** Short month name for the Monday that opens a week column. */
function useMonthLabels(grid: AdherenceGridModel): Map<number, string> {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(dateLabelLocale(i18n.language), { timeZone: 'UTC', month: 'short' });
    return new Map(
      grid.monthLabels.map((label) => [label.weekIndex, formatter.format(new Date(`${label.weekStart}T00:00:00Z`))]),
    );
  }, [grid.monthLabels, i18n.language]);
}

/** The idle caption: what the whole window adds up to, phrased for the grid's mode. */
function summarySentence(
  grid: AdherenceGridModel,
  t: (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string,
): string {
  if (grid.loggedDayCount === 0) return t('trends.grid.empty');
  if (grid.mode === 'activity') {
    return t('trends.grid.summaryActivity', { days: grid.loggedDayCount, total: grid.elapsedDayCount });
  }
  return t('trends.grid.summary', { days: grid.perfectDayCount, logged: grid.loggedDayCount });
}

/**
 * The grid, its caption row and its keyboard model.
 *
 * @param grid - the resolved grid model (13 columns, oldest first).
 * @param goals - the user's configured daily goals, for the readout's "against" phrases.
 */
export function AdherenceGrid({ grid, goals }: { grid: AdherenceGridModel; goals: AdherenceGoals }) {
  const { t, i18n } = useTranslation();
  const weekdayNames = useWeekdayNames();
  const monthLabels = useMonthLabels(grid);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectableDays = useMemo(() => grid.days.filter((day) => !day.isFuture), [grid.days]);
  const todayDate = useMemo(
    () => grid.days.find((day) => day.isToday)?.date ?? selectableDays[selectableDays.length - 1]?.date ?? null,
    [grid.days, selectableDays],
  );

  /** The cell owning the grid's single tab stop. Starts on today, then follows focus/keyboard. */
  const [anchorDate, setAnchorDate] = useState<string | null>(todayDate);
  /** The cell the caption row is reading out, or null for the idle summary. */
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const registerRef = useCallback((date: string, node: HTMLButtonElement | null) => {
    if (node === null) buttonRefs.current.delete(date);
    else buttonRefs.current.set(date, node);
  }, []);

  const onActivate = useCallback((date: string) => {
    setActiveDate(date);
    setAnchorDate(date);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
      const step = keyStep(event.key);
      const index = selectableDays.findIndex((day) => day.date === date);
      if (index < 0) return;
      let target: number;
      if (step !== undefined) target = index + step;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = selectableDays.length - 1;
      else return;

      event.preventDefault();
      const clamped = Math.min(Math.max(target, 0), selectableDays.length - 1);
      const next = selectableDays[clamped].date;
      onActivate(next);
      buttonRefs.current.get(next)?.focus();
    },
    [onActivate, selectableDays],
  );

  const activeDay = activeDate === null ? null : (grid.days.find((day) => day.date === activeDate) ?? null);
  const activeDescription =
    activeDay === null ? null : (
      describeAdherenceDay({ day: activeDay, goals, mode: grid.mode, t, language: i18n.language })
    );

  return (
    <div className="space-y-2">
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        <div className="max-w-[400px] space-y-[2px]">
          <MonthLabelRow labels={monthLabels} weekCount={grid.weeks.length} />
          <ul
            aria-label={t(grid.mode === 'activity' ? 'trends.grid.a11yLabelActivity' : 'trends.grid.a11yLabel')}
            onPointerLeave={() => setActiveDate(null)}
            className={cn(
              'grid list-none grid-flow-col gap-[2px]',
              'grid-cols-[1.5rem_repeat(13,minmax(0,1fr))] grid-rows-[repeat(7,auto)]',
            )}
          >
            {weekdayNames.map((name, row) => (
              <li
                key={name}
                aria-hidden="true"
                className="flex items-center justify-end pr-1 text-[10px] leading-none text-muted-foreground"
              >
                {LABELLED_WEEKDAY_ROWS.has(row) ? name : ''}
              </li>
            ))}
            {grid.days.map((day) => (
              <AdherenceCell
                key={day.date}
                day={day}
                goals={goals}
                mode={grid.mode}
                isAnchor={day.date === anchorDate}
                onActivate={onActivate}
                onKeyDown={onKeyDown}
                registerRef={registerRef}
              />
            ))}
          </ul>
        </div>
      </TooltipProvider>

      {/*
        The persistent readout — the touch equivalent of a tooltip. Its height
        is reserved so switching between the idle sentence and a day's rows
        never reflows the legend below it. Deliberately NOT `aria-live`: it
        changes on every hover and would flood a screen reader, which reads the
        per-cell `aria-label` instead.
      */}
      <div className="min-h-[2.75rem] text-xs text-muted-foreground">
        {activeDay !== null && activeDescription !== null ?
          <AdherenceDayReadout day={activeDay} description={activeDescription} tone="surface" />
        : <div className="space-y-0.5">
            <p className="tabular-nums">{summarySentence(grid, t)}</p>
            <p>{t('trends.grid.captionIdle')}</p>
          </div>
        }
      </div>
    </div>
  );
}

/** Arrow/page keys → how far they move through the (column-major, oldest-first) day list. */
function keyStep(key: string): number | undefined {
  if (key === 'ArrowUp') return -1;
  if (key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'PageUp') return -DAYS_PER_WEEK;
  if (key === 'ArrowRight' || key === 'PageDown') return DAYS_PER_WEEK;
  return undefined;
}

/**
 * The month row above the grid. A label is drawn on the first column and on
 * every column whose Monday opens a new month; it may overhang its column
 * rather than widening it, so the 13 squares below stay evenly sized.
 */
function MonthLabelRow({ labels, weekCount }: { labels: Map<number, string>; weekCount: number }): ReactNode {
  return (
    <div className="grid grid-cols-[1.5rem_repeat(13,minmax(0,1fr))] gap-[2px]" aria-hidden="true">
      <span />
      {Array.from({ length: weekCount }, (_unused, weekIndex) => (
        <span
          key={weekIndex}
          className="relative overflow-visible text-[10px] leading-none whitespace-nowrap text-muted-foreground"
        >
          {labels.get(weekIndex) ?? ''}
        </span>
      ))}
    </div>
  );
}
