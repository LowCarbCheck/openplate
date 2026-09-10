/**
 * The Budget Ridge: the Overview page's seven-day tile (M216/01). One short
 * vertical bar per day, oldest to today, each a link into that day's diary.
 * Presentational only: the whole model arrives pre-computed from
 * `#app/models/day-ridge`, which owns every verdict.
 *
 * HEIGHT ARITHMETIC. The tile has to fit the Overview's no-scroll budget, which
 * `dashboard.tsx`'s module header spends down to the pixel, so this component
 * is drawn to a fixed 164 px card, border to border:
 *
 *   1 top border + 16 header padding + 32 title (two lines at 16 px)
 *   + 8 header padding + 12 goal caption + 62 drawing area + 4 gap
 *   + 12 weekday row + 16 content padding + 1 bottom border = 164.
 *
 * Inside the 62 px drawing area the 100 percent rule sits 48 px above the
 * baseline, which leaves 14 px of headroom. An over bar is therefore CLIPPED at
 * 62/48, about 1.29 times the goal, and nothing marks the clip: the amber says
 * the direction, and the bar's `aria-label` carries the true value and the
 * goal, so the magnitude is never lost to a screen reader (operator decision,
 * 2026-09-10).
 *
 * The handoff to `/trends` is the arrow in the tile HEADER, not a labelled link
 * under the chart. At the tile's real width of 171 px the label wrapped to two
 * lines and spent 40 px of the 164, which would have left the chart 22 px to
 * draw in. It is still a real link to the same place, and it keeps the label as
 * its `aria-label`, so nothing is lost to a screen reader (same decision).
 */
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { dateLabelLocale } from '#app/i18n/date-locale';
import type { DayRidge as DayRidgeModel, RidgeDay, RidgeMetric } from '#app/models/day-ridge';
import { cn } from '#app/lib/utils';

/** The drawing area, in px. See the height arithmetic above. */
const DRAW_HEIGHT_PX = 62;
/** Where the 100 percent rule sits above the baseline, in px. A bar at `fraction === 1` is exactly this tall. */
const RULE_HEIGHT_PX = 48;
/** A gap day's stub. Never zero: "nothing logged" still has to be visible and tappable. */
const GAP_STUB_PX = 2;
/** The shortest bar a logged day can draw, so a tiny figure still reads as a bar rather than as a gap. */
const MIN_LOGGED_BAR_PX = 4;

/**
 * Bar fill per state. Teal under the rule, amber over it, and a HOLLOW stub for
 * a gap day.
 *
 * The gap stub reuses `habit-strip.tsx`'s `none` stroke rather than `bg-muted`:
 * 2 px of `--muted` on `--card` was close to invisible in both themes when the
 * design was rendered, and the diary strip had already solved the same problem
 * this way (operator decision, 2026-09-10).
 */
const RIDGE_BAR_CLASS = {
  none: 'border border-muted-foreground/30',
  logged: 'bg-primary',
  met: 'bg-primary',
  over: 'bg-accent-amber',
} satisfies Record<RidgeDay['state'], string>;

/** The narrow slice of i18next's `t` the label helpers depend on, declared locally as `habit-strip.tsx` does. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** A `YYYY-MM-DD` calendar date as a UTC instant. A date's weekday is the same everywhere, so no zone is needed. */
function utcInstant(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** How tall to draw a day, clipped to the drawing area. */
function barHeightPx(day: RidgeDay): number {
  if (day.state === 'none') return GAP_STUB_PX;
  if (day.fraction === null) return MIN_LOGGED_BAR_PX;
  const scaled = Math.round(day.fraction * RULE_HEIGHT_PX);
  return Math.min(DRAW_HEIGHT_PX, Math.max(MIN_LOGGED_BAR_PX, scaled));
}

/** The caption above the bars: what the rule stands for, or that there is no goal. */
function captionFor(ridge: DayRidgeModel, t: Translate): string {
  if (ridge.metric === null || ridge.goal === null) return t('dashboard.ridge.caption.none');
  return t(`dashboard.ridge.caption.${ridge.metric.key}`, { goal: ridge.goal });
}

/** The verdict half of a graded day's key: a floor reads reached / not reached, never over. */
function verdictKey(day: RidgeDay, metric: RidgeMetric): string {
  if (metric.direction === 'floor') return day.state === 'met' ? 'met' : 'under';
  return day.state === 'over' ? 'over' : 'met';
}

/**
 * One bar's screen-reader label. Four shapes: a graded day naming its value,
 * its goal and the verdict; a logged but ungraded day; a day on the no-goal
 * ridge naming its entry count; and a gap day.
 */
function ridgeDayLabel({
  day,
  ridge,
  dayLabel,
  t,
}: {
  day: RidgeDay;
  ridge: DayRidgeModel;
  dayLabel: string;
  t: Translate;
}): string {
  if (day.state === 'none') return t('dashboard.ridge.day.none', { day: dayLabel });
  if (ridge.metric === null || ridge.goal === null) {
    return t('dashboard.ridge.day.entries', { day: dayLabel, count: day.value ?? 0 });
  }
  if (day.value === null) return t('dashboard.ridge.day.logged', { day: dayLabel });
  return t(`dashboard.ridge.day.${ridge.metric.key}.${verdictKey(day, ridge.metric)}`, {
    day: dayLabel,
    value: day.value,
    goal: ridge.goal,
  });
}

export function DayRidge({ ridge, emptyLabel }: { ridge: DayRidgeModel; emptyLabel: string }): ReactElement {
  const { t, i18n } = useTranslation();
  const locale = dateLabelLocale(i18n.language);

  // Two formatters, both memoised per locale: `Intl.DateTimeFormat`
  // construction is the expensive part and this renders on every visit to the
  // page. `long` is the spoken label ("Tuesday, 3 September"); `short` is the
  // visible weekday under the bar, in the app's own form (Mo, Di, Mi), because
  // single letters collide twice over in German.
  const [spokenDay, weekdayLetter] = useMemo(
    () => [
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }),
    ],
    [locale],
  );

  return (
    <div>
      {/*
        One sentence for a screen reader landing on the tile. A window with
        nothing in it says so in the tile's own empty copy instead of reading
        out a row of zeroes.
      */}
      <p className="sr-only">
        {ridge.loggedDayCount === 0 ?
          emptyLabel
        : t('dashboard.ridge.srSummary', { logged: ridge.loggedDayCount, total: ridge.days.length })}
      </p>
      <p
        aria-hidden="true"
        className="text-right text-[10px] leading-3 text-muted-foreground tabular-nums"
        style={{ height: 12 }}
      >
        {captionFor(ridge, t)}
      </p>
      <div className="relative flex items-end gap-[3px]" style={{ height: DRAW_HEIGHT_PX }}>
        {/* The 100 percent line. Absent entirely when there is no goal to draw it for. */}
        {ridge.metric !== null && (
          <span aria-hidden="true" className="absolute inset-x-0 h-px bg-border" style={{ bottom: RULE_HEIGHT_PX }} />
        )}
        {ridge.days.map((day) => (
          <Link
            key={day.date}
            to={`/diary?date=${day.date}`}
            aria-label={ridgeDayLabel({ day, ridge, dayLabel: spokenDay.format(utcInstant(day.date)), t })}
            aria-current={day.isToday ? 'date' : undefined}
            className="flex h-full flex-1 items-end justify-center"
          >
            <span
              className={cn(
                'block w-full rounded-t-sm transition-colors',
                RIDGE_BAR_CLASS[day.state],
                day.isToday && 'ring-2 ring-primary/40 ring-offset-1 ring-offset-background',
              )}
              style={{ height: barHeightPx(day) }}
            />
          </Link>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex gap-[3px] text-[10px] leading-3 text-muted-foreground"
        style={{ height: 12 }}
      >
        {ridge.days.map((day) => (
          <span key={day.date} className={cn('flex-1 text-center', day.isToday && 'font-bold text-foreground')}>
            {weekdayLetter.format(utcInstant(day.date))}
          </span>
        ))}
      </div>
    </div>
  );
}
