/**
 * The diary day's BUDGET ROWS: one row per tracked metric, replacing the two
 * ring gauges the hero used to draw.
 *
 * A ring answers "how much is left?" with a shape, and it can only carry one
 * metric per circle. Five metrics therefore cost five circles, and a phone has
 * room for two. A row costs about 40 px, says the same thing in words, and
 * stacks: net carbs, calories, protein, fat and fiber all fit in less height
 * than the two rings they replace. Colour is never the message here, every row
 * is named, and the swatch and the meter are the only coloured parts.
 *
 * Nothing is computed twice. The two BUDGET metrics (net carbs, calories) keep
 * their existing remaining-first framings from `#app/components/hero-stat`,
 * and the two FLOOR metrics (protein, fiber) keep theirs from
 * `#app/lib/macro-gaps`. Fat is a third kind of its own: nobody sets a fat
 * target and there is no population default to borrow (unlike fiber's), so by
 * default it is the day's absolute gram figure with no meter, the same shape
 * net carbs takes when there is no ceiling.
 *
 * It gets ONE exception, and only when the person's own numbers already
 * contain the answer. On a low-carb day fat is what is left of the energy
 * budget once carbs and protein are paid for, so a person who has set all
 * three of a kcal target, a net-carb ceiling and a protein floor has already
 * said what their fat figure is: `(kcal - 4*carbs - 4*protein) / 9`. That is
 * arithmetic on their targets, not a target invented for them, and it is
 * labelled `targetSource: 'derived'` so the row can say where it came from.
 * Any of the three missing, or a result under ten grams, and the absolute
 * shape stands: a two-gram "budget" is a rounding artefact, not a budget.
 * This module only decides which rows exist, in what order, and how their two
 * lines of text read.
 *
 * The rules the two sources already hold apply unchanged:
 *
 * 1. **Never fabricate a target.** No ceiling means the net-carb row shows the
 *    day's absolute figure with no meter and no progress text; no calorie
 *    target means there is no calorie row at all (`selectGoalRings` decides).
 * 2. **Never a NaN.** A row's `fraction` is null whenever there is nothing
 *    positive to divide against.
 * 3. **Over is amber and factual, once per cause.** `tone` is the only colour
 *    instruction this module gives, and it never reaches for a destructive
 *    tone. The derived fat row is the one row that stays plain past its
 *    reference: that reference is the energy the calorie row already guards,
 *    so colouring both would report one overshoot twice. Its words still say
 *    "over".
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
import type { DayGaps, MacroGap, MacroGapTargetSource, MissingReferenceDate } from '#app/lib/macro-gaps';

/** Which metric a row describes. The array order below is the display order. */
export type DayBudgetRowKey = 'netCarbs' | 'calories' | 'protein' | 'fat' | 'fiber';

/**
 * Where a row's target came from.
 *
 * `MacroGapTargetSource`'s three answers plus one this module alone can give:
 * `'derived'`, a figure computed from the person's own targets rather than
 * read off one of them. Kept local rather than pushed into `macro-gaps`, since
 * no gap can ever be derived, only a row can.
 */
export type DayBudgetTargetSource = MacroGapTargetSource | 'derived';

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
  targetSource: DayBudgetTargetSource;
  /** True when this row's reference used its no-date fallback (see `MacroGap.referenceDateMissing`). */
  referenceDateMissing: boolean;
  /**
   * Which date the row should ask for, or `null` when it has nothing to ask.
   *
   * The COPY concern beside `referenceDateMissing`'s computation concern: the gap
   * decides whether a fallback happened, this decides whether the tag says "due
   * date" or "birth date". Always `null` while `referenceDateMissing` is false.
   */
  missingReferenceDate: MissingReferenceDate | null;
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
  fat: number;
  fiber: number;
  /** True when the day's figures include AI estimates, which hedges the two budget headlines with a leading "~". */
  hasEstimates: boolean;
}

/**
 * The daily budgets a row set needs.
 *
 * The protein and fiber ROWS still read their targets off `DayGaps`, never off
 * this, so there is no second source of truth for what protein's floor means.
 * `proteinFloor` is here for one unrelated job: it is a term in the fat row's
 * energy arithmetic (see `deriveFatReferenceG`). A caller that omits it gets
 * the absolute fat row, which is the same answer as a person who never set a
 * floor.
 */
export interface DayBudgetGoals {
  netCarbsCeiling: number | null;
  /** The protein floor in grams, as the person typed it in, or `null`. Only read by the fat row's derivation. */
  proteinFloor?: number | null;
  /**
   * The calorie target as it is DISPLAYED and compared against. A caller for a
   * pregnant or breastfeeding person has already added the EFSA energy addition
   * (`computeReferenceKcalAddition`) to the figure the person typed in; the raw
   * one they typed is untouched in storage.
   */
  kcalTarget: number | null;
  /**
   * Which date would make the protein reference follow the person's actual
   * stage, or `null`. Only read for the row whose gap reports
   * `referenceDateMissing`, so passing it for somebody with a due date on file
   * changes nothing.
   */
  missingReferenceDate?: MissingReferenceDate | null;
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
    // A budget row's target is a figure the person typed in, so no reference and
    // no fallback can apply to it.
    referenceDateMissing: false,
    missingReferenceDate: null,
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
  missingReferenceDate,
  t,
  language,
}: {
  key: 'protein' | 'fiber';
  gap: MacroGap;
  /** The caller's date subject; kept only when this gap actually fell back. */
  missingReferenceDate: MissingReferenceDate | null;
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
    referenceDateMissing: gap.referenceDateMissing,
    missingReferenceDate: gap.referenceDateMissing ? missingReferenceDate : null,
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

/** Atwater energy factors, in kilocalories per gram, for the fat derivation below. */
const KCAL_PER_GRAM_CARB = 4;
const KCAL_PER_GRAM_PROTEIN = 4;
const KCAL_PER_GRAM_FAT = 9;

/**
 * The smallest derived fat reference worth drawing a meter against.
 *
 * Below this the three targets are barely consistent with each other, and the
 * remainder is a rounding artefact of somebody else's arithmetic rather than a
 * budget anyone set. The row falls back to its absolute shape, which says
 * nothing false.
 */
const DERIVED_FAT_MINIMUM_G = 10;

/**
 * Fat as the remainder of the energy budget, in whole grams, or `null` when
 * the person's targets do not contain the answer.
 *
 * Requires ALL THREE inputs. Two of them would mean guessing the third, which
 * is the one thing this module never does.
 *
 * @param goals - the day's budgets.
 * @returns the derived reference in grams, or `null` to keep the absolute row.
 */
function deriveFatReferenceG(goals: DayBudgetGoals): number | null {
  const proteinFloor = goals.proteinFloor ?? null;
  if (goals.kcalTarget === null || goals.netCarbsCeiling === null || proteinFloor === null) return null;
  const fatKcal =
    goals.kcalTarget - KCAL_PER_GRAM_CARB * goals.netCarbsCeiling - KCAL_PER_GRAM_PROTEIN * proteinFloor;
  const grams = Math.round(fatKcal / KCAL_PER_GRAM_FAT);
  return grams >= DERIVED_FAT_MINIMUM_G ? grams : null;
}

/**
 * The fat row's absolute shape: the day's gram figure with no meter and no
 * over/under framing, the same shape net carbs takes when the person has set
 * no ceiling. Reuses that shape's own template (`diary.budget.grams`) rather
 * than inventing a second "N g" wording.
 */
function absoluteFatRow({
  totals,
  t,
  language,
}: {
  totals: DayBudgetTotals;
  t: Translate;
  language: string | null | undefined;
}): DayBudgetRow {
  const label = t('diary.macros.fat');
  const headline = t('diary.budget.grams', { value: formatMacroNumberIn(language, totals.fat) });
  return {
    key: 'fat',
    label,
    headline,
    headlineNumeric: null,
    headlineMode: null,
    tone: 'default',
    progressText: null,
    fraction: null,
    consumed: totals.fat,
    target: null,
    targetSource: 'none',
    referenceDateMissing: false,
    missingReferenceDate: null,
    srLabel: t('diary.budget.srRowNoTarget', { label, status: headline }),
  };
}

/**
 * The fat row against a reference derived from the person's own targets: a
 * meter and a remaining-first headline, read exactly as the calorie row is.
 *
 * Its tone stays `'default'` in both states, and that is deliberate. The
 * reference IS the energy left over once carbs and protein are paid for, so
 * eating past it is the same event as eating past the calorie target, and the
 * calorie row already turns amber for it. Two amber rows for one cause reads
 * as two problems. The words still say it: the headline is "{{value}} g over"
 * and the meter is full. There is no "met" state either, because a reference
 * is not a floor to reach.
 *
 * It still does not animate. `AnimatedHeadlines` names two fields, net carbs
 * and calories, so "fat is tweening" is a state the diary cannot express, and
 * a `headlineMode` here would invite `formatBudgetHeadline` to render frames
 * nothing ever asks for.
 *
 * @param totals - the day's figures.
 * @param referenceG - the derived reference in whole grams, already vetted by `deriveFatReferenceG`.
 * @param t - the caller's translator.
 * @param language - the active UI language.
 * @returns the fat row.
 */
function referencedFatRow({
  totals,
  referenceG,
  t,
  language,
}: {
  totals: DayBudgetTotals;
  referenceG: number;
  t: Translate;
  language: string | null | undefined;
}): DayBudgetRow {
  const label = t('diary.macros.fat');
  const consumedText = formatMacroNumberIn(language, totals.fat);
  // Compared at the precision the row DISPLAYS, one decimal, so a day can
  // never read "0 g over" beside a meter that looks full. The same reason
  // `carbStat` compares through its shared rounding one module away.
  const isOver = Math.round(totals.fat * 10) > referenceG * 10;
  const difference = isOver ? totals.fat - referenceG : Math.max(0, referenceG - totals.fat);
  const headline = t(isOver ? 'diary.budget.gramsOver' : 'diary.budget.gramsLeft', {
    value: formatMacroNumberIn(language, difference),
  });
  return {
    key: 'fat',
    label,
    headline,
    headlineNumeric: null,
    headlineMode: null,
    // Never 'over': see this function's doc. The calorie row carries that warning.
    tone: 'default',
    progressText: t('diary.budget.progressGrams', { consumed: consumedText, target: referenceG }),
    fraction: budgetFraction(totals.fat, referenceG),
    consumed: totals.fat,
    target: referenceG,
    targetSource: 'derived',
    referenceDateMissing: false,
    missingReferenceDate: null,
    srLabel: t('diary.budget.srRowGrams', {
      label,
      consumed: consumedText,
      target: referenceG,
      status: headline,
    }),
  };
}

/**
 * The fat row, in whichever of its two shapes the person's targets earn. See
 * the module doc for why the derivation exists and why it needs all three
 * inputs.
 */
function fatRow({
  totals,
  goals,
  t,
  language,
}: {
  totals: DayBudgetTotals;
  goals: DayBudgetGoals;
  t: Translate;
  language: string | null | undefined;
}): DayBudgetRow {
  const referenceG = deriveFatReferenceG(goals);
  if (referenceG === null) return absoluteFatRow({ totals, t, language });
  return referencedFatRow({ totals, referenceG, t, language });
}

/**
 * The day's budget rows, in display order: net carbs, calories, protein, fat,
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
 * @returns three to five rows, in display order.
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

  const missingReferenceDate = goals.missingReferenceDate ?? null;
  rows.push(
    floorRow({ key: 'protein', gap: gaps.protein, missingReferenceDate, t, language }),
    fatRow({ totals, goals, t, language }),
    floorRow({ key: 'fiber', gap: gaps.fiber, missingReferenceDate, t, language }),
  );
  return rows;
}
