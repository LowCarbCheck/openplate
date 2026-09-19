/**
 * `MacroEnergySplitCard` (`app/components/trends/macro-energy-split-card.tsx`),
 * rendered to static markup with the shipped English catalog (M239/03).
 *
 * The arithmetic is `macro-energy-split.test.ts`'s job. This file checks what
 * the card puts on screen: the verbatim title and note, a split bar for a day
 * that has one, an empty track with its reason for a day that does not, and
 * one row per week rather than per day at the wide ranges.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { MacroEnergySplitCard } from '../../app/components/trends/macro-energy-split-card';
import type { TrendDay } from '../../app/lib/trend-chart';
import type { DaySummary } from '../../app/models/food-log-summary';

/** A logged day with 100 g each of protein and carbs and 0 g fat, so the split is 50/50/0. */
function loggedDay(date: string, overrides: Partial<DaySummary> = {}): TrendDay {
  return {
    date,
    hasLogs: true,
    summary: {
      carbs: 100,
      fiber: 0,
      polyols: 0,
      netCarbs: 100,
      protein: 100,
      fat: 0,
      kcal: 800,
      hasUnknowns: false,
      hasEstimates: false,
      ...overrides,
    },
    kcal: { total: 800, basis: 'reported', derivedShare: 0 },
    estimateShare: 0,
  };
}

/** A day nobody logged. */
function gapDay(date: string): TrendDay {
  return { date, hasLogs: false, summary: null, kcal: { total: null, basis: 'none', derivedShare: 0 }, estimateShare: 0 };
}

/** The card's markup for `days`. */
function render(days: readonly TrendDay[], isWeekly = false): string {
  return renderToStaticMarkup(withI18n(createElement(MacroEnergySplitCard, { days, isWeekly })));
}

/** How many rows the card drew. */
function rowsOf(html: string): number {
  return [...html.matchAll(/data-slot="macro-split-row"/g)].length;
}

describe('MacroEnergySplitCard', () => {
  it('carries the title and the note verbatim', () => {
    const html = render([loggedDay('2026-07-13')]);

    assert.ok(html.includes('Where your calories come from'));
    assert.ok(html.includes('Worked out from protein, carbs and fat, so it can differ a little from your calorie total.'));
  });

  it('draws a split for a whole day and names it in words', () => {
    const html = render([loggedDay('2026-07-13')]);

    assert.match(html, /data-slot="macro-split-bar" data-date="2026-07-13" data-state="split"/);
    assert.ok(html.includes('50% carbs, 50% protein, 0% fat'));
  });

  it('draws an empty track with a reason for a partial day and for an unlogged one', () => {
    const html = render([loggedDay('2026-07-13', { hasUnknowns: true }), gapDay('2026-07-14')]);

    assert.match(html, /data-date="2026-07-13" data-state="none"/);
    assert.match(html, /data-date="2026-07-14" data-state="none"/);
    // Each reason is paired with its own day, so swapping the two reasons fails.
    assert.ok(html.includes('13 Jul: some macros are missing'));
    assert.ok(html.includes('14 Jul: nothing logged'));
    // Control: neither day produced a split, so there is no average either.
    assert.ok(!html.includes('macro-split-average'));
  });

  it('draws one row per week at the wide ranges, and one per day otherwise', () => {
    const days = ['2026-07-13', '2026-07-14', '2026-07-20'].map((date) => loggedDay(date));

    assert.strictEqual(rowsOf(render(days, true)), 2);
    assert.strictEqual(rowsOf(render(days, false)), 3);
  });
});
