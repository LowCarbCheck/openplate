/**
 * Unit tests for `#app/lib/streak-message`'s `describeStreak` — the profile
 * streak card's copy selection. Covers the bug this module fixes: a `streak`
 * of `0` on a day that DOES have logs (an over-goal day) must never resolve to
 * the "nothing logged yet" key, since that's false.
 *
 * The copy itself moved into the i18n catalog (M129/05), so these tests assert
 * on the KEY the module selects (and the interpolation it passes) rather than
 * on English sentences — the distinction each case was written to protect.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeStreak, type Translate } from '../../app/lib/streak-message';

/** Renders `key` plus any interpolation params, so both are assertable without i18next. */
const fakeT: Translate = (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`);

describe('describeStreak', () => {
  it('reports a positive streak, passing the count through for plural selection', () => {
    assert.equal(describeStreak({ streak: 1, todayHasLogs: true }, fakeT), 'trends.streak.active {"count":1}');
  });

  it('passes the real streak length for a multi-day streak', () => {
    assert.equal(describeStreak({ streak: 5, todayHasLogs: true }, fakeT), 'trends.streak.active {"count":5}');
  });

  it('invites the first log when today genuinely has nothing logged', () => {
    assert.equal(describeStreak({ streak: 0, todayHasLogs: false }, fakeT), 'trends.streak.empty');
  });

  it('does not claim nothing was logged when today has logs but broke the streak (over goal)', () => {
    const message = describeStreak({ streak: 0, todayHasLogs: true }, fakeT);
    assert.notEqual(message, 'trends.streak.empty');
    assert.equal(message, 'trends.streak.overGoal');
  });
});
