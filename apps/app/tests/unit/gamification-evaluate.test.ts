/**
 * Unit tests for `#app/lib/gamification/evaluate` (M235/01).
 *
 * The evaluator only ever adds. The tests that matter here are the ones that
 * would catch a revocation sneaking in: a key already held is never returned
 * again, a shrinking streak takes nothing back, and the on-plan family stays
 * silent when no carb ceiling is set. Each of those has a control case that
 * goes red if the rule were inverted.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AWARDS } from '../../app/lib/gamification/catalog';
import { evaluateAwards } from '../../app/lib/gamification/evaluate';
import type { LocalActivityMark } from '../../app/lib/gamification/marks';

const TODAY = '2026-09-18';
const NOW = 1_789_000_000_000;

/** A mark row, keyed the way the store keys it. */
function mark(dayKey: string, signal: string): LocalActivityMark {
  return { id: `${dayKey}#${signal}`, dayKey, signal };
}

/** The evaluator with everything at its quietest, so each test states only what it changes. */
function evaluateKeys({
  marks = [],
  activeStreak = 0,
  onPlanStreak = null,
  earnedKeys = [],
}: {
  marks?: readonly LocalActivityMark[];
  activeStreak?: number;
  onPlanStreak?: number | null;
  earnedKeys?: readonly string[];
}): string[] {
  return evaluateAwards({ marks, activeStreak, onPlanStreak, earnedKeys, today: TODAY, now: NOW }).map(
    (award) => award.key,
  );
}

describe('evaluateAwards, explorer family', () => {
  it('earns one badge per signal that has ever been marked', () => {
    const keys = evaluateKeys({ marks: [mark('2026-09-01', 'fast.run'), mark(TODAY, 'log.food')] });

    assert.deepStrictEqual(keys, ['explorer.log.food', 'explorer.fast.run']);
  });

  it('earns nothing for a signal never marked', () => {
    const keys = evaluateKeys({ marks: [mark(TODAY, 'log.food')] });

    assert.equal(keys.includes('explorer.weight.log'), false);
    // Control: the badge for the signal that WAS marked is there, so the
    // assertion above is about the signal and not about an empty result.
    assert.equal(keys.includes('explorer.log.food'), true);
  });

  it('earns the backup.export badge, which is the one signal that never extends the streak', () => {
    const keys = evaluateKeys({ marks: [mark(TODAY, 'backup.export')] });

    assert.deepStrictEqual(keys, ['explorer.backup.export']);
  });

  it('ignores a signal id this build has no award for', () => {
    assert.deepStrictEqual(evaluateKeys({ marks: [mark(TODAY, 'recipe.cook')] }), []);
  });
});

describe('evaluateAwards, streak family', () => {
  it('earns every threshold at or below the current run, in catalog order', () => {
    const keys = evaluateKeys({ activeStreak: 14 });

    assert.deepStrictEqual(keys, ['streak.active.3', 'streak.active.7', 'streak.active.14']);
  });

  it('earns nothing below the first threshold', () => {
    assert.deepStrictEqual(evaluateKeys({ activeStreak: 2 }), []);
    // Control: one more day and the first threshold does land.
    assert.deepStrictEqual(evaluateKeys({ activeStreak: 3 }), ['streak.active.3']);
  });
});

describe('evaluateAwards, on-plan family', () => {
  it('says nothing at all when no carb ceiling is set', () => {
    const keys = evaluateKeys({ onPlanStreak: null, activeStreak: 100 });

    assert.equal(
      keys.some((key) => key.startsWith('onplan.')),
      false,
    );
    // Control: the same long run WITH a ceiling earns the whole family, so the
    // silence above is the null ceiling and not a broken threshold check.
    const withCeiling = evaluateKeys({ onPlanStreak: 100, activeStreak: 100 });
    assert.deepStrictEqual(
      withCeiling.filter((key) => key.startsWith('onplan.')),
      ['onplan.7', 'onplan.14', 'onplan.30', 'onplan.100'],
    );
  });

  it('is a separate count from the activity streak', () => {
    const keys = evaluateKeys({ activeStreak: 30, onPlanStreak: 7 });

    assert.deepStrictEqual(keys, [
      'streak.active.3',
      'streak.active.7',
      'streak.active.14',
      'streak.active.30',
      'onplan.7',
    ]);
  });
});

describe('evaluateAwards, never twice and never revoked', () => {
  it('never returns a key already earned', () => {
    const keys = evaluateKeys({ activeStreak: 7, earnedKeys: ['streak.active.3'] });

    assert.deepStrictEqual(keys, ['streak.active.7']);
    // Control: without the earned key the same input returns it, so the filter
    // is doing the work and the input is not simply wrong.
    assert.deepStrictEqual(evaluateKeys({ activeStreak: 7 }), ['streak.active.3', 'streak.active.7']);
  });

  it('takes nothing back when the streak falls to zero', () => {
    const keys = evaluateKeys({ activeStreak: 0, earnedKeys: ['streak.active.3', 'streak.active.7'] });

    assert.deepStrictEqual(keys, []);
  });

  it('is monotone: more marks keep everything the smaller input had earned', () => {
    const first = [mark('2026-09-01', 'log.food')];
    const both = [...first, mark(TODAY, 'fast.run')];

    const earlier = evaluateKeys({ marks: first, activeStreak: 3 });
    const later = evaluateKeys({ marks: both, activeStreak: 7, earnedKeys: earlier });
    const freshWithEverything = evaluateKeys({ marks: both, activeStreak: 7 });

    assert.deepStrictEqual([...earlier, ...later].toSorted(), freshWithEverything.toSorted());
  });

  it('returns nothing once every key in the catalog is held', () => {
    const everything = AWARDS.map((award) => award.key);
    const marks = [mark(TODAY, 'log.food'), mark(TODAY, 'backup.export')];

    assert.deepStrictEqual(evaluateKeys({ marks, activeStreak: 100, onPlanStreak: 100, earnedKeys: everything }), []);
  });
});

describe('evaluateAwards, the written row', () => {
  it('stamps the clock and the day it was given, and leaves the note unseen', () => {
    const rows = evaluateAwards({
      marks: [mark(TODAY, 'log.food')],
      activeStreak: 0,
      onPlanStreak: null,
      earnedKeys: [],
      today: TODAY,
      now: NOW,
    });

    assert.deepStrictEqual(rows, [{ key: 'explorer.log.food', earnedAt: NOW, earnedOnDay: TODAY, seenAt: null }]);
  });
});
