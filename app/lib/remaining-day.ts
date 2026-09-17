/**
 * The REST OF THE DAY as one value: what is still open in today's targets
 * after what has already been eaten, and which nutrients the next meal should
 * lean on (M233/03).
 *
 * The pieces existed and nobody had put them together. `computeDayGaps`
 * (`#app/lib/macro-gaps`) knows the net-carb ceiling, the protein floor and the
 * fibre reference; `deriveFatTargetG` (`#app/lib/day-budget-rows`) knows fat as
 * the remainder of the energy budget; the eating style knows which lens the day
 * is graded by. What was missing is the one answer a recipe proposal needs: how
 * much of each target is left, how much of it belongs to THIS meal, and what
 * the meal should therefore be made of. A protein-heavy breakfast has to be
 * followed by a lunch that leans somewhere else, and nothing in the app could
 * say that.
 *
 * Nothing here re-derives a target. Every figure below comes out of the module
 * that already owns it, so a change to the protein floor or to the fat rule
 * reaches the recipe prompt without a second edit. The one number this module
 * adds on its own is `share`, the slice of what is left that the next meal is
 * expected to cover.
 *
 * Pure and provider free: no store, no i18n, no clock. The slot and the number
 * of slots left are computed by the caller (`mealTypeForTime` in
 * `#app/lib/meal-time`), so every rule below is pinned by a plain unit test.
 *
 * `describeRemainingDayForPrompt` is the one string producer, and it is written
 * for a MODEL, never for a person. It is deliberately English-only: the answer's
 * language is carried as a code inside the block, so the model writes the recipe
 * in the person's language while reading its instructions in one fixed one.
 */
import { deriveFatTargetG } from '#app/lib/day-budget-rows';
import type { EatingStyleLens } from '#app/lib/eating-style';
import { effectiveEatingStyle, lensForStyle } from '#app/lib/eating-style';
import type { LocalProfileGoals } from '#app/lib/local-store/schema';
import type { DayGapTotals, MacroGap, Translate } from '#app/lib/macro-gaps';
import { computeDayGaps } from '#app/lib/macro-gaps';
import { EU_PROTEIN_REFERENCE_INTAKE_G } from '#app/models/body-metrics';
import type { MealType } from '#types/enums';

/**
 * Share of the net-carb ceiling below which the remaining headroom is too small
 * to spend on a carb-led meal, so the next meal is asked to lean low carb.
 * Under 40 percent of the day's carbs left is, in practice, one portion of
 * anything starchy and nothing else for the rest of the day.
 */
export const LOW_CARB_EMPHASIS_MAX_REMAINING_FRACTION = 0.4;

/**
 * Share of the calorie target below which the rest of the day has to be light.
 * A quarter of the day's energy left means the next meal is small whatever else
 * is true of it.
 */
export const LIGHT_EMPHASIS_MAX_REMAINING_FRACTION = 0.25;

/**
 * How far a floor has to be behind the day's energy pace before the next meal is
 * asked to lean on it. Fifteen points of the target, so a floor that is merely
 * keeping step with the calories never wins: leaning on a nutrient that is
 * already on track only crowds out the one that is not.
 */
export const BEHIND_THE_DAY_MIN_FRACTION_LEAD = 0.15;

/**
 * Share of the protein floor that must still be open for protein to stay in the
 * emphasis at all. Under a fifth of the floor left, the person has essentially
 * met it, and a lunch proposal built around protein after a protein-heavy
 * breakfast is exactly the repetition this module exists to prevent.
 */
export const PROTEIN_EMPHASIS_MIN_REMAINING_FRACTION = 0.2;

/**
 * The protein floor used when the person set none.
 *
 * The food-labelling reference intake, the same last resort
 * `computeReferenceProteinFloor` falls back to for somebody who has given
 * neither a weigh-in nor a height. A recipe proposal has to put SOME protein
 * figure in front of the model, and borrowing the app's published figure is the
 * only honest way to do it; the row is tagged `'default'`, never `'goal'`, so no
 * caller can mistake it for something the person chose.
 */
export const DEFAULT_PROTEIN_FLOOR_G = EU_PROTEIN_REFERENCE_INTAKE_G;

/** Where a remaining row's target came from. `'derived'` is fat, computed off the other three. */
export type RemainingSource = 'goal' | 'default' | 'derived';

/** One nutrient's state for the rest of the day. `remaining` is floored at 0: a day past a target has nothing left, not a negative budget. */
export interface Remaining {
  target: number;
  consumed: number;
  remaining: number;
  source: RemainingSource;
}

/** What the next meal should lean on. `balanced` is a real answer, not a missing one. */
export type Emphasis = 'protein' | 'fiber' | 'lowCarb' | 'light' | 'balanced';

/** The day's totals this module reads. `kcal` and `fatG` are nullable because a day of uncomputable entries has neither. */
export interface RemainingDayTotals extends DayGapTotals {
  kcal: number | null;
  fatG: number | null;
}

export interface RemainingDayInput {
  totals: RemainingDayTotals;
  /** The stored profile, or `null` for an account that has none yet. */
  goals: LocalProfileGoals | null;
  /** The slot the next meal belongs to. */
  slot: MealType;
  /**
   * Main slots not yet eaten today, from `slot` onward: breakfast, lunch,
   * dinner. A snack is not a slot the day's budget is divided by, so it never
   * counts. Clamped to at least 1 below, since dividing what is left by zero
   * meals is not a plan.
   */
  slotsLeft: number;
}

export interface RemainingDay {
  /** Null when the person set no calorie target. */
  kcal: Remaining | null;
  /** Always present: the person's floor, or the labelling reference (see `DEFAULT_PROTEIN_FLOOR_G`). */
  protein: Remaining;
  /** Null when the person set no net-carb ceiling. */
  netCarbs: Remaining | null;
  /** Null unless all three of kcal, carbs and protein are set (see `deriveFatTargetG`). */
  fat: Remaining | null;
  /** Always present: the published fibre reference. */
  fiber: Remaining;
  /**
   * The slot the figures were computed for, carried through from the input.
   *
   * Not in the spec's field list, and added deliberately:
   * `describeRemainingDayForPrompt` takes only the day and has to name the meal
   * the model is cooking for, so the slot has to travel with the numbers rather
   * than beside them.
   */
  slot: MealType;
  /** The slice of what is left this meal is expected to cover, `1 / slotsLeft`. */
  share: number;
  /** What the next meal should lean on, in rule order. Never empty. */
  emphasis: Emphasis[];
  /** The lens of the account's eating style, so a caller can weight the proposal the way the day is graded. */
  lens: EatingStyleLens;
}

/**
 * The translator `computeDayGaps` needs. This module never renders a label, so
 * the key is its own answer: passing the real catalog in would make a pure
 * selector depend on i18n for strings nobody reads.
 */
const labelKey: Translate = (key) => key;

/** The two sources a targeted gap row can have. `'none'` is impossible here, since a null target is filtered out first. */
function gapSource(gap: MacroGap): RemainingSource {
  return gap.targetSource === 'goal' ? 'goal' : 'default';
}

/** A gap row as a `Remaining`, or `null` when the row has no target to be remaining against. */
function remainingFromGap(gap: MacroGap): Remaining | null {
  if (gap.target === null || gap.remainingG === null) return null;
  return {
    target: gap.target,
    consumed: gap.consumed,
    remaining: Math.max(0, gap.remainingG),
    source: gapSource(gap),
  };
}

/**
 * The same, for the two floors that always have a target: protein falls back to
 * `DEFAULT_PROTEIN_FLOOR_G` and fibre to `DEFAULT_FIBER_REFERENCE_G`, so a null
 * here would mean `computeDayGaps` stopped honouring a reference it was handed.
 * That is a broken invariant, not a case to render, so it throws.
 */
function requireRemaining(gap: MacroGap): Remaining {
  const row = remainingFromGap(gap);
  if (row === null) throw new Error(`The ${gap.key} floor lost its reference target`);
  return row;
}

/** A `Remaining` built from a plain target and a plain intake, for the two figures no gap row covers. */
function remainingFromTarget({
  target,
  consumed,
  source,
}: {
  target: number | null;
  consumed: number;
  source: RemainingSource;
}): Remaining | null {
  if (target === null || target <= 0) return null;
  return { target, consumed, remaining: Math.max(0, target - consumed), source };
}

/** Share of a target still open, 0..1. Null when there is nothing positive to divide against. */
function openFraction(row: Remaining | null): number | null {
  if (row === null || row.target <= 0) return null;
  return Math.min(1, Math.max(0, row.remaining / row.target));
}

/**
 * Whether a floor is behind the day's energy pace by more than the lead.
 *
 * With no calorie target there is no pace to be behind, so the floor stands on
 * its own and the lead is measured against zero: a floor with more than 15
 * percent of itself still open is the day's most useful instruction when
 * nothing else is being tracked.
 */
function isBehindTheDay({ floorOpen, kcalOpen }: { floorOpen: number | null; kcalOpen: number | null }): boolean {
  if (floorOpen === null) return false;
  return floorOpen > (kcalOpen ?? 0) + BEHIND_THE_DAY_MIN_FRACTION_LEAD;
}

/**
 * What the next meal should lean on, in the order the rules are read.
 *
 * Every rule is a statement about what is LEFT, never about what was eaten, so
 * the same day seen from a later slot gives a different answer without any
 * memory of the earlier one. Protein carries the extra guard: a floor that is
 * all but met is dropped from the list even when the arithmetic would keep it,
 * which is the whole "heavy breakfast, lighter lunch" behaviour.
 */
function selectEmphasis({
  kcal,
  protein,
  netCarbs,
  fiber,
  lens,
}: {
  kcal: Remaining | null;
  protein: Remaining;
  netCarbs: Remaining | null;
  fiber: Remaining;
  lens: EatingStyleLens;
}): Emphasis[] {
  const emphasis: Emphasis[] = [];
  const kcalOpen = openFraction(kcal);
  const carbsOpen = openFraction(netCarbs);
  const proteinOpen = openFraction(protein);
  const fiberOpen = openFraction(fiber);

  if (lens === 'carb' && carbsOpen !== null && carbsOpen < LOW_CARB_EMPHASIS_MAX_REMAINING_FRACTION) {
    emphasis.push('lowCarb');
  }
  if (kcalOpen !== null && kcalOpen < LIGHT_EMPHASIS_MAX_REMAINING_FRACTION) {
    emphasis.push('light');
  }
  if (
    proteinOpen !== null &&
    proteinOpen >= PROTEIN_EMPHASIS_MIN_REMAINING_FRACTION &&
    isBehindTheDay({ floorOpen: proteinOpen, kcalOpen })
  ) {
    emphasis.push('protein');
  }
  if (isBehindTheDay({ floorOpen: fiberOpen, kcalOpen })) {
    emphasis.push('fiber');
  }
  if (emphasis.length === 0) emphasis.push('balanced');
  return emphasis;
}

/**
 * The rest of the day, as one value.
 *
 * @param input - the day's totals so far, the stored profile, the next slot and how many main slots are left.
 * @returns every open target, the share this meal should cover, the emphasis and the day's lens.
 */
export function computeRemainingDay({ totals, goals, slot, slotsLeft }: RemainingDayInput): RemainingDay {
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: {
      netCarbsCeiling: goals?.goalNetCarbsCeilingG ?? null,
      proteinFloor: goals?.goalProteinFloorG ?? null,
      proteinReferenceG: DEFAULT_PROTEIN_FLOOR_G,
    },
    t: labelKey,
  });

  const kcal = remainingFromTarget({
    target: goals?.goalKcalTarget ?? null,
    consumed: totals.kcal ?? 0,
    source: 'goal',
  });
  const netCarbs = remainingFromGap(gaps.netCarbs);
  const protein = requireRemaining(gaps.protein);
  const fiber = requireRemaining(gaps.fiber);

  const fat = remainingFromTarget({
    target: deriveFatTargetG({
      kcalTarget: goals?.goalKcalTarget ?? null,
      netCarbsCeilingG: goals?.goalNetCarbsCeilingG ?? null,
      proteinFloorG: goals?.goalProteinFloorG ?? null,
    }),
    consumed: totals.fatG ?? 0,
    source: 'derived',
  });

  const lens = lensForStyle(
    effectiveEatingStyle({
      goalNetCarbsCeilingG: goals?.goalNetCarbsCeilingG ?? null,
      goalKcalTarget: goals?.goalKcalTarget ?? null,
      goalProteinFloorG: goals?.goalProteinFloorG ?? null,
      eatingStyle: goals?.eatingStyle ?? null,
    }),
  );

  return {
    kcal,
    protein,
    netCarbs,
    fat,
    fiber,
    slot,
    share: 1 / Math.max(1, slotsLeft),
    emphasis: selectEmphasis({ kcal, protein, netCarbs, fiber, lens }),
    lens,
  };
}

/** The nutrient rows of the prompt block, in reading order, with the unit each is measured in. */
const PROMPT_ROWS = [
  { label: 'Calories', unit: 'kcal', pick: (day: RemainingDay): Remaining | null => day.kcal },
  { label: 'Net carbs', unit: 'g', pick: (day: RemainingDay): Remaining | null => day.netCarbs },
  { label: 'Protein', unit: 'g', pick: (day: RemainingDay): Remaining | null => day.protein },
  { label: 'Fat', unit: 'g', pick: (day: RemainingDay): Remaining | null => day.fat },
  { label: 'Fiber', unit: 'g', pick: (day: RemainingDay): Remaining | null => day.fiber },
] as const;

/** Whole units everywhere in the block: a model reading "19.37 g of protein left" gains nothing from the decimals. */
function whole(value: number): number {
  return Math.round(value);
}

/**
 * The rest of the day as a compact English block for a model.
 *
 * Never user-facing, so nothing here goes through i18n. The person's language
 * travels as a CODE on its own line, which is what the model writes its answer
 * in; the instructions it reads stay in one language so a prompt regression can
 * only ever have one cause.
 *
 * @param day - the computed rest of the day.
 * @param language - the language code the answer must be written in.
 * @returns one line per nutrient plus the slot, the share and the emphasis.
 */
export function describeRemainingDayForPrompt(day: RemainingDay, language: string): string {
  const lines = [
    'Rest of the day, remaining against the targets already set.',
    `Meal slot: ${day.slot}`,
    `Share of what is left for this meal: ${Math.round(day.share * 100)}%`,
    `Emphasis: ${day.emphasis.join(', ')}`,
    `Eating style lens: ${day.lens}`,
    `Answer language code: ${language}`,
  ];
  for (const row of PROMPT_ROWS) {
    const value = row.pick(day);
    lines.push(
      value === null ?
        `${row.label}: no target`
      : `${row.label}: target ${whole(value.target)} ${row.unit}, consumed ${whole(value.consumed)} ${row.unit}, remaining ${whole(value.remaining)} ${row.unit} (${value.source})`,
    );
  }
  return lines.join('\n');
}
