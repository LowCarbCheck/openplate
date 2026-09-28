/**
 * The paint for one adherence-grid cell, shared by the 13-week grid
 * (`app/components/trends/adherence-grid.tsx`) and the diary's calendar day
 * picker (`DateNav` in `app/routes/diary.tsx`, via `#app/lib/calendar-day-levels`),
 * so the two surfaces can never disagree about what a colour means. Tokens
 * only (`bg-adherence-*`, DESIGN.md section 11), no palette literal lives
 * outside `app/app.css`.
 *
 * `CALENDAR_DAY_MODIFIER_CLASSNAMES` repeats the same tokens as full, literal
 * Tailwind class strings rather than being built by interpolating `CELL_FILL`.
 * Tailwind's scanner reads source text, not runtime JS: a class name
 * assembled as a template string never appears anywhere as a literal, so
 * Tailwind would never generate its CSS and the fill would silently fail to
 * render. Keeping both constants in this one file means a change to the
 * palette side is impossible to make without also seeing the calendar side.
 */
import type { AdherenceLevel, AdherenceStatus } from '#app/models/adherence-grid';

/** One resolved day's paintable state, the two fields both `AdherenceDay` and the calendar's leaner per-day record carry. */
export interface AdherenceCellPaint {
  status: AdherenceStatus;
  level: AdherenceLevel | null;
}

/**
 * The one place a cell state becomes a class. Tokens only, no literals.
 *
 * `activity` mode paints every logged day at step 4 deliberately: with no goal
 * configured there is no magnitude to encode, so it is a nominal one-series
 * fill (the same two-state teal the habit strip uses), not a ramp.
 */
export const CELL_FILL = {
  'no-data': 'bg-adherence-empty',
  unrated: 'bg-adherence-unrated',
  logged: 'bg-adherence-4',
  rated: 'bg-adherence-empty', // unreachable, `rated` always resolves via level
  'rated-1': 'bg-adherence-1',
  'rated-2': 'bg-adherence-2',
  'rated-3': 'bg-adherence-3',
  'rated-4': 'bg-adherence-4',
} satisfies Record<AdherenceStatus | `rated-${AdherenceLevel}`, string>;

/** The paint class for one resolved cell. */
export function fillClassForDay({ status, level }: AdherenceCellPaint): string {
  if (status === 'rated' && level !== null) return CELL_FILL[`rated-${level}`];
  return CELL_FILL[status];
}

/**
 * The six states `DateNav`'s calendar paints: one per ramp level, plus the
 * two `activity`/neutral non-ramp states. `no-data` never reaches the
 * calendar in practice (`selectCalendarDayLevels` only ever returns days that
 * were logged), so it carries no modifier of its own; a day with no entry in
 * the map simply paints nothing.
 */
export type CalendarDayModifier = 'logged' | 'unrated' | 'rated1' | 'rated2' | 'rated3' | 'rated4';

/** The `CalendarDayModifier` for one resolved day, or null when it paints nothing (the no-data edge case). */
export function calendarDayModifierFor({ status, level }: AdherenceCellPaint): CalendarDayModifier | null {
  if (status === 'logged') return 'logged';
  if (status === 'unrated') return 'unrated';
  if (status === 'rated' && level !== null) {
    // SAFETY: `level` is `AdherenceLevel` (1 to 4), so the template literal
    // can only ever produce 'rated1' | 'rated2' | 'rated3' | 'rated4',
    // exactly the four ramp members of `CalendarDayModifier`.
    return `rated${level}` as CalendarDayModifier;
  }
  return null;
}

/**
 * Literal Tailwind strings for `modifiersClassNames`. The paint targets the
 * `<button>` child, not the `<td>` react-day-picker wraps it in, matching
 * `calendar.tsx`'s own `selected` and `today` classnames, which use the same
 * `[&>button]:` pattern for the same reason: react-day-picker applies a
 * matched modifier's class to the day CELL, and only a child-combinator
 * selector reaches the actual button surface. Levels 3 and 4 add the grid's
 * own inverted-surface rule (`TONE_CLASSES.inverted` in `adherence-grid.tsx`)
 * so the day number stays legible on the two darkest steps.
 */
export const CALENDAR_DAY_MODIFIER_CLASSNAMES = {
  logged: '[&>button]:bg-adherence-4 [&>button]:text-background',
  unrated: '[&>button]:bg-adherence-unrated',
  rated1: '[&>button]:bg-adherence-1',
  rated2: '[&>button]:bg-adherence-2',
  rated3: '[&>button]:bg-adherence-3 [&>button]:text-background',
  rated4: '[&>button]:bg-adherence-4 [&>button]:text-background',
} satisfies Record<CalendarDayModifier, string>;
