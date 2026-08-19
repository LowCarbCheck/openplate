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
 *    targets that appear without the user setting them are the two DOCUMENTED
 *    references below, and every gap carries a `targetSource` so the UI can
 *    say plainly which one it's using.
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

/**
 * The i18next `t` shape this module needs. Declared locally (see the module
 * doc) — structurally identical to the one the other diary modules declare.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/**
 * Reference net-carb ceiling used for the carb-impact tier when the user has
 * set no goal of their own. 50 g is not invented for this module: it is the
 * "Low-carb" preset openplate's own onboarding offers
 * (`#app/lib/onboarding`'s `CARB_PRESETS`), and the most widely used
 * definition of a low-carb day. It NEVER becomes a displayed target — see
 * `computeDayGaps`, where the carb gap row stays target-less without a real
 * goal — it only gives a goal-less novice a big-picture verdict instead of a
 * bare number.
 */
export const DEFAULT_NET_CARB_REFERENCE_G = 50;

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
  /** The reference the verdict was measured against. */
  referenceG: number;
  /** Whether that reference is the user's own goal or `DEFAULT_NET_CARB_REFERENCE_G`. */
  referenceSource: 'goal' | 'default';
  /** Share of the reference consumed, clamped to 0..1. Null when the reference is non-positive. */
  fraction: number | null;
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
 * The day's qualitative carb verdict, measured against the user's ceiling when
 * they have one and `DEFAULT_NET_CARB_REFERENCE_G` when they don't.
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
 * @returns the tier, its label, and the reference it was measured against.
 */
export function computeCarbImpact({
  netCarbs,
  ceiling,
  t,
}: {
  netCarbs: number;
  ceiling: number | null;
  t: Translate;
}): CarbImpact {
  const hasGoal = ceiling !== null && ceiling > 0;
  const referenceG = hasGoal ? ceiling : DEFAULT_NET_CARB_REFERENCE_G;
  const referenceSource = hasGoal ? 'goal' : 'default';
  const fraction = referenceG > 0 ? Math.min(1, Math.max(0, netCarbs / referenceG)) : null;
  const isOver = referenceG > 0 && netCarbs > referenceG;

  const level: CarbImpactLevel =
    fraction === null ? 'high'
    : isOver ? 'high'
    : fraction <= LOW_IMPACT_MAX_FRACTION ? 'low'
    : fraction <= MODERATE_IMPACT_MAX_FRACTION ? 'moderate'
    : 'high';

  return { level, label: t(CARB_IMPACT_LABEL_KEY[level]), referenceG, referenceSource, fraction, isOver };
}

/** Which of the three tracked targets a gap row describes. */
export type MacroGapKey = 'netCarbs' | 'protein' | 'fiber';

/** A ceiling is stayed under; a floor is reached. The two read and color differently. */
export type MacroGapKind = 'ceiling' | 'floor';

/** Where a gap's target came from — never guess, always say. */
export type MacroGapTargetSource = 'goal' | 'default' | 'none';

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
}: {
  key: MacroGapKey;
  label: string;
  kind: MacroGapKind;
  consumed: number;
  target: number | null;
  targetSource: MacroGapTargetSource;
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
  /** The hero's qualitative verdict. */
  impact: CarbImpact;
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
 *   in their mouth. (The impact chip still uses the 50 g reference — a
 *   qualitative verdict is a much smaller claim than a displayed target, and
 *   the chip's `referenceSource` says which it used.)
 * - **Protein** likewise takes a target only from the user's floor: protein
 *   needs vary far too much with body mass and goal for a default to be honest.
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
  const protein = buildGap({
    key: 'protein',
    label: t('diary.macros.protein'),
    kind: 'floor',
    consumed: totals.protein,
    target: goals.proteinFloor,
    targetSource: goals.proteinFloor === null ? 'none' : 'goal',
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
