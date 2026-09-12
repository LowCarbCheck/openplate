/**
 * The `/fasting` line's floor.
 *
 * `fastingNow` counts the person reading it, so the sentence says
 * `fastingNow - 1`, and the floor is applied to `fastingNow`: at three the
 * line says two others, at two there is no line at all. The function can
 * therefore never produce a zero, which is the requirement, "0 others are
 * fasting" is worse than silence.
 *
 * The three case is the control for the two and zero cases, exactly as in the
 * tile's test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { withI18n } from './trends-i18n-harness';
import { PulseFastingLine } from '../../app/components/pulse-fasting-line';
import { othersFastingLine, type PulseToday } from '../../app/lib/pulse';

function today(fastingNow: number): PulseToday {
  return { day: '2026-09-12', meals: 0, photos: 0, kcal: 0, protein: 0, contributors: 12, fastingNow };
}

function render(value: PulseToday | null): string {
  return renderToStaticMarkup(withI18n(createElement(PulseFastingLine, { today: value })));
}

describe('othersFastingLine', () => {
  it('counts the others, and only above the floor', () => {
    assert.equal(othersFastingLine(today(3)), 2);
    assert.equal(othersFastingLine(today(9)), 8);
    assert.equal(othersFastingLine(today(2)), null);
    assert.equal(othersFastingLine(today(0)), null);
    assert.equal(othersFastingLine(null), null);
  });
});

describe('the fasting line', () => {
  it('renders the sentence at three', () => {
    const markup = render(today(3));
    assert.match(markup, /2 others are fasting right now/);
  });

  it('renders nothing at two, at none, and before the read lands', () => {
    assert.equal(render(today(2)), '');
    assert.equal(render(today(0)), '');
    assert.equal(render(null), '');
  });

  it('never renders a zero count', () => {
    for (const markup of [render(today(2)), render(today(1)), render(today(0))]) {
      assert.doesNotMatch(markup, /0 others/);
    }
  });
});
