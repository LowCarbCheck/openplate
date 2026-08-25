/**
 * Pure per-100g macro plausibility checks for the scan confirm step. The AI
 * (and occasionally a curated source) can return numbers that are internally
 * inconsistent — a single macro above 100 g/100 g, macros summing past a whole
 * 100 g, or a calorie count that doesn't match its own macros. This module
 * surfaces those as non-blocking, human-readable notes so the user can
 * double-check before logging; it never blocks a submit and never mutates data.
 *
 * Side-effect-free — unit-tested without React, a DB, or the network. The
 * thresholds and tolerances live only here.
 */
import type { Macros } from './macros';
import { formatMacroNumberIn } from './format-macro-number';

/** A single macro (or their sum) above this many grams per 100 g is impossible. */
const MAX_SINGLE_MACRO_PER_100G = 100;
/** Carbs + protein + fat above this leaves no room for water/ash — flag it. */
const MAX_MACRO_SUM_PER_100G = 105;
/** kcal must be within this fraction of the macro-derived estimate to pass. */
const KCAL_RELATIVE_TOLERANCE = 0.2;
/** …and within this absolute kcal gap, so tiny foods don't trip on rounding. */
const KCAL_ABSOLUTE_TOLERANCE = 30;
const KCAL_PER_GRAM_CARB = 4;
const KCAL_PER_GRAM_PROTEIN = 4;
const KCAL_PER_GRAM_FAT = 9;

/** Discriminates which plausibility rule a given issue came from. */
export type MacroSanityCode =
  'single-macro-over-100' | 'macro-sum-over-100' | 'kcal-macro-mismatch' | 'label-columns-disagree';

/** One plausibility problem found in a per-100g macro set, with display copy. */
export interface MacroSanityIssue {
  code: MacroSanityCode;
  message: string;
}

/**
 * The translator this module needs, taken as a parameter rather than imported.
 * A pure module must not reach for the i18next singleton: on the server that
 * singleton is shared by every concurrent request (see `I18nProvider`), so a
 * module-level `t` would render one visitor's language into another's markup.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** The gram-denominated macros checked by the single-macro and sum rules (kcal is energy, not grams). */
const GRAM_MACROS: ReadonlyArray<{ key: keyof Macros; labelKey: string }> = [
  { key: 'carbs', labelKey: 'scan.review.sanity.macro.carbs' },
  { key: 'fiber', labelKey: 'scan.review.sanity.macro.fiber' },
  { key: 'sugars', labelKey: 'scan.review.sanity.macro.sugars' },
  { key: 'polyols', labelKey: 'scan.review.sanity.macro.polyols' },
  { key: 'protein', labelKey: 'scan.review.sanity.macro.protein' },
  { key: 'fat', labelKey: 'scan.review.sanity.macro.fat' },
];

/** Flags any single gram-macro that reads above 100 g per 100 g of food. */
function _collectSingleMacroIssues(per100g: Macros, t: Translate, language: string | null | undefined): MacroSanityIssue[] {
  const issues: MacroSanityIssue[] = [];
  for (const { key, labelKey } of GRAM_MACROS) {
    const value = per100g[key];
    if (value === null || value <= MAX_SINGLE_MACRO_PER_100G) continue;
    issues.push({
      code: 'single-macro-over-100',
      message: t('scan.review.sanity.singleMacroOver100', {
        label: t(labelKey),
        value: formatMacroNumberIn(language, value),
      }),
    });
  }
  return issues;
}

/** Flags carbs + protein + fat summing past a whole 100 g (with a little slack). */
function _collectMacroSumIssue(per100g: Macros, t: Translate, language: string | null | undefined): MacroSanityIssue | null {
  const sum = (per100g.carbs ?? 0) + (per100g.protein ?? 0) + (per100g.fat ?? 0);
  if (sum <= MAX_MACRO_SUM_PER_100G) return null;
  return {
    code: 'macro-sum-over-100',
    message: t('scan.review.sanity.macroSumOver100', { sum: formatMacroNumberIn(language, sum) }),
  };
}

/** Flags a stated kcal that diverges too far from 4·carbs + 4·protein + 9·fat. */
function _collectKcalMismatchIssue(per100g: Macros, t: Translate, language: string | null | undefined): MacroSanityIssue | null {
  const statedKcal = per100g.kcal;
  const hasAnyMacro = per100g.carbs !== null || per100g.protein !== null || per100g.fat !== null;
  if (statedKcal === null || !hasAnyMacro) return null;
  const computedKcal =
    KCAL_PER_GRAM_CARB * (per100g.carbs ?? 0) +
    KCAL_PER_GRAM_PROTEIN * (per100g.protein ?? 0) +
    KCAL_PER_GRAM_FAT * (per100g.fat ?? 0);
  const deviation = Math.abs(statedKcal - computedKcal);
  const reference = Math.max(statedKcal, computedKcal);
  if (deviation <= KCAL_ABSOLUTE_TOLERANCE || deviation / reference <= KCAL_RELATIVE_TOLERANCE) return null;
  return {
    code: 'kcal-macro-mismatch',
    message: t('scan.review.sanity.kcalMismatch', {
      stated: formatMacroNumberIn(language, statedKcal),
      computed: formatMacroNumberIn(language, computedKcal),
    }),
  };
}

/**
 * A printed per-100g figure and the same figure derived from the printed
 * per-serving column may differ this much (relative) before it counts as a
 * disagreement. Panels round both columns independently — "35 g serving,
 * 14.7 g carbs" and "42 g/100 g" don't reconcile exactly and shouldn't.
 */
const LABEL_COLUMN_RELATIVE_TOLERANCE = 0.15;
/** …and a small absolute floor, so a 0.4 g vs 0.6 g rounding gap isn't a "misread". */
const LABEL_COLUMN_ABSOLUTE_TOLERANCE = 1;
/** kcal are a bigger number on the same basis, so they get their own absolute floor. */
const LABEL_COLUMN_KCAL_ABSOLUTE_TOLERANCE = 25;

/** Every macro compared by the two-column cross-check, with the label used to name a disagreement. */
const CROSS_CHECKED_MACROS: ReadonlyArray<{ key: keyof Macros; labelKey: string }> = [
  ...GRAM_MACROS,
  { key: 'kcal', labelKey: 'scan.review.sanity.macro.kcal' },
];

/** Whether two figures for the SAME macro, on the same basis, are close enough to be the same reading. */
function _isWithinLabelColumnTolerance(key: keyof Macros, printed: number, converted: number): boolean {
  const deviation = Math.abs(printed - converted);
  const absoluteFloor = key === 'kcal' ? LABEL_COLUMN_KCAL_ABSOLUTE_TOLERANCE : LABEL_COLUMN_ABSOLUTE_TOLERANCE;
  if (deviation <= absoluteFloor) return true;
  const reference = Math.max(Math.abs(printed), Math.abs(converted));
  if (reference === 0) return true;
  return deviation / reference <= LABEL_COLUMN_RELATIVE_TOLERANCE;
}

/**
 * Cross-checks a nutrition panel's TWO printed columns against each other
 * (M123/10): the per-100g column as printed, versus the per-serving column
 * converted to the same basis. They describe the same product, so they must
 * agree — a disagreement means one of them was misread, and a misread digit is
 * the failure mode of reading small print off a curved, glossy package.
 *
 * It lives here, in the same module and the same `MacroSanityIssue`
 * vocabulary as the kcal 4/4/9 rule, precisely so the confirm step has ONE set
 * of plausibility notes rather than a second, label-only warning language.
 *
 * Returns null when the two columns agree, when only one column was printed
 * (nothing to cross-check), or when no macro appears in both.
 *
 * @param columns.printedPer100g - the panel's own per-100g column.
 * @param columns.convertedPer100g - the per-serving column converted to per 100 g.
 * @param t - translator for the issue copy (see `Translate`).
 * @param language - active UI language, for the figures inside the copy.
 * @returns the disagreement, or null.
 */
export function checkLabelColumnAgreement(
  columns: { printedPer100g: Macros; convertedPer100g: Macros },
  t: Translate,
  language: string | null | undefined,
): MacroSanityIssue | null {
  const { printedPer100g, convertedPer100g } = columns;
  for (const { key, labelKey } of CROSS_CHECKED_MACROS) {
    const printed = printedPer100g[key];
    const converted = convertedPer100g[key];
    if (printed === null || converted === null) continue;
    if (_isWithinLabelColumnTolerance(key, printed, converted)) continue;
    return {
      code: 'label-columns-disagree',
      message: t('scan.review.sanity.labelColumnsDisagree', {
        label: t(labelKey),
        printed: formatMacroNumberIn(language, printed),
        converted: formatMacroNumberIn(language, converted),
      }),
    };
  }
  return null;
}

/**
 * Runs every plausibility rule against a per-100g macro set.
 *
 * @param per100g - the food's per-100g macros (unknown fields are `null`).
 * @param t - translator for the issue copy (see `Translate`).
 * @param language - active UI language, so the figures inside the copy carry
 *   that language's decimal separator (passed in for the same reason `t` is).
 * @returns the list of issues found; an empty array means the numbers look sane.
 */
export function checkMacroSanity(
  per100g: Macros,
  t: Translate,
  language: string | null | undefined,
): MacroSanityIssue[] {
  const issues = _collectSingleMacroIssues(per100g, t, language);
  const sumIssue = _collectMacroSumIssue(per100g, t, language);
  if (sumIssue) issues.push(sumIssue);
  const kcalIssue = _collectKcalMismatchIssue(per100g, t, language);
  if (kcalIssue) issues.push(kcalIssue);
  return issues;
}
