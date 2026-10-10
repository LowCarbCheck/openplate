/**
 * How long ago something happened, as the admin console words it.
 *
 * ── Pure, with the clock passed in ───────────────────────────────────────
 *
 * Every function here takes `now`. "Joined 3 days ago" is a fact about two
 * instants, and a test that read the real clock would pass on the day it was
 * written and fail a week later.
 *
 * ── Ages are 24 hour spans, not calendar days ────────────────────────────
 *
 * "Today" is the last 24 hours and "yesterday" is the 24 hours before that.
 * A calendar rule would need the reader's time zone and would say "yesterday"
 * for a sign-up eleven minutes ago at one minute past midnight. The console is
 * used to answer "who is new", and a rolling window answers that without
 * asking where the operator is.
 *
 * ── A timestamp that does not parse is very old, not an error ────────────
 *
 * The wire schema only promises a string. A bad one must not take the whole
 * list down, so it reads as the oldest thing possible: it sorts last under
 * "newest first", lands in "earlier", and is never "new".
 */
import { dateLabelLocale } from '../../i18n/date-locale';

/** Milliseconds in one 24 hour span. */
export const MS_PER_DAY = 86_400_000;

/** A person who joined less than this many days ago is new, and sits in the first band. */
export const NEW_WITHIN_DAYS = 7;

/** A person who joined less than this many days ago, and not this week, sits in the second band. */
export const MONTH_WITHIN_DAYS = 30;

/** The bands a list sorted by sign-up date is split into. */
export type PeopleBand = 'week' | 'month' | 'earlier';

/**
 * How many days ago an instant was, fractional.
 *
 * A clock that runs ahead of the server puts a timestamp in the future; that
 * reads as "now" (zero), because "joined in minus two hours" is nonsense.
 * An instant that does not parse is `Infinity`.
 */
export function ageInDays({ iso, now }: { iso: string; now: Date }): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - at) / MS_PER_DAY);
}

/** The band a sign-up date falls in. */
export function bandOf({ createdAt, now }: { createdAt: string; now: Date }): PeopleBand {
  const age = ageInDays({ iso: createdAt, now });
  if (age < NEW_WITHIN_DAYS) return 'week';
  if (age < MONTH_WITHIN_DAYS) return 'month';
  return 'earlier';
}

/** What to say about an instant: a relative phrase while it is recent, a date once it is not. */
export type DayAge =
  { kind: 'today' } | { kind: 'yesterday' } | { kind: 'days-ago'; days: number } | { kind: 'date'; iso: string };

/**
 * The phrase an instant gets.
 *
 * @param relativeUntilDays - from this age on, a date replaces "N days ago".
 *   A sign-up is relative for a week, because "3 days ago" is what an operator
 *   asks about. A last sign-in is relative for two weeks, the same length as
 *   "gone quiet".
 */
export function describeDayAge({
  iso,
  now,
  relativeUntilDays,
}: {
  iso: string;
  now: Date;
  relativeUntilDays: number;
}): DayAge {
  const age = ageInDays({ iso, now });
  if (age < 1) return { kind: 'today' };
  if (age < 2) return { kind: 'yesterday' };
  if (age < relativeUntilDays) return { kind: 'days-ago', days: Math.floor(age) };
  return { kind: 'date', iso };
}

/**
 * An instant as a short date in the reader's language: `3 Oct` in English,
 * `3. Okt.` in German. The year is added once it is not this year's, because a
 * sign-up on "3 Oct" is a different fact a year on.
 *
 * Read in the reader's own time zone, like `formatNumericDate`. An instant that
 * does not parse is printed as it came: a wrong date would be a claim, a raw
 * string is only ugly.
 */
export function formatShortDate({ iso, now, language }: { iso: string; now: Date; language: string }): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const isThisYear = at.getFullYear() === now.getFullYear();
  return at.toLocaleDateString(dateLabelLocale(language), {
    day: 'numeric',
    month: 'short',
    year: isThisYear ? undefined : 'numeric',
  });
}
