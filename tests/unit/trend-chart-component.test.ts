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
import { useTranslation } from 'react-i18next';

import { withI18n } from './trends-i18n-harness';
import { averageLinePath, chartTitleKey, TrendChart } from '../../app/components/trends/trend-chart';
import type { BarGeometry, TrendChartModel, TrendMetric } from '../../app/lib/trend-chart';

function bar(overrides: Partial<BarGeometry> = {}): BarGeometry {
  return {
    date: '2026-07-13',
    value: 94.9,
    hasLogs: true,
    hasEstimate: false,
    fill: 'solid',
    isOverGoal: false,
    isUnderGoal: false,
    heightFraction: 1,
    outlineFraction: null,
    totalCarbs: null,
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

/**
 * M239/03: the new metrics, the week wording, the carbs outline and the
 * average line. Every claim is checked beside the case that must NOT show it.
 */
describe('TrendChart, a protein day under the floor is flagged without a warning hue (M239/03)', () => {
  it('keeps an under-floor protein bar in the protein hue, and says so in words', () => {
    const html = renderChart(
      { bars: [bar({ value: 60, heightFraction: 0.5, isUnderGoal: true })], domainMax: 120, goalFraction: 0.8 },
      { metric: 'protein', goalValue: 100 },
    );

    assert.ok(html.includes('text-macro-protein'));
    assert.ok(!html.includes('text-accent-amber'), 'missing a floor is not a warning');
    assert.ok(html.includes('data-goal="under"'));
    assert.match(html, /aria-label="2026-07-13: 60 g protein, below your goal"/);
  });

  it('leaves a protein day that reached the floor unflagged', () => {
    const html = renderChart(
      { bars: [bar({ value: 110, heightFraction: 0.9 })], domainMax: 120, goalFraction: 0.8 },
      { metric: 'protein', goalValue: 100 },
    );

    assert.ok(html.includes('data-goal="none"'));
    assert.ok(!html.includes('below your goal'));
  });

  it('reads fat and fiber bars in grams with their own names and hues', () => {
    const fat = renderChart({ bars: [bar({ value: 42 })], domainMax: 50, goalFraction: null }, { metric: 'fat' });
    const fiber = renderChart({ bars: [bar({ value: 12 })], domainMax: 20, goalFraction: null }, { metric: 'fiber' });

    assert.match(fat, /aria-label="2026-07-13: 42 g fat"/);
    assert.ok(fat.includes('text-macro-fat'));
    assert.match(fiber, /aria-label="2026-07-13: 12 g fiber"/);
    assert.ok(fiber.includes('text-macro-fiber'));
  });
});

describe('TrendChart, a weekly bar says it is a week average (M239/03)', () => {
  /** Renders one 40 g bar dated on a Monday, daily or weekly. */
  function renderWeekly(isWeekly: boolean, overrides: Partial<BarGeometry> = {}): string {
    return renderToStaticMarkup(
      withI18n(
        createElement(
          MemoryRouter,
          { initialEntries: ['/trends'] },
          createElement(TrendChart, {
            model: { bars: [bar({ value: 40, ...overrides })], domainMax: 50, goalFraction: null },
            metric: 'net-carbs',
            goalValue: null,
            isWeekly,
          }),
        ),
      ),
    );
  }

  it('names a valued weekly bar as the week and its daily average', () => {
    assert.match(renderWeekly(true), /aria-label="Week of 2026-07-13, daily average: 40 g net carbs"/);
  });

  it('names the same bar as one day when the bars are daily', () => {
    assert.match(renderWeekly(false), /aria-label="2026-07-13: 40 g net carbs"/);
  });

  it('names an unlogged week as a week, without calling nothing an average', () => {
    const html = renderWeekly(true, { fill: 'empty', value: null, hasLogs: false });

    assert.match(html, /aria-label="Week of 2026-07-13: nothing logged"/);
  });
});

describe('TrendChart, the total-carbs outline (M239/03)', () => {
  it('draws the outline above a net-carbs bar and names total carbs', () => {
    const html = renderChart({
      bars: [bar({ value: 20, heightFraction: 0.4, outlineFraction: 0.6, totalCarbs: 30 })],
      domainMax: 50,
      goalFraction: null,
    });

    assert.ok(html.includes('data-slot="trend-carbs-outline"'));
    assert.match(html, /aria-label="2026-07-13: 20 g net carbs, 30 g total carbs"/);
  });

  it('draws no outline when total carbs equal net carbs, since there is no gap to show', () => {
    const html = renderChart({
      bars: [bar({ value: 20, heightFraction: 0.4, outlineFraction: 0.4, totalCarbs: 20 })],
      domainMax: 50,
      goalFraction: null,
    });

    assert.ok(!html.includes('trend-carbs-outline'));
    assert.ok(!html.includes('total carbs'));
  });
});

describe('TrendChart, the 7-day average line (M239/03)', () => {
  it('draws the line when fractions are given, and breaks it at a gap', () => {
    const html = renderToStaticMarkup(
      withI18n(
        createElement(
          MemoryRouter,
          { initialEntries: ['/trends'] },
          createElement(TrendChart, {
            model: { bars: [bar(), bar({ date: '2026-07-14' })], domainMax: 100, goalFraction: null },
            metric: 'net-carbs',
            goalValue: null,
            averageFractions: [0.5, 0.25],
          }),
        ),
      ),
    );

    assert.ok(html.includes('data-slot="trend-average-line"'));
    assert.strictEqual(averageLinePath([0.5, null, 0.25, 0.75]), 'M 6 50 M 30 75 L 42 25');
  });

  it('draws no line without fractions', () => {
    const html = renderChart({ bars: [bar()], domainMax: 100, goalFraction: null });

    assert.ok(!html.includes('trend-average-line'));
  });
});

/** One catalog key rendered through the harness, so the English is the shipped string. */
function TitleProbe({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return t(titleKey);
}

/** The English string at a catalog key; a missing key would render the key itself. */
function englishAt(key: string): string {
  return renderToStaticMarkup(withI18n(createElement(TitleProbe, { titleKey: key })));
}

describe('chartTitleKey, no "Daily" over weekly bars (M239/03)', () => {
  it('says Daily over daily bars and per week over weekly ones, for every metric', () => {
    for (const metric of ['net-carbs', 'calories', 'protein', 'fat', 'fiber'] as const) {
      const daily = englishAt(chartTitleKey({ metric, isWeekly: false }));
      const weekly = englishAt(chartTitleKey({ metric, isWeekly: true }));
      assert.match(daily, /^Daily /, metric);
      assert.ok(!weekly.startsWith('Daily'), `${metric}: ${weekly}`);
      assert.match(weekly, /per week/, metric);
    }
  });
});
