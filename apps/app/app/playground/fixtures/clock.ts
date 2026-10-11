/**
 * The playground's clock.
 *
 * Every admin component takes the instant its ages are measured against as a
 * `now` prop ("a parameter, so a render is reproducible"). The playground gives
 * them all this one, and builds every fixture date relative to it, so "joined 3
 * days ago" and "expires in 2 days" read the same on any day the page is opened.
 */

/** The instant the admin fixtures are measured from. */
export const PLAYGROUND_NOW = new Date('2026-10-11T09:30:00Z');

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/**
 * An ISO instant a span before {@link PLAYGROUND_NOW}.
 *
 * @param days - whole days back.
 * @param hours - extra hours back, for "joined this morning".
 */
export function isoBefore({ days, hours = 0 }: { days: number; hours?: number }): string {
  return new Date(PLAYGROUND_NOW.getTime() - (days * HOURS_PER_DAY + hours) * MS_PER_HOUR).toISOString();
}

/**
 * An ISO instant a span after {@link PLAYGROUND_NOW}.
 *
 * @param days - whole days ahead.
 * @param hours - extra hours ahead.
 */
export function isoAfter({ days, hours = 0 }: { days: number; hours?: number }): string {
  return new Date(PLAYGROUND_NOW.getTime() + (days * HOURS_PER_DAY + hours) * MS_PER_HOUR).toISOString();
}

/** The UTC day key (`2026-10-11`) of an instant, the form the activity wire uses. */
export function dayKeyOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
