/**
 * The daily strip, the part that has no pixels in it.
 *
 * ── A quiet day and an absent day are different things ───────────────────
 *
 * The service zero-fills every day of the window (`PROTOCOL.md` §5.20), so
 * inside a window a day with no photo reading arrives as `count: 0` and never
 * as a hole. That is the whole point of the endpoint: an operator running a
 * study asks whether somebody has stopped, and a run of zeroes is the answer,
 * while a missing key is a question about an API.
 *
 * The screen has to keep that distinction, and it can only do so if it draws
 * one square per entry and nothing else. {@link activityLevel} therefore has a
 * level 0 that IS drawn, as an empty outlined square, rather than a level that
 * renders nothing. A day outside the window has no square at all, and the strip
 * says in words which window it drew, so the two cannot be read as each other.
 *
 * ── Five levels, and no library ──────────────────────────────────────────
 *
 * A managed instance here has a handful of people and an allowance in the low
 * hundreds. Five buckets separate "nothing", "a photo or two", "a normal day"
 * and "a heavy day" well enough for the question being asked, and a charting
 * dependency would ship a rendering engine to draw ninety squares.
 *
 * The buckets are ABSOLUTE, not relative to the busiest day in the window.
 * Scaling to the maximum would redraw the same person's history every time
 * their busiest day changed, and would make two people's strips uncomparable
 * while looking exactly as though they could be compared.
 */
import type { AdminActivityDay } from './admin-wire';

/** How full one square is drawn. `0` is a day that happened and was quiet, and it is still drawn. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

/** The lower bound of each level above zero. Read in order, first match wins. */
const LEVEL_THRESHOLDS: readonly { from: number; level: ActivityLevel }[] = [
  { from: 10, level: 4 },
  { from: 6, level: 3 },
  { from: 3, level: 2 },
  { from: 1, level: 1 },
];

/**
 * The bucket one day's count falls in.
 *
 * A negative count cannot come off the wire (the schema takes an integer and
 * the service stores a counter), and it is treated as zero rather than thrown
 * on: this function decides how dark a square is, and a bad number is not worth
 * an operator's page.
 */
export function activityLevel(count: number): ActivityLevel {
  for (const threshold of LEVEL_THRESHOLDS) {
    if (count >= threshold.from) return threshold.level;
  }
  return 0;
}

/** Everything read in the window. The strip's one summary number, and the reason an all-zero strip can say so. */
export function activityTotal(days: readonly AdminActivityDay[]): number {
  return days.reduce((sum, entry) => sum + entry.count, 0);
}
