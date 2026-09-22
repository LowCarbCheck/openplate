/**
 * The main goal: which one number the diary shows first (2026-09-23).
 *
 * The diary's day card leads with one large figure and lists the rest quietly
 * under it. Which figure leads is the person's call, and it is a separate call
 * from the eating style: someone on a low-carb style can still care most about
 * protein. So it is its own field, `LocalProfileGoals.mainGoal`, and this
 * module is the single reader of it.
 *
 * WHY A NEW FIELD AND NOT A FOURTH `trackingFocus` VALUE. `trackingFocus` is a
 * `z.enum` in `backup.ts`, and every sync blob is parsed through that same
 * schema on the receiving device. A value a 0.39.0 build has never heard of
 * would fail that parse, and the older device would refuse to sync at all. A
 * NEW optional key is different: `profileGoalsSchema` is a plain `z.object`,
 * so an older build drops the key it does not know and syncs on. The cost is
 * that such a device may write the profile back without the key, and the
 * choice is lost. The reader below then falls back to the default, which is a
 * sensible lead rather than a wrong one. `eatingStyle` and
 * `gamificationHidden` accepted the same risk.
 *
 * Pure and store free, like `#app/lib/eating-style`, so a plain unit test can
 * drive it.
 */
import { effectiveEatingStyle, lensForStyle, type EatingStyleGoals, type EatingStyleLens } from '#app/lib/eating-style';

/** The three main goals, in the order the settings card and the onboarding list them. */
export const MAIN_GOAL_IDS = ['net-carbs', 'calories', 'protein'] as const;

/** One of the three main goals. Stored verbatim in `LocalProfileGoals.mainGoal`. */
export type MainGoalId = (typeof MAIN_GOAL_IDS)[number];

/** The ids as a set, so the guard is a lookup rather than a scan. */
const MAIN_GOAL_ID_SET: ReadonlySet<string> = new Set<MainGoalId>(MAIN_GOAL_IDS);

/**
 * Narrows a stored or submitted string to a main goal.
 *
 * Needed because a stored field is only as trustworthy as the oldest build
 * that wrote it, and a form field is only as trustworthy as whoever posted it.
 *
 * @param value - the candidate, typically read off a stored profile.
 * @returns whether it is one of the three ids.
 */
export function isMainGoalId(value: string | null | undefined): value is MainGoalId {
  return value !== null && value !== undefined && MAIN_GOAL_ID_SET.has(value);
}

/**
 * The main goal a lens implies, for a person who never picked one.
 *
 * `none` (the `just-track` style) maps to net carbs, because that is the order
 * the card had before the main goal existed, and the app is about carbs first.
 *
 * @param lens - the eating style's lens.
 * @returns the main goal that lens reads as.
 */
export function mainGoalForLens(lens: EatingStyleLens): MainGoalId {
  if (lens === 'kcal') return 'calories';
  if (lens === 'protein') return 'protein';
  return 'net-carbs';
}

/** What `effectiveMainGoal` reads: the style inputs, plus the stored pick. */
export interface MainGoalProfile extends EatingStyleGoals {
  /** Absent on every profile written before the main goal existed. */
  mainGoal?: string | null;
}

/**
 * The main goal in effect: a valid stored pick wins, otherwise the one the
 * eating style's lens implies.
 *
 * The stored value is typed as a plain string on purpose. A profile that came
 * in through sync from a build with a longer list can carry a value this build
 * does not know, and it must fall back rather than lead with nothing.
 *
 * @param profile - the stored goal numbers, style and main goal, any of which may be absent.
 * @returns the main goal to lead the diary with.
 */
export function effectiveMainGoal(profile: MainGoalProfile): MainGoalId {
  if (isMainGoalId(profile.mainGoal)) return profile.mainGoal;
  return mainGoalForLens(effectiveEatingStyleLens(profile));
}

/** The lens of the style in effect, read through the same entry point every other screen uses. */
function effectiveEatingStyleLens(profile: MainGoalProfile): EatingStyleLens {
  const style = effectiveEatingStyle({
    goalNetCarbsCeilingG: profile.goalNetCarbsCeilingG,
    goalKcalTarget: profile.goalKcalTarget,
    goalProteinFloorG: profile.goalProteinFloorG,
    eatingStyle: profile.eatingStyle ?? null,
  });
  return lensForStyle(style);
}
