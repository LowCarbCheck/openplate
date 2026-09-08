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
import type { AdminAccountView, AdminActivityDay } from './admin-wire';

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

/**
 * The strips, keyed by the account they belong to.
 *
 * `null` IS ITS OWN ANSWER and the reason this exists: an instance whose
 * service is older than this client has no batch activity endpoint, so the
 * request fails and every row is drawn with no strip at all. That is a
 * different picture from a quiet strip, and the two must never collapse, so
 * the absence is carried as `null` rather than as an empty map that would draw
 * every person as though they had stopped.
 */
export type ActivityByAccount = ReadonlyMap<number, readonly AdminActivityDay[]>;

/** One account and its strip, ready to draw. `days` is null when this client never received one for them. */
export interface AccountActivityRow {
  account: AdminAccountView;
  days: readonly AdminActivityDay[] | null;
}

/**
 * Everybody, most recently active first, with the people who never arrived
 * last.
 *
 * SORTED ON `lastSeenAt`, not on the strip. The strip is a window and the
 * question the activity page answers, "is this study participant still using
 * it", is asked about people whose last sign in may be older than any window
 * the service keeps. Sorting on the strip would have put somebody who stopped
 * four months ago in the same place as somebody who stopped yesterday, since
 * both windows are all zeroes.
 *
 * `null` sorts last rather than first: an invited account that never arrived
 * is a real state, and it is not news about somebody going quiet.
 */
export function orderByRecentActivity(input: {
  people: readonly AdminAccountView[];
  activity: ActivityByAccount | null;
}): AccountActivityRow[] {
  const ordered = input.people.toSorted((left, right) => {
    const leftAt = lastSeenMs(left.lastSeenAt);
    const rightAt = lastSeenMs(right.lastSeenAt);
    if (leftAt === rightAt) return left.email.localeCompare(right.email);
    return rightAt - leftAt;
  });
  return ordered.map((account) => ({ account, days: input.activity?.get(account.id) ?? null }));
}

/** A last-seen instant as a number, with "never" as the smallest value there is so it sorts last. */
function lastSeenMs(lastSeenAt: string | null): number {
  if (lastSeenAt === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(lastSeenAt);
  // An unparseable instant is treated as "never" rather than thrown on: this
  // function decides a row's position, which is not worth an operator's page.
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
