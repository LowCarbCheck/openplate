/**
 * Days for the Overview hero cards.
 *
 * A scenario is the INPUT the dashboard's hero is built from: the day's totals,
 * the goals, how many entries the day holds, and the main goal that leads. It is
 * not a pre-built `HeroLead`. The section runs it through the real builders
 * (`computeDayGaps`, `buildDayBudgetRows`, `buildHeroLead`), so every string and
 * every fraction on a card is the app's own.
 *
 * The types are the builders' own input types.
 */
import type { DayBudgetGoals, DayBudgetTotals } from '#app/lib/day-budget-rows';
import type { DayGapGoals } from '#app/lib/macro-gaps';
import type { MainGoalId } from '#app/lib/main-goal';

/** The goals the hero reads, as the dashboard's loader hands them to `TodayHeroCard`. */
export type HeroGoals = DayGapGoals & Pick<DayBudgetGoals, 'kcalTarget'>;

export interface HeroScenario {
  /** Which metric leads the hero. */
  mainGoal: MainGoalId;
  /** How many entries the day holds. Zero is the untouched day. */
  entryCount: number;
  totals: DayBudgetTotals;
  goals: HeroGoals;
}

/** A day with nothing logged. */
const NOTHING_EATEN: DayBudgetTotals = { netCarbs: 0, kcal: 0, protein: 0, fat: 0, fiber: 0, hasEstimates: false };

/** A day part of the way through every budget. */
const PARTWAY_EATEN: DayBudgetTotals = { netCarbs: 24.1, kcal: 1240, protein: 52, fat: 48, fiber: 11, hasEstimates: false };

/** All three goals set, the way a person who filled in the targets page has them. */
const ALL_GOALS: HeroGoals = {
  netCarbsCeiling: 50,
  kcalTarget: 1950,
  proteinFloor: 90,
  proteinReferenceG: null,
  proteinReferenceMissingDate: null,
};

const PARTWAY_ENTRIES = 4;

// ── Net carbs leads ──────────────────────────────────────────────────────────

export const NET_CARBS_ZERO: HeroScenario = {
  mainGoal: 'net-carbs',
  entryCount: 0,
  totals: NOTHING_EATEN,
  goals: ALL_GOALS,
};

export const NET_CARBS_PARTWAY: HeroScenario = {
  mainGoal: 'net-carbs',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: ALL_GOALS,
};

/** Past the 50 g limit by 12.4 g. The lead and the ledger go amber. */
export const NET_CARBS_OVER: HeroScenario = {
  mainGoal: 'net-carbs',
  entryCount: 6,
  totals: { ...PARTWAY_EATEN, netCarbs: 62.4 },
  goals: ALL_GOALS,
};

/** The day holds an AI estimate, so budget figures wear the "~" hedge. */
export const NET_CARBS_ESTIMATES: HeroScenario = {
  mainGoal: 'net-carbs',
  entryCount: PARTWAY_ENTRIES,
  totals: { ...PARTWAY_EATEN, hasEstimates: true },
  goals: ALL_GOALS,
};

/** No ceiling set: what was eaten, and no meter. */
export const NET_CARBS_NO_LIMIT: HeroScenario = {
  mainGoal: 'net-carbs',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: { ...ALL_GOALS, netCarbsCeiling: null },
};

// ── Calories leads ───────────────────────────────────────────────────────────

export const CALORIES_ZERO: HeroScenario = {
  mainGoal: 'calories',
  entryCount: 0,
  totals: NOTHING_EATEN,
  goals: ALL_GOALS,
};

export const CALORIES_PARTWAY: HeroScenario = {
  mainGoal: 'calories',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: ALL_GOALS,
};

/** 155 kcal past the 1,950 target. */
export const CALORIES_OVER: HeroScenario = {
  mainGoal: 'calories',
  entryCount: 7,
  totals: { ...PARTWAY_EATEN, kcal: 2105 },
  goals: ALL_GOALS,
};

/** Calories lead but no calorie target is set: the day's figure, and no meter. */
export const CALORIES_NO_TARGET: HeroScenario = {
  mainGoal: 'calories',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: { ...ALL_GOALS, kcalTarget: null },
};

// ── Protein leads ────────────────────────────────────────────────────────────

export const PROTEIN_ZERO: HeroScenario = {
  mainGoal: 'protein',
  entryCount: 0,
  totals: NOTHING_EATEN,
  goals: ALL_GOALS,
};

export const PROTEIN_PARTWAY: HeroScenario = {
  mainGoal: 'protein',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: ALL_GOALS,
};

/** 96 g against a 90 g floor: reached, so the figure is brand coloured and wears a check mark. */
export const PROTEIN_REACHED: HeroScenario = {
  mainGoal: 'protein',
  entryCount: 5,
  totals: { ...PARTWAY_EATEN, protein: 96 },
  goals: ALL_GOALS,
};

/** No floor typed in; the population reference (68 g) stands in and is labelled as one. */
export const PROTEIN_REFERENCE: HeroScenario = {
  mainGoal: 'protein',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: { ...ALL_GOALS, proteinFloor: null, proteinReferenceG: 68 },
};

/** The reference had to fall back for a missing due date, so the tag asks for it and links to the page. */
export const PROTEIN_REFERENCE_DATE_MISSING: HeroScenario = {
  mainGoal: 'protein',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: { ...ALL_GOALS, proteinFloor: null, proteinReferenceG: 68, proteinReferenceMissingDate: 'due-date' },
};

/** Neither a floor nor a reference: what was eaten, and no meter. */
export const PROTEIN_NO_TARGET: HeroScenario = {
  mainGoal: 'protein',
  entryCount: PARTWAY_ENTRIES,
  totals: PARTWAY_EATEN,
  goals: { ...ALL_GOALS, proteinFloor: null, proteinReferenceG: null },
};
