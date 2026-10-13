/**
 * `#app/lib/nutrient-window`: which days a `/nutrients` URL reads, and the
 * links the diary and Insights build into it.
 *
 * Every fallback has a control: the same URL with the one fact changed that
 * must keep the asked-for window. A resolver that always answered the default
 * would pass each fallback case and fail its control.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NUTRIENT_RANGE,
  nutrientRangeFor,
  nutrientsDayHref,
  nutrientsRangeHref,
  parseNutrientRange,
  resolveNutrientWindow,
} from '../../app/lib/nutrient-window';

const TODAY = '2026-10-11';

describe('resolveNutrientWindow', () => {
  it('reads one day on its own from `day`', () => {
    assert.deepEqual(resolveNutrientWindow({ day: '2026-10-09', range: null, today: TODAY }), {
      kind: 'day',
      day: '2026-10-09',
      fromDate: '2026-10-09',
      toDate: '2026-10-09',
    });
  });

  it('lets `day` win over `range`', () => {
    const window = resolveNutrientWindow({ day: '2026-10-09', range: '30', today: TODAY });
    assert.equal(window.kind, 'day');
  });

  it('accepts today itself as a day', () => {
    assert.equal(resolveNutrientWindow({ day: TODAY, range: null, today: TODAY }).kind, 'day');
  });

  it('falls back to the 7-day default for a day after today', () => {
    assert.deepEqual(resolveNutrientWindow({ day: '2026-10-12', range: null, today: TODAY }), {
      kind: 'range',
      range: 7,
      fromDate: '2026-10-05',
      toDate: TODAY,
    });
  });

  it('falls back to the 7-day default for a malformed or impossible day', () => {
    for (const day of ['yesterday', '2026-13-01', '2026-02-30', '']) {
      const window = resolveNutrientWindow({ day, range: null, today: TODAY });
      assert.equal(window.kind, 'range', day);
      assert.equal(window.kind === 'range' && window.range, DEFAULT_NUTRIENT_RANGE, day);
    }
  });

  it('keeps an asked-for range when the day is invalid (control for the fallback)', () => {
    const window = resolveNutrientWindow({ day: 'yesterday', range: '14', today: TODAY });
    assert.deepEqual(window, { kind: 'range', range: 14, fromDate: '2026-09-28', toDate: TODAY });
  });

  it('reads the last N days ending today, today included', () => {
    assert.deepEqual(resolveNutrientWindow({ day: null, range: '30', today: TODAY }), {
      kind: 'range',
      range: 30,
      fromDate: '2026-09-12',
      toDate: TODAY,
    });
  });
});

describe('parseNutrientRange', () => {
  it('reads each offered window', () => {
    assert.equal(parseNutrientRange('7'), 7);
    assert.equal(parseNutrientRange('14'), 14);
    assert.equal(parseNutrientRange('30'), 30);
  });

  it('answers the default for anything not offered', () => {
    for (const raw of [null, '', '90', '0', 'week']) {
      assert.equal(parseNutrientRange(raw), DEFAULT_NUTRIENT_RANGE, String(raw));
    }
  });
});

describe('nutrientRangeFor', () => {
  it('maps each Insights range onto the window that answers it', () => {
    assert.equal(nutrientRangeFor(7), 7);
    assert.equal(nutrientRangeFor(14), 14);
    assert.equal(nutrientRangeFor(30), 30);
  });

  it('maps 90 days to the longest window, 30 (control: 30 maps to itself above)', () => {
    assert.equal(nutrientRangeFor(90), 30);
  });
});

describe('the deep links', () => {
  it('name the day or the range, with no trailing slash', () => {
    assert.equal(nutrientsDayHref('2026-10-09'), '/nutrients?day=2026-10-09');
    assert.equal(nutrientsRangeHref(14), '/nutrients?range=14');
  });

  it('round-trip through the resolver', () => {
    const dayParams = new URL(nutrientsDayHref('2026-10-09'), 'http://local.test').searchParams;
    assert.equal(resolveNutrientWindow({ day: dayParams.get('day'), range: dayParams.get('range'), today: TODAY }).kind, 'day');
    const rangeParams = new URL(nutrientsRangeHref(30), 'http://local.test').searchParams;
    const window = resolveNutrientWindow({ day: rangeParams.get('day'), range: rangeParams.get('range'), today: TODAY });
    assert.equal(window.kind === 'range' && window.range, 30);
  });
});
