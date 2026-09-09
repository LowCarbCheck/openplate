/**
 * Pure decision for the reproductive-status nudge (M206/04). Mirrors
 * `#app/lib/backup-nudge`'s shape exactly: a documented threshold constant, a
 * dependency-free decision function, no DOM, no store, `today` threaded in as
 * a parameter rather than read off the clock internally.
 *
 * THE APP NEVER FLIPS THE STATUS. A stored `pregnant` due date in the past, or
 * a `lactating` start date more than {@link LACTATION_STALE_THRESHOLD_MONTHS}
 * months old, is a record that has plausibly gone stale, but "plausibly" is
 * doing the work in that sentence. A pregnancy can run past its due date; a
 * parent can breastfeed for years. This module only ever REPORTS that a
 * status looks old enough to be worth asking about; it has no write path, and
 * nothing that calls it may add one. `settings.goals.tsx`'s save action stays
 * the only place `reproductiveStatus`, `pregnancyDueDate` and
 * `lactationStartDate` are ever written.
 */
import type { ReproductiveStatus } from '#app/lib/local-store/schema';

/**
 * Months of lactation before the nudge considers a `lactating` status worth
 * asking about. Two years, not one: exclusively- or partially-breastfeeding
 * well past infancy is ordinary, not a sign the record was left stale.
 */
export const LACTATION_STALE_THRESHOLD_MONTHS = 24;

/** Input to {@link shouldPromptStatusUpdate}. */
export interface ShouldPromptStatusUpdateInput {
  /** The stored status, or `null` when biological sex isn't `'female'` or nothing has been set. */
  reproductiveStatus: ReproductiveStatus | null;
  /** The stored pregnancy due date (`YYYY-MM-DD`), or `null`. Only consulted when `'pregnant'`. */
  dueDate: string | null;
  /** The stored lactation start date (`YYYY-MM-DD`), or `null`. Only consulted when `'lactating'`. */
  lactationStartDate: string | null;
  /** The caller's clock. Never read internally, so this stays unit-testable without faking `Date.now()`. */
  today: Date;
}

/** Parses a `YYYY-MM-DD` string as a UTC calendar day, ignoring any time-of-day component. */
function parseIsoDateAsUtcDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Truncates a `Date` to its UTC calendar day, so a caller's local time-of-day never shifts a boundary. */
function toUtcCalendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Adds whole calendar months to a UTC calendar day (`Date.UTC` normalises month overflow). */
function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/** Whether `dueDate` is strictly before `today`, compared as UTC calendar days. */
function isDueDatePassed(dueDate: string, today: Date): boolean {
  return parseIsoDateAsUtcDay(dueDate).getTime() < toUtcCalendarDay(today).getTime();
}

/**
 * Whether `today` is strictly after the day exactly
 * {@link LACTATION_STALE_THRESHOLD_MONTHS} months past `lactationStartDate` ,
 * so the day of that anniversary itself is still "not stale yet", and the
 * day after is.
 */
function isLactationStale(lactationStartDate: string, today: Date): boolean {
  const staleFrom = addMonthsUtc(parseIsoDateAsUtcDay(lactationStartDate), LACTATION_STALE_THRESHOLD_MONTHS);
  return toUtcCalendarDay(today).getTime() > staleFrom.getTime();
}

/**
 * Whether the dashboard should show the "still pregnant / still breastfeeding,
 * or time to update?" nudge.
 *
 * `true` when `reproductiveStatus === 'pregnant'` and `dueDate` has passed, or
 * when `reproductiveStatus === 'lactating'` and `lactationStartDate` is more
 * than {@link LACTATION_STALE_THRESHOLD_MONTHS} months old. `false` for
 * `'none'`, `false` for `null`, and `false` whenever the relevant date is
 * missing, there is nothing to compare against, so nothing is asserted.
 *
 * This function only ever answers the question; see this module's header for
 * why nothing may use the answer to write a new status.
 */
export function shouldPromptStatusUpdate({
  reproductiveStatus,
  dueDate,
  lactationStartDate,
  today,
}: ShouldPromptStatusUpdateInput): boolean {
  if (reproductiveStatus === 'pregnant') return dueDate !== null && isDueDatePassed(dueDate, today);
  if (reproductiveStatus === 'lactating') return lactationStartDate !== null && isLactationStale(lactationStartDate, today);
  return false;
}
