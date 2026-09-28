/**
 * Pure gap arithmetic for the diary's novice-first hero and its day
 * drill-down (M129/06).
 *
 * The hero used to hand a novice four raw macro figures and leave them to work
 * out what any of it meant. This module produces the two things that replace
 * it — a QUALITATIVE carb-impact verdict for the hero, and a per-target GAP
 * list ("54 g protein to go") for the drill-down — from the day's totals plus
 * whatever goals the user has actually set.
 *
 * Three rules hold everywhere below:
 *
 * 1. **Never fabricate a target.** A user with no protein goal has no protein
 *    gap — the drill-down shows their absolute intake and stops. The only
 *    targets that appear without the user setting them are the DOCUMENTED
 *    fiber reference below and the protein reference the caller passes in, and
 *    every gap carries a `targetSource` so the UI can say plainly which one
 *    it's using. There is no carb reference: a day is graded on net carbs only
 *    against a ceiling the person actually set (M210).
 * 2. **Never NaN, never Infinity.** A zero or negative target can't be divided
 *    against; those paths return a null fraction rather than a broken number.
 * 3. **Ceilings and floors are different shapes.** Net carbs is a CEILING
 *    (remaining = headroom left, going over is amber and never a failure);
 *    protein and fiber are FLOORS (remaining = still to go, reaching it is the
 *    win). One `MacroGap` type carries both, discriminated by `kind`.
 *
 * Not modelled here: real glycemic load. That needs a per-food glycemic index
 * openplate's catalog does not carry, so the qualitative carb-impact tier
 * below is the v1 stand-in — it answers the same "was this a big carb day?"
 * question from data we actually have.
 *
 * Every label this module produces is translated through a `t` the CALLER
 * passes in (M129/05). The i18n singleton is deliberately not imported: this
 * module's whole value is that its arithmetic and its wording can both be
 * driven from a test with nothing else in scope.
 */
import type { EatingStyleLens } from '#app/lib/eating-style';

/**
 * The i18next `t` shape this module needs. Declared locally (see the module
 * doc) — structurally identical to the one the other diary modules declare.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Reference daily fiber intake. openplate has no fiber goal field, so this
 * reference is the only target the fiber row ever has, and it is always tagged
 * `'default'` in the UI. 25 g is the Institute of Medicine's Adequate Intake
 * for adult women — the conservative low end of the 25–38 g adult range — and
 * is a target a low-carb day plausibly reaches, unlike the 38 g male figure.
 */
export const DEFAULT_FIBER_REFERENCE_G = 25;

/** Share of the reference at or below which a day reads as low carb impact. */
const LOW_IMPACT_MAX_FRACTION = 0.5;
/** Share of the reference at or below which a day reads as moderate carb impact. */
const MODERATE_IMPACT_MAX_FRACTION = 0.85;

/** Qualitative verdict on the day's carb load — the hero's one-glance signal. */
export type CarbImpactLevel = 'low' | 'moderate' | 'high';

export interface CarbImpact {
  level: CarbImpactLevel;
  /** Short label for the chip — "Low carb impact" etc. Never a percentage, never a grade. */
  label: string;
  /** The ceiling the verdict was measured against. Always the person's own goal. */
  referenceG: number;
  /** Share of the ceiling consumed, clamped to 0..1. Never null: a verdict without a usable ceiling is no verdict at all. */
  fraction: number;
  /** True once the day's net carbs pass the reference. `level` is always `'high'` when this is set. */
  isOver: boolean;
}

/** Catalog key per tier. The wording lives in `diary.impact.*`; only the mapping lives here. */
const CARB_IMPACT_LABEL_KEY = {
  low: 'diary.impact.low',
  moderate: 'diary.impact.moderate',
  high: 'diary.impact.high',
} satisfies Record<CarbImpactLevel, string>;

/**
 * The day's qualitative carb verdict, measured against the user's own ceiling.
 *
 * Null without a usable ceiling, and that is the whole M210 change: this
 * module used to measure a goal-less day against a hidden 50 g reference, so a
 * person who had set no carb goal still read a carb grade against a number
 * they had never seen. A day is graded on net carbs only for someone whose
 * eating style says carbs are the point, and such a style always carries a
 * ceiling by construction (`#app/lib/eating-style`).
 *
 * The tiers are deliberately generous at the bottom and unhedged at the top:
 * half a day's carbs or less is "low", up to 85% is "moderate", and the last
 * 15% — plus everything past the reference — is "high". A user who is at 90%
 * of their goal has genuinely had a high-carb day even though they are still
 * under; pretending otherwise would make the chip useless exactly where it
 * matters. None of the three labels is a judgement: "high carb impact" is a
 * description of the food, never of the person.
 *
 * @param netCarbs - the day's net carbs in grams.
 * @param ceiling - the user's net-carb ceiling, or null when unset.
 * @param t - the caller's translator (see the module doc).
 * @returns the tier, its label, and the ceiling it was measured against, or null with no usable ceiling.
 */
export function computeCarbImpact({
  netCarbs,
  ceiling,
  t,
}: {
  netCarbs: number;
  ceiling: number | null;
  t: Translate;
}): CarbImpact | null {
  if (ceiling === null || ceiling <= 0) return null;
  const fraction = Math.min(1, Math.max(0, netCarbs / ceiling));
  const isOver = netCarbs > ceiling;

  const level: CarbImpactLevel =
    isOver ? 'high'
    : fraction <= LOW_IMPACT_MAX_FRACTION ? 'low'
    : fraction <= MODERATE_IMPACT_MAX_FRACTION ? 'moderate'
    : 'high';

  return { level, label: t(CARB_IMPACT_LABEL_KEY[level]), referenceG: ceiling, fraction, isOver };
}

/** Which of the three tracked targets a gap row describes. */
export type MacroGapKey = 'netCarbs' | 'protein' | 'fiber';

/** A ceiling is stayed under; a floor is reached. The two read and color differently. */
export type MacroGapKind = 'ceiling' | 'floor';

/** Where a gap's target came from — never guess, always say. */
export type MacroGapTargetSource = 'goal' | 'default' | 'none';

/**
 * Which date is missing when a reference had to fall back to the largest figure
 * for a reproductive status: a pregnancy's due date, or a birth date for
 * breastfeeding.
 *
 * Named per date rather than per status because the UI's job is to ask for the
 * one thing that would fix the figure, and "add your due date" is a different
 * request from "add the birth date".
 */
export type MissingReferenceDate = 'due-date' | 'birth-date';

export interface MacroGap {
  key: MacroGapKey;
  /** Human label — "Net carbs", "Protein", "Fiber". */
  label: string;
  kind: MacroGapKind;
  /** Grams consumed today. Always a real number, even with no target. */
  consumed: number;
  /** The target in grams, or null when there is none to compare against. */
  target: number | null;
  targetSource: MacroGapTargetSource;
  /**
   * Ceiling: grams of headroom left (0 once over — the overshoot lives in
   * `overByG`, so a bar fed from this never renders a negative width).
   * Floor: grams still needed (0 once met). Null with no target.
   */
  remainingG: number | null;
  /** Grams past a ceiling; always 0 for a floor and for a ceiling not yet exceeded. */
  overByG: number;
  /** Share of the target consumed, clamped 0..1. Null with no (or a non-positive) target. */
  fraction: number | null;
  /** Ceiling: still at or under it. Floor: reached it. False when there is no target to meet. */
  isMet: boolean;
  /** Ceiling only: past the target. Always false for a floor. */
  isOver: boolean;
  /**
   * True when this row's target is a reference that had to use its no-date
   * fallback: the person is pregnant or breastfeeding, but gave no due date or
   * birth date, so the largest figure for that status applied instead of the one
   * for the stage they are actually in.
   *
   * A separate fact from `targetSource`, deliberately. The source is still
   * `'default'` and the figure is still defensible; what the UI can now say is
   * that one date would make it exact.
   */
  referenceDateMissing: boolean;
}

/**
 * Rounds to whole grams before every met/over comparison, matching the
 * rounding the UI applies before it renders the figure — the same discipline
 * `#app/lib/goal-progress` enforces, and for the same reason: a verdict
 * decided on a raw value while the screen shows a rounded one produces "110 /
 * 110 g" next to "0.4 g to go".
 */
function roundGrams(value: number): number {
  return Math.round(value);
}

/** Clamped 0..1 share of a target, or null when the target can't be divided against. */
function targetFraction(consumed: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(1, Math.max(0, consumed / target));
}

/**
 * Builds one gap row. Kept private and shared by all three so a ceiling and a
 * floor can never drift into computing "remaining" two different ways.
 */
function buildGap({
  key,
  label,
  kind,
  consumed,
  target,
  targetSource,
  referenceDateMissing = false,
}: {
  key: MacroGapKey;
  label: string;
  kind: MacroGapKind;
  consumed: number;
  target: number | null;
  targetSource: MacroGapTargetSource;
  referenceDateMissing?: boolean;
}): MacroGap {
  if (target === null) {
    return {
      key,
      label,
      kind,
      consumed,
      target: null,
      targetSource: 'none',
      remainingG: null,
      overByG: 0,
      fraction: null,
      isMet: false,
      isOver: false,
      // No target means no reference was used, so there is no fallback to report.
      referenceDateMissing: false,
    };
  }

  const roundedConsumed = roundGrams(consumed);
  const roundedTarget = roundGrams(target);

  if (kind === 'ceiling') {
    const isOver = roundedConsumed > roundedTarget;
    return {
      key,
      label,
      kind,
      consumed,
      target,
      targetSource,
      remainingG: Math.max(0, target - consumed),
      overByG: isOver ? consumed - target : 0,
      fraction: targetFraction(consumed, target),
      isMet: !isOver,
      isOver,
      referenceDateMissing,
    };
  }

  const isMet = roundedConsumed >= roundedTarget;
  return {
    key,
    label,
    kind,
    consumed,
    target,
    targetSource,
    remainingG: isMet ? 0 : target - consumed,
    overByG: 0,
    fraction: targetFraction(consumed, target),
    isMet,
    isOver: false,
    referenceDateMissing,
  };
}

/** The nutrients a suggestion can be asked to close a gap in — the two floors. */
export type GapNutrient = 'protein' | 'fiber';

export interface DominantGap {
  nutrient: GapNutrient;
  /** Grams still needed. Always > 0 — a met floor is never dominant. */
  remainingG: number;
  /** Share of the target still missing, 0..1 — the basis on which this gap won. */
  shortfallFraction: number;
}

export interface DayGaps {
  /** The hero's qualitative carb verdict, or null when the person set no ceiling. */
  impact: CarbImpact | null;
  /** The three rows the drill-down renders, in display order. */
  gaps: [MacroGap, MacroGap, MacroGap];
  netCarbs: MacroGap;
  protein: MacroGap;
  fiber: MacroGap;
  /**
   * Grams of net carbs a suggestion may spend, or null when the user has set
   * no ceiling (nothing to spend against — see `computeDayGaps`). Never
   * negative: a day already over its ceiling has 0 to spend, not -12.
   */
  carbHeadroomG: number | null;
  /**
   * The unmet floor with the largest RELATIVE shortfall — what suggestions
   * should try to close. Null when both floors are met or neither has a
   * target.
   */
  dominantGap: DominantGap | null;
}

/** The day totals this module needs — a structural subset of `DaySummary`, so it can be driven from a plain object in tests. */
export interface DayGapTotals {
  netCarbs: number;
  protein: number;
  fiber: number;
}

/** The goals this module reads — a structural subset of the diary's `goals`. */
export interface DayGapGoals {
  netCarbsCeiling: number | null;
  proteinFloor: number | null;
  /**
   * The population reference protein floor in grams, from
   * `computeReferenceProteinFloor`, used ONLY when `proteinFloor` is null.
   * Optional so a caller that has no body metrics to work from (a test, or a
   * surface that never reads the profile) keeps the older no-target behaviour
   * rather than inventing a figure.
   */
  proteinReferenceG?: number | null;
  /**
   * Which date the person would have to add for `proteinReferenceG` to follow
   * their actual stage, or `null` when nothing is missing.
   *
   * Set by the caller only when the status is `'pregnant'` or `'lactating'` AND
   * the matching date resolved to no stage, which is the one case where the
   * reference silently used the largest figure for that status. Optional, so a
   * caller with no body metrics keeps the older behaviour.
   */
  proteinReferenceMissingDate?: MissingReferenceDate | null;
}

/**
 * How much more a gap against the user's OWN target counts than one against a
 * default reference they never chose. A goal the user typed in is a statement
 * of intent; `DEFAULT_FIBER_REFERENCE_G` is a population average this app
 * supplied on their behalf, and the two should not compete as equals.
 *
 * A weight rather than a hard priority, deliberately. Hard priority would send
 * a user who is 2 g short of their protein goal a list of protein foods while
 * their fiber sat at 1 g of 25; ignoring the source entirely would let a
 * reference the user never set beat the one they did. 1.25 makes a personal
 * target win every close call while still yielding to a genuinely gaping
 * default gap.
 */
const GOAL_TARGET_PRIORITY_WEIGHT = 1.25;

/**
 * Picks the floor worth acting on. Compared by RELATIVE shortfall rather than
 * raw grams, because raw grams would let a 60 g protein gap beat a 24 g fiber
 * gap on a day where the user had 100 g of protein and 1 g of fiber — the
 * fiber gap is plainly the one that needs attention. A gap against the user's
 * own goal is then weighted up (see `GOAL_TARGET_PRIORITY_WEIGHT`). Protein
 * wins an exact tie: it's the more actionable of the two, since almost every
 * food carries protein in useful amounts while fiber is concentrated in few.
 */
function selectDominantGap(protein: MacroGap, fiber: MacroGap): DominantGap | null {
  const candidates: (DominantGap & { priority: number })[] = [];
  for (const [nutrient, gap] of [
    ['protein', protein],
    ['fiber', fiber],
  ] as const) {
    if (gap.target === null || gap.target <= 0 || gap.isMet) continue;
    const remainingG = gap.remainingG;
    if (remainingG === null || remainingG <= 0) continue;
    const shortfallFraction = Math.min(1, remainingG / gap.target);
    candidates.push({
      nutrient,
      remainingG,
      shortfallFraction,
      priority: shortfallFraction * (gap.targetSource === 'goal' ? GOAL_TARGET_PRIORITY_WEIGHT : 1),
    });
  }
  if (candidates.length === 0) return null;
  // Protein is first in `candidates`, so a strict `>` comparison leaves it
  // winning any exact tie.
  const winner = candidates.reduce((best, candidate) => (candidate.priority > best.priority ? candidate : best));
  return { nutrient: winner.nutrient, remainingG: winner.remainingG, shortfallFraction: winner.shortfallFraction };
}

/**
 * The whole gap view for a day.
 *
 * Target sourcing, deliberately asymmetric:
 * - **Net carbs** takes a target ONLY from the user's ceiling. A goal-less
 *   user sees their absolute net carbs with no target line, because inventing
 *   a "50 g limit" for someone who declined to set one would be putting words
 *   in their mouth. The impact chip is silent for the same person: since M210
 *   there is no carb reference to fall back on.
 * - **Protein** prefers the user's floor and falls back to
 *   `goals.proteinReferenceG`, tagged `'default'`, the population reference
 *   `computeReferenceProteinFloor` scales from the person's own weigh-in or
 *   height. Protein needs do vary with body mass, which is exactly why the
 *   reference is computed per person rather than being one flat number; a
 *   floor the user typed in still wins whenever there is one. When that
 *   reference had to use its no-date fallback for a pregnancy or for
 *   breastfeeding, the row also carries `referenceDateMissing`, so the UI can
 *   ask for the one date that would make the figure exact.
 * - **Fiber** always uses `DEFAULT_FIBER_REFERENCE_G`, tagged `'default'`,
 *   because there is no fiber goal field to read and the reference is a
 *   published population figure rather than a personal target.
 *
 * @param totals - the day's net carbs, protein, and fiber in grams.
 * @param goals - the user's ceiling/floor, either of which may be null.
 * @param t - the caller's translator (see the module doc).
 * @returns every gap row, the carb headroom, the dominant gap, and the impact tier.
 */
export function computeDayGaps({
  totals,
  goals,
  t,
}: {
  totals: DayGapTotals;
  goals: DayGapGoals;
  t: Translate;
}): DayGaps {
  const netCarbs = buildGap({
    key: 'netCarbs',
    label: t('diary.macros.netCarbs'),
    kind: 'ceiling',
    consumed: totals.netCarbs,
    target: goals.netCarbsCeiling,
    targetSource: goals.netCarbsCeiling === null ? 'none' : 'goal',
  });
  // `buildGap` re-tags a null target as `'none'`, so a caller that passes
  // neither a floor nor a reference keeps the untargeted protein row.
  const proteinTarget = goals.proteinFloor ?? goals.proteinReferenceG ?? null;
  // Only a reference that was actually USED can have fallen back: a floor the
  // person typed in owes nothing to a due date, and a row with no target at all
  // has no figure to qualify.
  const usesProteinReference = goals.proteinFloor === null && proteinTarget !== null;
  const protein = buildGap({
    key: 'protein',
    label: t('diary.macros.protein'),
    kind: 'floor',
    consumed: totals.protein,
    target: proteinTarget,
    targetSource: goals.proteinFloor !== null ? 'goal' : 'default',
    referenceDateMissing: usesProteinReference && (goals.proteinReferenceMissingDate ?? null) !== null,
  });
  const fiber = buildGap({
    key: 'fiber',
    label: t('diary.macros.fiber'),
    kind: 'floor',
    consumed: totals.fiber,
    target: DEFAULT_FIBER_REFERENCE_G,
    targetSource: 'default',
  });

  return {
    impact: computeCarbImpact({ netCarbs: totals.netCarbs, ceiling: goals.netCarbsCeiling, t }),
    gaps: [netCarbs, protein, fiber],
    netCarbs,
    protein,
    fiber,
    carbHeadroomG: netCarbs.remainingG,
    dominantGap: selectDominantGap(protein, fiber),
  };
}

/**
 * The gap row's sentence — "54 g to go", "12 g of headroom left", "Over by
 * 4 g", or the plain total when there's no target. Pure so the exact wording
 * is pinned by a test rather than by a screenshot.
 *
 * @param gap - the row to describe.
 * @param formatGrams - the app's shared gram formatter (injected so this module stays dependency-free).
 * @param t - the caller's translator, injected for the same reason.
 * @returns the phrase to render beside the row.
 */
export function describeGap(gap: MacroGap, formatGrams: (value: number) => string, t: Translate): string {
  // Whole grams throughout: this phrase sits directly beside a rounded
  // "36 / 110 g" reading, and "73.8 g to go" next to "36 / 110 g" is the same
  // inconsistency `roundGrams` exists to prevent one line further up. The
  // absolute total on a target-less row keeps its precision — nothing is
  // rounded next to it.
  if (gap.target === null) return t('diary.gap.logged', { value: formatGrams(gap.consumed) });
  if (gap.kind === 'ceiling') {
    if (gap.isOver) return t('diary.gap.overBy', { value: formatGrams(roundGrams(gap.overByG)) });
    return t('diary.gap.headroom', { value: formatGrams(roundGrams(gap.remainingG ?? 0)) });
  }
  if (gap.isMet) return t('diary.gap.reached');
  return t('diary.gap.toGo', { value: formatGrams(roundGrams(gap.remainingG ?? 0)) });
}


////////////////////////////////////////////////////////////////////////////////
// The day's one verdict, chosen by the eating style's lens (M210)
////////////////////////////////////////////////////////////////////////////////

/**
 * Share of the calorie target at which a day stops reading as comfortably
 * within it. Below 0.9 the person has room they can still plan around; from
 * 0.9 up the next meal is the one that decides the day.
 */
const KCAL_NEAR_MIN_FRACTION = 0.9;
/**
 * Share of the calorie target above which the day is over. Strictly above, so
 * a day that lands exactly on the target is "near", never "over": hitting the
 * number is the goal, and grading it as a miss would be absurd.
 */
const KCAL_OVER_MIN_FRACTION = 1;

/** The three calorie tiers, in the order they occur. */
export type KcalTier = 'within' | 'near' | 'over';

/** The two protein states. Reaching the floor is the win, so there is no "over". */
export type ProteinState = 'toGo' | 'met';

/** The carb lens's verdict: today's chip, unchanged. */
export interface CarbDayVerdict {
  lens: 'carb';
  impact: CarbImpact;
}

/** The kcal lens's verdict, against the target as DISPLAYED (any reproductive addition already applied by the caller). */
export interface KcalDayVerdict {
  lens: 'kcal';
  tier: KcalTier;
  consumed: number;
  target: number;
  /** Share of the target eaten, clamped 0..1, so a meter fed from this never overflows. */
  fraction: number;
  /** Calories left before the target, 0 once it is reached. */
  remainingKcal: number;
  /** Calories past the target, 0 while under it. */
  overByKcal: number;
}

/** The protein lens's verdict, against the person's floor. */
export interface ProteinDayVerdict {
  lens: 'protein';
  state: ProteinState;
  consumed: number;
  floor: number;
  /** Share of the floor eaten, clamped 0..1. */
  fraction: number;
  /** Grams still needed, 0 once met. */
  remainingG: number;
}

/** No verdict. A real answer for `just-track`, and the fallback whenever a lens has no number to grade against. */
export interface NoDayVerdict {
  lens: 'none';
}

/**
 * The day's single verdict. Discriminated by `lens`, so a caller cannot read a
 * calorie tier off a carb day, and the `none` arm has no figures at all.
 */
export type DayVerdict = CarbDayVerdict | KcalDayVerdict | ProteinDayVerdict | NoDayVerdict;

/** What `dayVerdict` needs. An options object because three of its four figures are plain numbers. */
export interface DayVerdictInput {
  /** The lens of the account's eating style (`lensForStyle` in `#app/lib/eating-style`). */
  lens: EatingStyleLens;
  /** The day's gaps, whose `impact` the carb lens renders. */
  gaps: DayGaps;
  kcal: {
    consumed: number;
    /** The target as displayed, or null when the person set none. */
    target: number | null;
  };
  protein: {
    consumed: number;
    /** The person's floor, or null. A reference is not a floor: see the doc below. */
    floor: number | null;
  };
}

/**
 * The one verdict a day is graded by, chosen by the account's lens.
 *
 * Exactly one grade per day, deliberately. Before M210 every day got a carb
 * verdict whether or not carbs were the point, which is how a person tracking
 * calories ended up reading a carb grade against a 50 g line nobody had shown
 * them. The style names what the person is doing, the lens falls out of the
 * style, and this function turns the lens into the single thing the card says.
 *
 * Every lens degrades to `none` rather than to a guess. A `kcal` lens with no
 * target and a `protein` lens with no floor cannot be graded, so they are not:
 * the budget rows below the chip still show the day, and no number is invented
 * to put a grade on it. The protein floor here is the person's OWN floor, not
 * the population reference the protein ROW may fall back to, for the same
 * reason: a verdict is a claim about their goal.
 *
 * @param input - the lens, the day's gaps, and the two figures the other two lenses grade.
 * @returns the verdict to render, or the `none` arm when there is nothing to grade.
 */
export function dayVerdict({ lens, gaps, kcal, protein }: DayVerdictInput): DayVerdict {
  if (lens === 'carb') {
    return gaps.impact === null ? { lens: 'none' } : { lens: 'carb', impact: gaps.impact };
  }

  if (lens === 'kcal') {
    const target = kcal.target;
    if (target === null || target <= 0) return { lens: 'none' };
    const ratio = kcal.consumed / target;
    const tier: KcalTier =
      ratio > KCAL_OVER_MIN_FRACTION ? 'over'
      : ratio >= KCAL_NEAR_MIN_FRACTION ? 'near'
      : 'within';
    return {
      lens: 'kcal',
      tier,
      consumed: kcal.consumed,
      target,
      fraction: Math.min(1, Math.max(0, ratio)),
      remainingKcal: Math.max(0, target - kcal.consumed),
      overByKcal: Math.max(0, kcal.consumed - target),
    };
  }

  if (lens === 'protein') {
    const floor = protein.floor;
    if (floor === null || floor <= 0) return { lens: 'none' };
    // Rounded on both sides before the comparison, so "110 of 110 g" and
    // "0.4 g to go" can never appear together (see `roundGrams`).
    const isMet = roundGrams(protein.consumed) >= roundGrams(floor);
    return {
      lens: 'protein',
      state: isMet ? 'met' : 'toGo',
      consumed: protein.consumed,
      floor,
      fraction: Math.min(1, Math.max(0, protein.consumed / floor)),
      remainingG: isMet ? 0 : floor - protein.consumed,
    };
  }

  return { lens: 'none' };
}
