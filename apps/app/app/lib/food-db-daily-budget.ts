/**
 * A count of LowCarbCheck calls per UTC day, with a ceiling.
 *
 * WHY IT EXISTS: every uncached food name is one call under the instance's
 * key, and the key's allowance is shared by everybody on the instance. The
 * per-address limiter on `/api/food-matches` bounds one network; this bounds
 * the whole server. See `parseFoodDbDailyCallLimit` in `#app/config` for the
 * default and the reasoning behind it.
 *
 * RESERVED BEFORE THE CALL, NEVER COUNTED AFTER IT. A caller asks for the
 * calls it is about to make and is refused before anything leaves, so a
 * refused request costs the upstream nothing. A reservation can overcount (two
 * requests for the same new name share one call through the resolver's
 * in-flight dedupe), and it errs that way on purpose: an undercount is the
 * direction that spends the allowance.
 *
 * IN MEMORY, like `rate-limit.server.ts`: one process, reset on restart. A
 * restart mid-day hands out a fresh day's worth, which on a single container
 * that restarts on deploy is a bounded leak, not an open one.
 *
 * PURE: the clock is an argument, so the day boundary is testable without
 * waiting for midnight. The one instance the app uses lives in
 * `food-db-daily-budget.server.ts`, next to the config it reads.
 */

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thrown by {@link DailyCallBudget.reserve} when the calls asked for would pass the day's limit. */
export class DailyCallLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Daily food database call limit reached');
    this.name = 'DailyCallLimitExceededError';
  }
}

/** The day's count and the one operation that moves it. */
export interface DailyCallBudget {
  /**
   * Reserves `calls` against the day `now` falls in.
   *
   * @throws DailyCallLimitExceededError when the day's count plus `calls`
   *   would pass the limit. Nothing is reserved then, so a smaller request
   *   later the same day may still fit.
   */
  reserve(input: { calls: number; now: number }): void;
  /** How many calls the day `now` falls in has reserved so far. */
  usedOn(now: number): number;
  /** Forgets the count. TEST SEAM. */
  reset(): void;
}

/** The UTC day an instant falls in, as a day number since the epoch. */
function utcDayOf(now: number): number {
  return Math.floor(now / DAY_MS);
}

/** Milliseconds from `now` until the next UTC midnight, when the count starts again. */
export function msUntilNextUtcDay(now: number): number {
  return (utcDayOf(now) + 1) * DAY_MS - now;
}

/**
 * A fresh budget with nothing reserved.
 *
 * @param options.limit - the most calls one UTC day may reserve.
 */
export function createDailyCallBudget({ limit }: { limit: number }): DailyCallBudget {
  let day = Number.NaN;
  let used = 0;

  /** Starts a new count when `now` has crossed into another day. */
  function rollOver(now: number): void {
    const today = utcDayOf(now);
    if (today === day) return;
    day = today;
    used = 0;
  }

  return {
    reserve({ calls, now }) {
      if (calls <= 0) return;
      rollOver(now);
      if (used + calls > limit) throw new DailyCallLimitExceededError(msUntilNextUtcDay(now));
      used += calls;
    },
    usedOn(now) {
      rollOver(now);
      return used;
    },
    reset() {
      day = Number.NaN;
      used = 0;
    },
  };
}
