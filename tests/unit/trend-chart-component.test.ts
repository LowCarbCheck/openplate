/**
 * Unit tests for `#app/components/trends/trend-chart` — the SVG bar-chart
 * component. Renders to static markup inside a `MemoryRouter` (each bar's
 * tap target is a `<Link>`, which needs router context). Focus: the
 * over-goal amber fix (bug 1) — a day flagged `isOverGoal` by the pure chart
 * model must actually render amber, not the default primary color, so the
 * diary and the chart can never visually disagree about the same day. M129/04
 * moved that amber onto the `--accent-amber` token (`text-accent-amber`), the
 * same one the diary's "Over by X g" line uses, and added the inline goal tag.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { TrendChart } from '../../app/components/trends/trend-chart';
import type { BarGeometry, TrendChartModel, TrendMetric } from '../../app/lib/trend-chart';

function bar(overrides: Partial<BarGeometry> = {}): BarGeometry {
  return {
    date: '2026-07-13',
    value: 94.9,
    hasLogs: true,
    hasEstimate: false,
    fill: 'solid',
    isOverGoal: false,
    heightFraction: 1,
    ...overrides,
  };
}

function renderChart(
  model: TrendChartModel,
  options: { metric?: TrendMetric; goalValue?: number | null } = {},
): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(
        MemoryRouter,
        { initialEntries: ['/trends'] },
        createElement(TrendChart, {
          model,
          metric: options.metric ?? 'net-carbs',
          goalValue: options.goalValue ?? null,
        }),
      ),
    ),
  );
}

describe('TrendChart — over-goal coloring agrees with the diary', () => {
  it('renders an over-goal solid bar with the amber token, never a raw Tailwind amber literal', () => {
    const html = renderChart({ bars: [bar({ isOverGoal: true })], domainMax: 100, goalFraction: 0.2 });

    assert.ok(html.includes('text-accent-amber'), 'over-goal bar must carry the amber token class');
    assert.ok(!html.includes('amber-500'), 'no raw Tailwind color literals — tokens only (DESIGN.md §11)');
    assert.ok(!html.includes('amber-400'));
  });

  it('renders an under-goal solid bar in the default primary color, not amber', () => {
    const html = renderChart({ bars: [bar({ value: 10, heightFraction: 0.1 })], domainMax: 100, goalFraction: 0.2 });

    assert.ok(!html.includes('text-accent-amber'));
    assert.ok(html.includes('text-primary'));
  });

  it('renders an over-goal incomplete (floor) bar in amber too', () => {
    const html = renderChart({
      bars: [bar({ fill: 'incomplete', isOverGoal: true })],
      domainMax: 100,
      goalFraction: 0.2,
    });

    assert.ok(html.includes('text-accent-amber'));
  });

  it("includes 'over your goal' in the tappable day's accessible name", () => {
    const html = renderChart({ bars: [bar({ isOverGoal: true })], domainMax: 100, goalFraction: 0.2 });

    assert.match(html, /aria-label="2026-07-13: 94\.9 g net carbs, over your goal"/);
  });
});

describe('TrendChart — the incomplete (floor) treatment reads as a minimum', () => {
  it('draws a floor bar as a pale body plus a solid cap rule, not a dashed outline', () => {
    const html = renderChart({ bars: [bar({ fill: 'incomplete' })], domainMax: 100, goalFraction: null });

    assert.ok(!html.includes('stroke-dasharray'), 'the hard-to-parse dashed outline is gone');
    assert.ok(html.includes('fill-opacity="0.28"'), 'the pale body carries the height');
    // Two rects: the pale body and the full-opacity cap on top of it.
    assert.equal([...html.matchAll(/<rect/g)].length, 2);
  });

  it("says 'at least' in a floor bar's accessible name — status is never hue-only", () => {
    const html = renderChart({ bars: [bar({ fill: 'incomplete' })], domainMax: 100, goalFraction: null });

    assert.match(html, /aria-label="2026-07-13: at least 94\.9 g net carbs"/);
  });

  it('leaves an ordinary solid bar unqualified', () => {
    const html = renderChart({ bars: [bar()], domainMax: 100, goalFraction: null });

    assert.ok(!html.includes('at least'));
  });
});

describe('TrendChart — the goal line is labelled inline', () => {
  it('prints the goal value as a tag at the line, with an accessible prefix', () => {
    const html = renderChart({ bars: [bar()], domainMax: 100, goalFraction: 0.5 }, { goalValue: 50 });

    assert.ok(html.includes('Your goal: '), 'the tag names itself for assistive tech');
    assert.ok(html.includes('50 g'), 'the tag prints the goal value in grams');
  });

  it('prints a calorie goal without a gram unit', () => {
    const html = renderChart(
      { bars: [bar()], domainMax: 2000, goalFraction: 0.9 },
      { metric: 'calories', goalValue: 1800 },
    );

    assert.ok(html.includes('1800'));
    assert.ok(!html.includes('1800 g'));
  });

  it('uses the goal value verbatim rather than re-deriving it from the domain (no 49.9 g for a 50 g ceiling)', () => {
    const html = renderChart({ bars: [bar()], domainMax: 3, goalFraction: 1 / 3 }, { goalValue: 1 });

    assert.ok(html.includes('1 g'));
    assert.ok(!html.includes('0.9'));
  });

  it('draws no tag when there is no goal to draw', () => {
    const html = renderChart({ bars: [bar()], domainMax: 100, goalFraction: null }, { goalValue: null });

    assert.ok(!html.includes('Your goal'));
  });
});
