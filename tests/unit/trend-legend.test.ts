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
