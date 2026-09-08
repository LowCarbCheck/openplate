/**
 * The diary day's BUDGET ROWS: one row per tracked metric, replacing the two
 * ring gauges the hero used to draw.
 *
 * A ring answers "how much is left?" with a shape, and it can only carry one
 * metric per circle. Four metrics therefore cost four circles, and a phone has
 * room for two. A row costs about 40 px, says the same thing in words, and
 * stacks: net carbs, calories, protein and fiber all fit in less height than
 * the two rings they replace. Colour is never the message here, every row is
 * named, and the swatch and the meter are the only coloured parts.
 *
 * Nothing is computed twice. The two BUDGET metrics (net carbs, calories) keep
 * their existing remaining-first framings from `#app/components/hero-stat`,
 * and the two FLOOR metrics (protein, fiber) keep theirs from
 * `#app/lib/macro-gaps`. This module only decides which rows exist, in what
 * order, and how their two lines of text read.
 *
 * The rules the two sources already hold apply unchanged:
 *
 * 1. **Never fabricate a target.** No ceiling means the net-carb row shows the
 *    day's absolute figure with no meter and no progress text; no calorie
 *    target means there is no calorie row at all (`selectGoalRings` decides).
 * 2. **Never a NaN.** A row's `fraction` is null whenever there is nothing
 *    positive to divide against.
 * 3. **Over is amber and factual.** `tone` is the only colour instruction this
 *    module gives, and it never reaches for a destructive tone.
 *
 * Pure and provider free, like the two modules it composes: the translator and
 * the language come in as parameters, so every string below is pinned by a
 * unit test rather than by a screenshot.
 */
import { formatHeroStats, formatHeroValue } from '#app/components/hero-stat';
import type { HeroStat, HeroStatMode, Translate } from '#app/components/hero-stat';
import { selectGoalRings } from '#app/lib/goal-rings';
import { formatMacroNumberIn } from '#app/lib/format-macro-number';
import { describeGap } from '#app/lib/macro-gaps';
import type { DayGaps, MacroGap, MacroGapTargetSource } from '#app/lib/macro-gaps';

/** Which metric a row describes. The array order below is the display order. */
export type DayBudgetRowKey = 'netCarbs' | 'calories' | 'protein' | 'fiber';

/** How a row is painted: amber past a ceiling, brand once a floor is reached, plain otherwise. */
export type DayBudgetRowTone = 'default' | 'over' | 'met';

export interface DayBudgetRow {
  key: DayBudgetRowKey;
  /** The metric's name, from the shared macro catalog. */
  label: string;
  /** The big line: "24.9 g left", "12 g over", "Reached", "12 g to go", or the absolute "42.1 g". */
  headline: string;
  /**
   * The raw figure the headline renders, for the two budget rows the diary
   * tweens with `useCountUp`. Null on the floor rows, which do not animate.
   */
  headlineNumeric: number | null;
  /** The framing the headline was formatted in, so a tweened figure can be re-formatted identically. Null when it does not animate. */
  headlineMode: HeroStatMode | null;
  tone: DayBudgetRowTone;
  /** The meter's caption: "25.1 of 50 g", "899 of 1800". Null when there is no target. */
  progressText: string | null;
  /** Consumed over target, clamped to 0..1. Null when there is no (or a non-positive) target. */
  fraction: number | null;
  /** The raw, unclamped figures behind the meter, as the visually hidden `progress` element reports them. */
  consumed: number;
  target: number | null;
  targetSource: MacroGapTargetSource;
  /** A whole sentence for assistive tech. */
  srLabel: string;
}

/**
 * Tweened headlines for the two rows that can animate, keyed by metric.
 *
 * Declared as two named fields rather than a partial map: a floor row has no
 * single figure to count toward, so "protein is animating" is a state that
 * must not be expressible.
 */
export interface AnimatedHeadlines {
  netCarbs: string | null;
  calories: string | null;
}

/** The day totals a row set is built from. A structural subset of `DaySummary`, so a test can pass a plain object. */
export interface DayBudgetTotals {
  netCarbs: number;
  kcal: number;
  protein: number;
  fiber: number;
  /** True when the day's figures include AI estimates, which hedges the two budget headlines with a leading "~". */
  hasEstimates: boolean;
}

/**
 * The two daily budgets. Protein's floor is deliberately absent: the protein
 * and fiber rows read their targets off `DayGaps`, and a second copy of the
 * same number here would be a second source of truth for it.
 */
export interface DayBudgetGoals {
  netCarbsCeiling: number | null;
  kcalTarget: number | null;
}

export interface DayBudgetRowsInput {
  totals: DayBudgetTotals;
  goals: DayBudgetGoals;
  /** The day's gaps, already computed by the caller for the impact chip. */
  gaps: DayGaps;
  /** The caller's translator. Passed in, never imported, so this stays pure. */
  t: Translate;
  /** Active UI language, for the decimal separator. Passed in for the same reason. */
  language: string | null | undefined;
}

/** The headline template per framing. The wording lives in `diary.budget.*`; only the mapping lives here. */
const HEADLINE_KEY = {
  'carbs-remaining': 'diary.budget.gramsLeft',
  'carbs-over': 'diary.budget.gramsOver',
  'kcal-remaining': 'diary.budget.left',
  'kcal-over': 'diary.budget.over',
  'carbs-absolute': 'diary.budget.grams',
} satisfies Record<HeroStatMode, string>;

/**
 * The headline for a budget row, formatted from a (possibly mid-tween) figure.
 *
 * Exported so the diary's count-up can re-render intermediate values through
 * exactly the same rounding, hedging and template as the settled one. An
 * animation that formats differently from its own destination visibly snaps on
 * its last frame.
 *
 * @param row - the row being animated; a row with no `headlineMode` returns its settled headline unchanged.
 * @param numericValue - the figure to render this frame.
 * @param hasEstimates - whether to prefix the "~" estimate hedge.
 * @param language - the active UI language.
 * @param t - the caller's translator.
 * @returns the headline string to paint.
 */
export function formatBudgetHeadline({
  row,
  numericValue,
  hasEstimates,
  language,
  t,
}: {
  row: DayBudgetRow;
  numericValue: number;
  hasEstimates: boolean;
  language: string | null | undefined;
  t: Translate;
}): string {
  const mode = row.headlineMode;
  if (mode === null) return row.headline;
  return t(HEADLINE_KEY[mode], { value: formatHeroValue({ numericValue, mode, hasEstimates, language }) });
}

/** Clamped 0..1 share of a budget, or null when there is nothing positive to divide against. */
function budgetFraction(consumed: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.min(1, Math.max(0, consumed / target));
}

/**
 * One of the two budget rows, built from the hero framing that already owns
 * its wording. Grams keep the app's one-decimal rounding and calories are
 * whole, on both lines of the row. A headline of "24.9 g left" beside a
 * progress text of "25 of 50 g" is the arithmetic mismatch `roundGrams` exists
 * to prevent one module away.
 */
function budgetRow({
  key,
  stat,
  consumed,
  target,
  t,
  language,
}: {
  key: 'netCarbs' | 'calories';
  stat: HeroStat;
  consumed: number;
  target: number | null;
  t: Translate;
  language: string | null | undefined;
}): DayBudgetRow {
  const isGrams = key === 'netCarbs';
  const consumedText = isGrams ? formatMacroNumberIn(language, consumed) : String(Math.round(consumed));
  return {
    key,
    label: t(isGrams ? 'diary.macros.netCarbs' : 'diary.budget.calories'),
    headline: t(HEADLINE_KEY[stat.mode], { value: stat.value }),
    headlineNumeric: stat.numericValue,
    headlineMode: stat.mode,
    tone: stat.isOver ? 'over' : 'default',
    progressText:
      target === null ? null : (
        t(isGrams ? 'diary.budget.progressGrams' : 'diary.budget.progress', {
          consumed: consumedText,
          target: Math.round(target),
        })
      ),
    fraction: budgetFraction(consumed, target),
    consumed,
    target,
    targetSource: target === null ? 'none' : 'goal',
    srLabel: stat.srLabel,
  };
}

/**
 * One of the two floor rows, built from the gap that already owns its wording.
 *
 * Both lines round to whole grams, because `describeGap` does: "12 g to go"
 * beside "12.6 of 25 g" invites the reader to check the subtraction and find
 * it wrong.
 */
function floorRow({
  key,
  gap,
  t,
  language,
}: {
  key: 'protein' | 'fiber';
  gap: MacroGap;
  t: Translate;
  language: string | null | undefined;
}): DayBudgetRow {
  const formatGrams = (value: number): string => formatMacroNumberIn(language, value);
  const headline = describeGap(gap, formatGrams, t);
  const consumed = Math.round(gap.consumed);
  return {
    key,
    label: gap.label,
    headline,
    headlineNumeric: null,
    headlineMode: null,
    tone: gap.isMet ? 'met' : 'default',
    progressText:
      gap.target === null ? null : t('diary.budget.progressGrams', { consumed, target: Math.round(gap.target) }),
    fraction: gap.fraction,
    consumed: gap.consumed,
    target: gap.target,
    targetSource: gap.targetSource,
    srLabel:
      gap.target === null ?
        t('diary.budget.srRowNoTarget', { label: gap.label, status: headline })
      : t('diary.budget.srRowGrams', {
          label: gap.label,
          consumed,
          target: Math.round(gap.target),
          status: headline,
        }),
  };
}

/**
 * The day's budget rows, in display order: net carbs, calories, protein,
 * fiber.
 *
 * Net carbs is always present. With a ceiling it is a budget, without one it
 * is the day's absolute figure and no meter is drawn. Calories appear only
 * when the person set a calorie target, which is `selectGoalRings`' decision
 * and not this module's; a caller with no target shows the absolute calorie
 * figure in the "What you ate" block instead.
 *
 * Each budget row asks `formatHeroStats` for ONE framing by hiding the other
 * goal from it. That is what guarantees the net-carb row gets a carb framing
 * even for someone who tracks calories only, where the shared entry point
 * would hand back the calorie stat.
 *
 * @param input - the day's totals, the two budgets, the day's gaps, and the caller's translator.
 * @returns two to four rows, in display order.
 */
export function buildDayBudgetRows({ totals, goals, gaps, t, language }: DayBudgetRowsInput): DayBudgetRow[] {
  const heroInput = {
    netCarbs: totals.netCarbs,
    kcal: totals.kcal,
    hasEstimates: totals.hasEstimates,
    netCarbsCeiling: goals.netCarbsCeiling,
    kcalTarget: goals.kcalTarget,
    t,
    language,
  };
  const rings = selectGoalRings(goals);
  const hasCeiling = rings.includes('net-carbs');

  const carbStat = formatHeroStats({ ...heroInput, kcalTarget: null })[0];
  const rows: DayBudgetRow[] = [
    budgetRow({
      key: 'netCarbs',
      stat: carbStat,
      consumed: totals.netCarbs,
      target: hasCeiling ? goals.netCarbsCeiling : null,
      t,
      language,
    }),
  ];

  if (rings.includes('calories')) {
    rows.push(
      budgetRow({
        key: 'calories',
        stat: formatHeroStats({ ...heroInput, netCarbsCeiling: null })[0],
        consumed: totals.kcal,
        target: goals.kcalTarget,
        t,
        language,
      }),
    );
  }

  rows.push(
    floorRow({ key: 'protein', gap: gaps.protein, t, language }),
    floorRow({ key: 'fiber', gap: gaps.fiber, t, language }),
  );
  return rows;
}
