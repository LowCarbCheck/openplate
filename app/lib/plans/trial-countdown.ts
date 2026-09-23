/**
 * THE TRIAL COUNTDOWN, decided here and drawn by the header's status slot
 * (M250/03).
 *
 * During a trial the header says how many days of AI scans are left and links
 * to the plan page. This module holds every rule about that line and no
 * React: whether it shows, what number it says, and whether the person closed
 * it today. `components/plans/trial-countdown.tsx` only publishes what this
 * answers.
 *
 * ── CALENDAR DAYS, NOT ELAPSED HOURS ─────────────────────────────────────
 *
 * `planStanding`'s `daysLeft` rounds elapsed time up, which is right for "is
 * there any trial left" and wrong for a sentence: with 21 hours left and the
 * end at nine tomorrow morning, "today" would be false. So the countdown
 * counts the device's calendar days from today to the LAST USABLE DAY,
 * today included. The last usable day is the local day of the instant just
 * before the end, because an allowance that ends at local midnight was
 * last usable the day before (`PROTOCOL.md` §5.19, "not after").
 *
 * ── CLOSED FOR THE DAY, ON THIS DEVICE ───────────────────────────────────
 *
 * Closing the line records today's local day key in `localStorage`, the
 * `save-meal-hint.ts` reasoning: a dismissed nudge is a preference about a
 * nudge, not health data, and it must not travel into backups or onto other
 * devices. Tomorrow the key no longer matches and the line comes back, which
 * is the promise "closed for the day" makes and no more.
 *
 * Pure but for the two storage calls, and both take their storage as an
 * argument.
 */
import { daysBetweenDates } from '#app/lib/ewma';
import { localDateToDayKey } from '#app/lib/day-key-date';
import type { PlanStanding } from '#app/lib/plans/plan-standing';
import { PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';

/** Where the closed day lives. Versioned, so a future retune can start clean. */
export const TRIAL_COUNTDOWN_STORAGE_KEY = 'openplate:trial-countdown-closed:v1';

/** Minimal storage surface. `localStorage` satisfies it, and so does a plain fake in a test. */
export interface CountdownStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * What the countdown says.
 *
 * - `days`: how many days of AI scans are left, today included. `1` is the last day.
 * - `scans`: how many free AI scans are left (M253/05). Above zero, because a
 *   spent trial is `trial-ended` and draws no countdown.
 */
export type TrialCountdown = { basis: 'days'; daysLeft: number } | { basis: 'scans'; scansLeft: number };

/**
 * The calendar days of AI scans left, today included, or `null` when the
 * end has passed or cannot be read.
 *
 * @param input.endsAt - the ISO instant the allowance ends.
 * @param input.now - the instant to count from.
 */
export function trialCountdownDaysLeft({ endsAt, now }: { endsAt: string; now: Date }): number | null {
  const endsAtMs = Date.parse(endsAt);
  if (Number.isNaN(endsAtMs) || endsAtMs <= now.getTime()) return null;
  // The instant BEFORE the end names the last usable day, so an end at local
  // midnight does not count the day that has not a single usable second.
  const lastUsableDay = localDateToDayKey(new Date(endsAtMs - 1));
  return daysBetweenDates(localDateToDayKey(now), lastUsableDay) + 1;
}

/**
 * The day the countdown was last closed on this device, or `null`.
 *
 * Anything unreadable reads as never closed, because a broken preference must
 * never take the header down with it.
 */
export function readCountdownClosedDay(storage: CountdownStorage): string | null {
  try {
    return storage.getItem(TRIAL_COUNTDOWN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Records that the countdown was closed today. A failed write (private mode,
 * a full quota) is swallowed for the reason above: the line then comes back on
 * the next load, which is a nudge too many and not a broken page.
 */
export function closeCountdownForDay({ storage, dayKey }: { storage: CountdownStorage; dayKey: string }): void {
  try {
    storage.setItem(TRIAL_COUNTDOWN_STORAGE_KEY, dayKey);
  } catch {
    // Ignored by design, see this function's doc.
  }
}

/**
 * Whether the countdown shows, and what it says.
 *
 * `null` for everybody who is not in a trial (the standing already answers
 * `no-plans` for an instance that sells nothing and for every fact not yet
 * read), for a person who closed it today, and on the plan page itself, where
 * a link to the page somebody is reading is a link to nowhere.
 *
 * @param input.standing - where the person stands, from `planStanding`.
 * @param input.now - the instant to count from.
 * @param input.closedDay - the day key the countdown was last closed on, or `null`.
 * @param input.pathname - the page the person is on.
 */
export function resolveTrialCountdown({
  standing,
  now,
  closedDay,
  pathname,
}: {
  standing: PlanStanding;
  now: Date;
  closedDay: string | null;
  pathname: string;
}): TrialCountdown | null {
  if (standing.kind !== 'trial') return null;
  if (closedDay === localDateToDayKey(now)) return null;
  if (isPlanPage(pathname)) return null;
  switch (standing.basis) {
    case 'scans':
      return { basis: 'scans', scansLeft: standing.scansLeft };
    case 'days': {
      const daysLeft = trialCountdownDaysLeft({ endsAt: standing.endsAt, now });
      return daysLeft === null ? null : { basis: 'days', daysLeft };
    }
  }
}

/** Whether a path is the plan page, with or without a trailing slash. */
export function isPlanPage(pathname: string): boolean {
  return pathname === PLAN_PAGE_HREF || pathname === `${PLAN_PAGE_HREF}/`;
}
