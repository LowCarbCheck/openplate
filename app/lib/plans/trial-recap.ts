/**
 * WHAT THE PERSON DID WITH AI DURING THE TRIAL, counted from the diary this
 * device already holds (M250/05).
 *
 * One line, near the end of the trial and on the plan page: how many meals
 * were logged with AI in the trial. It is counted from the food logs on this
 * device and nothing is uploaded to count it; a diary that syncs is the
 * account's whole diary, which is what the sentence is about.
 *
 * ── WHAT COUNTS AS ONE MEAL ──────────────────────────────────────────────
 *
 * A food log whose `source` is `plate_ai`: a photographed plate, a printed
 * label, a meal written in words, a recipe proposed from the pantry. Every
 * way in that runs the AI intake writes that source, and nothing else does.
 * One intake writes its rows under one `logBatchId`, so a four-item plate is
 * ONE meal, not four. A row with no batch counts as its own meal.
 *
 * ── THE WINDOW ───────────────────────────────────────────────────────────
 *
 * From the account's creation, which on a consumer instance is when the
 * invitation wrote the trial's allowance (M213/05), to the trial's end. A row
 * CREATED in that window counts, whatever day it was filed under, because a
 * meal logged during the trial for last Tuesday was still logged with the
 * trial's AI. The end is exclusive, the protocol's "not after" (§5.19): a
 * scan at the end instant was refused. Without a creation date or an end date
 * there is no window and no sentence, because a count over a guessed window
 * would claim meals that were not the trial's.
 *
 * A SCAN TRIAL HAS NO END DATE (M253/05), so its window runs from the account's
 * creation to now: every AI meal logged so far, and the sentence says "so far".
 * The end is unbounded rather than the clock, so the window, and the read it
 * keys, does not change on every render; a meal cannot be created in the future.
 *
 * Pure: the logs and the dates are arguments.
 */
import type { LocalFoodLog } from '#app/lib/local-store';
import type { PlanStanding } from '#app/lib/plans/plan-standing';

/** The calendar days before the end at which the countdown carries the recap. */
export const RECAP_NEAR_END_DAYS = 3;

/** The free scans left at which the countdown carries the recap (M253/05). */
export const RECAP_NEAR_END_SCANS = 3;

/** The recap's sentence: "in your trial" for a dated trial, "so far" for a scan trial, which has no end yet. */
export type RecapSentenceKey = 'plan.recap.meals' | 'plan.recap.mealsSoFar';

/** Which recap sentence a standing reads. */
export function recapSentenceKey(standing: PlanStanding): RecapSentenceKey {
  const isScans = (standing.kind === 'trial' || standing.kind === 'trial-ended') && standing.basis === 'scans';
  return isScans ? 'plan.recap.mealsSoFar' : 'plan.recap.meals';
}

/** The trial, as two epoch-ms instants. `startsAtMs` is included, `endsAtMs` is not. */
export interface TrialWindow {
  startsAtMs: number;
  endsAtMs: number;
}

/** The fields of a food log the count reads. */
export type RecapLog = Pick<LocalFoodLog, 'id' | 'source' | 'createdAt' | 'logBatchId'>;

/**
 * The trial's window, or `null` when there is none to count in.
 *
 * @param input.standing - where the person stands. Only a running trial and a
 *   trial that ended on a known date have a window.
 * @param input.accountCreatedAt - the account's creation instant, or `null`/absent while unread.
 */
export function trialRecapWindow({
  standing,
  accountCreatedAt,
}: {
  standing: PlanStanding;
  accountCreatedAt: string | null | undefined;
}): TrialWindow | null {
  const endsAt = trialEndOf(standing);
  if (endsAt === null || accountCreatedAt === null || accountCreatedAt === undefined) return null;
  const startsAtMs = Date.parse(accountCreatedAt);
  const endsAtMs = endsAt === UNBOUNDED ? Number.POSITIVE_INFINITY : Date.parse(endsAt);
  if (Number.isNaN(startsAtMs) || Number.isNaN(endsAtMs) || startsAtMs >= endsAtMs) return null;
  return { startsAtMs, endsAtMs };
}

/** The end of a scan trial's window: none. A sentinel rather than a date, so no clock is read. */
const UNBOUNDED = 'unbounded';

/**
 * The instant a trial ends or ended, {@link UNBOUNDED} for a scan trial, or
 * `null` for every standing that is not about a trial.
 */
function trialEndOf(standing: PlanStanding): string | null {
  if (standing.kind !== 'trial' && standing.kind !== 'trial-ended') return null;
  if (standing.basis === 'scans') return UNBOUNDED;
  return standing.kind === 'trial' ? standing.endsAt : standing.endedAt;
}

/**
 * How many meals were logged with AI inside the window.
 *
 * @param input.logs - the device's food logs.
 * @param input.window - the trial's window.
 */
export function countTrialAiMeals({ logs, window }: { logs: readonly RecapLog[]; window: TrialWindow }): number {
  const meals = new Set<string>();
  for (const log of logs) {
    if (log.source !== 'plate_ai') continue;
    if (log.createdAt < window.startsAtMs || log.createdAt >= window.endsAtMs) continue;
    // A prefix per kind, so a batch id can never collide with a row id.
    meals.add(log.logBatchId === null ? `row:${log.id}` : `batch:${log.logBatchId}`);
  }
  return meals.size;
}
