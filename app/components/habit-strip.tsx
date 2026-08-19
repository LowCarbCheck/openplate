/**
 * The seven-day habit strip — one dot per day (oldest → today), each linking to
 * its own `/diary?date=` view. Two-state (logged/none) until a carb ceiling is
 * set, then three-state (met/over/none) with an explanatory legend. Today is
 * ringed. Calm by design — a gap is just an empty dot, never a "broken streak".
 *
 * Extracted from `diary.tsx`, where it was module-private, so `/dashboard`'s
 * week tile can render THE strip rather than a second copy of the same dots
 * (and a second, drifting `HABIT_DOT_CLASS` map).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import type { HabitStripDay, HabitStripStatus } from '#app/models/habit-strip';
import { cn } from '#app/lib/utils';

/**
 * The narrow slice of i18next's `t` the label helper depends on, declared
 * locally rather than imported — the same convention `hero-stat.tsx` and
 * `macro-gaps.ts` follow.
 */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** Dot fill per state — teal for met/logged, amber (never red) for over, hollow for none. */
const HABIT_DOT_CLASS = {
  met: 'bg-primary',
  logged: 'bg-primary',
  over: 'bg-accent-amber',
  none: 'border border-muted-foreground/30',
} satisfies Record<HabitStripStatus, string>;

/** Screen-reader suffix describing a day's dot state. */
function habitDayLabel(day: HabitStripDay, t: Translate): string {
  return t(`diary.habit.${day.status}`, { date: day.date });
}

export function HabitStrip({
  days,
  loggedCount,
  hasCeiling,
  showLegend = true,
  emptyLabel,
  dense = false,
}: {
  days: HabitStripDay[];
  loggedCount: number;
  hasCeiling: boolean;
  /**
   * Whether to draw the under/over-goal legend under the dots. `/diary` keeps
   * it (it is where the meaning is taught); `/dashboard`'s glance tile turns it
   * off — the tile has no room for it, and repeating the lesson on a second
   * screen is the duplication the nav catalog exists to avoid.
   */
  showLegend?: boolean;
  /**
   * Replaces the "Logged 0 of the last 7 days" line on a device with nothing
   * logged in the window. `/diary` deliberately doesn't pass one — it has its
   * own empty states below the strip — while `/dashboard`'s week tile is the
   * whole surface, so a bare zero there is the only thing it would say.
   */
  emptyLabel?: string;
  /**
   * Narrow-column layout for `/dashboard`'s half-width week tile (~10rem of
   * content at 375 px). Two differences, both scoped to this flag so `/diary`'s
   * full-width strip renders byte-identically:
   *
   * - The dots spread across the full row (`grow` + `px-0.5`) instead of each
   *   carrying a fixed 4 px of horizontal padding. Seven fixed dots need 126 px
   *   and overflow the tile; growing them makes the row fit ANY width down to
   *   ~77 px, and the tap target gets WIDER, not narrower, because the free
   *   space is handed to the links rather than left as dead gutter.
   * - The "Logged N of the last 7 days" line moves under the dots instead of
   *   sitting beside them, which is the only place it fits in this column.
   */
  dense?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className={dense ? 'flex flex-col gap-1.5' : 'flex items-center gap-3'}>
        <div className={cn('flex items-center', dense && 'w-full')}>
          {days.map((day) => (
            <Link
              key={day.date}
              to={`/diary?date=${day.date}`}
              title={day.date}
              aria-label={habitDayLabel(day, t)}
              className={cn('flex items-center justify-center p-1', dense && 'grow px-0.5')}
            >
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full transition-colors',
                  HABIT_DOT_CLASS[day.status],
                  day.isToday && 'ring-2 ring-primary/40 ring-offset-1 ring-offset-background',
                )}
              />
            </Link>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {loggedCount === 0 && emptyLabel !== undefined ?
            emptyLabel
          : t('diary.habit.summary', { logged: loggedCount, total: days.length })}
        </span>
      </div>
      {showLegend && hasCeiling && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" /> {t('diary.habit.underGoal')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-accent-amber" /> {t('diary.habit.overGoal')}
          </span>
        </div>
      )}
    </div>
  );
}
