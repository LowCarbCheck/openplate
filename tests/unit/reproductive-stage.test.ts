/**
 * The date-to-stage math (`app/lib/reproductive-stage`, M206/01).
 *
 * Every claim here is a PAIR: the day a band begins and the day before it, so a
 * boundary that moves by one day fails instead of passing on a happy midpoint.
 * A single "week 20 is trimester 2" assertion would stay green under almost any
 * off-by-one in the week count, which is the whole reason this file exists.
 *
 * `today` is a parameter everywhere, so none of this touches a clock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dueDateFromWeeksAlong,
  MAX_WEEKS_AHEAD,
  resolveGestation,
  resolveLactationMonths,
  type Gestation,
  type Trimester,
} from '../../app/lib/reproductive-stage';
import { shiftDate } from '../../app/lib/user-days';

const TODAY = '2026-01-01';

/** The gestation resolved for a due date `days` after `TODAY`. */
function gestationInDays(days: number): Gestation | null {
  return resolveGestation({ dueDate: shiftDate(TODAY, days), today: TODAY });
}

/** The expected trimester for a week, spelled out here rather than imported, so the test states the bands itself. */
function expectedTrimester(week: number): Trimester {
  if (week <= 13) return 1;
  if (week <= 27) return 2;
  return 3;
}

describe('resolveGestation trimester bands', () => {
  it('moves from trimester 1 to trimester 2 on the day week 14 begins, and not the day before', () => {
    // 26 weeks left is week 14; one more day is 27 weeks left, which is week 13.
    assert.deepEqual(gestationInDays(26 * 7), { week: 14, trimester: 2 });
    assert.deepEqual(gestationInDays(26 * 7 + 1), { week: 13, trimester: 1 });
  });

  it('moves from trimester 2 to trimester 3 on the day week 28 begins, and not the day before', () => {
    assert.deepEqual(gestationInDays(12 * 7), { week: 28, trimester: 3 });
    assert.deepEqual(gestationInDays(12 * 7 + 1), { week: 27, trimester: 2 });
  });

  it('reports the last week of the pregnancy on the due date itself', () => {
    assert.deepEqual(gestationInDays(0), { week: 40, trimester: 3 });
  });
});

describe('resolveGestation refusals', () => {
  it('clamps to week 1 rather than reporting a week below one', () => {
    // 42 weeks out would be 40 - 42 = -2 without the clamp.
    assert.deepEqual(gestationInDays(MAX_WEEKS_AHEAD * 7), { week: 1, trimester: 1 });
  });

  it('accepts a due date 42 weeks ahead and refuses one 43 weeks ahead', () => {
    assert.notEqual(gestationInDays(MAX_WEEKS_AHEAD * 7), null);
    assert.equal(gestationInDays((MAX_WEEKS_AHEAD + 1) * 7), null);
  });

  it('refuses a due date already past, which is spec 04 business and not a stage', () => {
    assert.equal(gestationInDays(-1), null);
    // The control: one day earlier in the same pair still resolves, so the
    // refusal above is the passed date and not a broken fixture.
    assert.notEqual(gestationInDays(0), null);
  });

  it('refuses a missing or unparseable date', () => {
    assert.equal(resolveGestation({ dueDate: null, today: TODAY }), null);
    assert.equal(resolveGestation({ dueDate: undefined, today: TODAY }), null);
    assert.equal(resolveGestation({ dueDate: '2026-13-40', today: TODAY }), null);
    assert.equal(resolveGestation({ dueDate: 'next spring', today: TODAY }), null);
    assert.equal(resolveGestation({ dueDate: '2026-06-01', today: 'sometime' }), null);
  });
});

describe('resolveLactationMonths', () => {
  it('turns the month over on the day of the month it started, and not the day before', () => {
    const startDate = '2026-01-15';
    assert.equal(resolveLactationMonths({ startDate, today: '2026-07-15' }), 6);
    assert.equal(resolveLactationMonths({ startDate, today: '2026-07-14' }), 5);
  });

  it('counts across a year boundary', () => {
    assert.equal(resolveLactationMonths({ startDate: '2025-11-20', today: '2026-02-20' }), 3);
    assert.equal(resolveLactationMonths({ startDate: '2025-11-20', today: '2026-02-19' }), 2);
  });

  it('reads the first month as zero, not as one', () => {
    assert.equal(resolveLactationMonths({ startDate: '2026-01-15', today: '2026-01-15' }), 0);
    assert.equal(resolveLactationMonths({ startDate: '2026-01-15', today: '2026-02-14' }), 0);
  });

  it('refuses a missing, unparseable or future date', () => {
    assert.equal(resolveLactationMonths({ startDate: null, today: TODAY }), null);
    assert.equal(resolveLactationMonths({ startDate: undefined, today: TODAY }), null);
    assert.equal(resolveLactationMonths({ startDate: '2026-02-30', today: TODAY }), null);
    assert.equal(resolveLactationMonths({ startDate: '2026-01-02', today: TODAY }), null);
    // The control for the future refusal: the same start date one day later reads 0.
    assert.equal(resolveLactationMonths({ startDate: '2026-01-02', today: '2026-01-02' }), 0);
  });
});

describe('dueDateFromWeeksAlong', () => {
  it('round-trips every week through resolveGestation', () => {
    for (const weeks of [1, 13, 14, 27, 28, 40]) {
      const dueDate = dueDateFromWeeksAlong({ weeks, today: TODAY });
      assert.deepEqual(
        resolveGestation({ dueDate, today: TODAY }),
        { week: weeks, trimester: expectedTrimester(weeks) },
        `week ${weeks} did not survive the round trip through ${dueDate}`,
      );
    }
  });

  it('puts a full-term due date 40 weeks out and a week-20 one 20 weeks out', () => {
    assert.equal(dueDateFromWeeksAlong({ weeks: 0, today: TODAY }), shiftDate(TODAY, 280));
    assert.equal(dueDateFromWeeksAlong({ weeks: 20, today: TODAY }), shiftDate(TODAY, 140));
    assert.equal(dueDateFromWeeksAlong({ weeks: 40, today: TODAY }), TODAY);
  });
});
