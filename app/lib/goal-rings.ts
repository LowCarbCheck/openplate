/**
 * Which daily goals a person is actually tracking, derived from the goal
 * VALUES alone (M200 spec 02).
 *
 * The stored `trackingFocus` is deliberately not read here. It can only ever
 * name one metric, and it was never the reason the second ring was missing:
 * the hero returned early on the carb branch, so a person with a carb ceiling
 * AND a calorie target only ever saw carbs. A number the person set is the
 * honest evidence that they track it, so that is what decides the rings.
 *
 * The direction is one-way on purpose. Nothing new is written to the device
 * store for this: `SCHEMA_VERSION` stays where it is, `TrackingFocusType`
 * keeps its three members, and `storedTrackingFocusFor` below is how a write
 * path reduces the derived truth back down to the one value an OLDER build on
 * another device still knows how to read.
 */
import type { TrackingFocusType } from '#types/enums';

/** A daily goal that draws its own ring. Protein is a floor, not a budget, and is not one of these. */
export type GoalRing = 'net-carbs' | 'calories';

/** The two daily targets, as they sit on the profile row: a number, or `null` for "not set". */
export interface GoalTargets {
  /** The daily net-carb ceiling in grams, or `null`. */
  netCarbsCeiling: number | null;
  /** The daily calorie target, or `null`. */
  kcalTarget: number | null;
}

/**
 * The rings to draw for a person with these targets, carbs first.
 *
 * A target that is `null`, zero or negative contributes nothing: a ring drawn
 * against a non-positive budget would be a fabricated goal, and the arc would
 * be a division by zero. That is the same "never invent a target" rule
 * `#app/lib/macro-gaps` and the hero already hold.
 *
 * Carbs lead because net carbs is openplate's tracked metric, and because a
 * stable order is what stops the two rings swapping places between renders.
 *
 * @param targets - the person's two daily targets.
 * @returns the visible rings, in display order; empty when neither target is set.
 */
export function selectGoalRings({ netCarbsCeiling, kcalTarget }: GoalTargets): GoalRing[] {
  const rings: GoalRing[] = [];
  if (netCarbsCeiling !== null && netCarbsCeiling > 0) rings.push('net-carbs');
  if (kcalTarget !== null && kcalTarget > 0) rings.push('calories');
  return rings;
}

/**
 * The `trackingFocus` to STORE for a set of visible rings.
 *
 * Both rings resolve to `'net-carbs'`, and that is the whole compatibility
 * story of this change. A profile row is written whole, so a device still on
 * an older build will read this value, render the carb hero it renders today,
 * and hand the same three-member enum back on its next save. Writing a fourth
 * value would have cost a schema bump and would still have been erased by that
 * older device the next time somebody edited their height on it.
 *
 * No ring means no daily number, which is exactly what `'habit'` has always
 * meant, so the stored focus and the derived rings can never disagree.
 *
 * @param rings - the rings `selectGoalRings` derived.
 * @returns the focus value to persist on the profile row.
 */
export function storedTrackingFocusFor(rings: readonly GoalRing[]): TrackingFocusType {
  if (rings.includes('net-carbs')) return 'net-carbs';
  if (rings.includes('calories')) return 'calories';
  return 'habit';
}
