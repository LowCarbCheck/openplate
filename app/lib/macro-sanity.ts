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
export type MacroSanityCode = 'single-macro-over-100' | 'macro-sum-over-100' | 'kcal-macro-mismatch';

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
