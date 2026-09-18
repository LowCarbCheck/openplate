/**
 * Unit tests for `#app/lib/gamification/streak` (M235/01): the activity walk.
 *
 * The walk is the number a person is asked to trust, so the two cases that
 * would make it dishonest are asserted with a control that goes red against a
 * wrong implementation:
 *
 * - a gap day BREAKS the count (a walk that ignored holes would read 5, not 2),
 * - a day dated after today DOES NOT EXTEND it (a walk that took the list's
 *   maximum as its anchor would read 3, not 2).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_ACTIVE_STREAK_DAYS, activeDayKeys, computeActiveStreak } from '../../app/lib/gamification/streak';
import type { LocalActivityMark } from '../../app/lib/gamification/marks';

/** A mark row, keyed the way the store keys it. */
function mark(dayKey: string, signal: string): LocalActivityMark {
  return { id: `${dayKey}#${signal}`, dayKey, signal };
}

/** `count` consecutive day keys ending on `lastDay`, oldest first. */
function consecutiveDays(lastDay: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${lastDay}T00:00:00Z`);
  for (let index = 0; index < count; index++) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.toReversed();
}

describe('activeDayKeys', () => {
  it('returns the days carrying a counting signal, sorted and unique', () => {
    const days = activeDayKeys([
      mark('2026-09-18', 'log.food'),
      mark('2026-09-16', 'fast.run'),
      mark('2026-09-18', 'weight.log'),
    ]);

    assert.deepStrictEqual(days, ['2026-09-16', '2026-09-18']);
  });

  it('does not make a day active on a backup.export mark alone', () => {
    assert.deepStrictEqual(activeDayKeys([mark('2026-09-18', 'backup.export')]), []);
    // Control: the same day IS active once a counting signal joins it, so the
    // assertion above is about the signal and not about the day key.
    assert.deepStrictEqual(activeDayKeys([mark('2026-09-18', 'backup.export'), mark('2026-09-18', 'log.food')]), [
      '2026-09-18',
    ]);
  });

  it('ignores a signal id this build does not know', () => {
    assert.deepStrictEqual(activeDayKeys([mark('2026-09-18', 'recipe.cook')]), []);
  });

  it('returns nothing for no marks', () => {
    assert.deepStrictEqual(activeDayKeys([]), []);
  });
});

describe('computeActiveStreak', () => {
  it('counts today when today is active', () => {
    const streak = computeActiveStreak({
      activeDays: ['2026-09-16', '2026-09-17', '2026-09-18'],
      today: '2026-09-18',
    });

    assert.equal(streak, 3);
  });

  it('ends on yesterday when today is not active yet, so a morning check reads the run still standing', () => {
    const streak = computeActiveStreak({
      activeDays: ['2026-09-16', '2026-09-17'],
      today: '2026-09-18',
    });

    assert.equal(streak, 2);
  });

  it('reads zero when neither today nor yesterday is active', () => {
    const streak = computeActiveStreak({
      activeDays: ['2026-09-10', '2026-09-11'],
      today: '2026-09-18',
    });

    assert.equal(streak, 0);
  });

  it('reads zero with no active days at all', () => {
    assert.equal(computeActiveStreak({ activeDays: [], today: '2026-09-18' }), 0);
  });

  it('breaks on a gap day and counts only the run that touches today', () => {
    // Five active days with 2026-09-16 missing. A walk that ignored the hole
    // would read 5; the honest answer is the two days that reach today.
    const streak = computeActiveStreak({
      activeDays: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18'],
      today: '2026-09-18',
    });

    assert.equal(streak, 2);
  });

  it('does not extend the streak with a day dated after today', () => {
    // A device whose clock ran fast, or a mark pulled from a zone further
    // ahead. A walk anchored on the list's maximum would read 3.
    const streak = computeActiveStreak({
      activeDays: ['2026-09-17', '2026-09-18', '2026-09-19'],
      today: '2026-09-18',
    });

    assert.equal(streak, 2);
  });

  it('does not extend the streak when only a future day is active', () => {
    const streak = computeActiveStreak({ activeDays: ['2026-09-19', '2026-09-20'], today: '2026-09-18' });

    assert.equal(streak, 0);
  });

  it('tolerates duplicates in the input', () => {
    const streak = computeActiveStreak({
      activeDays: ['2026-09-18', '2026-09-18', '2026-09-17', '2026-09-17'],
      today: '2026-09-18',
    });

    assert.equal(streak, 2);
  });

  it('walks across a month and a year boundary', () => {
    const streak = computeActiveStreak({
      activeDays: ['2025-12-30', '2025-12-31', '2026-01-01'],
      today: '2026-01-01',
    });

    assert.equal(streak, 3);
  });

  it('counts a long unbroken run day for day', () => {
    const streak = computeActiveStreak({ activeDays: consecutiveDays('2026-09-18', 400), today: '2026-09-18' });

    assert.equal(streak, 400);
  });

  it('terminates at the bound instead of walking forever', () => {
    const days = consecutiveDays('2026-09-18', MAX_ACTIVE_STREAK_DAYS + 50);

    assert.equal(computeActiveStreak({ activeDays: days, today: '2026-09-18' }), MAX_ACTIVE_STREAK_DAYS);
  });
});
