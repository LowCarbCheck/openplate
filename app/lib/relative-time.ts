/**
 * relative-time.ts — "5 min ago", "yesterday", "just now", in the visitor's own
 * language.
 *
 * Split in two on purpose: `relativeTimeParts` is a pure, locale-free
 * arithmetic step that decides WHICH unit a gap should be told in, and
 * `formatRelativeTime` hands that to `Intl.RelativeTimeFormat` for the words.
 * The unit choice is the part with judgment in it (and the part worth
 * testing); the wording is the platform's job, and going through `Intl` is
 * what keeps German from needing a hand-written table of its own.
 */

/** A signed gap, in the largest unit that still reads naturally. Negative values are in the past. */
export interface RelativeTimeParts {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Calendar months vary; this is the conventional averaging constant, and the copy is approximate anyway. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Largest unit first — the first threshold the gap clears wins. */
const UNIT_STEPS: ReadonlyArray<{ ms: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { ms: YEAR_MS, unit: 'year' },
  { ms: MONTH_MS, unit: 'month' },
  { ms: WEEK_MS, unit: 'week' },
  { ms: DAY_MS, unit: 'day' },
  { ms: HOUR_MS, unit: 'hour' },
  { ms: MINUTE_MS, unit: 'minute' },
];

/**
 * @param from - the past epoch-ms instant being described.
 * @param now - the epoch-ms instant to describe it against (passed in, never read from the clock, so this stays pure).
 * @returns the gap as a value/unit pair; `{ value: 0, unit: 'second' }` for anything under a minute, which
 *   `Intl`'s `numeric: 'auto'` renders as "now" / "jetzt" rather than a jittering seconds count.
 */
export function relativeTimeParts({ from, now }: { from: number; now: number }): RelativeTimeParts {
  // A timestamp in the future means a clock disagreement, not time travel:
  // describe it as "now" rather than "in 3 hours", which would read as a bug.
  const elapsed = Math.max(0, now - from);

  for (const step of UNIT_STEPS) {
    if (elapsed >= step.ms) return { value: -Math.floor(elapsed / step.ms), unit: step.unit };
  }
  return { value: 0, unit: 'second' };
}

/**
 * The same gap as words, in `locale`.
 *
 * `numeric: 'auto'` is what turns -1 day into "yesterday" and 0 seconds into
 * "now"; `style: 'short'` keeps it inside a menu row ("5 min. ago", "vor 5
 * Min.") instead of wrapping.
 */
export function formatRelativeTime({ from, now, locale }: { from: number; now: number; locale: string }): string {
  const { value, unit } = relativeTimeParts({ from, now });
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(value, unit);
}
