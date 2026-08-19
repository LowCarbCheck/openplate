/**
 * Unit tests for `#app/components/trends/sparse-trend-notice` — the honest
 * stand-in that replaces the bar chart under `MIN_TREND_DAYS` logged days
 * (M129/04). The point of the component is the sentence, so the sentence is
 * what's pinned here: it must state the real count, and it must never phrase a
 * thin week as the user's failure (DESIGN.md §10.1/§10.5).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { MIN_TREND_DAYS, SparseTrendNotice } from '../../app/components/trends/sparse-trend-notice';

function render(loggedDays: number): string {
  return renderToStaticMarkup(withI18n(createElement(SparseTrendNotice, { loggedDays })));
}

describe('SparseTrendNotice', () => {
  it('needs three days — two points are a line, not a pattern', () => {
    assert.equal(MIN_TREND_DAYS, 3);
  });

  it('counts the days the user actually has', () => {
    assert.match(render(2), /Trends need a few more days to mean anything — you’ve got 2\./);
    assert.match(render(1), /you’ve got 1\./);
  });

  it('phrases a zero-day window as "none in this stretch", never "0"', () => {
    const html = render(0);

    assert.match(html, /you’ve got none in this stretch\./);
    assert.ok(!html.includes('got 0.'));
  });

  it('reassures rather than scolds — no "you failed to log" framing', () => {
    const html = render(1);

    assert.ok(html.includes('Nothing is lost in the meantime'));
    for (const scold of ['failed', "haven't", 'only', 'missing']) {
      assert.ok(!html.toLowerCase().includes(scold), `sparse copy must not say "${scold}"`);
    }
  });

  it('uses the established empty-state pattern — dashed brand-soft panel with the plate glyph', () => {
    const html = render(2);

    assert.ok(html.includes('surface-brand-soft'));
    assert.ok(html.includes('border-dashed'));
    assert.ok(html.includes('<svg'), 'the PlateGlyph mark is present');
  });
});
