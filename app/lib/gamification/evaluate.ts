/**
 * Which awards are newly true (M235/01).
 *
 * One rule governs this module: it only ever ADDS. There is no code path that
 * returns a removal, and there must never be one. An award records something a
 * person actually did, and a later edit to an old log, a raised carb ceiling or
 * a device restored from an older backup must not be able to take it back. That
 * is also why the caller passes what is already earned rather than asking this
 * module to diff: the function answers "what is new", never "what is the full
 * set now".
 *
 * Pure: the store, the clock and the day all arrive as arguments.
 */
import { AWARDS } from './catalog';
import type { AwardDefinition } from './catalog';
import type { LocalActivityMark } from './marks';

/**
 * One earned award row.
 *
 * Declared here rather than imported because the store table it belongs to
 * arrives in M235/02; that spec re-exports or aligns with this shape. `key` is
 * a free `string`, never an enum, so a key minted by a newer build survives a
 * backup round trip on an older one instead of being stripped.
 */
export interface LocalAward {
  /** The catalog key, which is also the row key. Written once, never changed. */
  key: string;
  /** When it was earned, epoch milliseconds, from the caller's clock. */
  earnedAt: number;
  /** The local day it was earned on, `YYYY-MM-DD`. */
  earnedOnDay: string;
  /** When the person was shown the note, or null while it is still unseen. The one mutable field. */
  seenAt: number | null;
}

/** Everything the evaluation needs to know. Nothing here is read from a singleton. */
export interface EvaluateAwardsInput {
  /** Every mark held on this device. Explorer awards read the signals, nothing else does. */
  marks: readonly LocalActivityMark[];
  /** The current activity streak, from `computeActiveStreak`. */
  activeStreak: number;
  /**
   * The current run of days at or under the net-carb ceiling, from
   * `computeStreak`, or null when the person has set no ceiling. Null is not
   * zero: with no ceiling there is nothing to be on plan with, so the whole
   * `onplan` family stays silent rather than reading as a run of length zero.
   */
  onPlanStreak: number | null;
  /** The keys already held, so an earned award is never offered twice. */
  earnedKeys: readonly string[];
  /** The person's current local day, `YYYY-MM-DD`, stamped on anything newly earned. */
  today: string;
  /** The caller's clock reading, epoch milliseconds. */
  now: number;
}

/** Whether a definition's condition is met right now. Returns false for a definition this build cannot evaluate. */
function isEarned(
  award: AwardDefinition,
  {
    signals,
    activeStreak,
    onPlanStreak,
  }: { signals: ReadonlySet<string>; activeStreak: number; onPlanStreak: number | null },
): boolean {
  if (award.kind === 'explorer') {
    return award.signal !== undefined && signals.has(award.signal);
  }
  if (award.threshold === undefined) return false;
  if (award.kind === 'streak') return activeStreak >= award.threshold;
  return onPlanStreak !== null && onPlanStreak >= award.threshold;
}

/**
 * The awards that are newly true, in catalog order.
 *
 * Never returns a key already in `earnedKeys`, and never returns a removal. It
 * is monotone by construction: every condition it checks is a "reached at
 * least" test over inputs that only grow, so a set it would have returned
 * before stays earned once more marks arrive.
 *
 * @param input - the marks, the two streak figures, what is already held, the day and the clock.
 * @returns the rows to write, ready for the store, each with `seenAt` null.
 */
export function evaluateAwards({
  marks,
  activeStreak,
  onPlanStreak,
  earnedKeys,
  today,
  now,
}: EvaluateAwardsInput): LocalAward[] {
  const held = new Set(earnedKeys);
  const signals = new Set(marks.map((mark) => mark.signal));
  const earned: LocalAward[] = [];
  for (const award of AWARDS) {
    if (held.has(award.key)) continue;
    if (!isEarned(award, { signals, activeStreak, onPlanStreak })) continue;
    earned.push({ key: award.key, earnedAt: now, earnedOnDay: today, seenAt: null });
  }
  return earned;
}
