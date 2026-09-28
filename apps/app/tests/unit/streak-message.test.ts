/**
 * Unit tests for `#app/lib/streak-message`'s `describeStreak`, the streak
 * line on `/trends` and in the header of `/dashboard`'s grid card.
 *
 * ── WHAT THIS FILE STOPPED TESTING, AND WHY ──────────────────────────────
 *
 * It used to carry a fourth case: a streak of `0` on a day that DID have logs,
 * which the adherence walk produced for anybody who went over their carb goal,
 * and which needed a sentence of its own (`trends.streak.overGoal`) so the card
 * did not tell them nothing was logged. M235/06 replaced the headline with the
 * ACTIVITY streak, which counts a day a person USED the app, so that state
 * cannot be reached and the branch is gone with it. The adherence walk itself
 * still exists and still has its own tests (`local-aggregates.test.ts`); it
 * feeds the `onplan.*` awards now.
 *
 * The copy lives in the i18n catalog (M129/05), so these tests assert on the
 * KEY the module selects and on the interpolation it passes, never on an
 * English sentence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeStreak, type Translate } from '../../app/lib/streak-message';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

describe('describeStreak', () => {
  it('reports a positive streak, passing the count through for plural selection', () => {
    assert.equal(describeStreak(1, fakeT), 'trends.streak.active {"count":1}');
  });

  it('passes the real streak length for a multi-day streak', () => {
    assert.equal(describeStreak(5, fakeT), 'trends.streak.active {"count":5}');
  });

  it('invites the first use of the day when there is no streak', () => {
    assert.equal(describeStreak(0, fakeT), 'trends.streak.empty');
  });

  it('says nothing about a streak that ended, in either branch', () => {
    // No loss language anywhere in this milestone's copy: the two keys this
    // module can select are the only two, and neither is about an ending. A
    // third key appearing here would fail this.
    const keys = new Set([describeStreak(0, fakeT), describeStreak(3, fakeT).split(' ')[0]]);
    assert.deepEqual([...keys].toSorted(), ['trends.streak.active', 'trends.streak.empty']);
  });
});
