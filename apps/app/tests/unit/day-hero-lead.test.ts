/**
 * Unit tests for `#app/lib/day-hero-lead`, the wording of the Overview hero's
 * lead figure and of its ledger's status lines (layout F, 2026-10-11).
 *
 * What is pinned, and why each block has a CONTROL:
 *
 * 1. **The figure is the right number for the state.** What is LEFT under a
 *    limit, the excess over one, what is STILL NEEDED under a floor, what was
 *    EATEN once a floor is reached or when there is no target. Each claim sits
 *    next to the same fixture in the neighbouring state, so a lead that always
 *    printed the same number could not pass.
 * 2. **Nothing is computed twice.** The figure is the row's `gap.amount`. One
 *    test hands the function a row whose amount was changed after the builder
 *    ran and requires the lead to follow it.
 * 3. **Nothing is invented.** No target means no fraction (so no meter), the
 *    words "no limit set", and the day's plain amount.
 * 4. **Calories never read "calories".** The unit beside the figure names it.
 *
 * The strings are the SHIPPED English catalog's, read through i18next, so a
 * renamed key fails here and not on a user's screen. Where a string carries a
 * figure and its unit, the space between them is the app's no-break space
 * (`UNIT_SPACE`), written as ` ` below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import i18next from '../../app/i18n/i18n';
import { buildHeroLead, buildLedgerStatus, type HeroLead } from '../../app/lib/day-hero-lead';
import { buildDayBudgetRows, type DayBudgetRow, type DayBudgetRowKey } from '../../app/lib/day-budget-rows';
import { computeDayGaps } from '../../app/lib/macro-gaps';
import type { Translate } from '../../app/lib/macro-gaps';
import type { MainGoalId } from '../../app/lib/main-goal';

const t: Translate = (key, params) => i18next.t(key, params ?? {});

/** The day's five figures; every test overrides what it cares about. */
interface Day {
  netCarbs: number;
  kcal: number;
  protein: number;
  fat: number;
  fiber: number;
}

interface Goals {
  netCarbsCeiling: number | null;
  kcalTarget: number | null;
  proteinFloor: number | null;
  proteinReferenceG?: number | null;
}

const EMPTY_DAY: Day = { netCarbs: 0, kcal: 0, protein: 0, fat: 0, fiber: 0 };
const ALL_GOALS: Goals = { netCarbsCeiling: 100, kcalTarget: 1950, proteinFloor: 68 };

/** Builds the day's rows exactly as the dashboard does, main goal first. */
function buildRows({
  day,
  goals,
  mainGoal,
  hasEstimates = false,
  language = 'en',
}: {
  day: Partial<Day>;
  goals: Goals;
  mainGoal: MainGoalId;
  hasEstimates?: boolean;
  language?: string;
}): DayBudgetRow[] {
  const totals = { ...EMPTY_DAY, ...day };
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: {
      netCarbsCeiling: goals.netCarbsCeiling,
      proteinFloor: goals.proteinFloor,
      proteinReferenceG: goals.proteinReferenceG ?? null,
      proteinReferenceMissingDate: null,
    },
    t,
  });
  return buildDayBudgetRows({
    totals: { ...totals, hasEstimates },
    goals: {
      netCarbsCeiling: goals.netCarbsCeiling,
      kcalTarget: goals.kcalTarget,
      proteinFloor: goals.proteinFloor,
      missingReferenceDate: null,
    },
    gaps,
    t,
    language,
    mainGoal,
  });
}

/** The lead for a day: rows built with the main goal, the first row read. */
function leadFor({
  day,
  goals = ALL_GOALS,
  mainGoal,
  entryCount,
  hasEstimates = false,
  language = 'en',
}: {
  day: Partial<Day>;
  goals?: Goals;
  mainGoal: MainGoalId;
  entryCount: number;
  hasEstimates?: boolean;
  language?: string;
}): HeroLead {
  const [row] = buildRows({ day, goals, mainGoal, hasEstimates, language });
  if (row === undefined) throw new Error('the builder returned no rows');
  return buildHeroLead({ row, entryCount, hasEstimates, t, language });
}

function rowFor(rows: DayBudgetRow[], key: DayBudgetRowKey): DayBudgetRow {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined) throw new Error(`expected a "${key}" row`);
  return row;
}

const NBSP = ' ';

describe('a lead under a limit states what is LEFT', () => {
  it('reads "26 g net carbs left today" for 74 of 100 g, and the whole limit on an empty day', () => {
    const logged = leadFor({ day: { netCarbs: 74 }, mainGoal: 'net-carbs', entryCount: 5 });
    assert.equal(logged.metric, 'netCarbs');
    assert.equal(logged.figure, '26');
    assert.equal(logged.unit, 'g');
    assert.equal(logged.caption, 'net carbs left today');
    assert.equal(logged.tone, 'default');
    assert.equal(logged.fraction, 0.74);
    assert.equal(logged.scaleStart, `74${NBSP}g so far, 5 entries`);
    assert.equal(logged.scaleEnd, `limit 100${NBSP}g`);

    // CONTROL: the same limit with nothing logged is a different state, with a
    // different figure, caption and scale line. A lead that ignored the day
    // would print the same words for both.
    const empty = leadFor({ day: {}, mainGoal: 'net-carbs', entryCount: 0 });
    assert.equal(empty.figure, '100');
    assert.equal(empty.caption, 'net carbs to spend today');
    assert.equal(empty.fraction, 0);
    assert.equal(empty.scaleStart, 'Empty plate so far.', "the empty day reuses the dashboard's own line");
    assert.equal(empty.scaleEnd, `limit 100${NBSP}g`);
  });

  it('keeps the one decimal the net-carb row prints, and the singular for one entry', () => {
    const lead = leadFor({ day: { netCarbs: 74.4 }, mainGoal: 'net-carbs', entryCount: 1 });
    assert.equal(lead.figure, '25.6');
    assert.equal(lead.scaleStart, `74.4${NBSP}g so far, 1 entry`);
    // CONTROL: two entries take the plural, so the singular above was chosen.
    assert.equal(
      leadFor({ day: { netCarbs: 74.4 }, mainGoal: 'net-carbs', entryCount: 2 }).scaleStart,
      `74.4${NBSP}g so far, 2 entries`,
    );
  });

  it('at the limit exactly, says zero left, and is not over', () => {
    const lead = leadFor({ day: { netCarbs: 100 }, mainGoal: 'net-carbs', entryCount: 4 });
    assert.equal(lead.figure, '0');
    assert.equal(lead.caption, 'net carbs left today');
    assert.equal(lead.tone, 'default');
    assert.equal(lead.fraction, 1);
    // CONTROL: one gram more is over, in a different state.
    assert.equal(leadFor({ day: { netCarbs: 101 }, mainGoal: 'net-carbs', entryCount: 4 }).tone, 'over');
  });

  it('a sub-half-gram spill past the limit is still "not over", like the row says', () => {
    const lead = leadFor({ day: { netCarbs: 100.3 }, mainGoal: 'net-carbs', entryCount: 4 });
    assert.equal(lead.tone, 'default');
    assert.equal(lead.figure, '0');
  });

  it('over the limit, states the EXCESS in amber with a full meter', () => {
    const lead = leadFor({ day: { netCarbs: 112 }, mainGoal: 'net-carbs', entryCount: 9 });
    assert.equal(lead.figure, '12');
    assert.equal(lead.caption, 'net carbs over today');
    assert.equal(lead.tone, 'over');
    assert.equal(lead.fraction, 1);
    assert.equal(lead.scaleStart, `112${NBSP}g so far, 9 entries`, 'the scale line keeps the amount eaten');
    assert.equal(lead.scaleEnd, `limit 100${NBSP}g`);
  });
});

describe('a lead over a floor states what is still NEEDED, and never goes amber', () => {
  it('reads "14 g protein still needed" for 54 of 68 g, and the whole floor on an empty day', () => {
    const lead = leadFor({ day: { protein: 54 }, mainGoal: 'protein', entryCount: 3 });
    assert.equal(lead.metric, 'protein');
    assert.equal(lead.figure, '14');
    assert.equal(lead.caption, 'protein still needed');
    assert.equal(lead.tone, 'default');
    assert.equal(lead.scaleStart, `54${NBSP}g so far, 3 entries`);
    assert.equal(lead.scaleEnd, `target 68${NBSP}g`);

    const empty = leadFor({ day: {}, mainGoal: 'protein', entryCount: 0 });
    assert.equal(empty.figure, '68');
    assert.equal(empty.caption, 'protein to reach today');
    assert.equal(empty.scaleStart, 'Empty plate so far.');
  });

  it('once reached, the figure is the amount EATEN, with the brand tone and no amber', () => {
    const lead = leadFor({ day: { protein: 82 }, mainGoal: 'protein', entryCount: 5 });
    assert.equal(lead.figure, '82');
    assert.equal(lead.caption, 'protein, target reached');
    assert.equal(lead.tone, 'met');
    assert.equal(lead.fraction, 1);
    assert.equal(lead.scaleStart, '5 entries', 'the figure already says the amount eaten, so the scale does not');
    // CONTROL: under the floor, the same fixture is a different state.
    assert.equal(leadFor({ day: { protein: 67 }, mainGoal: 'protein', entryCount: 5 }).tone, 'default');
  });

  it('exactly the floor is reached, and far past it is still reached and never over', () => {
    const exact = leadFor({ day: { protein: 68 }, mainGoal: 'protein', entryCount: 5 });
    assert.equal(exact.tone, 'met');
    assert.equal(exact.figure, '68');
    const far = leadFor({ day: { protein: 240 }, mainGoal: 'protein', entryCount: 5 });
    assert.equal(far.tone, 'met', 'a floor cannot be over');
    assert.equal(far.figure, '240');
    assert.notEqual(far.tone, 'over');
  });

  it('a protein target that is only a reference says "reference", and one the person set says "target"', () => {
    const reference = leadFor({
      day: { protein: 20 },
      goals: { ...ALL_GOALS, proteinFloor: null, proteinReferenceG: 68 },
      mainGoal: 'protein',
      entryCount: 1,
    });
    assert.equal(reference.row.targetSource, 'default');
    assert.equal(reference.scaleEnd, `reference 68${NBSP}g`);
    // CONTROL: the same figures with a floor the person typed in.
    const own = leadFor({ day: { protein: 20 }, mainGoal: 'protein', entryCount: 1 });
    assert.equal(own.scaleEnd, `target 68${NBSP}g`);
  });
});

describe('a lead with no target states the plain amount and draws no meter', () => {
  it('net carbs with no ceiling: "74 g net carbs today", no fraction, "no limit set"', () => {
    const goals = { netCarbsCeiling: null, kcalTarget: null, proteinFloor: 68 };
    const lead = leadFor({ day: { netCarbs: 74 }, goals, mainGoal: 'net-carbs', entryCount: 5 });
    assert.equal(lead.figure, '74');
    assert.equal(lead.caption, 'net carbs today');
    assert.equal(lead.fraction, null);
    assert.equal(lead.scaleStart, '5 entries');
    assert.equal(lead.scaleEnd, 'no limit set');
    assert.equal(lead.tone, 'default');
    // CONTROL: give the same day a ceiling and it grows a fraction and a limit.
    const withCeiling = leadFor({ day: { netCarbs: 74 }, mainGoal: 'net-carbs', entryCount: 5 });
    assert.notEqual(withCeiling.fraction, null);
    assert.notEqual(withCeiling.scaleEnd, 'no limit set');
  });

  it('a calorie main goal with no calorie target: the day total, no meter', () => {
    const goals = { netCarbsCeiling: 50, kcalTarget: null, proteinFloor: 68 };
    const lead = leadFor({ day: { kcal: 1640 }, goals, mainGoal: 'calories', entryCount: 5 });
    assert.equal(lead.metric, 'calories');
    assert.equal(lead.figure, '1,640');
    assert.equal(lead.unit, 'kcal');
    assert.equal(lead.caption, 'today');
    assert.equal(lead.fraction, null);
    assert.equal(lead.scaleEnd, 'no limit set');
  });

  it('protein with no floor and no reference says there is no target, in the floor words', () => {
    const goals = { netCarbsCeiling: 50, kcalTarget: null, proteinFloor: null, proteinReferenceG: null };
    const lead = leadFor({ day: { protein: 30 }, goals, mainGoal: 'protein', entryCount: 2 });
    assert.equal(lead.figure, '30');
    assert.equal(lead.caption, 'protein today');
    assert.equal(lead.fraction, null);
    assert.equal(lead.scaleEnd, 'no target set');
  });
});

describe('calories', () => {
  it('never read "calories": the unit beside the figure names the metric', () => {
    const lead = leadFor({ day: { kcal: 1640 }, mainGoal: 'calories', entryCount: 5 });
    assert.equal(lead.figure, '310');
    assert.equal(lead.unit, 'kcal');
    assert.equal(lead.caption, 'left today');
    assert.equal(lead.scaleStart, `1,640${NBSP}kcal so far, 5 entries`);
    assert.equal(lead.scaleEnd, `limit 1,950${NBSP}kcal`);
    for (const text of [lead.caption, lead.scaleStart, lead.scaleEnd]) {
      assert.doesNotMatch(text, /calorie/i, `"${text}" repeats the unit as a noun`);
    }
    // CONTROL: the net-carb lead DOES keep its noun, so the check above can fail.
    assert.match(leadFor({ day: { netCarbs: 74 }, mainGoal: 'net-carbs', entryCount: 5 }).caption, /net carbs/);
  });

  it('on an empty day, the whole target is "to spend today"; past it, the excess is "over today"', () => {
    const empty = leadFor({ day: {}, mainGoal: 'calories', entryCount: 0 });
    assert.equal(empty.figure, '1,950');
    assert.equal(empty.caption, 'to spend today');
    const over = leadFor({ day: { kcal: 2310 }, mainGoal: 'calories', entryCount: 9 });
    assert.equal(over.figure, '360');
    assert.equal(over.caption, 'over today');
    assert.equal(over.tone, 'over');
  });

  it('writes the thousands separator the language writes', () => {
    const figureIn = (language: string): string =>
      leadFor({ day: {}, mainGoal: 'calories', entryCount: 0, language }).figure;
    assert.equal(figureIn('en'), '1,950');
    assert.equal(figureIn('de'), '1.950');
    // French groups with a narrow no-break space; the claim is "a space and not a digit between".
    assert.match(figureIn('fr'), /^1\s950$/u);
    assert.notEqual(figureIn('de'), figureIn('en'), 'the language is not being read');
  });
});

describe('the estimate hedge follows the rows', () => {
  it('hedges a budget figure with "~", and never the protein figure', () => {
    const hedged = leadFor({ day: { netCarbs: 74 }, mainGoal: 'net-carbs', entryCount: 5, hasEstimates: true });
    assert.equal(hedged.figure, '~26');
    // CONTROL: the same day with exact figures has no hedge.
    assert.equal(leadFor({ day: { netCarbs: 74 }, mainGoal: 'net-carbs', entryCount: 5 }).figure, '26');
    // The protein row has never been hedged, so neither is its lead.
    const protein = leadFor({ day: { protein: 54 }, mainGoal: 'protein', entryCount: 3, hasEstimates: true });
    assert.equal(protein.figure, '14');
  });
});

describe('the lead reads the row and computes nothing', () => {
  it("prints the row's gap amount, so a changed amount changes the figure", () => {
    const [row] = buildRows({ day: { netCarbs: 74 }, goals: ALL_GOALS, mainGoal: 'net-carbs' });
    if (row === undefined) throw new Error('no row');
    assert.equal(row.gap.kind, 'left');
    const changed: DayBudgetRow = { ...row, gap: { kind: 'left', amount: 7 } };
    assert.equal(buildHeroLead({ row: changed, entryCount: 5, hasEstimates: false, t, language: 'en' }).figure, '7');
    assert.equal(buildHeroLead({ row, entryCount: 5, hasEstimates: false, t, language: 'en' }).figure, '26');
  });

  it('refuses a fat or fiber row: only a main goal leads', () => {
    const rows = buildRows({ day: {}, goals: ALL_GOALS, mainGoal: 'net-carbs' });
    for (const key of ['fat', 'fiber'] as const) {
      assert.throws(
        () => buildHeroLead({ row: rowFor(rows, key), entryCount: 0, hasEstimates: false, t, language: 'en' }),
        /cannot be the/,
      );
    }
    // CONTROL: a main-goal row does not throw.
    assert.doesNotThrow(() =>
      buildHeroLead({ row: rowFor(rows, 'protein'), entryCount: 0, hasEstimates: false, t, language: 'en' }),
    );
  });
});

describe('the ledger status line', () => {
  const statusOf = (key: DayBudgetRowKey, day: Partial<Day>, goals: Goals = ALL_GOALS) =>
    buildLedgerStatus({ row: rowFor(buildRows({ day, goals, mainGoal: 'net-carbs' }), key), t, language: 'en' });

  it('says what is left under a limit, in grams', () => {
    assert.deepEqual(statusOf('netCarbs', { netCarbs: 74 }), { text: `26${NBSP}g left`, tone: 'default' });
  });

  it('says the excess over a limit, in amber', () => {
    assert.deepEqual(statusOf('netCarbs', { netCarbs: 112 }), { text: `12${NBSP}g over`, tone: 'over' });
  });

  it('says what is still to go under a floor, and "Reached" once it is, in the brand tone', () => {
    assert.deepEqual(statusOf('protein', { protein: 54 }), { text: `14${NBSP}g to go`, tone: 'default' });
    assert.deepEqual(statusOf('protein', { protein: 82 }), { text: 'Reached', tone: 'met' });
  });

  it('says "no target" for a row with none, and states no number for it', () => {
    // Fat has a target only when all three of calories, carbs and protein are set.
    const status = statusOf('fat', { fat: 40 }, { ...ALL_GOALS, kcalTarget: null });
    assert.deepEqual(status, { text: 'no target', tone: 'default' });
    assert.doesNotMatch(status.text, /\d/);
    // CONTROL: with all three set, the same fat row HAS a target and a number.
    assert.match(statusOf('fat', { fat: 40 }).text, /\d/);
  });

  it('prints a calorie row with no unit, because its value prints none either', () => {
    const status = statusOf('calories', { kcal: 1640 });
    assert.equal(status.text, '310 left');
    assert.doesNotMatch(status.text, /kcal/);
    // CONTROL: a gram row keeps its unit.
    assert.match(statusOf('netCarbs', { netCarbs: 74 }).text, /g left/);
  });

  it('keeps the derived fat row plain past its reference: it says "over" and stays default', () => {
    // 1950 kcal, 100 g carbs, 68 g protein: (1950 - 400 - 272) / 9 = 142 g of fat.
    const status = statusOf('fat', { fat: 150 });
    assert.equal(status.text, `8${NBSP}g over`);
    assert.equal(status.tone, 'default', 'two amber rows for one cause');
    // CONTROL: the calorie row, which guards the same energy, does turn amber.
    assert.equal(statusOf('calories', { kcal: 2310 }).tone, 'over');
  });
});
