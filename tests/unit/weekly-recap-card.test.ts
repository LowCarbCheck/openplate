/**
 * Unit tests for `#app/components/trends/weekly-recap-card` — the "This week"
 * card above the trends chart.
 *
 * Two focus areas:
 * - M123/07's fix to the AI-estimate line, which used to render "~0% of this
 *   week's calories are AI-estimated" to any user who had never touched AI
 *   plate-scanning — i.e. everyone by default — reading as a broken/
 *   meaningless stat rather than information.
 * - The elapsed-vs-logged-days denominator bug: the ceiling/protein-floor
 *   ratios must divide by `loggedDays` (the same population the numerator
 *   counts), never `elapsedDays` — otherwise a day the user simply didn't log
 *   reads as a failure, and a single good day in a mostly-unlogged week reads
 *   as discouraging instead of encouraging.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { WeeklyRecapCard } from '../../app/components/trends/weekly-recap-card';
import type { WeeklyRecap } from '../../app/lib/trend-recap';

const NO_GOALS = { netCarbsCeiling: null, proteinFloor: null };

function makeRecap(overrides: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    elapsedDays: 3,
    loggedDays: 3,
    avgNetCarbs: 25,
    daysUnderCeiling: null,
    daysHitProteinFloor: null,
    estimateShare: null,
    avgMacroGrams: { carbs: 30, protein: 90, fat: 50, fiber: 8 },
    ...overrides,
  };
}

function render(
  recap: WeeklyRecap,
  goals: { netCarbsCeiling: number | null; proteinFloor: number | null } = NO_GOALS,
): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(WeeklyRecapCard, {
        current: recap,
        previous: makeRecap({ avgNetCarbs: null, estimateShare: null }),
        weight: null,
        eatingWindow: null,
        goals,
      }),
    ),
  );
}

describe('WeeklyRecapCard', () => {
  it('never renders the AI-estimate line for a day-one user who has never used AI scanning (estimateShare: 0)', () => {
    const html = render(makeRecap({ estimateShare: 0 }));
    assert.ok(!html.includes('AI-estimated'), 'a meaningless ~0% must not render');
  });

  it('omits the AI-estimate line when nothing is computable at all (estimateShare: null)', () => {
    const html = render(makeRecap({ estimateShare: null }));
    assert.ok(!html.includes('AI-estimated'));
  });

  it('renders the AI-estimate line once it is actually meaningful (estimateShare > 0)', () => {
    const html = render(makeRecap({ estimateShare: 0.4 }));
    assert.match(html, /~40% of this week.s calories are AI-estimated/);
  });

  it('rounds a small-but-real estimate share rather than hiding it (e.g. 4%)', () => {
    const html = render(makeRecap({ estimateShare: 0.04 }));
    assert.match(html, /~4% of this week.s calories are AI-estimated/);
  });

  it('still shows a neutral message, not a scolding one, when nothing has been logged this week', () => {
    const html = render(makeRecap({ avgNetCarbs: null, estimateShare: null }));
    assert.ok(html.includes('No entries logged this week yet.'));
  });
});

describe('WeeklyRecapCard — ceiling/protein ratios divide by logged days, not elapsed days', () => {
  const CEILING_GOAL = { netCarbsCeiling: 20, proteinFloor: null };
  const PROTEIN_GOAL = { netCarbsCeiling: null, proteinFloor: 90 };

  it('reads "1 of 1" (encouraging), not "1 of 6" (discouraging), for one good logged day in an otherwise-empty week', () => {
    // Regression for the bug: a Monday with one logged, under-ceiling day, in
    // a week window that runs Monday..Sunday (elapsedDays would only be 1 too
    // early in the week, but a week further along must still read against
    // loggedDays, not the larger elapsedDays).
    const recap = makeRecap({ elapsedDays: 6, loggedDays: 1, daysUnderCeiling: 1, avgNetCarbs: 15 });
    const html = render(recap, CEILING_GOAL);

    assert.match(html, /1 of 1 logged days were under your 20 g net-carbs goal/);
    assert.ok(!html.includes('1 of 6'), 'must never divide by the elapsed-days count');
  });

  it('applies the same logged-days denominator to the protein ratio', () => {
    const recap = makeRecap({ elapsedDays: 5, loggedDays: 2, daysHitProteinFloor: 2, avgNetCarbs: 15 });
    const html = render(recap, PROTEIN_GOAL);

    assert.match(html, /2 of 2 logged days met your 90 g protein goal/);
    assert.ok(!html.includes('2 of 5'));
  });

  it('omits the net-carbs goal line entirely when nothing has been logged (0 of 0 would be nonsense)', () => {
    const recap = makeRecap({
      elapsedDays: 4,
      loggedDays: 0,
      daysUnderCeiling: 0,
      avgNetCarbs: null,
      estimateShare: null,
    });
    const html = render(recap, CEILING_GOAL);

    assert.ok(!html.includes('net-carbs goal'), '0 of 0 logged days is not a claim worth making');
  });
});

describe('WeeklyRecapCard — plain language, not "ceiling"/"floor" jargon (durability round)', () => {
  it('never says "ceiling" or "floor" anywhere in the rendered card', () => {
    const recap = makeRecap({ daysUnderCeiling: 3, daysHitProteinFloor: 2, loggedDays: 3, avgNetCarbs: 20 });
    const html = render(recap, { netCarbsCeiling: 100, proteinFloor: 131 });

    assert.ok(!/ceiling/i.test(html), 'jargon word "ceiling" must not appear');
    assert.ok(!/floor/i.test(html), 'jargon word "floor" must not appear');
  });
});

/**
 * M129/04: the card was text-only, so the one thing a week of logging is
 * actually good for — the shape of a typical day — had to be reconstructed in
 * the reader's head. It now leads with the spec-01 `MacroRatioBar`.
 */
describe('WeeklyRecapCard — average-day composition', () => {
  it('draws the macro ratio bar with a named, labelled figure per macro (never hue alone)', () => {
    const html = render(makeRecap());

    assert.ok(html.includes('An average day'));
    assert.ok(html.includes('Macro ratio:'), "the bar's accessible name states the ratio in words");
    for (const label of ['Carbs', 'Fiber', 'Protein', 'Fat']) {
      assert.ok(html.includes(label), `${label} must be named next to its swatch`);
    }
  });

  it('hedges the average figures with "~" — a mean of logged days is not a precise number', () => {
    assert.ok(render(makeRecap()).includes('~30 g'));
  });

  it('omits the whole block when nothing was logged this week', () => {
    const html = render(makeRecap({ avgMacroGrams: null, avgNetCarbs: null }));

    assert.ok(!html.includes('An average day'));
  });
});
