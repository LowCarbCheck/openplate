/**
 * Unit tests for `#app/components/trends/trend-legend` — the bar-chart legend.
 * Focus: the "chart chrome written for an analyst" fix. The legend must not
 * carry jargon a normal person wouldn't understand (no "Includes AI estimate"
 * dot, no metric-specific "Reported"/"Part-estimated" swatches), and the
 * amber "Over your goal" swatch only ever appears for the net-carbs metric
 * with a ceiling set — mirroring the diary, which only ambers the carb
 * ceiling, never a calorie target.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { TrendLegend } from '../../app/components/trends/trend-legend';

function render(props: { metric: 'net-carbs' | 'calories'; hasGoal: boolean }): string {
  return renderToStaticMarkup(withI18n(createElement(TrendLegend, props)));
}

describe('TrendLegend', () => {
  it('drops the analyst-only states: no AI-estimate dot, no reported/part-estimated jargon', () => {
    const html = render({ metric: 'net-carbs', hasGoal: false });

    assert.ok(!html.includes('AI estimate'));
    assert.ok(!html.includes('Reported'));
    assert.ok(!html.includes('Part-estimated'));
    assert.ok(!html.includes('Missing data'));
  });

  it('shows the amber "Over your goal" swatch for net-carbs once a ceiling is set', () => {
    const html = render({ metric: 'net-carbs', hasGoal: true });

    assert.ok(html.includes('Over your goal'));
    assert.ok(html.includes('Your goal'));
  });

  it('never shows "Over your goal" for the calories metric — the diary has no amber kcal state', () => {
    const html = render({ metric: 'calories', hasGoal: true });

    assert.ok(!html.includes('Over your goal'));
    assert.ok(html.includes('Your goal'));
  });

  it('omits the goal line entry entirely when no goal is set', () => {
    const html = render({ metric: 'net-carbs', hasGoal: false });

    assert.ok(!html.includes('Your goal'));
    assert.ok(!html.includes('Over your goal'));
  });

  it('always explains the no-entry hairline and the partial-data outline', () => {
    const html = render({ metric: 'net-carbs', hasGoal: false });

    assert.ok(html.includes('No entry'));
    assert.ok(html.includes('Might be incomplete'));
  });
});

/** Renders the net-carbs legend with the two M239/03 switches. */
function renderWith(props: { hasAverageLine: boolean; hasCarbsOutline: boolean }): string {
  return renderToStaticMarkup(withI18n(createElement(TrendLegend, { metric: 'net-carbs', hasGoal: false, ...props })));
}

describe('TrendLegend, the M239/03 entries', () => {
  it('names the 7-day average line only when it is drawn', () => {
    assert.ok(renderWith({ hasAverageLine: true, hasCarbsOutline: false }).includes('7-day average'));
    assert.ok(!renderWith({ hasAverageLine: false, hasCarbsOutline: false }).includes('7-day average'));
  });

  it('explains the total-carbs outline only when one is drawn', () => {
    assert.ok(renderWith({ hasAverageLine: false, hasCarbsOutline: true }).includes('total carbs'));
    assert.ok(!renderWith({ hasAverageLine: false, hasCarbsOutline: false }).includes('total carbs'));
  });

  it('draws the floor swatch in the metric hue, protein in the protein token', () => {
    const protein = renderToStaticMarkup(withI18n(createElement(TrendLegend, { metric: 'protein', hasGoal: true })));

    assert.ok(protein.includes('border-macro-protein'));
    assert.ok(!protein.includes('border-primary'));
    assert.ok(!protein.includes('Over your goal'), 'a floor has nothing to be over');
  });
});
