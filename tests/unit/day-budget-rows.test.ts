/**
 * Unit tests for `#app/lib/day-budget-rows`, the rows that replaced the diary
 * hero's ring gauges.
 *
 * Three properties are pinned here, all of them the reason the rings went:
 *
 * 1. **Every row is named and worded.** A ring said "24.9" and left the rest to
 *    a circle; a row says "24.9 g left" and "25.1 of 50 g". The exact strings
 *    are asserted against the SHIPPED English catalog, so a renamed key fails
 *    here rather than rendering `diary.budget.gramsLeft` to a user.
 * 2. **Nothing is invented.** No ceiling means no meter and no target; no
 *    calorie target means no calorie row at all. There is never a NaN.
 * 3. **Over is amber and clamped.** A day past its ceiling reports `tone:
 *    'over'` with a full meter, while the `progress` element still carries the
 *    real, unclamped figures.
 *
 * The rendering test at the bottom is the one visual claim worth pinning: the
 * over-goal treatment is amber and never `--destructive`, and the colour cue
 * is a swatch rather than the thick left rule this redesign removed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import { DayBudgetRows } from '../../app/components/day-budget-rows';
import {
  buildDayBudgetRows,
  formatBudgetHeadline,
  type DayBudgetRow,
  type DayBudgetRowKey,
} from '../../app/lib/day-budget-rows';
import { computeDayGaps } from '../../app/lib/macro-gaps';
import type { Translate } from '../../app/lib/macro-gaps';

/**
 * The REAL catalog, not a stub. These assertions are about exact wording, and
 * routing them through the shipped English resources is what keeps this a copy
 * test rather than a key-spelling test.
 */
const t: Translate = (key, params) => i18next.t(key, params ?? {});

/** The day's four figures; every test overrides what it cares about. */
interface DayTotals {
  netCarbs: number;
  kcal: number;
  protein: number;
  fiber: number;
}

/** The two budgets plus the protein floor, any of which may be unset. */
interface DayGoals {
  netCarbsCeiling: number | null;
  kcalTarget: number | null;
  proteinFloor: number | null;
}

function buildRows(totals: DayTotals, goals: DayGoals, hasEstimates = false): DayBudgetRow[] {
  const gaps = computeDayGaps({
    totals: { netCarbs: totals.netCarbs, protein: totals.protein, fiber: totals.fiber },
    goals: { netCarbsCeiling: goals.netCarbsCeiling, proteinFloor: goals.proteinFloor },
    t,
  });
  return buildDayBudgetRows({
    totals: { ...totals, hasEstimates },
    goals: { netCarbsCeiling: goals.netCarbsCeiling, kcalTarget: goals.kcalTarget },
    gaps,
    t,
    language: 'en',
  });
}

function rowFor(rows: DayBudgetRow[], key: DayBudgetRowKey): DayBudgetRow {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined) throw new Error(`expected a "${key}" row`);
  return row;
}

const DAY = { netCarbs: 25.1, kcal: 899, protein: 95, fiber: 13 };
const BOTH_GOALS = { netCarbsCeiling: 50, kcalTarget: 1800, proteinFloor: 90 };

describe('buildDayBudgetRows, both budgets set', () => {
  it('returns the four rows in display order', () => {
    const rows = buildRows(DAY, BOTH_GOALS);
    assert.deepEqual(
      rows.map((row) => row.key),
      ['netCarbs', 'calories', 'protein', 'fiber'],
    );
  });

  it('leads each budget row with what is LEFT, and captions it with the progress', () => {
    const rows = buildRows(DAY, BOTH_GOALS);
    const netCarbs = rowFor(rows, 'netCarbs');
    assert.equal(netCarbs.label, 'Net carbs');
    assert.equal(netCarbs.headline, '24.9 g left');
    assert.equal(netCarbs.progressText, '25.1 of 50 g');
    assert.equal(netCarbs.tone, 'default');
    assert.equal(netCarbs.targetSource, 'goal');

    const calories = rowFor(rows, 'calories');
    assert.equal(calories.label, 'Calories');
    assert.equal(calories.headline, '901 left');
    assert.equal(calories.progressText, '899 of 1800');
  });

  it('hedges both budget headlines when the day includes AI estimates', () => {
    const rows = buildRows(DAY, BOTH_GOALS, true);
    assert.equal(rowFor(rows, 'netCarbs').headline, '~24.9 g left');
    assert.equal(rowFor(rows, 'calories').headline, '~901 left');
  });

  it('carries the raw figures and a clamped fraction for the meter', () => {
    const netCarbs = rowFor(buildRows(DAY, BOTH_GOALS), 'netCarbs');
    assert.equal(netCarbs.consumed, 25.1);
    assert.equal(netCarbs.target, 50);
    assert.ok(netCarbs.fraction !== null && Math.abs(netCarbs.fraction - 0.502) < 1e-9);
  });

  it('speaks each budget row as a whole sentence', () => {
    const rows = buildRows(DAY, BOTH_GOALS);
    assert.equal(rowFor(rows, 'netCarbs').srLabel, '24.9 g left today of your 50 g net-carb goal.');
    assert.equal(rowFor(rows, 'calories').srLabel, '901 calories left today of your 1800 calorie goal.');
  });
});

describe('buildDayBudgetRows, only a carb ceiling', () => {
  it('omits the calorie row entirely rather than inventing a target for it', () => {
    const rows = buildRows(DAY, { netCarbsCeiling: 50, kcalTarget: null, proteinFloor: 90 });
    assert.deepEqual(
      rows.map((row) => row.key),
      ['netCarbs', 'protein', 'fiber'],
    );
    assert.equal(rowFor(rows, 'netCarbs').headline, '24.9 g left');
  });

  it('refuses a non-positive calorie target, which is not a goal', () => {
    const rows = buildRows(DAY, { netCarbsCeiling: 50, kcalTarget: 0, proteinFloor: null });
    assert.ok(!rows.some((row) => row.key === 'calories'));
  });
});

describe('buildDayBudgetRows, only a calorie target', () => {
  it("still leads with net carbs, as the day's absolute figure and no meter", () => {
    const rows = buildRows(DAY, { netCarbsCeiling: null, kcalTarget: 1800, proteinFloor: null });
    assert.deepEqual(
      rows.map((row) => row.key),
      ['netCarbs', 'calories', 'protein', 'fiber'],
    );

    const netCarbs = rowFor(rows, 'netCarbs');
    assert.equal(netCarbs.headline, '25.1 g');
    assert.equal(netCarbs.target, null);
    assert.equal(netCarbs.fraction, null);
    assert.equal(netCarbs.progressText, null);
    assert.equal(netCarbs.targetSource, 'none');
  });
});

describe('buildDayBudgetRows, no goals at all', () => {
  const NO_GOALS = { netCarbsCeiling: null, kcalTarget: null, proteinFloor: null };

  it('draws no calorie row, no fabricated target, and no NaN', () => {
    const rows = buildRows(DAY, NO_GOALS);
    assert.deepEqual(
      rows.map((row) => row.key),
      ['netCarbs', 'protein', 'fiber'],
    );
    for (const row of rows) {
      assert.ok(row.fraction === null || Number.isFinite(row.fraction), `${row.key} fraction must never be NaN`);
      assert.ok(Number.isFinite(row.consumed));
      assert.doesNotMatch(row.headline, /NaN/);
    }
  });

  it('keeps the fiber reference, which is the only target nobody had to set', () => {
    const fiber = rowFor(buildRows(DAY, NO_GOALS), 'fiber');
    assert.equal(fiber.target, 25);
    assert.equal(fiber.targetSource, 'default');
    assert.equal(fiber.headline, '12 g to go');
    assert.equal(fiber.progressText, '13 of 25 g');
  });

  it('leaves protein with no target of its own', () => {
    const protein = rowFor(buildRows(DAY, NO_GOALS), 'protein');
    assert.equal(protein.target, null);
    assert.equal(protein.progressText, null);
    assert.equal(protein.headline, '95 g logged');
    assert.equal(protein.srLabel, 'Protein: 95 g logged.');
  });
});

describe('buildDayBudgetRows, over the ceiling', () => {
  it('flips to a factual over-by figure with a full meter, never a negative remainder', () => {
    const rows = buildRows({ ...DAY, netCarbs: 62 }, BOTH_GOALS);
    const netCarbs = rowFor(rows, 'netCarbs');
    assert.equal(netCarbs.tone, 'over');
    assert.equal(netCarbs.headline, '12 g over');
    assert.equal(netCarbs.fraction, 1);
    // The meter clamps; the reported figures do not.
    assert.equal(netCarbs.consumed, 62);
    assert.equal(netCarbs.target, 50);
    assert.doesNotMatch(netCarbs.headline, /-\d/);
  });

  it('grades each budget on its own: over on carbs while still under on calories', () => {
    const rows = buildRows({ ...DAY, netCarbs: 62 }, BOTH_GOALS);
    assert.equal(rowFor(rows, 'netCarbs').tone, 'over');
    assert.equal(rowFor(rows, 'calories').tone, 'default');
  });
});

describe('buildDayBudgetRows, a floor that is reached', () => {
  it('says so in words, and marks the row met rather than over', () => {
    const protein = rowFor(buildRows(DAY, BOTH_GOALS), 'protein');
    assert.equal(protein.tone, 'met');
    assert.equal(protein.headline, 'Reached');
    assert.equal(protein.progressText, '95 of 90 g');
    assert.equal(protein.srLabel, 'Protein: 95 of 90 g. Reached.');
  });

  it('does not animate a floor row, there is no single figure to count toward', () => {
    const protein = rowFor(buildRows(DAY, BOTH_GOALS), 'protein');
    assert.equal(protein.headlineNumeric, null);
    assert.equal(protein.headlineMode, null);
  });
});

describe('formatBudgetHeadline', () => {
  it('formats a mid-tween figure exactly as the settled one would be', () => {
    const netCarbs = rowFor(buildRows(DAY, BOTH_GOALS), 'netCarbs');
    assert.equal(
      formatBudgetHeadline({
        row: netCarbs,
        numericValue: netCarbs.headlineNumeric ?? 0,
        hasEstimates: false,
        language: 'en',
        t,
      }),
      netCarbs.headline,
    );
  });

  it("returns a floor row's settled headline unchanged, because it does not animate", () => {
    const protein = rowFor(buildRows(DAY, BOTH_GOALS), 'protein');
    assert.equal(
      formatBudgetHeadline({ row: protein, numericValue: 42, hasEstimates: false, language: 'en', t }),
      'Reached',
    );
  });
});

/** The rows as the diary paints them, with no tween, which is what the dashboard renders. */
function render(rows: DayBudgetRow[]): string {
  return renderToStaticMarkup(withI18n(createElement(DayBudgetRows, { rows })));
}

describe('DayBudgetRows rendering', () => {
  it('names every row in words, so colour is never the only encoding', () => {
    const html = render(buildRows(DAY, BOTH_GOALS));
    for (const label of ['Net carbs', 'Calories', 'Protein', 'Fiber']) {
      assert.ok(html.includes(label), `expected the row labelled "${label}"`);
    }
  });

  it('paints an over-budget row amber, never destructive', () => {
    const html = render(buildRows({ ...DAY, netCarbs: 62 }, BOTH_GOALS));
    assert.match(html, /text-accent-amber/);
    assert.ok(!html.includes('destructive'), 'over-goal must never use the destructive token');
  });

  it('cues colour with a round swatch, never a thick left rule', () => {
    const html = render(buildRows(DAY, BOTH_GOALS));
    assert.match(html, /h-2 w-2 shrink-0 rounded-full/);
    assert.ok(!html.includes('border-l-2'), 'the left-rule accent is what this redesign removed');
    assert.ok(!html.includes('border-l-4'));
  });

  it('reports the real, unclamped figures to assistive tech', () => {
    const html = render(buildRows({ ...DAY, netCarbs: 62 }, BOTH_GOALS));
    assert.match(html, /<progress[^>]*value="62"[^>]*max="50"/);
  });

  it('draws no meter for a row with no target, and says so instead', () => {
    const html = render(buildRows(DAY, { netCarbsCeiling: null, kcalTarget: null, proteinFloor: null }));
    assert.ok(html.includes('No target set'));
  });
});
