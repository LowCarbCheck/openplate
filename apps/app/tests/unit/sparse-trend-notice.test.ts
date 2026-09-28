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

/**
 * Every WHOLE class token in the markup, from every `class` attribute.
 *
 * Whole tokens, never a substring: `markup.includes('border-border')` also
 * matches `border-border-strong`, and `includes('border-primary')` matches a
 * `hover:border-primary/40` that is not a resting edge at all. Splitting on
 * whitespace is what makes the absence claims below mean what they say.
 *
 * @param html - rendered markup.
 * @returns the class tokens, in document order, with duplicates kept.
 */
function classTokens(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
    (match[1] ?? '').split(/\s+/).filter((token) => token.length > 0),
  );
}

describe('SparseTrendNotice', () => {
  it('needs three days — two points are a line, not a pattern', () => {
    assert.equal(MIN_TREND_DAYS, 3);
  });

  it('counts the days the user actually has', () => {
    assert.match(render(2), /Trends need a few more days to mean anything, you’ve got 2\./);
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

  it('uses the established empty-state pattern, a dashed soft panel with the plate glyph', () => {
    const html = render(2);

    assert.ok(classTokens(html).includes('surface-brand-soft'));
    assert.ok(classTokens(html).includes('border-dashed'));
    assert.ok(html.includes('<svg'), 'the PlateGlyph mark is present');
  });

  /**
   * M243 spec 04: the panel's EDGE is an ordinary hairline now. The dashes say
   * "placeholder"; a brand-tinted edge said "this panel matters", which is the
   * opposite of what an empty state means.
   */
  it('draws the dashed edge in the border colour, never in the brand colour', () => {
    const tokens = classTokens(render(2));

    assert.ok(tokens.includes('border-border'), 'the placeholder edge is the ordinary hairline');
    assert.ok(
      !tokens.some((token) => token.startsWith('border-primary')),
      'no brand-tinted edge may be on the panel',
    );

    // CONTROL: the recipe exactly as it shipped before M243 spec 04 fails both
    // halves of the claim, so neither is an assertion that cannot go red.
    const preFix = classTokens(
      '<div class="surface-brand-soft flex flex-col items-center gap-3 rounded-lg border border-dashed border-primary/30 px-4 py-8 text-center"></div>',
    );
    assert.ok(!preFix.includes('border-border'), 'CONTROL: the old recipe has no ordinary hairline');
    assert.ok(
      preFix.some((token) => token.startsWith('border-primary')),
      'CONTROL: the old recipe does carry a brand-tinted edge',
    );
  });
});
